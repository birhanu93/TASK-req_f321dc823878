import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetAll, setCurrentUser } from '../helpers.js';
import { roomService } from '../../js/services/room-service.js';
import { whiteboardService } from '../../js/services/whiteboard-service.js';
import { stickyService } from '../../js/services/sticky-service.js';
import { chatService } from '../../js/services/chat-service.js';
import { activityService } from '../../js/services/activity-service.js';
import { bus } from '../../js/core/event-bus.js';

describe('Integration: Room whiteboard/sticky/chat wiring', () => {
  let room;

  beforeEach(async () => {
    await resetAll();
    setCurrentUser();
    room = await roomService.createRoom('Test Room', 'For integration tests');
  });

  describe('Whiteboard → Activity Feed', () => {
    it('should create whiteboard elements and log activity', async () => {
      const rect = await whiteboardService.createElement(room.id, 'rect', {
        x: 10, y: 20, width: 100, height: 50, fill: '#ff0000'
      });
      expect(rect.type).toBe('rect');
      expect(rect.roomId).toBe(room.id);

      await activityService.logActivity(room.id, 'create', 'whiteboardElement', rect.id, 'Created rectangle');
      const feed = await activityService.getActivityFeed(room.id);
      expect(feed.length).toBeGreaterThanOrEqual(1);
      expect(feed[0].action).toBe('create');
    });

    it('should support element notes up to 20k chars', async () => {
      const el = await whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0, width: 50, height: 50 });
      const longNotes = 'x'.repeat(20000);
      const updated = await whiteboardService.updateNotes(el.id, longNotes);
      expect(updated.notes.length).toBe(20000);
    });

    it('should reject notes exceeding 20k chars', async () => {
      const el = await whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0, width: 50, height: 50 });
      await expect(whiteboardService.updateNotes(el.id, 'x'.repeat(20001))).rejects.toThrow('20000');
    });

    it('should support threaded comments on elements', async () => {
      const el = await whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0 });

      // Root comment
      const rootResult = await whiteboardService.addComment(el.id, 'Main comment');
      const root = rootResult.comment;
      expect(root.elementId).toBe(el.id);
      expect(root.parentId).toBeNull();

      // Reply
      const replyResult = await whiteboardService.addComment(el.id, 'Reply to main', root.id);
      const reply = replyResult.comment;
      expect(reply.parentId).toBe(root.id);

      // Get thread
      const thread = await whiteboardService.getComments(el.id);
      expect(thread).toHaveLength(1); // 1 root
      expect(thread[0].replies).toHaveLength(1); // 1 reply
      expect(thread[0].replies[0].body).toBe('Reply to main');
    });

    it('should soft-delete element and cascade to comments', async () => {
      const el = await whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0 });
      await whiteboardService.addComment(el.id, 'Comment');

      await whiteboardService.deleteElement(el.id);

      const elements = await whiteboardService.getElementsByRoom(room.id);
      expect(elements).toHaveLength(0); // Soft-deleted elements filtered out

      const comments = await whiteboardService.getComments(el.id);
      expect(comments).toHaveLength(0); // Comments also soft-deleted
    });
  });

  describe('Sticky Notes → CSV Import', () => {
    it('should create sticky notes and group them', async () => {
      const note1 = await stickyService.createNote(room.id, { title: 'Idea 1', body: 'Details' });
      const note2 = await stickyService.createNote(room.id, { title: 'Idea 2', body: 'More details' });

      const group = await stickyService.createGroup(room.id, 'Phase 1', '#4CAF50');
      await stickyService.assignToGroup(note1.id, group.id);

      const notes = await stickyService.getNotesByRoom(room.id);
      expect(notes).toHaveLength(2);

      const assigned = notes.find(n => n.id === note1.id);
      expect(assigned.groupId).toBe(group.id);
    });

    it('should import CSV and report errors', async () => {
      const csv = `title,body
Task 1,Do this
Task 2,Do that
,Missing title
Task 4,`;
      const result = await stickyService.importCSV(room.id, csv);
      expect(result.imported).toBe(3); // Task 1, 2, 4 (4 has empty body but non-empty title)
      expect(result.errors.length).toBeGreaterThanOrEqual(1); // Row with missing title

      const notes = await stickyService.getNotesByRoom(room.id);
      expect(notes).toHaveLength(3);
    });

    it('should generate downloadable error CSV', () => {
      const errors = [
        { row: 3, column: 'title', message: 'Title is empty' },
        { row: 5, column: 'body', message: 'Body is empty' }
      ];
      const csv = stickyService.exportErrorCSV(errors);
      expect(csv).toContain('row,column,message');
      expect(csv).toContain('3,title,Title is empty');
    });

    it('should delete group and ungroup its notes', async () => {
      const note = await stickyService.createNote(room.id, { title: 'Grouped', body: 'test' });
      const group = await stickyService.createGroup(room.id, 'MyGroup', '#FFF');
      await stickyService.assignToGroup(note.id, group.id);

      await stickyService.deleteGroup(group.id);

      const { db } = await import('../../js/core/db.js');
      const updated = await db.get('stickyNotes', note.id);
      expect(updated.groupId).toBeNull();
    });
  });

  describe('Chat → Rate Limiting → Message Cap', () => {
    it('should send and retrieve messages', async () => {
      await chatService.sendMessage(room.id, 'Hello team!');
      await chatService.sendMessage(room.id, 'Meeting at 3pm');

      const messages = await chatService.getMessages(room.id);
      expect(messages).toHaveLength(2);
      expect(messages[0].body).toBe('Meeting at 3pm'); // Desc order — newest first
    });

    it('should enforce 500-char limit', async () => {
      await expect(chatService.sendMessage(room.id, 'x'.repeat(501)))
        .rejects.toThrow('500');
    });

    it('should allow exactly 500 chars', async () => {
      const result = await chatService.sendMessage(room.id, 'x'.repeat(500));
      expect(result.message.body.length).toBe(500);
    });

    it('should require logged-in user', async () => {
      const { store } = await import('../../js/core/store.js');
      store.set('currentUser', null);
      await expect(chatService.sendMessage(room.id, 'hello'))
        .rejects.toThrow('logged in');
    });

    it('should emit chat:message event', async () => {
      const handler = vi.fn();
      bus.on('chat:message', handler);
      await chatService.sendMessage(room.id, 'event test');
      expect(handler).toHaveBeenCalled();
      expect(handler.mock.calls[0][0].body).toBe('event test');
      bus.off('chat:message', handler);
    });

    it('should soft-delete messages', async () => {
      const { message } = await chatService.sendMessage(room.id, 'delete me');
      await chatService.deleteMessage(message.id);

      const { db } = await import('../../js/core/db.js');
      const stored = await db.get('chatMessages', message.id);
      expect(stored.deleted).toBe(true);
    });
  });

  describe('Snapshots', () => {
    it('should create snapshot capturing room data', async () => {
      await whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0 });
      await stickyService.createNote(room.id, { title: 'Note', body: 'Body' });
      await chatService.sendMessage(room.id, 'Hello');

      const snapshot = await roomService.createSnapshot(room.id, 'v1');
      expect(snapshot.roomId).toBe(room.id);
      expect(snapshot.sizeBytes).toBeGreaterThan(0);

      // Verify snapshot data contains our items
      const data = JSON.parse(snapshot.blob);
      expect(data.whiteboardElements.length).toBeGreaterThanOrEqual(1);
      expect(data.stickyNotes.length).toBeGreaterThanOrEqual(1);
      expect(data.chatMessages.length).toBeGreaterThanOrEqual(1);
    });

    it('should rollback snapshot restoring data', async () => {
      // Create data
      await whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0 });
      const snapshot = await roomService.createSnapshot(room.id, 'before-change');

      // Modify data
      await whiteboardService.createElement(room.id, 'ellipse', { x: 50, y: 50 });

      // Before rollback
      let elements = await whiteboardService.getElementsByRoom(room.id);
      expect(elements.length).toBe(2);

      // Rollback
      await roomService.rollbackSnapshot(room.id, snapshot.id);

      elements = await whiteboardService.getElementsByRoom(room.id);
      expect(elements.length).toBe(1);
      expect(elements[0].type).toBe('rect');
    });
  });
});
