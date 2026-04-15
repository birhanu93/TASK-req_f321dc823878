import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetAll, setCurrentUser } from '../helpers.js';
import { db } from '../../js/core/db.js';
import { store } from '../../js/core/store.js';
import { bus } from '../../js/core/event-bus.js';
import { roomService } from '../../js/services/room-service.js';

beforeEach(async () => {
  await resetAll();
  setCurrentUser();
});

describe('room-service', () => {
  // ---------------------------------------------------------------
  // createRoom
  // ---------------------------------------------------------------
  describe('createRoom', () => {
    it('should create a room with correct fields', async () => {
      const room = await roomService.createRoom('Test Room', 'A description');
      expect(room).toHaveProperty('id');
      expect(room.name).toBe('Test Room');
      expect(room.description).toBe('A description');
      expect(room.createdBy).toBe('u1');
      expect(room.storageBytesUsed).toBe(0);
      expect(room.snapshotCount).toBe(0);
      expect(room).toHaveProperty('createdAt');
      expect(room).toHaveProperty('updatedAt');
    });

    it('should persist the room in the database', async () => {
      const room = await roomService.createRoom('Persist Room');
      const stored = await db.get('rooms', room.id);
      expect(stored).toBeTruthy();
      expect(stored.name).toBe('Persist Room');
    });

    it('should emit room:created event', async () => {
      const handler = vi.fn();
      bus.on('room:created', handler);
      const room = await roomService.createRoom('Event Room');
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].id).toBe(room.id);
    });

    it('should default description to empty string', async () => {
      const room = await roomService.createRoom('No Desc');
      expect(room.description).toBe('');
    });
  });

  // ---------------------------------------------------------------
  // getRoom
  // ---------------------------------------------------------------
  describe('getRoom', () => {
    it('should return the room by id', async () => {
      const room = await roomService.createRoom('My Room');
      const fetched = await roomService.getRoom(room.id);
      expect(fetched).toEqual(room);
    });

    it('should return undefined for non-existent room', async () => {
      const result = await roomService.getRoom('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------
  // listRooms
  // ---------------------------------------------------------------
  describe('listRooms', () => {
    it('should return rooms sorted by updatedAt descending', async () => {
      const r1 = await roomService.createRoom('Room 1');
      const r2 = await roomService.createRoom('Room 2');
      const r3 = await roomService.createRoom('Room 3');
      const list = await roomService.listRooms();
      expect(list.length).toBe(3);
      // Most recently created should come first
      expect(list[0].updatedAt).toBeGreaterThanOrEqual(list[1].updatedAt);
      expect(list[1].updatedAt).toBeGreaterThanOrEqual(list[2].updatedAt);
    });

    it('should return empty array when no rooms exist', async () => {
      const list = await roomService.listRooms();
      expect(list).toEqual([]);
    });
  });

  // ---------------------------------------------------------------
  // updateRoom
  // ---------------------------------------------------------------
  describe('updateRoom', () => {
    it('should update allowed fields', async () => {
      const room = await roomService.createRoom('Original');
      const updated = await roomService.updateRoom(room.id, { name: 'Renamed', description: 'New desc' });
      expect(updated.name).toBe('Renamed');
      expect(updated.description).toBe('New desc');
      expect(updated.updatedAt).toBeGreaterThanOrEqual(room.updatedAt);
    });

    it('should throw for non-existent room', async () => {
      await expect(roomService.updateRoom('missing', { name: 'X' }))
        .rejects.toThrow('Room not found');
    });

    it('should not allow overwriting id or createdBy', async () => {
      const room = await roomService.createRoom('Protected');
      await roomService.updateRoom(room.id, { id: 'hacked', createdBy: 'hacker' });
      const stored = await db.get('rooms', room.id);
      expect(stored.id).toBe(room.id);
      expect(stored.createdBy).toBe('u1');
    });

    it('should emit room:updated event', async () => {
      const room = await roomService.createRoom('Evt Room');
      const handler = vi.fn();
      bus.on('room:updated', handler);
      await roomService.updateRoom(room.id, { name: 'Updated' });
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------
  // deleteRoom
  // ---------------------------------------------------------------
  describe('deleteRoom', () => {
    it('should delete the room from the database', async () => {
      const room = await roomService.createRoom('Delete Me');
      await roomService.deleteRoom(room.id);
      const stored = await db.get('rooms', room.id);
      expect(stored).toBeUndefined();
    });

    it('should delete related data (activity logs, chat messages, etc.)', async () => {
      const room = await roomService.createRoom('Del Related');
      // Add related data
      await db.put('chatMessages', { id: 'cm1', roomId: room.id, body: 'hi', createdAt: 1 });
      await db.put('activityLogs', { id: 'al1', roomId: room.id, action: 'test', createdAt: 1 });
      await db.put('comments', { id: 'c1', roomId: room.id, body: 'comment', createdAt: 1 });

      await roomService.deleteRoom(room.id);

      const msgs = await db.getAllByIndex('chatMessages', 'roomId', room.id);
      const logs = await db.getAllByIndex('activityLogs', 'roomId', room.id);
      const cmts = await db.getAllByIndex('comments', 'roomId', room.id);
      expect(msgs).toHaveLength(0);
      expect(logs).toHaveLength(0);
      expect(cmts).toHaveLength(0);
    });

    it('should emit room:deleted event', async () => {
      const room = await roomService.createRoom('Evt Del');
      const handler = vi.fn();
      bus.on('room:deleted', handler);
      await roomService.deleteRoom(room.id);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toEqual({ id: room.id });
    });
  });

  // ---------------------------------------------------------------
  // getStorageUsed
  // ---------------------------------------------------------------
  describe('getStorageUsed', () => {
    it('should return 0 for empty room', async () => {
      const room = await roomService.createRoom('Empty');
      const bytes = await roomService.getStorageUsed(room.id);
      expect(bytes).toBe(0);
    });

    it('should return byte count for room with data', async () => {
      const room = await roomService.createRoom('Has Data');
      await db.put('chatMessages', { id: 'cm1', roomId: room.id, body: 'hello world', createdAt: 1 });
      const bytes = await roomService.getStorageUsed(room.id);
      expect(bytes).toBeGreaterThan(0);
    });

    it('should update the room storageBytesUsed field', async () => {
      const room = await roomService.createRoom('Track Storage');
      await db.put('chatMessages', { id: 'cm1', roomId: room.id, body: 'data', createdAt: 1 });
      await roomService.getStorageUsed(room.id);
      const stored = await db.get('rooms', room.id);
      expect(stored.storageBytesUsed).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------
  // checkStorageQuota
  // ---------------------------------------------------------------
  describe('checkStorageQuota', () => {
    it('should return quota information', async () => {
      const room = await roomService.createRoom('Quota Room');
      const quota = await roomService.checkStorageQuota(room.id);
      expect(quota).toHaveProperty('used');
      expect(quota).toHaveProperty('limit', 200 * 1024 * 1024);
      expect(quota).toHaveProperty('warning', 180 * 1024 * 1024);
      expect(quota).toHaveProperty('exceeded', false);
      expect(quota).toHaveProperty('nearLimit', false);
    });
  });

  // ---------------------------------------------------------------
  // createSnapshot
  // ---------------------------------------------------------------
  describe('createSnapshot', () => {
    it('should create a snapshot with correct fields', async () => {
      const room = await roomService.createRoom('Snap Room');
      const snap = await roomService.createSnapshot(room.id, 'v1');
      expect(snap).toHaveProperty('id');
      expect(snap.roomId).toBe(room.id);
      expect(snap.label).toBe('v1');
      expect(snap.createdBy).toBe('u1');
      expect(snap).toHaveProperty('blob');
      expect(snap).toHaveProperty('sizeBytes');
      expect(snap).toHaveProperty('createdAt');
    });

    it('should increment room snapshotCount', async () => {
      const room = await roomService.createRoom('Snap Count');
      await roomService.createSnapshot(room.id, 'v1');
      const stored = await db.get('rooms', room.id);
      expect(stored.snapshotCount).toBe(1);
    });

    it('should use default label when none provided', async () => {
      const room = await roomService.createRoom('Default Label');
      const snap = await roomService.createSnapshot(room.id);
      expect(snap.label).toBe('Snapshot 1');
    });

    it('should throw when room not found', async () => {
      await expect(roomService.createSnapshot('missing'))
        .rejects.toThrow('Room not found');
    });

    it('should enforce 50 snapshot cap', async () => {
      const room = await roomService.createRoom('Cap Room');
      for (let i = 0; i < 50; i++) {
        await roomService.createSnapshot(room.id, `snap-${i}`);
      }
      await expect(roomService.createSnapshot(room.id, 'snap-51'))
        .rejects.toThrow('Maximum 50 snapshots reached');
    });

    it('should emit snapshot:created event', async () => {
      const room = await roomService.createRoom('Evt Snap');
      const handler = vi.fn();
      bus.on('snapshot:created', handler);
      await roomService.createSnapshot(room.id, 'v1');
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].roomId).toBe(room.id);
    });
  });

  // ---------------------------------------------------------------
  // listSnapshots
  // ---------------------------------------------------------------
  describe('listSnapshots', () => {
    it('should return snapshots without blob field', async () => {
      const room = await roomService.createRoom('List Snaps');
      await roomService.createSnapshot(room.id, 'v1');
      const list = await roomService.listSnapshots(room.id);
      expect(list).toHaveLength(1);
      expect(list[0].blob).toBeUndefined();
      expect(list[0].label).toBe('v1');
    });

    it('should return sorted by createdAt descending', async () => {
      const room = await roomService.createRoom('Sort Snaps');
      await roomService.createSnapshot(room.id, 'first');
      await roomService.createSnapshot(room.id, 'second');
      const list = await roomService.listSnapshots(room.id);
      expect(list[0].createdAt).toBeGreaterThanOrEqual(list[1].createdAt);
      expect(list[0].label).toBe('second');
    });
  });

  // ---------------------------------------------------------------
  // rollbackSnapshot
  // ---------------------------------------------------------------
  describe('rollbackSnapshot', () => {
    it('should restore room data from snapshot', async () => {
      const room = await roomService.createRoom('Rollback Room');
      // Add some data
      await db.put('chatMessages', { id: 'msg1', roomId: room.id, body: 'original', createdAt: 1 });
      const snap = await roomService.createSnapshot(room.id, 'before-change');
      // Modify data
      await db.put('chatMessages', { id: 'msg1', roomId: room.id, body: 'modified', createdAt: 1 });
      await db.put('chatMessages', { id: 'msg2', roomId: room.id, body: 'new msg', createdAt: 2 });

      await roomService.rollbackSnapshot(room.id, snap.id);

      const msgs = await db.getAllByIndex('chatMessages', 'roomId', room.id);
      expect(msgs).toHaveLength(1);
      expect(msgs[0].body).toBe('original');
    });

    it('should throw for non-existent snapshot', async () => {
      const room = await roomService.createRoom('No Snap');
      await expect(roomService.rollbackSnapshot(room.id, 'nonexistent'))
        .rejects.toThrow('Snapshot not found');
    });

    it('should throw when snapshot belongs to different room', async () => {
      const room1 = await roomService.createRoom('Room A');
      const room2 = await roomService.createRoom('Room B');
      const snap = await roomService.createSnapshot(room1.id, 'snap-a');
      await expect(roomService.rollbackSnapshot(room2.id, snap.id))
        .rejects.toThrow('Snapshot not found');
    });

    it('should emit snapshot:rolled-back event', async () => {
      const room = await roomService.createRoom('Evt Rollback');
      const snap = await roomService.createSnapshot(room.id, 'v1');
      const handler = vi.fn();
      bus.on('snapshot:rolled-back', handler);
      await roomService.rollbackSnapshot(room.id, snap.id);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toEqual({ roomId: room.id, snapshotId: snap.id });
    });
  });

  // ---------------------------------------------------------------
  // deleteSnapshot
  // ---------------------------------------------------------------
  describe('deleteSnapshot', () => {
    it('should delete the snapshot from DB', async () => {
      const room = await roomService.createRoom('Del Snap');
      const snap = await roomService.createSnapshot(room.id, 'v1');
      await roomService.deleteSnapshot(snap.id);
      const stored = await db.get('snapshots', snap.id);
      expect(stored).toBeUndefined();
    });

    it('should update room snapshotCount', async () => {
      const room = await roomService.createRoom('Count Snap');
      const snap1 = await roomService.createSnapshot(room.id, 'v1');
      await roomService.createSnapshot(room.id, 'v2');
      await roomService.deleteSnapshot(snap1.id);
      const stored = await db.get('rooms', room.id);
      expect(stored.snapshotCount).toBe(1);
    });

    it('should emit snapshot:deleted event', async () => {
      const room = await roomService.createRoom('Evt Del Snap');
      const snap = await roomService.createSnapshot(room.id, 'v1');
      const handler = vi.fn();
      bus.on('snapshot:deleted', handler);
      await roomService.deleteSnapshot(snap.id);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toEqual({ snapshotId: snap.id, roomId: room.id });
    });

    it('should handle deleting non-existent snapshot gracefully', async () => {
      // Should not throw
      await roomService.deleteSnapshot('nonexistent');
    });
  });
});
