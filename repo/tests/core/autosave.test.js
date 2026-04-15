import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { autosave } from '../../js/core/autosave.js';
import { bus } from '../../js/core/event-bus.js';

beforeEach(() => {
  vi.useFakeTimers();
  autosave.destroy();
  bus.clear();
});

afterEach(() => {
  autosave.destroy();
  vi.useRealTimers();
});

describe('Autosave', () => {
  describe('init', () => {
    it('should start the interval', () => {
      const cb = vi.fn();
      autosave.init(cb);
      autosave.markDirty('store1', 'id1', { id: 'id1', data: 'test' });
      vi.advanceTimersByTime(5000);
      expect(cb).toHaveBeenCalled();
    });
  });

  describe('markDirty', () => {
    it('should track dirty items', () => {
      autosave.init(vi.fn());
      autosave.markDirty('rooms', 'r1', { id: 'r1' });
      expect(autosave.hasPending()).toBe(true);
    });

    it('should overwrite same id', () => {
      const cb = vi.fn();
      autosave.init(cb);
      autosave.markDirty('rooms', 'r1', { id: 'r1', v: 1 });
      autosave.markDirty('rooms', 'r1', { id: 'r1', v: 2 });
      vi.advanceTimersByTime(5000);
      const batch = cb.mock.calls[0][0];
      expect(batch.get('rooms').size).toBe(1);
      expect(batch.get('rooms').get('r1').v).toBe(2);
    });
  });

  describe('flush', () => {
    it('should call callback with batched data and clear queue', async () => {
      const cb = vi.fn().mockResolvedValue(undefined);
      autosave.init(cb);
      autosave.markDirty('rooms', 'r1', { id: 'r1' });
      autosave.markDirty('messages', 'm1', { id: 'm1' });
      await autosave.flush();
      expect(cb).toHaveBeenCalledTimes(1);
      const batch = cb.mock.calls[0][0];
      expect(batch.has('rooms')).toBe(true);
      expect(batch.has('messages')).toBe(true);
      expect(autosave.hasPending()).toBe(false);
    });

    it('should not call callback when queue is empty', async () => {
      const cb = vi.fn();
      autosave.init(cb);
      await autosave.flush();
      expect(cb).not.toHaveBeenCalled();
    });

    it('should re-enqueue on error', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const cb = vi.fn().mockRejectedValue(new Error('fail'));
      autosave.init(cb);
      autosave.markDirty('rooms', 'r1', { id: 'r1' });
      await autosave.flush();
      expect(autosave.hasPending()).toBe(true);
      err.mockRestore();
    });

    it('should emit autosave:complete on success', async () => {
      const fn = vi.fn();
      bus.on('autosave:complete', fn);
      autosave.init(vi.fn().mockResolvedValue(undefined));
      autosave.markDirty('rooms', 'r1', { id: 'r1' });
      await autosave.flush();
      expect(fn).toHaveBeenCalled();
    });
  });

  describe('hasPending', () => {
    it('should return false when empty', () => {
      autosave.init(vi.fn());
      expect(autosave.hasPending()).toBe(false);
    });
  });

  describe('destroy', () => {
    it('should clear interval and queue', () => {
      autosave.init(vi.fn());
      autosave.markDirty('rooms', 'r1', { id: 'r1' });
      autosave.destroy();
      expect(autosave.hasPending()).toBe(false);
    });
  });
});
