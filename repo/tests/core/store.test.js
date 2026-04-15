import { describe, it, expect, vi, beforeEach } from 'vitest';
import { store } from '../../js/core/store.js';

beforeEach(() => {
  // Clear store state by deleting known keys
  const all = store.getAll();
  for (const key of Object.keys(all)) {
    store.delete(key);
  }
});

describe('Store', () => {
  describe('get / set', () => {
    it('should set and get a simple value', () => {
      store.set('name', 'Alice');
      expect(store.get('name')).toBe('Alice');
    });

    it('should set and get nested paths', () => {
      store.set('user.name', 'Bob');
      expect(store.get('user.name')).toBe('Bob');
      expect(store.get('user')).toEqual({ name: 'Bob' });
    });

    it('should set deeply nested paths', () => {
      store.set('a.b.c.d', 42);
      expect(store.get('a.b.c.d')).toBe(42);
    });

    it('should return undefined for non-existent paths', () => {
      expect(store.get('nonexistent')).toBeUndefined();
      expect(store.get('a.b.c')).toBeUndefined();
    });

    it('should overwrite existing values', () => {
      store.set('x', 1);
      store.set('x', 2);
      expect(store.get('x')).toBe(2);
    });

    it('should handle object values', () => {
      store.set('config', { theme: 'dark', lang: 'en' });
      expect(store.get('config')).toEqual({ theme: 'dark', lang: 'en' });
      expect(store.get('config.theme')).toBe('dark');
    });
  });

  describe('delete', () => {
    it('should delete a value', () => {
      store.set('x', 1);
      store.delete('x');
      expect(store.get('x')).toBeUndefined();
    });

    it('should delete a nested value', () => {
      store.set('a.b', 1);
      store.delete('a.b');
      expect(store.get('a.b')).toBeUndefined();
    });

    it('should handle deleting non-existent path', () => {
      expect(() => store.delete('nonexistent')).not.toThrow();
    });
  });

  describe('watch', () => {
    it('should notify watcher when value changes', () => {
      const fn = vi.fn();
      store.watch('x', fn);
      store.set('x', 42);
      expect(fn).toHaveBeenCalledWith(42, 'x');
    });

    it('should notify parent watchers on child changes', () => {
      const fn = vi.fn();
      store.watch('user', fn);
      store.set('user.name', 'Alice');
      expect(fn).toHaveBeenCalled();
    });

    it('should notify child watchers on parent changes', () => {
      const fn = vi.fn();
      store.watch('user.name', fn);
      store.set('user', { name: 'Bob' });
      expect(fn).toHaveBeenCalled();
    });

    it('should not notify unrelated watchers', () => {
      const fn = vi.fn();
      store.watch('a', fn);
      store.set('b', 1);
      expect(fn).not.toHaveBeenCalled();
    });

    it('should return an unsubscribe function', () => {
      const fn = vi.fn();
      const unsub = store.watch('x', fn);
      store.set('x', 1);
      expect(fn).toHaveBeenCalledTimes(1);
      unsub();
      store.set('x', 2);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should isolate errors in watchers', () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const fn1 = vi.fn(() => { throw new Error('boom'); });
      const fn2 = vi.fn();
      store.watch('x', fn1);
      store.watch('x', fn2);
      store.set('x', 1);
      expect(fn2).toHaveBeenCalled();
      err.mockRestore();
    });
  });

  describe('getAll', () => {
    it('should return a clone of full state', () => {
      store.set('a', 1);
      store.set('b', 2);
      const all = store.getAll();
      expect(all.a).toBe(1);
      expect(all.b).toBe(2);
      // Verify it's a clone
      all.a = 999;
      expect(store.get('a')).toBe(1);
    });
  });
});
