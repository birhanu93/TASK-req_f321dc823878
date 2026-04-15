import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetAll, setCurrentUser } from '../helpers.js';
import { roomService } from '../../js/services/room-service.js';
import { whiteboardService } from '../../js/services/whiteboard-service.js';
import { stickyService } from '../../js/services/sticky-service.js';
import { chatService } from '../../js/services/chat-service.js';
import { autosave } from '../../js/core/autosave.js';
import { db } from '../../js/core/db.js';

describe('Integration: Autosave from real mutations', () => {
  let room;
  let flushedBatches;

  beforeEach(async () => {
    await resetAll();
    setCurrentUser();
    flushedBatches = [];
    // Initialize autosave with a callback that records flushes
    autosave.destroy();
    autosave.init(async (batch) => {
      flushedBatches.push(new Map(batch));
    });
    room = await roomService.createRoom('Autosave Room');
  });

  afterEach(() => {
    autosave.destroy();
  });

  it('should mark room dirty on createRoom', () => {
    // createRoom already ran in beforeEach
    expect(autosave.hasPending()).toBe(true);
  });

  it('should mark whiteboard elements dirty on createElement', async () => {
    // Flush previous pending from room creation
    await autosave.flush();
    flushedBatches = [];

    await whiteboardService.createElement(room.id, 'rect', { x: 10, y: 20 });
    expect(autosave.hasPending()).toBe(true);

    await autosave.flush();
    expect(flushedBatches.length).toBe(1);
    const batch = flushedBatches[0];
    expect(batch.has('whiteboardElements')).toBe(true);
  });

  it('should mark whiteboard dirty on updateElement', async () => {
    const el = await whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0 });
    await autosave.flush();
    flushedBatches = [];

    await whiteboardService.updateElement(el.id, { fill: '#ff0000' });
    await autosave.flush();
    expect(flushedBatches.length).toBe(1);
    expect(flushedBatches[0].has('whiteboardElements')).toBe(true);
  });

  it('should mark whiteboard dirty on deleteElement', async () => {
    const el = await whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0 });
    await autosave.flush();
    flushedBatches = [];

    await whiteboardService.deleteElement(el.id);
    await autosave.flush();
    expect(flushedBatches[0].has('whiteboardElements')).toBe(true);
  });

  it('should mark whiteboard dirty on updateNotes', async () => {
    const el = await whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0 });
    await autosave.flush();
    flushedBatches = [];

    await whiteboardService.updateNotes(el.id, 'My notes');
    await autosave.flush();
    expect(flushedBatches[0].has('whiteboardElements')).toBe(true);
  });

  it('should mark comments dirty on addComment', async () => {
    const el = await whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0 });
    await autosave.flush();
    flushedBatches = [];

    await whiteboardService.addComment(el.id, 'Nice work');
    await autosave.flush();
    expect(flushedBatches[0].has('comments')).toBe(true);
  });

  it('should mark sticky notes dirty on createNote', async () => {
    await autosave.flush();
    flushedBatches = [];

    await stickyService.createNote(room.id, { title: 'Task', body: 'Do it' });
    await autosave.flush();
    expect(flushedBatches[0].has('stickyNotes')).toBe(true);
  });

  it('should mark sticky notes dirty on updateNote', async () => {
    const note = await stickyService.createNote(room.id, { title: 'T', body: 'B' });
    await autosave.flush();
    flushedBatches = [];

    await stickyService.updateNote(note.id, { title: 'Updated' });
    await autosave.flush();
    expect(flushedBatches[0].has('stickyNotes')).toBe(true);
  });

  it('should mark sticky notes dirty on assignToGroup', async () => {
    const note = await stickyService.createNote(room.id, { title: 'T', body: 'B' });
    const group = await stickyService.createGroup(room.id, 'G1', '#fff');
    await autosave.flush();
    flushedBatches = [];

    await stickyService.assignToGroup(note.id, group.id);
    await autosave.flush();
    expect(flushedBatches[0].has('stickyNotes')).toBe(true);
  });

  it('should mark chat messages dirty on sendMessage', async () => {
    await autosave.flush();
    flushedBatches = [];

    await chatService.sendMessage(room.id, 'hello');
    await autosave.flush();
    expect(flushedBatches[0].has('chatMessages')).toBe(true);
  });

  it('should mark room dirty on updateRoom', async () => {
    await autosave.flush();
    flushedBatches = [];

    await roomService.updateRoom(room.id, { name: 'Renamed' });
    await autosave.flush();
    expect(flushedBatches[0].has('rooms')).toBe(true);
  });

  it('should accumulate multiple dirty items and flush in one batch', async () => {
    await autosave.flush();
    flushedBatches = [];

    await whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0 });
    await stickyService.createNote(room.id, { title: 'N', body: 'B' });
    await chatService.sendMessage(room.id, 'hi');

    expect(autosave.hasPending()).toBe(true);
    await autosave.flush();
    expect(flushedBatches.length).toBe(1);

    const batch = flushedBatches[0];
    expect(batch.has('whiteboardElements')).toBe(true);
    expect(batch.has('stickyNotes')).toBe(true);
    expect(batch.has('chatMessages')).toBe(true);
  });

  it('should re-enqueue on flush error and retry successfully', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await autosave.flush();

    // Set up a callback that fails once then succeeds
    let callCount = 0;
    autosave.destroy();
    autosave.init(async (batch) => {
      callCount++;
      if (callCount === 1) throw new Error('transient failure');
      flushedBatches.push(new Map(batch));
    });

    await whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0 });
    await autosave.flush(); // This should fail
    expect(autosave.hasPending()).toBe(true); // Re-enqueued

    flushedBatches = [];
    await autosave.flush(); // This should succeed
    expect(autosave.hasPending()).toBe(false);
    expect(flushedBatches.length).toBe(1);
    errSpy.mockRestore();
  });
});
