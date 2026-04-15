import { describe, it, expect, beforeEach } from 'vitest';
import { resetAll, setCurrentUser } from '../helpers.js';
import { roomService } from '../../js/services/room-service.js';
import { whiteboardService } from '../../js/services/whiteboard-service.js';
import { stickyService } from '../../js/services/sticky-service.js';
import { chatService } from '../../js/services/chat-service.js';
import { db } from '../../js/core/db.js';

describe('Integration: Storage quota handling', () => {
  let room;

  beforeEach(async () => {
    await resetAll();
    setCurrentUser();
    room = await roomService.createRoom('Quota Room');
  });

  it('should calculate storage used for empty room', async () => {
    const used = await roomService.getStorageUsed(room.id);
    expect(used).toBe(0);
  });

  it('should increase storage used when data is added', async () => {
    await whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0, width: 100, height: 50 });
    await stickyService.createNote(room.id, { title: 'Note', body: 'Content' });
    await chatService.sendMessage(room.id, 'Hello');

    const used = await roomService.getStorageUsed(room.id);
    expect(used).toBeGreaterThan(0);
  });

  it('should update room storageBytesUsed field', async () => {
    await whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0 });
    await roomService.getStorageUsed(room.id);

    const updatedRoom = await roomService.getRoom(room.id);
    expect(updatedRoom.storageBytesUsed).toBeGreaterThan(0);
  });

  it('should return quota info with correct structure', async () => {
    const quota = await roomService.checkStorageQuota(room.id);
    expect(quota).toHaveProperty('used');
    expect(quota).toHaveProperty('limit');
    expect(quota).toHaveProperty('warning');
    expect(quota).toHaveProperty('exceeded');
    expect(quota).toHaveProperty('nearLimit');
    expect(quota.limit).toBe(200 * 1024 * 1024);
    expect(quota.warning).toBe(180 * 1024 * 1024);
  });

  it('should report not exceeded for normal usage', async () => {
    await whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0 });
    const quota = await roomService.checkStorageQuota(room.id);
    expect(quota.exceeded).toBe(false);
    expect(quota.nearLimit).toBe(false);
  });

  it('should provide cleanup suggestions', async () => {
    // Add some data
    await whiteboardService.createElement(room.id, 'image', { x: 0, y: 0, src: 'data:image/png;base64,abc' });
    await roomService.createSnapshot(room.id, 'snap1');
    await chatService.sendMessage(room.id, 'Old message');

    const suggestions = await roomService.getCleanupSuggestions(room.id);
    expect(suggestions).toHaveProperty('images');
    expect(suggestions).toHaveProperty('oldestSnapshots');
    expect(suggestions).toHaveProperty('oldMessages');

    expect(suggestions.images.length).toBeGreaterThanOrEqual(1);
    expect(suggestions.oldestSnapshots.length).toBeGreaterThanOrEqual(1);
    expect(suggestions.oldMessages.length).toBeGreaterThanOrEqual(1);
  });

  it('should reduce storage after deleting data', async () => {
    const el = await whiteboardService.createElement(room.id, 'rect', {
      x: 0, y: 0, width: 100, height: 50, fill: '#ff0000', someData: 'x'.repeat(1000)
    });

    const usedBefore = await roomService.getStorageUsed(room.id);
    expect(usedBefore).toBeGreaterThan(0);

    // Hard delete the element
    await db.delete('whiteboardElements', el.id);

    const usedAfter = await roomService.getStorageUsed(room.id);
    expect(usedAfter).toBeLessThan(usedBefore);
  });

  it('should enforce snapshot cap at 50', async () => {
    // Create 50 snapshots
    for (let i = 0; i < 50; i++) {
      await roomService.createSnapshot(room.id, `snap-${i}`);
    }

    // 51st should fail
    await expect(roomService.createSnapshot(room.id, 'snap-51'))
      .rejects.toThrow('50');

    // Delete one and try again
    const snapshots = await roomService.listSnapshots(room.id);
    await roomService.deleteSnapshot(snapshots[0].id);

    const newSnap = await roomService.createSnapshot(room.id, 'snap-new');
    expect(newSnap).toBeTruthy();
  });
});
