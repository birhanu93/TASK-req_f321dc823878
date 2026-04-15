import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetAll, setCurrentUser } from '../helpers.js';
import { db } from '../../js/core/db.js';
import { bus } from '../../js/core/event-bus.js';
import { sync } from '../../js/core/sync.js';
import { presenceService } from '../../js/services/presence-service.js';

beforeEach(async () => {
  await resetAll();
  setCurrentUser();
  // Ensure no leftover room state from previous tests
  presenceService.destroy();
  vi.useRealTimers();
});

describe('presenceService', () => {
  // ─── enterRoom ────────────────────────────────────────────────────
  describe('enterRoom', () => {
    it('should write a presence record to the database', async () => {
      await presenceService.enterRoom('room1');
      const tabId = sync.getTabId();
      const record = await db.get('presence', tabId);
      expect(record).toBeTruthy();
      expect(record.roomId).toBe('room1');
      expect(record.profileId).toBe('u1');
      expect(record.status).toBe('active');
      expect(record).toHaveProperty('lastHeartbeat');

      // Clean up
      await presenceService.leaveRoom();
    });

    it('should emit presence:enter event', async () => {
      const handler = vi.fn();
      bus.on('presence:enter', handler);
      await presenceService.enterRoom('room1');
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].roomId).toBe('room1');

      await presenceService.leaveRoom();
    });

    it('should leave previous room when entering a new one', async () => {
      await presenceService.enterRoom('room1');
      const leaveHandler = vi.fn();
      bus.on('presence:leave', leaveHandler);

      await presenceService.enterRoom('room2');
      expect(leaveHandler).toHaveBeenCalledTimes(1);
      expect(leaveHandler.mock.calls[0][0].roomId).toBe('room1');

      // Verify new room presence
      const tabId = sync.getTabId();
      const record = await db.get('presence', tabId);
      expect(record.roomId).toBe('room2');

      await presenceService.leaveRoom();
    });
  });

  // ─── leaveRoom ────────────────────────────────────────────────────
  describe('leaveRoom', () => {
    it('should delete the presence record', async () => {
      await presenceService.enterRoom('room1');
      const tabId = sync.getTabId();

      await presenceService.leaveRoom();
      const record = await db.get('presence', tabId);
      expect(record).toBeUndefined();
    });

    it('should emit presence:leave event', async () => {
      await presenceService.enterRoom('room1');
      const handler = vi.fn();
      bus.on('presence:leave', handler);

      await presenceService.leaveRoom();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].roomId).toBe('room1');
    });

    it('should be a no-op when not in any room', async () => {
      // Should not throw
      await presenceService.leaveRoom();
    });
  });

  // ─── setIdle ──────────────────────────────────────────────────────
  describe('setIdle', () => {
    it('should update status to idle', async () => {
      await presenceService.enterRoom('room1');
      await presenceService.setIdle();

      const tabId = sync.getTabId();
      const record = await db.get('presence', tabId);
      expect(record.status).toBe('idle');

      await presenceService.leaveRoom();
    });

    it('should emit presence:idle event', async () => {
      await presenceService.enterRoom('room1');
      const handler = vi.fn();
      bus.on('presence:idle', handler);

      await presenceService.setIdle();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].roomId).toBe('room1');

      await presenceService.leaveRoom();
    });

    it('should be a no-op when no presence record exists', async () => {
      // Should not throw
      await presenceService.setIdle();
    });
  });

  // ─── setActive ────────────────────────────────────────────────────
  describe('setActive', () => {
    it('should update status to active', async () => {
      await presenceService.enterRoom('room1');
      await presenceService.setIdle();
      await presenceService.setActive();

      const tabId = sync.getTabId();
      const record = await db.get('presence', tabId);
      expect(record.status).toBe('active');

      await presenceService.leaveRoom();
    });

    it('should emit presence:active event', async () => {
      await presenceService.enterRoom('room1');
      await presenceService.setIdle();

      const handler = vi.fn();
      bus.on('presence:active', handler);
      await presenceService.setActive();
      expect(handler).toHaveBeenCalledTimes(1);

      await presenceService.leaveRoom();
    });

    it('should update lastHeartbeat timestamp', async () => {
      await presenceService.enterRoom('room1');
      const tabId = sync.getTabId();
      const before = await db.get('presence', tabId);
      const beforeHb = before.lastHeartbeat;

      // Small delay to ensure timestamp difference
      await new Promise(r => setTimeout(r, 10));
      await presenceService.setActive();

      const after = await db.get('presence', tabId);
      expect(after.lastHeartbeat).toBeGreaterThanOrEqual(beforeHb);

      await presenceService.leaveRoom();
    });
  });

  // ─── getRoomPresence ──────────────────────────────────────────────
  describe('getRoomPresence', () => {
    it('should return active presence records for a room', async () => {
      await presenceService.enterRoom('room1');
      const records = await presenceService.getRoomPresence('room1');
      expect(records).toHaveLength(1);
      expect(records[0].roomId).toBe('room1');
      expect(records[0].status).toBe('active');

      await presenceService.leaveRoom();
    });

    it('should prune stale records (older than 30s)', async () => {
      // Manually insert a stale presence record
      const staleTabId = 'stale-tab-123';
      await db.put('presence', {
        tabId: staleTabId,
        profileId: 'u-stale',
        roomId: 'room1',
        status: 'active',
        lastHeartbeat: Date.now() - 60_000 // 60 seconds ago
      });

      // Also insert a fresh record
      await presenceService.enterRoom('room1');

      const records = await presenceService.getRoomPresence('room1');
      // Only the fresh record should remain
      expect(records).toHaveLength(1);
      expect(records[0].profileId).toBe('u1');

      // Stale record should have been removed from DB
      const stale = await db.get('presence', staleTabId);
      expect(stale).toBeUndefined();

      await presenceService.leaveRoom();
    });

    it('should return empty array for a room with no presence', async () => {
      const records = await presenceService.getRoomPresence('empty-room');
      expect(records).toHaveLength(0);
    });

    it('should not prune records within the 30s threshold', async () => {
      // Insert a record that is still fresh (5 seconds ago)
      await db.put('presence', {
        tabId: 'fresh-tab',
        profileId: 'u-fresh',
        roomId: 'room1',
        status: 'active',
        lastHeartbeat: Date.now() - 5_000
      });

      const records = await presenceService.getRoomPresence('room1');
      expect(records).toHaveLength(1);
      expect(records[0].profileId).toBe('u-fresh');
    });
  });

  // ─── Idle to Active Recovery ─────────────────────────────────────
  describe('idle-to-active recovery', () => {
    it('should track current status accurately through idle/active transitions', async () => {
      await presenceService.enterRoom('room1');

      // Initially active
      let record = presenceService._getCurrentRecord();
      expect(record).toBeTruthy();
      expect(record.status).toBe('active');

      // After setIdle, status should reflect idle
      await presenceService.setIdle();
      record = presenceService._getCurrentRecord();
      expect(record.status).toBe('idle');

      // After setActive, status should reflect active
      await presenceService.setActive();
      record = presenceService._getCurrentRecord();
      expect(record.status).toBe('active');

      await presenceService.leaveRoom();
    });

    it('should return correct idle status for activity handler decision', async () => {
      await presenceService.enterRoom('room1');
      await presenceService.setIdle();

      // The activity handler checks _getCurrentRecord().status === 'idle'
      // to decide whether to call setActive(). Verify this works.
      const record = presenceService._getCurrentRecord();
      expect(record.status).toBe('idle');

      // Simulate what the activity handler does
      if (record && record.status === 'idle') {
        await presenceService.setActive();
      }

      // Verify the DB record is now active
      const tabId = sync.getTabId();
      const dbRecord = await db.get('presence', tabId);
      expect(dbRecord.status).toBe('active');

      // And the local status is also active
      const updatedRecord = presenceService._getCurrentRecord();
      expect(updatedRecord.status).toBe('active');

      await presenceService.leaveRoom();
    });

    it('should reset status to active on leaveRoom', async () => {
      await presenceService.enterRoom('room1');
      await presenceService.setIdle();
      await presenceService.leaveRoom();

      // After leaving, _getCurrentRecord returns null (no room)
      const record = presenceService._getCurrentRecord();
      expect(record).toBeNull();

      // Re-entering should start as active, not carry over idle
      await presenceService.enterRoom('room2');
      const newRecord = presenceService._getCurrentRecord();
      expect(newRecord.status).toBe('active');

      await presenceService.leaveRoom();
    });

    it('should emit presence:active when recovering from idle via setActive', async () => {
      await presenceService.enterRoom('room1');
      await presenceService.setIdle();

      const handler = vi.fn();
      bus.on('presence:active', handler);

      await presenceService.setActive();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].roomId).toBe('room1');

      await presenceService.leaveRoom();
    });
  });
});
