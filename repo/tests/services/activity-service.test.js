import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetAll, setCurrentUser } from '../helpers.js';
import { db } from '../../js/core/db.js';
import { bus } from '../../js/core/event-bus.js';
import { activityService } from '../../js/services/activity-service.js';

beforeEach(async () => {
  await resetAll();
  setCurrentUser();
});

describe('activity-service', () => {
  // ---------------------------------------------------------------
  // logActivity
  // ---------------------------------------------------------------
  describe('logActivity', () => {
    it('should create a log entry with all expected fields', async () => {
      const entry = await activityService.logActivity(
        'room1', 'create', 'element', 'el1', 'Created an element', { color: 'red' }
      );
      expect(entry).toHaveProperty('id');
      expect(entry.roomId).toBe('room1');
      expect(entry.actorId).toBe('u1');
      expect(entry.action).toBe('create');
      expect(entry.targetType).toBe('element');
      expect(entry.targetId).toBe('el1');
      expect(entry.summary).toBe('Created an element');
      expect(entry.metadata).toEqual({ color: 'red' });
      expect(entry).toHaveProperty('createdAt');
    });

    it('should persist the entry in the database', async () => {
      const entry = await activityService.logActivity('room1', 'update', 'note', 'n1', 'Updated note');
      const stored = await db.get('activityLogs', entry.id);
      expect(stored).toBeTruthy();
      expect(stored.action).toBe('update');
    });

    it('should emit activity:logged event', async () => {
      const handler = vi.fn();
      bus.on('activity:logged', handler);
      const entry = await activityService.logActivity('room1', 'delete', 'comment', 'c1', 'Deleted comment');
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].id).toBe(entry.id);
    });

    it('should set actorId to null when no current user', async () => {
      // Clear the current user
      const { store } = await import('../../js/core/store.js');
      store.set('currentUser', null);
      const entry = await activityService.logActivity('room1', 'create', 'element', 'el1', 'Anonymous');
      expect(entry.actorId).toBeNull();
    });

    it('should default metadata to empty object', async () => {
      const entry = await activityService.logActivity('room1', 'create', 'element', 'el1', 'No meta');
      expect(entry.metadata).toEqual({});
    });
  });

  // ---------------------------------------------------------------
  // getActivityFeed
  // ---------------------------------------------------------------
  describe('getActivityFeed', () => {
    it('should return logs sorted by createdAt descending', async () => {
      await activityService.logActivity('room1', 'create', 'a', '1', 'First');
      await activityService.logActivity('room1', 'update', 'b', '2', 'Second');
      await activityService.logActivity('room1', 'delete', 'c', '3', 'Third');

      const feed = await activityService.getActivityFeed('room1');
      expect(feed).toHaveLength(3);
      expect(feed[0].createdAt).toBeGreaterThanOrEqual(feed[1].createdAt);
      expect(feed[1].createdAt).toBeGreaterThanOrEqual(feed[2].createdAt);
    });

    it('should filter by action', async () => {
      await activityService.logActivity('room1', 'create', 'a', '1', 'Created');
      await activityService.logActivity('room1', 'update', 'b', '2', 'Updated');
      await activityService.logActivity('room1', 'create', 'c', '3', 'Created again');

      const feed = await activityService.getActivityFeed('room1', { action: 'create' });
      expect(feed).toHaveLength(2);
      expect(feed.every(l => l.action === 'create')).toBe(true);
    });

    it('should filter by since timestamp', async () => {
      const e1 = await activityService.logActivity('room1', 'create', 'a', '1', 'Old');
      const timestamp = Date.now() + 1;
      const e2 = await activityService.logActivity('room1', 'update', 'b', '2', 'New');

      // Use e2's createdAt as the since filter
      const feed = await activityService.getActivityFeed('room1', { since: e2.createdAt });
      expect(feed.length).toBeGreaterThanOrEqual(1);
      expect(feed.every(l => l.createdAt >= e2.createdAt)).toBe(true);
    });

    it('should respect limit', async () => {
      for (let i = 0; i < 10; i++) {
        await activityService.logActivity('room1', 'create', 'x', `${i}`, `Entry ${i}`);
      }
      const feed = await activityService.getActivityFeed('room1', { limit: 3 });
      expect(feed).toHaveLength(3);
    });

    it('should default limit to 50', async () => {
      for (let i = 0; i < 55; i++) {
        await activityService.logActivity('room1', 'create', 'x', `${i}`, `Entry ${i}`);
      }
      const feed = await activityService.getActivityFeed('room1');
      expect(feed).toHaveLength(50);
    });

    it('should only return logs for the specified room', async () => {
      await activityService.logActivity('room1', 'create', 'a', '1', 'Room 1');
      await activityService.logActivity('room2', 'create', 'b', '2', 'Room 2');

      const feed = await activityService.getActivityFeed('room1');
      expect(feed).toHaveLength(1);
      expect(feed[0].roomId).toBe('room1');
    });

    it('should return empty array for room with no activity', async () => {
      const feed = await activityService.getActivityFeed('empty-room');
      expect(feed).toEqual([]);
    });
  });

  // ---------------------------------------------------------------
  // clearActivityFeed
  // ---------------------------------------------------------------
  describe('clearActivityFeed', () => {
    it('should remove all logs for the specified room', async () => {
      await activityService.logActivity('room1', 'create', 'a', '1', 'R1 entry');
      await activityService.logActivity('room1', 'update', 'b', '2', 'R1 entry 2');
      await activityService.logActivity('room2', 'create', 'c', '3', 'R2 entry');

      await activityService.clearActivityFeed('room1');

      const r1Feed = await activityService.getActivityFeed('room1');
      expect(r1Feed).toHaveLength(0);

      // Room 2 should be unaffected
      const r2Feed = await activityService.getActivityFeed('room2');
      expect(r2Feed).toHaveLength(1);
    });

    it('should handle clearing an already empty feed', async () => {
      // Should not throw
      await activityService.clearActivityFeed('empty-room');
      const feed = await activityService.getActivityFeed('empty-room');
      expect(feed).toEqual([]);
    });
  });
});
