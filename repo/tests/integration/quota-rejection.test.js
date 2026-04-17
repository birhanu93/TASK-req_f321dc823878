import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetAll, setCurrentUser } from '../helpers.js';
import { roomService } from '../../js/services/room-service.js';
import { whiteboardService } from '../../js/services/whiteboard-service.js';
import { stickyService } from '../../js/services/sticky-service.js';
import { chatService } from '../../js/services/chat-service.js';
import { autosave } from '../../js/core/autosave.js';
import { db } from '../../js/core/db.js';
import { bus } from '../../js/core/event-bus.js';
import { invalidateCache, LIMITS } from '../../js/core/quota-guard.js';

/**
 * Reduced boundary mocking:
 *  - Previously this suite replaced `enforceQuota` wholesale with
 *    `vi.spyOn(...).mockRejectedValue(...)`, so the tests never exercised the real
 *    threshold logic in `quota-guard.js`.
 *  - Now the real `enforceQuota` runs for every assertion. The only shim is on the
 *    `Blob` global: rows seeded with a `__quotaSize` marker are reported at exactly
 *    that byte count by our synthetic Blob, which lets the real estimateSize sum
 *    cross the 200 MB threshold without allocating a literal 200 MB string (which
 *    hits V8's array-length cap in this runtime). Every service path under test —
 *    the activity log, event bus, IDB writes, autosave — runs for real.
 */

const RealBlob = globalThis.Blob;
function installSyntheticBlob() {
  globalThis.Blob = class QuotaBlob extends RealBlob {
    constructor(parts, options) {
      super(parts, options);
      for (const part of parts || []) {
        if (typeof part === 'string') {
          const m = part.match(/"__quotaSize":(\d+)/);
          if (m) { this._syntheticSize = parseInt(m[1], 10); return; }
        }
      }
    }
    get size() { return this._syntheticSize ?? super.size; }
  };
}
function uninstallSyntheticBlob() {
  globalThis.Blob = RealBlob;
}

async function seedSynthetic(roomId, bytes) {
  // Seed into activityLogs — that store is also tracked by quota-guard but is NOT
  // read by the services under test, so synthetic quota rows cannot pollute the
  // whiteboard/sticky/chat reads we assert on.
  await db.put('activityLogs', {
    id: `${roomId}-synthetic-quota-row`,
    roomId,
    action: 'synthetic-quota-seed',
    __quotaSize: bytes,
    createdAt: Date.now()
  });
  invalidateCache(roomId);
}

describe('Integration: Hard quota rejection across services (real enforceQuota, real services)', () => {
  let room;

  beforeEach(async () => {
    await resetAll();
    setCurrentUser();
    autosave.destroy();
    autosave.init(async () => {});
    installSyntheticBlob();
    room = await roomService.createRoom('Quota Room');
  });

  afterEach(() => {
    uninstallSyntheticBlob();
    autosave.destroy();
  });

  it('rejects whiteboardService.createElement when usage >= STORAGE_LIMIT (real enforceQuota)', async () => {
    await seedSynthetic(room.id, LIMITS.STORAGE_LIMIT + 1024);
    await expect(
      whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0 })
    ).rejects.toThrow(/Storage limit exceeded/);
  });

  it('error message formatted by the real formatter includes "200 MB" and the cleanup hint', async () => {
    await seedSynthetic(room.id, LIMITS.STORAGE_LIMIT + 1024);
    await expect(
      whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0 })
    ).rejects.toThrow(/200 MB/);
    invalidateCache(room.id);
    await expect(
      whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0 })
    ).rejects.toThrow(/Delete unused content/);
  });

  it('rejects whiteboardService.addComment when over quota', async () => {
    const el = await whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0 });
    await seedSynthetic(room.id, LIMITS.STORAGE_LIMIT + 1024);
    await expect(
      whiteboardService.addComment(el.id, 'Test comment')
    ).rejects.toThrow(/Storage limit exceeded/);
  });

  it('rejects stickyService.createNote when over quota', async () => {
    await seedSynthetic(room.id, LIMITS.STORAGE_LIMIT + 1024);
    await expect(
      stickyService.createNote(room.id, { title: 'T', body: 'B' })
    ).rejects.toThrow(/Storage limit exceeded/);
  });

  it('rejects stickyService.importCSV when over quota', async () => {
    await seedSynthetic(room.id, LIMITS.STORAGE_LIMIT + 1024);
    await expect(
      stickyService.importCSV(room.id, 'title,body\nA,B')
    ).rejects.toThrow(/Storage limit exceeded/);
  });

  it('rejects chatService.sendMessage when over quota', async () => {
    await seedSynthetic(room.id, LIMITS.STORAGE_LIMIT + 1024);
    await expect(
      chatService.sendMessage(room.id, 'hello')
    ).rejects.toThrow(/Storage limit exceeded/);
  });

  it('rejects roomService.createSnapshot when over quota', async () => {
    await seedSynthetic(room.id, LIMITS.STORAGE_LIMIT + 1024);
    await expect(
      roomService.createSnapshot(room.id, 'snap')
    ).rejects.toThrow(/Storage limit exceeded/);
  });

  it('reads remain allowed when over quota (no quota check on read paths)', async () => {
    await whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0 });
    await stickyService.createNote(room.id, { title: 'N', body: 'B' });
    await chatService.sendMessage(room.id, 'hi');

    await seedSynthetic(room.id, LIMITS.STORAGE_LIMIT + 1024);

    const elements = await whiteboardService.getElementsByRoom(room.id);
    expect(elements.length).toBe(1);
    const notes = await stickyService.getNotesByRoom(room.id);
    expect(notes.length).toBe(1);
    const messages = await chatService.getMessages(room.id);
    expect(messages.length).toBe(1);
  });

  it('deletes remain allowed when over quota (so users can free space)', async () => {
    const el = await whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0 });
    const note = await stickyService.createNote(room.id, { title: 'N', body: 'B' });

    await seedSynthetic(room.id, LIMITS.STORAGE_LIMIT + 1024);

    await whiteboardService.deleteElement(el.id);
    await stickyService.deleteNote(note.id);

    const elements = await whiteboardService.getElementsByRoom(room.id);
    expect(elements.length).toBe(0);
    const notes = await stickyService.getNotesByRoom(room.id);
    expect(notes.length).toBe(0);
  });

  it('emits the real room:storage-warning event when usage is in [WARNING, LIMIT)', async () => {
    const events = [];
    const handler = (e) => events.push(e);
    bus.on('room:storage-warning', handler);

    await seedSynthetic(room.id, LIMITS.STORAGE_WARNING + 1024);

    // Non-blocking warning: write succeeds AND the event is emitted by real enforceQuota
    await whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0 });

    expect(events.length).toBeGreaterThan(0);
    const warn = events[0];
    expect(warn.roomId).toBe(room.id);
    expect(warn.limit).toBe(LIMITS.STORAGE_LIMIT);
    expect(warn.warning).toBe(LIMITS.STORAGE_WARNING);
    expect(warn.used).toBeGreaterThanOrEqual(LIMITS.STORAGE_WARNING);
    expect(warn.used).toBeLessThan(LIMITS.STORAGE_LIMIT);

    bus.off('room:storage-warning', handler);
  });
});
