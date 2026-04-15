import { describe, it, expect, beforeEach } from 'vitest';
import { resetAll, setCurrentUser } from '../helpers.js';
import { createProfile, login, logout, lockSession, unlockSession, getCurrentSession } from '../../js/services/auth-service.js';
import { roomService } from '../../js/services/room-service.js';
import { store } from '../../js/core/store.js';
import { storage, STORAGE_KEYS } from '../../js/core/storage.js';

describe('Integration: Login → Rooms → Room flow', () => {
  beforeEach(async () => {
    await resetAll();
  });

  it('should complete full signup → login → create room → enter room flow', async () => {
    // 1. Create profile
    const profile = await createProfile('alice', 'Alice', 'password123');
    expect(profile.username).toBe('alice');
    expect(profile.id).toBeTruthy();

    // 2. Login
    const { session, profile: user } = await login('alice', 'password123');
    expect(user.username).toBe('alice');
    expect(store.get('currentUser')).toBeTruthy();
    expect(store.get('currentUser').id).toBe(profile.id);
    expect(storage.get(STORAGE_KEYS.CURRENT_USER)).toBeTruthy();

    // 3. Create room
    const room = await roomService.createRoom('Team Standup', 'Daily sync');
    expect(room.name).toBe('Team Standup');
    expect(room.createdBy).toBe(profile.id);

    // 4. List rooms
    const rooms = await roomService.listRooms();
    expect(rooms).toHaveLength(1);
    expect(rooms[0].id).toBe(room.id);

    // 5. Get room
    const fetched = await roomService.getRoom(room.id);
    expect(fetched.name).toBe('Team Standup');
  });

  it('should handle lock → unlock cycle preserving session', async () => {
    await createProfile('bob', 'Bob', 'secret99');
    await login('bob', 'secret99');

    const userBefore = store.get('currentUser');
    expect(userBefore).toBeTruthy();

    // Lock
    await lockSession();
    expect(store.get('locked')).toBe(true);

    // Session user should still be set
    expect(store.get('currentUser')).toBeTruthy();

    // Unlock with correct password
    await unlockSession('secret99');
    expect(store.get('locked')).toBe(false);

    // User should still be the same
    expect(store.get('currentUser').id).toBe(userBefore.id);
  });

  it('should reject unlock with wrong password', async () => {
    await createProfile('carol', 'Carol', 'mypass');
    await login('carol', 'mypass');
    await lockSession();

    await expect(unlockSession('wrongpass')).rejects.toThrow('Incorrect password');
    expect(store.get('locked')).toBe(true);
  });

  it('should clear session on logout', async () => {
    await createProfile('dan', 'Dan', 'pass123');
    await login('dan', 'pass123');
    expect(store.get('currentUser')).toBeTruthy();

    await logout();
    expect(store.get('currentUser')).toBeNull();
    expect(storage.get(STORAGE_KEYS.CURRENT_USER)).toBeNull();
  });

  it('should restore session from localStorage', async () => {
    await createProfile('eve', 'Eve', 'evepw');
    await login('eve', 'evepw');
    const userId = store.get('currentUser').id;

    // Simulate page reload — clear store but keep localStorage
    store.set('currentUser', null);

    // getCurrentSession should restore from localStorage
    const restored = getCurrentSession();
    expect(restored).toBeTruthy();
    expect(restored.id).toBe(userId);
    expect(store.get('currentUser').id).toBe(userId);
  });

  it('should create multiple rooms and list them all', async () => {
    setCurrentUser();

    await roomService.createRoom('Room A', 'First');
    await roomService.createRoom('Room B', 'Second');
    await roomService.createRoom('Room C', 'Third');

    const rooms = await roomService.listRooms();
    expect(rooms).toHaveLength(3);
    const names = rooms.map(r => r.name).sort();
    expect(names).toEqual(['Room A', 'Room B', 'Room C']);
  });

  it('should delete room and all associated data', async () => {
    setCurrentUser();

    const room = await roomService.createRoom('Doomed Room');
    // Add some data to the room
    const { db } = await import('../../js/core/db.js');
    await db.put('chatMessages', { id: 'cm1', roomId: room.id, body: 'hi', createdAt: Date.now() });
    await db.put('whiteboardElements', { id: 'el1', roomId: room.id, type: 'rect', createdAt: Date.now() });
    await db.put('stickyNotes', { id: 'sn1', roomId: room.id, title: 'note', createdAt: Date.now() });

    await roomService.deleteRoom(room.id);

    // Room gone
    const fetched = await roomService.getRoom(room.id);
    expect(fetched).toBeUndefined();

    // Related data gone
    const msgs = await db.getAllByIndex('chatMessages', 'roomId', room.id);
    expect(msgs).toHaveLength(0);
    const els = await db.getAllByIndex('whiteboardElements', 'roomId', room.id);
    expect(els).toHaveLength(0);
    const notes = await db.getAllByIndex('stickyNotes', 'roomId', room.id);
    expect(notes).toHaveLength(0);
  });
});
