import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetAll, setCurrentUser } from '../helpers.js';
import { roomService } from '../../js/services/room-service.js';
import { whiteboardService } from '../../js/services/whiteboard-service.js';
import { stickyService } from '../../js/services/sticky-service.js';
import { chatService } from '../../js/services/chat-service.js';
import { autosave } from '../../js/core/autosave.js';
import { db } from '../../js/core/db.js';
import { bus } from '../../js/core/event-bus.js';
import * as quotaGuard from '../../js/core/quota-guard.js';

describe('Integration: Hard quota rejection across services', () => {
  let room;

  beforeEach(async () => {
    await resetAll();
    setCurrentUser();
    autosave.destroy();
    autosave.init(async () => {}); // no-op flush for these tests
    room = await roomService.createRoom('Quota Room');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    autosave.destroy();
  });

  function mockOverLimit() {
    // Mock enforceQuota directly since getUsage is an internal call
    vi.spyOn(quotaGuard, 'enforceQuota').mockRejectedValue(
      new Error('Storage limit exceeded for this room (201.0 MB / 200 MB). Delete unused content to free space.')
    );
  }

  it('should reject whiteboard createElement when over quota', async () => {
    mockOverLimit();
    await expect(
      whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0 })
    ).rejects.toThrow(/Storage limit exceeded/);
  });

  it('should reject whiteboard addComment when over quota', async () => {
    // Create element BEFORE hitting quota
    const el = await whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0 });
    mockOverLimit();
    await expect(
      whiteboardService.addComment(el.id, 'Test comment')
    ).rejects.toThrow(/Storage limit exceeded/);
  });

  it('should reject stickyService createNote when over quota', async () => {
    mockOverLimit();
    await expect(
      stickyService.createNote(room.id, { title: 'T', body: 'B' })
    ).rejects.toThrow(/Storage limit exceeded/);
  });

  it('should reject stickyService importCSV when over quota', async () => {
    mockOverLimit();
    await expect(
      stickyService.importCSV(room.id, 'title,body\nA,B')
    ).rejects.toThrow(/Storage limit exceeded/);
  });

  it('should reject chatService sendMessage when over quota', async () => {
    mockOverLimit();
    await expect(
      chatService.sendMessage(room.id, 'hello')
    ).rejects.toThrow(/Storage limit exceeded/);
  });

  it('should reject roomService createSnapshot when over quota', async () => {
    mockOverLimit();
    await expect(
      roomService.createSnapshot(room.id, 'snap')
    ).rejects.toThrow(/Storage limit exceeded/);
  });

  it('should allow reads when over quota', async () => {
    // Create data before quota hit
    await whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0 });
    await stickyService.createNote(room.id, { title: 'N', body: 'B' });
    await chatService.sendMessage(room.id, 'hi');

    mockOverLimit();

    // Reads should still work
    const elements = await whiteboardService.getElementsByRoom(room.id);
    expect(elements.length).toBe(1);
    const notes = await stickyService.getNotesByRoom(room.id);
    expect(notes.length).toBe(1);
    const messages = await chatService.getMessages(room.id);
    expect(messages.length).toBe(1);
  });

  it('should allow deletes when over quota (to free space)', async () => {
    const el = await whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0 });
    const note = await stickyService.createNote(room.id, { title: 'N', body: 'B' });

    mockOverLimit();

    // Deletes should still work (no quota check on delete)
    await whiteboardService.deleteElement(el.id);
    await stickyService.deleteNote(note.id);

    const elements = await whiteboardService.getElementsByRoom(room.id);
    expect(elements.length).toBe(0);
    const notes = await stickyService.getNotesByRoom(room.id);
    expect(notes.length).toBe(0);
  });

  it('should emit storage warning when approaching limit', async () => {
    const handler = vi.fn();
    bus.on('room:storage-warning', handler);

    // Mock enforceQuota to emit warning (like the real one does at 180MB+)
    vi.spyOn(quotaGuard, 'enforceQuota').mockImplementation(async (roomId) => {
      bus.emit('room:storage-warning', { roomId, used: 185 * 1024 * 1024, limit: 200 * 1024 * 1024, warning: 180 * 1024 * 1024 });
    });

    await whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0 });
    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls[0][0].roomId).toBe(room.id);

    bus.off('room:storage-warning', handler);
  });
});
