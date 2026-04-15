import { describe, it, expect, beforeEach } from 'vitest';
import { openDB, db } from '../../js/core/db.js';

// Ensure DB is open and clear test stores before each test
const TEST_STORES = [
  'profiles', 'sessions', 'rooms', 'whiteboardElements', 'comments',
  'stickyNotes', 'stickyGroups', 'chatMessages', 'presence', 'activityLogs',
  'snapshots', 'notifications', 'relationships', 'opsAnnouncements',
  'opsTemplates', 'opsSensitiveWords', 'opsRules', 'canaryFlags',
  'analyticsEvents', 'mealPlans', 'nutrientDb', 'bookings', 'bookingPolicies'
];

beforeEach(async () => {
  await openDB();
  for (const store of TEST_STORES) {
    try { await db.clear(store); } catch { /* ignore if already clear */ }
  }
});

describe('Database', () => {
  describe('openDB', () => {
    it('should open the database successfully', async () => {
      const database = await openDB();
      expect(database).toBeTruthy();
      expect(database.name).toBe('alignspace_db');
    });

    it('should create all expected object stores', async () => {
      const database = await openDB();
      const storeNames = [...database.objectStoreNames];
      expect(storeNames).toContain('profiles');
      expect(storeNames).toContain('sessions');
      expect(storeNames).toContain('rooms');
      expect(storeNames).toContain('whiteboardElements');
      expect(storeNames).toContain('comments');
      expect(storeNames).toContain('stickyNotes');
      expect(storeNames).toContain('stickyGroups');
      expect(storeNames).toContain('chatMessages');
      expect(storeNames).toContain('presence');
      expect(storeNames).toContain('activityLogs');
      expect(storeNames).toContain('snapshots');
      expect(storeNames).toContain('notifications');
      expect(storeNames).toContain('relationships');
      expect(storeNames).toContain('opsAnnouncements');
      expect(storeNames).toContain('opsTemplates');
      expect(storeNames).toContain('opsSensitiveWords');
      expect(storeNames).toContain('opsRules');
      expect(storeNames).toContain('canaryFlags');
      expect(storeNames).toContain('analyticsEvents');
      expect(storeNames).toContain('mealPlans');
      expect(storeNames).toContain('nutrientDb');
      expect(storeNames).toContain('bookings');
      expect(storeNames).toContain('bookingPolicies');
    });
  });

  describe('put / get', () => {
    it('should store and retrieve a record', async () => {
      await db.put('profiles', { id: 'p1', username: 'alice', displayName: 'Alice' });
      const result = await db.get('profiles', 'p1');
      expect(result).toEqual({ id: 'p1', username: 'alice', displayName: 'Alice' });
    });

    it('should return undefined for non-existent key', async () => {
      const result = await db.get('profiles', 'nonexistent');
      expect(result).toBeUndefined();
    });

    it('should overwrite existing record', async () => {
      await db.put('profiles', { id: 'p1', username: 'alice' });
      await db.put('profiles', { id: 'p1', username: 'bob' });
      const result = await db.get('profiles', 'p1');
      expect(result.username).toBe('bob');
    });
  });

  describe('getAll', () => {
    it('should return all records', async () => {
      await db.put('rooms', { id: 'r1', name: 'Room1' });
      await db.put('rooms', { id: 'r2', name: 'Room2' });
      const all = await db.getAll('rooms');
      expect(all).toHaveLength(2);
    });

    it('should return empty array for empty store', async () => {
      const all = await db.getAll('rooms');
      expect(all).toEqual([]);
    });
  });

  describe('getAllByIndex', () => {
    it('should query by index value', async () => {
      await db.put('chatMessages', { id: 'm1', roomId: 'r1', body: 'hi', createdAt: 1 });
      await db.put('chatMessages', { id: 'm2', roomId: 'r1', body: 'yo', createdAt: 2 });
      await db.put('chatMessages', { id: 'm3', roomId: 'r2', body: 'no', createdAt: 3 });
      const msgs = await db.getAllByIndex('chatMessages', 'roomId', 'r1');
      expect(msgs).toHaveLength(2);
      expect(msgs.every(m => m.roomId === 'r1')).toBe(true);
    });
  });

  describe('getByIndex', () => {
    it('should return single record by unique index', async () => {
      await db.put('profiles', { id: 'p1', username: 'alice' });
      const result = await db.getByIndex('profiles', 'username', 'alice');
      expect(result.id).toBe('p1');
    });

    it('should return undefined for non-existent index value', async () => {
      const result = await db.getByIndex('profiles', 'username', 'nobody');
      expect(result).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('should delete a record', async () => {
      await db.put('rooms', { id: 'r1', name: 'Room' });
      await db.delete('rooms', 'r1');
      const result = await db.get('rooms', 'r1');
      expect(result).toBeUndefined();
    });
  });

  describe('count', () => {
    it('should count all records in a store', async () => {
      await db.put('rooms', { id: 'r1', name: 'R1' });
      await db.put('rooms', { id: 'r2', name: 'R2' });
      const c = await db.count('rooms');
      expect(c).toBe(2);
    });

    it('should count by index', async () => {
      await db.put('chatMessages', { id: 'm1', roomId: 'r1', createdAt: 1 });
      await db.put('chatMessages', { id: 'm2', roomId: 'r1', createdAt: 2 });
      await db.put('chatMessages', { id: 'm3', roomId: 'r2', createdAt: 3 });
      const c = await db.count('chatMessages', 'roomId', 'r1');
      expect(c).toBe(2);
    });
  });

  describe('clear', () => {
    it('should remove all records from a store', async () => {
      await db.put('rooms', { id: 'r1', name: 'R1' });
      await db.put('rooms', { id: 'r2', name: 'R2' });
      await db.clear('rooms');
      const all = await db.getAll('rooms');
      expect(all).toEqual([]);
    });
  });

  describe('putBatch', () => {
    it('should insert multiple records', async () => {
      await db.putBatch('rooms', [
        { id: 'r1', name: 'R1' },
        { id: 'r2', name: 'R2' },
        { id: 'r3', name: 'R3' }
      ]);
      const all = await db.getAll('rooms');
      expect(all).toHaveLength(3);
    });
  });

  describe('deleteBatch', () => {
    it('should delete multiple records', async () => {
      await db.putBatch('rooms', [
        { id: 'r1', name: 'R1' },
        { id: 'r2', name: 'R2' },
        { id: 'r3', name: 'R3' }
      ]);
      await db.deleteBatch('rooms', ['r1', 'r3']);
      const all = await db.getAll('rooms');
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe('r2');
    });
  });

  describe('getAllSorted', () => {
    it('should return records sorted by index', async () => {
      await db.put('rooms', { id: 'r1', name: 'B', updatedAt: 2 });
      await db.put('rooms', { id: 'r2', name: 'A', updatedAt: 1 });
      await db.put('rooms', { id: 'r3', name: 'C', updatedAt: 3 });
      const sorted = await db.getAllSorted('rooms', 'updatedAt', 'next');
      expect(sorted[0].updatedAt).toBe(1);
      expect(sorted[2].updatedAt).toBe(3);
    });

    it('should respect limit', async () => {
      await db.putBatch('rooms', [
        { id: 'r1', name: 'A', updatedAt: 1 },
        { id: 'r2', name: 'B', updatedAt: 2 },
        { id: 'r3', name: 'C', updatedAt: 3 }
      ]);
      const sorted = await db.getAllSorted('rooms', 'updatedAt', 'next', 2);
      expect(sorted).toHaveLength(2);
    });
  });
});
