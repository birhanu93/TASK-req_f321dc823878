import { describe, it, expect, beforeEach } from 'vitest';
import { storage, STORAGE_KEYS } from '../../js/core/storage.js';

beforeEach(() => {
  localStorage.clear();
});

describe('Storage', () => {
  describe('get / set', () => {
    it('should store and retrieve values', () => {
      storage.set('test', 'value');
      expect(storage.get('test')).toBe('value');
    });

    it('should store objects as JSON', () => {
      storage.set('obj', { a: 1, b: 'two' });
      expect(storage.get('obj')).toEqual({ a: 1, b: 'two' });
    });

    it('should store arrays', () => {
      storage.set('arr', [1, 2, 3]);
      expect(storage.get('arr')).toEqual([1, 2, 3]);
    });

    it('should store numbers', () => {
      storage.set('num', 42);
      expect(storage.get('num')).toBe(42);
    });

    it('should store booleans', () => {
      storage.set('bool', true);
      expect(storage.get('bool')).toBe(true);
    });

    it('should return default for missing keys', () => {
      expect(storage.get('missing')).toBeNull();
      expect(storage.get('missing', 'default')).toBe('default');
    });

    it('should use alignspace_ prefix in localStorage', () => {
      storage.set('key', 'val');
      expect(localStorage.getItem('alignspace_key')).toBe('"val"');
    });
  });

  describe('remove', () => {
    it('should remove a key', () => {
      storage.set('key', 'val');
      storage.remove('key');
      expect(storage.get('key')).toBeNull();
    });
  });

  describe('clear', () => {
    it('should clear only prefixed keys', () => {
      storage.set('a', 1);
      storage.set('b', 2);
      localStorage.setItem('other_key', 'keep');
      storage.clear();
      expect(storage.get('a')).toBeNull();
      expect(storage.get('b')).toBeNull();
      expect(localStorage.getItem('other_key')).toBe('keep');
    });
  });

  describe('STORAGE_KEYS', () => {
    it('should have expected keys', () => {
      expect(STORAGE_KEYS.CURRENT_USER).toBe('current_user');
      expect(STORAGE_KEYS.ROLE).toBe('role');
      expect(STORAGE_KEYS.LOCK_TIMEOUT_MS).toBe('lock_timeout_ms');
      expect(STORAGE_KEYS.CHAT_SOUND).toBe('chat_sound');
      expect(STORAGE_KEYS.SIDEBAR_OPEN).toBe('sidebar_open');
      expect(STORAGE_KEYS.LAST_ROOM).toBe('last_room');
    });
  });
});
