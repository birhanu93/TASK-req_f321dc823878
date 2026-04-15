import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetAll, setCurrentUser } from '../helpers.js';
import { bus } from '../../js/core/event-bus.js';
import { sync } from '../../js/core/sync.js';
import { db } from '../../js/core/db.js';
import { store } from '../../js/core/store.js';
import { roomService } from '../../js/services/room-service.js';
import { autosave } from '../../js/core/autosave.js';
import { initSyncConsumer } from '../../js/app.js';

describe('Integration: Cross-tab sync via initSyncConsumer', () => {
  let room;

  beforeEach(async () => {
    await resetAll();
    setCurrentUser();
    autosave.destroy();
    autosave.init(async () => {});
    sync.init();
    room = await roomService.createRoom('Sync Room');
    store.set('currentRoom', room);
    // Register the real sync consumer so sync:remote events are handled
    initSyncConsumer();
  });

  afterEach(() => {
    sync.destroy();
    autosave.destroy();
  });

  it('should route chat messages through the sync consumer', async () => {
    // Insert a chat message directly into DB as if another tab wrote it
    const msg = {
      id: 'remote-msg-1',
      roomId: room.id,
      authorId: 'other-user',
      body: 'Hello from tab 2',
      createdAt: Date.now(),
      deleted: false
    };
    await db.put('chatMessages', msg);

    const chatHandler = vi.fn();
    bus.on('chat:message', chatHandler);

    // Emit sync:remote as the BroadcastChannel would
    bus.emit('sync:remote', {
      type: 'db-change',
      store: 'chatMessages',
      action: 'add',
      id: msg.id,
      roomId: room.id,
      tabId: 'other-tab-id'
    });

    // The consumer fetches from DB async; wait for microtask
    await new Promise(r => setTimeout(r, 50));

    expect(chatHandler).toHaveBeenCalled();
    expect(chatHandler.mock.calls[0][0].body).toBe('Hello from tab 2');
    bus.off('chat:message', chatHandler);
  });

  it('should route whiteboard changes through the sync consumer', () => {
    const handler = vi.fn();
    bus.on('sync:whiteboardElements:refresh', handler);

    bus.emit('sync:remote', {
      type: 'db-change',
      store: 'whiteboardElements',
      action: 'add',
      key: 'el-1',
      roomId: room.id,
      tabId: 'other-tab'
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({ action: 'add', id: 'el-1', roomId: room.id });
    bus.off('sync:whiteboardElements:refresh', handler);
  });

  it('should route sticky note changes through the sync consumer', () => {
    const handler = vi.fn();
    bus.on('sync:stickyNotes:refresh', handler);

    bus.emit('sync:remote', {
      type: 'db-change',
      store: 'stickyNotes',
      action: 'add',
      key: 'sn-1',
      roomId: room.id,
      tabId: 'other-tab'
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({ action: 'add', id: 'sn-1', roomId: room.id });
    bus.off('sync:stickyNotes:refresh', handler);
  });

  it('should route presence events through the sync consumer', () => {
    const handler = vi.fn();
    bus.on('presence:enter', handler);

    bus.emit('sync:remote', {
      type: 'db-change',
      store: 'presence',
      action: 'enter',
      roomId: room.id,
      tabId: 'other-tab'
    });

    expect(handler).toHaveBeenCalledTimes(1);
    bus.off('presence:enter', handler);
  });

  it('should route room import/rollback through the sync consumer', () => {
    const handler = vi.fn();
    bus.on('room:remote-refresh', handler);

    bus.emit('sync:remote', {
      type: 'db-change',
      store: 'rooms',
      action: 'import',
      key: room.id,
      roomId: room.id,
      tabId: 'other-tab'
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({ roomId: room.id, action: 'import' });
    bus.off('room:remote-refresh', handler);
  });

  it('should route notification events through the sync consumer', () => {
    const handler = vi.fn();
    bus.on('notification:new', handler);

    bus.emit('sync:remote', {
      type: 'db-change',
      store: 'notifications',
      action: 'add',
      data: { id: 'n1', type: 'info', title: 'Test' },
      tabId: 'other-tab'
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({ id: 'n1', type: 'info', title: 'Test' });
    bus.off('notification:new', handler);
  });

  it('should broadcast changes when services write data', async () => {
    const broadcastSpy = vi.spyOn(sync, 'broadcast');

    const { whiteboardService } = await import('../../js/services/whiteboard-service.js');
    await whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0 });

    expect(broadcastSpy).toHaveBeenCalled();
    const calls = broadcastSpy.mock.calls;
    const dbChange = calls.find(c => c[0].type === 'db-change' && c[0].store === 'whiteboardElements');
    expect(dbChange).toBeTruthy();
    broadcastSpy.mockRestore();
  });

  it('should ignore non-db-change messages', () => {
    const handler = vi.fn();
    bus.on('sync:whiteboardElements:refresh', handler);
    bus.on('presence:enter', handler);
    bus.on('chat:message', handler);

    bus.emit('sync:remote', {
      type: 'heartbeat',
      store: 'whiteboardElements',
      tabId: 'other-tab'
    });

    expect(handler).not.toHaveBeenCalled();
    bus.off('sync:whiteboardElements:refresh', handler);
    bus.off('presence:enter', handler);
    bus.off('chat:message', handler);
  });

  it('should not route changes for a different room', () => {
    const handler = vi.fn();
    bus.on('sync:whiteboardElements:refresh', handler);

    bus.emit('sync:remote', {
      type: 'db-change',
      store: 'whiteboardElements',
      action: 'add',
      key: 'el-1',
      roomId: 'different-room-id',
      tabId: 'other-tab'
    });

    expect(handler).not.toHaveBeenCalled();
    bus.off('sync:whiteboardElements:refresh', handler);
  });

  it('should route comment refresh events through the sync consumer', () => {
    const handler = vi.fn();
    bus.on('sync:comments:refresh', handler);

    bus.emit('sync:remote', {
      type: 'db-change',
      store: 'comments',
      action: 'add',
      key: 'c-1',
      roomId: room.id,
      tabId: 'other-tab'
    });

    expect(handler).toHaveBeenCalledTimes(1);
    bus.off('sync:comments:refresh', handler);
  });
});
