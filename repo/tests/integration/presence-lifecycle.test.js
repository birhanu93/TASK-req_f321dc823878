import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetAll, setCurrentUser } from '../helpers.js';
import { presenceService } from '../../js/services/presence-service.js';
import { roomService } from '../../js/services/room-service.js';
import { bus } from '../../js/core/event-bus.js';
import { sync } from '../../js/core/sync.js';
import { db } from '../../js/core/db.js';

describe('Integration: Presence lifecycle', () => {
  let room;

  beforeEach(async () => {
    await resetAll();
    setCurrentUser();
    sync.init();
    room = await roomService.createRoom('Presence Room');
  });

  afterEach(async () => {
    await presenceService.leaveRoom();
    presenceService.destroy();
    sync.destroy();
  });

  it('should enter a room and create presence record', async () => {
    await presenceService.enterRoom(room.id);

    const records = await presenceService.getRoomPresence(room.id);
    expect(records).toHaveLength(1);
    expect(records[0].roomId).toBe(room.id);
    expect(records[0].status).toBe('active');
    expect(records[0].profileId).toBe('u1');
  });

  it('should emit presence:enter event', async () => {
    const handler = vi.fn();
    bus.on('presence:enter', handler);

    await presenceService.enterRoom(room.id);

    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls[0][0].roomId).toBe(room.id);
    bus.off('presence:enter', handler);
  });

  it('should leave room and remove presence record', async () => {
    await presenceService.enterRoom(room.id);

    const handler = vi.fn();
    bus.on('presence:leave', handler);

    await presenceService.leaveRoom();

    expect(handler).toHaveBeenCalled();
    const records = await presenceService.getRoomPresence(room.id);
    expect(records).toHaveLength(0);
    bus.off('presence:leave', handler);
  });

  it('should switch rooms: leave previous, enter new', async () => {
    const room2 = await roomService.createRoom('Room 2');

    await presenceService.enterRoom(room.id);
    let records1 = await presenceService.getRoomPresence(room.id);
    expect(records1).toHaveLength(1);

    // Enter second room (should auto-leave first)
    await presenceService.enterRoom(room2.id);

    records1 = await presenceService.getRoomPresence(room.id);
    expect(records1).toHaveLength(0);

    const records2 = await presenceService.getRoomPresence(room2.id);
    expect(records2).toHaveLength(1);
  });

  it('should set idle status', async () => {
    await presenceService.enterRoom(room.id);
    await presenceService.setIdle();

    const records = await presenceService.getRoomPresence(room.id);
    expect(records[0].status).toBe('idle');
  });

  it('should set active status after idle', async () => {
    await presenceService.enterRoom(room.id);
    await presenceService.setIdle();
    await presenceService.setActive();

    const records = await presenceService.getRoomPresence(room.id);
    expect(records[0].status).toBe('active');
  });

  it('should emit presence:idle and presence:active events', async () => {
    const idleHandler = vi.fn();
    const activeHandler = vi.fn();
    bus.on('presence:idle', idleHandler);
    bus.on('presence:active', activeHandler);

    await presenceService.enterRoom(room.id);
    await presenceService.setIdle();
    expect(idleHandler).toHaveBeenCalled();

    await presenceService.setActive();
    expect(activeHandler).toHaveBeenCalled();

    bus.off('presence:idle', idleHandler);
    bus.off('presence:active', activeHandler);
  });

  it('should prune stale presence records', async () => {
    // Manually insert a stale record
    const staleRecord = {
      tabId: 'stale-tab',
      profileId: 'other-user',
      roomId: room.id,
      status: 'active',
      lastHeartbeat: Date.now() - 60000 // 60 seconds ago (> 30s stale threshold)
    };
    await db.put('presence', staleRecord);

    // Enter room (creates fresh record)
    await presenceService.enterRoom(room.id);

    // Get presence — stale should be pruned
    const records = await presenceService.getRoomPresence(room.id);
    expect(records).toHaveLength(1);
    expect(records[0].tabId).not.toBe('stale-tab');
  });

  it('should handle leaveRoom when not in any room', async () => {
    // Should not throw
    await presenceService.leaveRoom();
    expect(true).toBe(true);
  });

  it('should handle setIdle when not in a room', async () => {
    await presenceService.setIdle();
    // Should not throw
    expect(true).toBe(true);
  });

  it('should return empty presence for room with no users', async () => {
    const records = await presenceService.getRoomPresence(room.id);
    expect(records).toHaveLength(0);
  });

  it('should init and destroy without error', () => {
    presenceService.destroy();
    presenceService.init();
    presenceService.destroy();
    // No errors thrown
    expect(true).toBe(true);
  });
});
