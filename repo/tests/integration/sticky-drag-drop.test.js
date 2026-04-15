import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetAll, setCurrentUser } from '../helpers.js';
import { roomService } from '../../js/services/room-service.js';
import { stickyService } from '../../js/services/sticky-service.js';
import { bus } from '../../js/core/event-bus.js';
import { autosave } from '../../js/core/autosave.js';

describe('Integration: Sticky drag-and-drop grouping', () => {
  let room;

  beforeEach(async () => {
    await resetAll();
    setCurrentUser();
    autosave.destroy();
    autosave.init(async () => {});
    room = await roomService.createRoom('DnD Room');
  });

  afterEach(() => {
    autosave.destroy();
  });

  it('should create a group and assign a note to it', async () => {
    const note = await stickyService.createNote(room.id, { title: 'Task 1', body: 'Do it' });
    const group = await stickyService.createGroup(room.id, 'Sprint 1', '#4CAF50');

    const updated = await stickyService.assignToGroup(note.id, group.id);
    expect(updated.groupId).toBe(group.id);

    // Verify via getNotesByRoom
    const notes = await stickyService.getNotesByRoom(room.id);
    const found = notes.find(n => n.id === note.id);
    expect(found.groupId).toBe(group.id);
  });

  it('should ungroup a note by assigning null groupId', async () => {
    const note = await stickyService.createNote(room.id, { title: 'Task', body: 'B' });
    const group = await stickyService.createGroup(room.id, 'G', '#fff');
    await stickyService.assignToGroup(note.id, group.id);

    // Ungroup
    const ungrouped = await stickyService.assignToGroup(note.id, null);
    expect(ungrouped.groupId).toBeNull();
  });

  it('should move note between groups', async () => {
    const note = await stickyService.createNote(room.id, { title: 'Task', body: 'B' });
    const g1 = await stickyService.createGroup(room.id, 'Phase 1', '#4CAF50');
    const g2 = await stickyService.createGroup(room.id, 'Phase 2', '#2196F3');

    await stickyService.assignToGroup(note.id, g1.id);
    const moved = await stickyService.assignToGroup(note.id, g2.id);
    expect(moved.groupId).toBe(g2.id);
  });

  it('should emit sticky:updated on group assignment', async () => {
    const handler = vi.fn();
    bus.on('sticky:updated', handler);

    const note = await stickyService.createNote(room.id, { title: 'T', body: 'B' });
    const group = await stickyService.createGroup(room.id, 'G', '#fff');
    await stickyService.assignToGroup(note.id, group.id);

    expect(handler).toHaveBeenCalled();
    const emitted = handler.mock.calls.find(c => c[0].id === note.id);
    expect(emitted[0].groupId).toBe(group.id);
    bus.off('sticky:updated', handler);
  });

  it('should delete group and ungroup all its notes', async () => {
    const n1 = await stickyService.createNote(room.id, { title: 'A', body: '1' });
    const n2 = await stickyService.createNote(room.id, { title: 'B', body: '2' });
    const group = await stickyService.createGroup(room.id, 'Temp', '#F44336');

    await stickyService.assignToGroup(n1.id, group.id);
    await stickyService.assignToGroup(n2.id, group.id);

    await stickyService.deleteGroup(group.id);

    const notes = await stickyService.getNotesByRoom(room.id);
    expect(notes.every(n => n.groupId === null)).toBe(true);

    const groups = await stickyService.getGroups(room.id);
    expect(groups).toHaveLength(0);
  });

  it('should handle multiple groups with isolated notes', async () => {
    const n1 = await stickyService.createNote(room.id, { title: 'A', body: '1' });
    const n2 = await stickyService.createNote(room.id, { title: 'B', body: '2' });
    const n3 = await stickyService.createNote(room.id, { title: 'C', body: '3' });
    const g1 = await stickyService.createGroup(room.id, 'G1', '#4CAF50');
    const g2 = await stickyService.createGroup(room.id, 'G2', '#2196F3');

    await stickyService.assignToGroup(n1.id, g1.id);
    await stickyService.assignToGroup(n2.id, g2.id);
    // n3 stays ungrouped

    const notes = await stickyService.getNotesByRoom(room.id);
    const byGroup = {};
    for (const n of notes) {
      const key = n.groupId || 'ungrouped';
      (byGroup[key] ??= []).push(n);
    }

    expect(byGroup[g1.id]).toHaveLength(1);
    expect(byGroup[g1.id][0].title).toBe('A');
    expect(byGroup[g2.id]).toHaveLength(1);
    expect(byGroup[g2.id][0].title).toBe('B');
    expect(byGroup['ungrouped']).toHaveLength(1);
    expect(byGroup['ungrouped'][0].title).toBe('C');
  });

  it('should mark autosave dirty on group assignment', async () => {
    await autosave.flush();

    const note = await stickyService.createNote(room.id, { title: 'T', body: 'B' });
    const group = await stickyService.createGroup(room.id, 'G', '#fff');
    await autosave.flush();

    // Now assign to group
    await stickyService.assignToGroup(note.id, group.id);
    expect(autosave.hasPending()).toBe(true);
  });

  it('should list groups for a room', async () => {
    await stickyService.createGroup(room.id, 'Alpha', '#4CAF50');
    await stickyService.createGroup(room.id, 'Beta', '#2196F3');

    const groups = await stickyService.getGroups(room.id);
    expect(groups).toHaveLength(2);
    const names = groups.map(g => g.name).sort();
    expect(names).toEqual(['Alpha', 'Beta']);
  });

  it('should not affect notes in other rooms', async () => {
    const room2 = await roomService.createRoom('Other Room');
    const n1 = await stickyService.createNote(room.id, { title: 'Room1 Note', body: 'B' });
    const n2 = await stickyService.createNote(room2.id, { title: 'Room2 Note', body: 'B' });
    const group = await stickyService.createGroup(room.id, 'G', '#fff');

    await stickyService.assignToGroup(n1.id, group.id);

    const room1Notes = await stickyService.getNotesByRoom(room.id);
    const room2Notes = await stickyService.getNotesByRoom(room2.id);

    expect(room1Notes[0].groupId).toBe(group.id);
    expect(room2Notes[0].groupId).toBeNull();
  });
});
