import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getUsage, invalidateCache, enforceQuota, LIMITS } from '../../js/core/quota-guard.js';
import { db } from '../../js/core/db.js';
import { bus } from '../../js/core/event-bus.js';
import { resetAll } from '../helpers.js';
import { now } from '../../js/core/utils.js';

let seedCounter = 0;
async function seedWhiteboardBytes(roomId, approxBytesEach, count) {
  // Each item JSON-stringifies to roughly `approxBytesEach`; we pad with a filler string.
  // A monotonically increasing counter prevents accidental id collisions across seed calls
  // in the same test (which would overwrite rather than append).
  for (let i = 0; i < count; i++) {
    seedCounter += 1;
    await db.put('whiteboardElements', {
      id: `${roomId}-el-${seedCounter}`,
      roomId,
      type: 'rect',
      x: 0, y: 0, width: 10, height: 10,
      filler: 'x'.repeat(approxBytesEach),
      createdAt: now(),
      updatedAt: now()
    });
  }
}

/**
 * Blob shim: lets us report synthetic byte sizes for quota tests without allocating
 * actual 200 MB strings (which overflow jsdom's Blob + V8 string length limits).
 *
 * Rows seeded with `__quotaSize` field are reported at exactly that many bytes when
 * `estimateSize` calls `new Blob([...]).size`. All other Blob constructions fall through
 * to the real implementation so tests elsewhere are unaffected.
 */
const RealBlob = globalThis.Blob;
function installSyntheticBlob() {
  globalThis.Blob = class QuotaBlob extends RealBlob {
    constructor(parts, options) {
      super(parts, options);
      // Scan the serialized content for our marker
      for (const part of parts || []) {
        if (typeof part === 'string') {
          const m = part.match(/"__quotaSize":(\d+)/);
          if (m) {
            this._syntheticSize = parseInt(m[1], 10);
            return;
          }
        }
      }
    }
    get size() {
      return this._syntheticSize ?? super.size;
    }
  };
}
function uninstallSyntheticBlob() {
  globalThis.Blob = RealBlob;
}

describe('core/quota-guard (direct, real IDB via fake-indexeddb)', () => {
  beforeEach(async () => {
    await resetAll();
    invalidateCache('r-warn');
    invalidateCache('r-over');
    invalidateCache('r-cache');
    invalidateCache('r-empty');
    invalidateCache('r-multi');
  });

  afterEach(() => {
    bus.clear();
    uninstallSyntheticBlob();
  });

  describe('LIMITS surface', () => {
    it('exports deterministic STORAGE_LIMIT=200MB and STORAGE_WARNING=180MB values', () => {
      expect(LIMITS.STORAGE_LIMIT).toBe(200 * 1024 * 1024);
      expect(LIMITS.STORAGE_WARNING).toBe(180 * 1024 * 1024);
    });
  });

  describe('getUsage: input (DB rows) → output (bytes)', () => {
    it('returns 0 for a room with no rows in any tracked store', async () => {
      const used = await getUsage('r-empty');
      expect(used).toBe(0);
    });

    it('sums JSON-Blob size across all tracked stores for the given roomId only', async () => {
      // Seed 10 elements at ~100 bytes of filler in r-multi
      await seedWhiteboardBytes('r-multi', 100, 10);
      // Seed an element in a DIFFERENT room — must NOT contribute
      await seedWhiteboardBytes('r-other', 1000, 1);

      const used = await getUsage('r-multi');
      // Lower bound: 10 items × 100 bytes of filler = 1000 bytes (plus JSON scaffold overhead)
      expect(used).toBeGreaterThan(1000);
      // Upper bound: generous ceiling (each row is small; filler + scaffold well under 500b)
      expect(used).toBeLessThan(10_000);
    });

    it('includes chatMessages, stickyNotes, comments, etc. — not just whiteboardElements', async () => {
      await db.put('chatMessages', {
        id: 'm1', roomId: 'r-multi', authorId: 'u1',
        text: 'y'.repeat(200), createdAt: now()
      });
      await db.put('stickyNotes', {
        id: 's1', roomId: 'r-multi',
        title: 'T', body: 'z'.repeat(200), color: 'yellow',
        createdAt: now(), updatedAt: now()
      });

      const used = await getUsage('r-multi');
      expect(used).toBeGreaterThan(400); // both fillers contribute
    });
  });

  describe('cache: TTL + invalidation', () => {
    it('within TTL: repeated calls return the same value even after new rows are added (cache hit)', async () => {
      await seedWhiteboardBytes('r-cache', 50, 5);
      const first = await getUsage('r-cache');
      expect(first).toBeGreaterThan(0);

      // Add more data — cache should still short-circuit within 10s TTL
      await seedWhiteboardBytes('r-cache', 50, 5);
      const second = await getUsage('r-cache');
      expect(second).toBe(first);
    });

    it('invalidateCache(roomId) forces a fresh sum on the next call', async () => {
      await seedWhiteboardBytes('r-cache', 50, 5);
      const before = await getUsage('r-cache');

      await seedWhiteboardBytes('r-cache', 50, 5);
      invalidateCache('r-cache');
      const after = await getUsage('r-cache');
      expect(after).toBeGreaterThan(before);
    });
  });

  describe('enforceQuota: state transitions', () => {
    it('is a no-op when usage is below the warning threshold (no throw, no event)', async () => {
      await seedWhiteboardBytes('r-warn', 100, 2); // tiny
      const events = [];
      bus.on('room:storage-warning', (e) => events.push(e));
      invalidateCache('r-warn');

      await expect(enforceQuota('r-warn')).resolves.toBeUndefined();
      expect(events).toEqual([]);
    });

    it('emits room:storage-warning when usage is in [WARNING, LIMIT) but does not throw', async () => {
      installSyntheticBlob();
      await db.put('whiteboardElements', {
        id: 'r-warn-el-1', roomId: 'r-warn', type: 'rect',
        __quotaSize: LIMITS.STORAGE_WARNING + 1024  // 180MB + 1KB
      });

      const events = [];
      bus.on('room:storage-warning', (e) => events.push(e));
      invalidateCache('r-warn');

      await expect(enforceQuota('r-warn')).resolves.toBeUndefined();

      expect(events).toHaveLength(1);
      expect(events[0].roomId).toBe('r-warn');
      expect(events[0].limit).toBe(LIMITS.STORAGE_LIMIT);
      expect(events[0].warning).toBe(LIMITS.STORAGE_WARNING);
      expect(events[0].used).toBeGreaterThanOrEqual(LIMITS.STORAGE_WARNING);
      expect(events[0].used).toBeLessThan(LIMITS.STORAGE_LIMIT);
    });

    it('throws with an actionable error message when usage is at or above STORAGE_LIMIT', async () => {
      installSyntheticBlob();
      await db.put('whiteboardElements', {
        id: 'r-over-el-1', roomId: 'r-over', type: 'rect',
        __quotaSize: LIMITS.STORAGE_LIMIT + 1024
      });

      invalidateCache('r-over');

      await expect(enforceQuota('r-over')).rejects.toThrow(/Storage limit exceeded/);
      invalidateCache('r-over');
      await expect(enforceQuota('r-over')).rejects.toThrow(/200 MB/);
      invalidateCache('r-over');
      await expect(enforceQuota('r-over')).rejects.toThrow(/Delete unused content/);
    });
  });
});
