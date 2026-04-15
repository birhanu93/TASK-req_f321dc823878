import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetAll, setCurrentUser } from '../helpers.js';
import { stickyService } from '../../js/services/sticky-service.js';
import { db } from '../../js/core/db.js';
import { bus } from '../../js/core/event-bus.js';

beforeEach(async () => {
  await resetAll();
  setCurrentUser();
});

describe('stickyService', () => {
  // ── createNote ─────────────────────────────────────────────────────

  describe('createNote', () => {
    it('should create a note with correct defaults', async () => {
      const note = await stickyService.createNote('room1');

      expect(note.id).toBeTruthy();
      expect(note.roomId).toBe('room1');
      expect(note.title).toBe('');
      expect(note.body).toBe('');
      expect(note.color).toBe('#FFEB3B');
      expect(note.posX).toBe(0);
      expect(note.posY).toBe(0);
      expect(note.groupId).toBeNull();
      expect(note.deleted).toBe(false);
      expect(note.createdBy).toBe('u1');
      expect(note.createdAt).toBeTypeOf('number');
      expect(note.updatedAt).toBeTypeOf('number');
    });

    it('should accept custom data', async () => {
      const note = await stickyService.createNote('room1', {
        title: 'My Note',
        body: 'Some text',
        color: '#FF0000',
        posX: 100,
        posY: 200
      });

      expect(note.title).toBe('My Note');
      expect(note.body).toBe('Some text');
      expect(note.color).toBe('#FF0000');
      expect(note.posX).toBe(100);
      expect(note.posY).toBe(200);
    });

    it('should persist note to the database', async () => {
      const note = await stickyService.createNote('room1', { title: 'Persisted' });
      const stored = await db.get('stickyNotes', note.id);
      expect(stored).toBeDefined();
      expect(stored.title).toBe('Persisted');
    });

    it('should throw when roomId is missing', async () => {
      await expect(stickyService.createNote('')).rejects.toThrow('roomId is required');
    });

    it('should emit sticky:created event', async () => {
      const handler = vi.fn();
      bus.on('sticky:created', handler);

      const note = await stickyService.createNote('room1', { title: 'Event' });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].id).toBe(note.id);
    });
  });

  // ── updateNote ─────────────────────────────────────────────────────

  describe('updateNote', () => {
    it('should merge changes into the note', async () => {
      const note = await stickyService.createNote('room1', { title: 'Old' });
      const updated = await stickyService.updateNote(note.id, { title: 'New', color: '#00FF00' });

      expect(updated.title).toBe('New');
      expect(updated.color).toBe('#00FF00');
    });

    it('should protect immutable fields (id, roomId, createdBy, createdAt)', async () => {
      const note = await stickyService.createNote('room1');
      const updated = await stickyService.updateNote(note.id, {
        id: 'hacked',
        roomId: 'hacked-room',
        createdBy: 'hacked-user',
        createdAt: 0
      });

      expect(updated.id).toBe(note.id);
      expect(updated.roomId).toBe('room1');
      expect(updated.createdBy).toBe('u1');
      expect(updated.createdAt).toBe(note.createdAt);
    });

    it('should throw for non-existent note', async () => {
      await expect(stickyService.updateNote('nonexistent', { title: 'X' }))
        .rejects.toThrow('Note not found');
    });

    it('should emit sticky:updated event', async () => {
      const handler = vi.fn();
      bus.on('sticky:updated', handler);

      const note = await stickyService.createNote('room1');
      await stickyService.updateNote(note.id, { title: 'Updated' });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ── deleteNote ─────────────────────────────────────────────────────

  describe('deleteNote', () => {
    it('should soft-delete the note', async () => {
      const note = await stickyService.createNote('room1');
      await stickyService.deleteNote(note.id);

      const stored = await db.get('stickyNotes', note.id);
      expect(stored.deleted).toBe(true);
    });

    it('should throw for non-existent note', async () => {
      await expect(stickyService.deleteNote('nonexistent'))
        .rejects.toThrow('Note not found');
    });

    it('should emit sticky:deleted event', async () => {
      const handler = vi.fn();
      bus.on('sticky:deleted', handler);

      const note = await stickyService.createNote('room1');
      await stickyService.deleteNote(note.id);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].id).toBe(note.id);
    });
  });

  // ── moveNote ───────────────────────────────────────────────────────

  describe('moveNote', () => {
    it('should update posX and posY', async () => {
      const note = await stickyService.createNote('room1');
      const moved = await stickyService.moveNote(note.id, 300, 400);

      expect(moved.posX).toBe(300);
      expect(moved.posY).toBe(400);
    });

    it('should throw for non-existent note', async () => {
      await expect(stickyService.moveNote('nonexistent', 10, 20))
        .rejects.toThrow('Note not found');
    });

    it('should emit sticky:moved event', async () => {
      const handler = vi.fn();
      bus.on('sticky:moved', handler);

      const note = await stickyService.createNote('room1');
      await stickyService.moveNote(note.id, 50, 60);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toMatchObject({ id: note.id, posX: 50, posY: 60 });
    });
  });

  // ── getNotesByRoom ─────────────────────────────────────────────────

  describe('getNotesByRoom', () => {
    it('should return only non-deleted notes', async () => {
      const n1 = await stickyService.createNote('room1', { title: 'Visible' });
      const n2 = await stickyService.createNote('room1', { title: 'Deleted' });
      await stickyService.deleteNote(n2.id);

      const notes = await stickyService.getNotesByRoom('room1');
      expect(notes.length).toBe(1);
      expect(notes[0].id).toBe(n1.id);
    });

    it('should return empty array for room with no notes', async () => {
      const notes = await stickyService.getNotesByRoom('emptyroom');
      expect(notes).toEqual([]);
    });

    it('should only return notes for the specified room', async () => {
      await stickyService.createNote('room1', { title: 'In room1' });
      await stickyService.createNote('room2', { title: 'In room2' });

      const notes = await stickyService.getNotesByRoom('room1');
      expect(notes.length).toBe(1);
      expect(notes[0].title).toBe('In room1');
    });
  });

  // ── createGroup ────────────────────────────────────────────────────

  describe('createGroup', () => {
    it('should create a group with name and color', async () => {
      const group = await stickyService.createGroup('room1', 'My Group', '#FF0000');

      expect(group.id).toBeTruthy();
      expect(group.roomId).toBe('room1');
      expect(group.name).toBe('My Group');
      expect(group.color).toBe('#FF0000');
      expect(group.createdAt).toBeTypeOf('number');
    });

    it('should default color to #FFEB3B', async () => {
      const group = await stickyService.createGroup('room1', 'Default Color', '');
      expect(group.color).toBe('#FFEB3B');
    });

    it('should throw when roomId is missing', async () => {
      await expect(stickyService.createGroup('', 'Name', '#FFF'))
        .rejects.toThrow('roomId is required');
    });

    it('should throw when name is missing', async () => {
      await expect(stickyService.createGroup('room1', '', '#FFF'))
        .rejects.toThrow('Group name is required');
    });

    it('should emit sticky:group-created event', async () => {
      const handler = vi.fn();
      bus.on('sticky:group-created', handler);

      await stickyService.createGroup('room1', 'Group', '#FFF');
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ── getGroups ──────────────────────────────────────────────────────

  describe('getGroups', () => {
    it('should return all groups for a room', async () => {
      await stickyService.createGroup('room1', 'Group A', '#F00');
      await stickyService.createGroup('room1', 'Group B', '#0F0');
      await stickyService.createGroup('room2', 'Group C', '#00F');

      const groups = await stickyService.getGroups('room1');
      expect(groups.length).toBe(2);
    });

    it('should return empty array when no groups exist', async () => {
      const groups = await stickyService.getGroups('emptyroom');
      expect(groups).toEqual([]);
    });
  });

  // ── deleteGroup ────────────────────────────────────────────────────

  describe('deleteGroup', () => {
    it('should delete the group', async () => {
      const group = await stickyService.createGroup('room1', 'To Delete', '#FFF');
      await stickyService.deleteGroup(group.id);

      const stored = await db.get('stickyGroups', group.id);
      expect(stored).toBeUndefined();
    });

    it('should ungroup notes that belonged to the deleted group', async () => {
      const group = await stickyService.createGroup('room1', 'My Group', '#FFF');
      const note = await stickyService.createNote('room1', { groupId: group.id });

      // Verify note is in the group
      let stored = await db.get('stickyNotes', note.id);
      expect(stored.groupId).toBe(group.id);

      await stickyService.deleteGroup(group.id);

      // Verify note is ungrouped
      stored = await db.get('stickyNotes', note.id);
      expect(stored.groupId).toBeNull();
    });

    it('should throw for non-existent group', async () => {
      await expect(stickyService.deleteGroup('nonexistent'))
        .rejects.toThrow('Group not found');
    });

    it('should emit sticky:group-deleted event', async () => {
      const handler = vi.fn();
      bus.on('sticky:group-deleted', handler);

      const group = await stickyService.createGroup('room1', 'Group', '#FFF');
      await stickyService.deleteGroup(group.id);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].id).toBe(group.id);
    });
  });

  // ── assignToGroup ──────────────────────────────────────────────────

  describe('assignToGroup', () => {
    it('should update the note groupId', async () => {
      const group = await stickyService.createGroup('room1', 'Group', '#FFF');
      const note = await stickyService.createNote('room1');

      const updated = await stickyService.assignToGroup(note.id, group.id);
      expect(updated.groupId).toBe(group.id);
    });

    it('should allow unassigning by setting groupId to null', async () => {
      const group = await stickyService.createGroup('room1', 'Group', '#FFF');
      const note = await stickyService.createNote('room1', { groupId: group.id });

      const updated = await stickyService.assignToGroup(note.id, null);
      expect(updated.groupId).toBeNull();
    });

    it('should throw for non-existent note', async () => {
      await expect(stickyService.assignToGroup('nonexistent', 'group1'))
        .rejects.toThrow('Note not found');
    });

    it('should emit sticky:updated event', async () => {
      const handler = vi.fn();
      bus.on('sticky:updated', handler);

      const note = await stickyService.createNote('room1');
      await stickyService.assignToGroup(note.id, 'group1');

      // createNote also emits sticky:created, so check for sticky:updated
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ── importCSV ──────────────────────────────────────────────────────

  describe('importCSV', () => {
    it('should import valid CSV with title and body columns', async () => {
      const csv = 'title,body\nNote 1,Body 1\nNote 2,Body 2';
      const result = await stickyService.importCSV('room1', csv);

      expect(result.imported).toBe(2);
      expect(result.errors).toEqual([]);

      const notes = await stickyService.getNotesByRoom('room1');
      expect(notes.length).toBe(2);
    });

    it('should produce errors for missing required columns', async () => {
      const csv = 'name,description\nFoo,Bar';
      const result = await stickyService.importCSV('room1', csv);

      expect(result.imported).toBe(0);
      expect(result.errors.length).toBe(2);
      expect(result.errors[0].column).toBe('title');
      expect(result.errors[1].column).toBe('body');
    });

    it('should produce error for missing title column only', async () => {
      const csv = 'body\nSome body';
      const result = await stickyService.importCSV('room1', csv);

      expect(result.imported).toBe(0);
      expect(result.errors.some(e => e.column === 'title')).toBe(true);
    });

    it('should produce error for empty title in a row', async () => {
      const csv = 'title,body\n,Body without title';
      const result = await stickyService.importCSV('room1', csv);

      expect(result.imported).toBe(0);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].column).toBe('title');
      expect(result.errors[0].message).toContain('Title is empty');
    });

    it('should handle max 1000 rows', async () => {
      const rows = ['title,body'];
      for (let i = 0; i < 1005; i++) {
        rows.push(`Title ${i},Body ${i}`);
      }
      const csv = rows.join('\n');
      const result = await stickyService.importCSV('room1', csv);

      // Only first 1000 should be processed
      expect(result.imported).toBe(1000);
      expect(result.errors.some(e => e.message.includes('exceeds maximum'))).toBe(true);
    });

    it('should throw for empty CSV', async () => {
      await expect(stickyService.importCSV('room1', '')).rejects.toThrow('CSV text is empty');
    });

    it('should throw for CSV with only header', async () => {
      await expect(stickyService.importCSV('room1', 'title,body'))
        .rejects.toThrow('CSV must contain a header row and at least one data row');
    });

    it('should throw when roomId is missing', async () => {
      await expect(stickyService.importCSV('', 'title,body\nA,B'))
        .rejects.toThrow('roomId is required');
    });

    it('should emit sticky:imported event', async () => {
      const handler = vi.fn();
      bus.on('sticky:imported', handler);

      const csv = 'title,body\nNote 1,Body 1';
      await stickyService.importCSV('room1', csv);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toMatchObject({ roomId: 'room1', count: 1 });
    });

    it('should handle quoted fields with commas', async () => {
      const csv = 'title,body\n"Title, with comma","Body, with comma"';
      const result = await stickyService.importCSV('room1', csv);

      expect(result.imported).toBe(1);
      const notes = await stickyService.getNotesByRoom('room1');
      expect(notes[0].title).toBe('Title, with comma');
      expect(notes[0].body).toBe('Body, with comma');
    });

    it('should skip rows where both title and body are empty', async () => {
      const csv = 'title,body\n,\nValid Title,Valid Body';
      const result = await stickyService.importCSV('room1', csv);

      expect(result.imported).toBe(1);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].message).toContain('Both title and body are empty');
    });
  });

  // ── exportErrorCSV ─────────────────────────────────────────────────

  describe('exportErrorCSV', () => {
    it('should format errors into a CSV string', () => {
      const errors = [
        { row: 2, column: 'title', message: 'Title is empty' },
        { row: 5, column: 'body', message: 'Body too long' }
      ];
      const csv = stickyService.exportErrorCSV(errors);

      expect(csv).toContain('row,column,message');
      expect(csv).toContain('2,title,Title is empty');
      expect(csv).toContain('5,body,Body too long');
    });

    it('should return empty string for no errors', () => {
      expect(stickyService.exportErrorCSV([])).toBe('');
      expect(stickyService.exportErrorCSV(null)).toBe('');
    });

    it('should escape fields containing commas', () => {
      const errors = [
        { row: 1, column: 'title', message: 'Has, comma' }
      ];
      const csv = stickyService.exportErrorCSV(errors);
      expect(csv).toContain('"Has, comma"');
    });
  });
});
