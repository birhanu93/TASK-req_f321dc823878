import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetAll, setCurrentUser } from '../helpers.js';
import { whiteboardService } from '../../js/services/whiteboard-service.js';
import { sensitiveWordService } from '../../js/services/sensitive-word-service.js';
import { db } from '../../js/core/db.js';
import { bus } from '../../js/core/event-bus.js';

beforeEach(async () => {
  await resetAll();
  setCurrentUser();
});

describe('whiteboardService', () => {
  // ── createElement ──────────────────────────────────────────────────

  describe('createElement', () => {
    it('should create an element with correct fields', async () => {
      const el = await whiteboardService.createElement('room1', 'rect', { x: 10, y: 20 });

      expect(el.id).toBeTruthy();
      expect(el.roomId).toBe('room1');
      expect(el.type).toBe('rect');
      expect(el.x).toBe(10);
      expect(el.y).toBe(20);
      expect(el.zIndex).toBe(0);
      expect(el.notes).toBe('');
      expect(el.deleted).toBe(false);
      expect(el.createdBy).toBe('u1');
      expect(el.createdAt).toBeTypeOf('number');
      expect(el.updatedAt).toBeTypeOf('number');
    });

    it('should persist element to the database', async () => {
      const el = await whiteboardService.createElement('room1', 'pen');
      const stored = await db.get('whiteboardElements', el.id);
      expect(stored).toBeDefined();
      expect(stored.type).toBe('pen');
    });

    it('should validate element type', async () => {
      await expect(whiteboardService.createElement('room1', 'invalid'))
        .rejects.toThrow('Invalid element type');
    });

    it('should accept all valid types', async () => {
      const types = ['pen', 'rect', 'ellipse', 'line', 'image', 'sticker'];
      for (const type of types) {
        const el = await whiteboardService.createElement('room1', type);
        expect(el.type).toBe(type);
      }
    });

    it('should throw when roomId is missing', async () => {
      await expect(whiteboardService.createElement('', 'rect'))
        .rejects.toThrow('roomId is required');
    });

    it('should emit whiteboard:element-created event', async () => {
      const handler = vi.fn();
      bus.on('whiteboard:element-created', handler);

      const el = await whiteboardService.createElement('room1', 'rect');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].id).toBe(el.id);
    });

    it('should use provided zIndex', async () => {
      const el = await whiteboardService.createElement('room1', 'rect', { zIndex: 5 });
      expect(el.zIndex).toBe(5);
    });

    it('should default zIndex to 0', async () => {
      const el = await whiteboardService.createElement('room1', 'rect');
      expect(el.zIndex).toBe(0);
    });
  });

  // ── updateElement ──────────────────────────────────────────────────

  describe('updateElement', () => {
    it('should merge changes into the element', async () => {
      const el = await whiteboardService.createElement('room1', 'rect', { x: 0, y: 0 });
      const updated = await whiteboardService.updateElement(el.id, { x: 100, color: 'red' });

      expect(updated.x).toBe(100);
      expect(updated.color).toBe('red');
      expect(updated.type).toBe('rect'); // unchanged
    });

    it('should protect immutable fields (id, roomId, createdBy, createdAt)', async () => {
      const el = await whiteboardService.createElement('room1', 'rect');
      const updated = await whiteboardService.updateElement(el.id, {
        id: 'hacked',
        roomId: 'hacked-room',
        createdBy: 'hacked-user',
        createdAt: 0
      });

      expect(updated.id).toBe(el.id);
      expect(updated.roomId).toBe('room1');
      expect(updated.createdBy).toBe('u1');
      expect(updated.createdAt).toBe(el.createdAt);
    });

    it('should update updatedAt timestamp', async () => {
      const el = await whiteboardService.createElement('room1', 'rect');
      const originalUpdatedAt = el.updatedAt;

      // Small delay to ensure different timestamp
      await new Promise(r => setTimeout(r, 5));
      const updated = await whiteboardService.updateElement(el.id, { x: 50 });
      expect(updated.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
    });

    it('should throw for non-existent element', async () => {
      await expect(whiteboardService.updateElement('nonexistent', { x: 1 }))
        .rejects.toThrow('Element not found');
    });

    it('should emit whiteboard:element-updated event', async () => {
      const handler = vi.fn();
      bus.on('whiteboard:element-updated', handler);

      const el = await whiteboardService.createElement('room1', 'rect');
      await whiteboardService.updateElement(el.id, { x: 10 });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ── deleteElement ──────────────────────────────────────────────────

  describe('deleteElement', () => {
    it('should soft-delete the element', async () => {
      const el = await whiteboardService.createElement('room1', 'rect');
      await whiteboardService.deleteElement(el.id);

      const stored = await db.get('whiteboardElements', el.id);
      expect(stored.deleted).toBe(true);
    });

    it('should soft-delete associated comments', async () => {
      const el = await whiteboardService.createElement('room1', 'rect');
      const comment = (await whiteboardService.addComment(el.id, 'A comment')).comment;
      await whiteboardService.deleteElement(el.id);

      const storedComment = await db.get('comments', comment.id);
      expect(storedComment.deleted).toBe(true);
    });

    it('should throw for non-existent element', async () => {
      await expect(whiteboardService.deleteElement('nonexistent'))
        .rejects.toThrow('Element not found');
    });

    it('should emit whiteboard:element-deleted event', async () => {
      const handler = vi.fn();
      bus.on('whiteboard:element-deleted', handler);

      const el = await whiteboardService.createElement('room1', 'rect');
      await whiteboardService.deleteElement(el.id);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].id).toBe(el.id);
    });
  });

  // ── moveElement ────────────────────────────────────────────────────

  describe('moveElement', () => {
    it('should update x and y coordinates', async () => {
      const el = await whiteboardService.createElement('room1', 'rect', { x: 0, y: 0 });
      const moved = await whiteboardService.moveElement(el.id, 150, 250);

      expect(moved.x).toBe(150);
      expect(moved.y).toBe(250);
    });

    it('should throw for non-existent element', async () => {
      await expect(whiteboardService.moveElement('nonexistent', 10, 20))
        .rejects.toThrow('Element not found');
    });

    it('should emit whiteboard:element-moved event', async () => {
      const handler = vi.fn();
      bus.on('whiteboard:element-moved', handler);

      const el = await whiteboardService.createElement('room1', 'rect');
      await whiteboardService.moveElement(el.id, 100, 200);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toMatchObject({ id: el.id, x: 100, y: 200 });
    });
  });

  // ── updateNotes ────────────────────────────────────────────────────

  describe('updateNotes', () => {
    it('should update the notes field', async () => {
      const el = await whiteboardService.createElement('room1', 'rect');
      const updated = await whiteboardService.updateNotes(el.id, 'New notes');

      expect(updated.notes).toBe('New notes');
    });

    it('should validate max length of 20000 characters', async () => {
      const el = await whiteboardService.createElement('room1', 'rect');
      const longNotes = 'a'.repeat(20001);

      await expect(whiteboardService.updateNotes(el.id, longNotes))
        .rejects.toThrow('cannot exceed 20000 characters');
    });

    it('should allow exactly 20000 characters', async () => {
      const el = await whiteboardService.createElement('room1', 'rect');
      const notes = 'a'.repeat(20000);
      const updated = await whiteboardService.updateNotes(el.id, notes);
      expect(updated.notes.length).toBe(20000);
    });

    it('should throw for non-string notes', async () => {
      const el = await whiteboardService.createElement('room1', 'rect');
      await expect(whiteboardService.updateNotes(el.id, 123))
        .rejects.toThrow('Notes must be a string');
    });

    it('should throw for non-existent element', async () => {
      await expect(whiteboardService.updateNotes('nonexistent', 'notes'))
        .rejects.toThrow('Element not found');
    });

    it('should emit whiteboard:notes-updated event', async () => {
      const handler = vi.fn();
      bus.on('whiteboard:notes-updated', handler);

      const el = await whiteboardService.createElement('room1', 'rect');
      await whiteboardService.updateNotes(el.id, 'Event notes');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].notes).toBe('Event notes');
    });
  });

  // ── getElementsByRoom ──────────────────────────────────────────────

  describe('getElementsByRoom', () => {
    it('should return only non-deleted elements', async () => {
      const el1 = await whiteboardService.createElement('room1', 'rect');
      const el2 = await whiteboardService.createElement('room1', 'pen');
      await whiteboardService.deleteElement(el1.id);

      const elements = await whiteboardService.getElementsByRoom('room1');
      expect(elements.length).toBe(1);
      expect(elements[0].id).toBe(el2.id);
    });

    it('should sort by zIndex ascending', async () => {
      await whiteboardService.createElement('room1', 'rect', { zIndex: 3 });
      await whiteboardService.createElement('room1', 'pen', { zIndex: 1 });
      await whiteboardService.createElement('room1', 'ellipse', { zIndex: 2 });

      const elements = await whiteboardService.getElementsByRoom('room1');
      expect(elements.length).toBe(3);
      expect(elements[0].zIndex).toBe(1);
      expect(elements[1].zIndex).toBe(2);
      expect(elements[2].zIndex).toBe(3);
    });

    it('should return empty array for room with no elements', async () => {
      const elements = await whiteboardService.getElementsByRoom('emptyroom');
      expect(elements).toEqual([]);
    });

    it('should only return elements for the specified room', async () => {
      await whiteboardService.createElement('room1', 'rect');
      await whiteboardService.createElement('room2', 'pen');

      const elements = await whiteboardService.getElementsByRoom('room1');
      expect(elements.length).toBe(1);
      expect(elements[0].roomId).toBe('room1');
    });
  });

  // ── reorderElement ─────────────────────────────────────────────────

  describe('reorderElement', () => {
    it('should update the zIndex', async () => {
      const el = await whiteboardService.createElement('room1', 'rect', { zIndex: 0 });
      const updated = await whiteboardService.reorderElement(el.id, 10);

      expect(updated.zIndex).toBe(10);
    });

    it('should throw for non-existent element', async () => {
      await expect(whiteboardService.reorderElement('nonexistent', 5))
        .rejects.toThrow('Element not found');
    });

    it('should emit whiteboard:element-updated event', async () => {
      const handler = vi.fn();
      bus.on('whiteboard:element-updated', handler);

      const el = await whiteboardService.createElement('room1', 'rect');
      await whiteboardService.reorderElement(el.id, 7);

      // createElement also emits, so check last call
      const lastCall = handler.mock.calls[handler.mock.calls.length - 1][0];
      expect(lastCall.zIndex).toBe(7);
    });
  });

  // ── addComment ─────────────────────────────────────────────────────

  describe('addComment', () => {
    it('should create a comment on an element', async () => {
      const el = await whiteboardService.createElement('room1', 'rect');
      const result = await whiteboardService.addComment(el.id, 'Nice work!');
      const comment = result.comment;

      expect(comment.id).toBeTruthy();
      expect(comment.elementId).toBe(el.id);
      expect(comment.roomId).toBe('room1');
      expect(comment.parentId).toBeNull();
      expect(comment.body).toBe('Nice work!');
      expect(comment.deleted).toBe(false);
      expect(comment.authorId).toBe('u1');
    });

    it('should create a threaded reply', async () => {
      const el = await whiteboardService.createElement('room1', 'rect');
      const root = (await whiteboardService.addComment(el.id, 'Root comment')).comment;
      const reply = (await whiteboardService.addComment(el.id, 'A reply', root.id)).comment;

      expect(reply.parentId).toBe(root.id);
    });

    it('should throw for empty body', async () => {
      const el = await whiteboardService.createElement('room1', 'rect');
      await expect(whiteboardService.addComment(el.id, ''))
        .rejects.toThrow('Comment body cannot be empty');
    });

    it('should throw for whitespace-only body', async () => {
      const el = await whiteboardService.createElement('room1', 'rect');
      await expect(whiteboardService.addComment(el.id, '   '))
        .rejects.toThrow('Comment body cannot be empty');
    });

    it('should throw for non-existent element', async () => {
      await expect(whiteboardService.addComment('nonexistent', 'Comment'))
        .rejects.toThrow('Element not found');
    });

    it('should emit comment:added event', async () => {
      const handler = vi.fn();
      bus.on('comment:added', handler);

      const el = await whiteboardService.createElement('room1', 'rect');
      await whiteboardService.addComment(el.id, 'A comment');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].body).toBe('A comment');
    });

    it('should return no warnings when no sensitive words are loaded', async () => {
      const el = await whiteboardService.createElement('room1', 'rect');
      const result = await whiteboardService.addComment(el.id, 'Clean comment');
      expect(result.warnings).toBeUndefined();
      expect(result.comment.body).toBe('Clean comment');
    });

    it('should return warnings when comment contains sensitive words', async () => {
      await sensitiveWordService.addWord('badword', 'high');
      const el = await whiteboardService.createElement('room1', 'rect');
      const result = await whiteboardService.addComment(el.id, 'This has badword in it');

      expect(result.warnings).toBeDefined();
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0].word).toBe('badword');
      expect(result.warnings[0].severity).toBe('high');
      // Comment is still persisted
      expect(result.comment.body).toBe('This has badword in it');
    });

    it('should return warnings for replies containing sensitive words', async () => {
      await sensitiveWordService.addWord('forbidden', 'medium');
      const el = await whiteboardService.createElement('room1', 'rect');
      const root = (await whiteboardService.addComment(el.id, 'Root comment')).comment;
      const result = await whiteboardService.addComment(el.id, 'A forbidden reply', root.id);

      expect(result.warnings).toBeDefined();
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0].word).toBe('forbidden');
      expect(result.comment.parentId).toBe(root.id);
    });
  });

  // ── getComments ────────────────────────────────────────────────────

  describe('getComments', () => {
    it('should build a thread tree with root comments and replies', async () => {
      const el = await whiteboardService.createElement('room1', 'rect');

      // Insert comments directly with explicit timestamps to guarantee ordering
      const root1Id = 'root-1';
      const root2Id = 'root-2';
      const reply1Id = 'reply-1';
      const reply2Id = 'reply-2';

      await db.put('comments', { id: root1Id, elementId: el.id, roomId: 'room1', parentId: null, body: 'Root 1', deleted: false, authorId: 'u1', createdAt: 1000, updatedAt: 1000 });
      await db.put('comments', { id: root2Id, elementId: el.id, roomId: 'room1', parentId: null, body: 'Root 2', deleted: false, authorId: 'u1', createdAt: 2000, updatedAt: 2000 });
      await db.put('comments', { id: reply1Id, elementId: el.id, roomId: 'room1', parentId: root1Id, body: 'Reply to root 1', deleted: false, authorId: 'u1', createdAt: 3000, updatedAt: 3000 });
      await db.put('comments', { id: reply2Id, elementId: el.id, roomId: 'room1', parentId: root2Id, body: 'Reply to root 2', deleted: false, authorId: 'u1', createdAt: 4000, updatedAt: 4000 });

      const threads = await whiteboardService.getComments(el.id);

      expect(threads.length).toBe(2);
      expect(threads[0].body).toBe('Root 1');
      expect(threads[0].replies.length).toBe(1);
      expect(threads[0].replies[0].body).toBe('Reply to root 1');
      expect(threads[1].body).toBe('Root 2');
      expect(threads[1].replies.length).toBe(1);
    });

    it('should exclude deleted comments', async () => {
      const el = await whiteboardService.createElement('room1', 'rect');
      const c1 = (await whiteboardService.addComment(el.id, 'Visible')).comment;
      const c2 = (await whiteboardService.addComment(el.id, 'To delete')).comment;
      await whiteboardService.deleteComment(c2.id);

      const threads = await whiteboardService.getComments(el.id);
      expect(threads.length).toBe(1);
      expect(threads[0].body).toBe('Visible');
    });

    it('should return empty array when no comments exist', async () => {
      const el = await whiteboardService.createElement('room1', 'rect');
      const threads = await whiteboardService.getComments(el.id);
      expect(threads).toEqual([]);
    });
  });

  // ── updateComment ──────────────────────────────────────────────────

  describe('updateComment', () => {
    it('should update comment body', async () => {
      const el = await whiteboardService.createElement('room1', 'rect');
      const comment = (await whiteboardService.addComment(el.id, 'Original')).comment;
      const result = await whiteboardService.updateComment(comment.id, 'Edited');

      expect(result.comment.body).toBe('Edited');
    });

    it('should throw for empty body', async () => {
      const el = await whiteboardService.createElement('room1', 'rect');
      const comment = (await whiteboardService.addComment(el.id, 'Original')).comment;
      await expect(whiteboardService.updateComment(comment.id, ''))
        .rejects.toThrow('Comment body cannot be empty');
    });

    it('should throw for non-existent comment', async () => {
      await expect(whiteboardService.updateComment('nonexistent', 'body'))
        .rejects.toThrow('Comment not found');
    });

    it('should emit comment:updated event', async () => {
      const handler = vi.fn();
      bus.on('comment:updated', handler);

      const el = await whiteboardService.createElement('room1', 'rect');
      const comment = (await whiteboardService.addComment(el.id, 'Original')).comment;
      await whiteboardService.updateComment(comment.id, 'Edited');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].body).toBe('Edited');
    });

    it('should return warnings when edited text contains sensitive words', async () => {
      await sensitiveWordService.addWord('offensive', 'high');
      const el = await whiteboardService.createElement('room1', 'rect');
      const comment = (await whiteboardService.addComment(el.id, 'Clean text')).comment;
      const result = await whiteboardService.updateComment(comment.id, 'Now has offensive content');

      expect(result.warnings).toBeDefined();
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0].word).toBe('offensive');
      expect(result.comment.body).toBe('Now has offensive content');
    });

    it('should return no warnings when edited text is clean', async () => {
      const el = await whiteboardService.createElement('room1', 'rect');
      const comment = (await whiteboardService.addComment(el.id, 'Original')).comment;
      const result = await whiteboardService.updateComment(comment.id, 'Still clean');

      expect(result.warnings).toBeUndefined();
      expect(result.comment.body).toBe('Still clean');
    });
  });

  // ── deleteComment ──────────────────────────────────────────────────

  describe('deleteComment', () => {
    it('should soft-delete a comment', async () => {
      const el = await whiteboardService.createElement('room1', 'rect');
      const comment = (await whiteboardService.addComment(el.id, 'To delete')).comment;
      await whiteboardService.deleteComment(comment.id);

      const stored = await db.get('comments', comment.id);
      expect(stored.deleted).toBe(true);
    });

    it('should throw for non-existent comment', async () => {
      await expect(whiteboardService.deleteComment('nonexistent'))
        .rejects.toThrow('Comment not found');
    });

    it('should emit comment:deleted event', async () => {
      const handler = vi.fn();
      bus.on('comment:deleted', handler);

      const el = await whiteboardService.createElement('room1', 'rect');
      const comment = (await whiteboardService.addComment(el.id, 'To delete')).comment;
      await whiteboardService.deleteComment(comment.id);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].id).toBe(comment.id);
    });
  });
});
