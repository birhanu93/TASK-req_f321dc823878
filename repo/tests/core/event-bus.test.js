import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bus } from '../../js/core/event-bus.js';

beforeEach(() => {
  bus.clear();
});

describe('EventBus', () => {
  describe('on / emit', () => {
    it('should call listener when event is emitted', () => {
      const fn = vi.fn();
      bus.on('test', fn);
      bus.emit('test', { a: 1 });
      expect(fn).toHaveBeenCalledWith({ a: 1 });
    });

    it('should support multiple listeners on the same event', () => {
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      bus.on('test', fn1);
      bus.on('test', fn2);
      bus.emit('test', 'data');
      expect(fn1).toHaveBeenCalledWith('data');
      expect(fn2).toHaveBeenCalledWith('data');
    });

    it('should not call listeners for different events', () => {
      const fn = vi.fn();
      bus.on('a', fn);
      bus.emit('b', 'data');
      expect(fn).not.toHaveBeenCalled();
    });

    it('should handle emit with no listeners gracefully', () => {
      expect(() => bus.emit('nonexistent', 'data')).not.toThrow();
    });

    it('should isolate errors in listeners', () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const fn1 = vi.fn(() => { throw new Error('boom'); });
      const fn2 = vi.fn();
      bus.on('test', fn1);
      bus.on('test', fn2);
      bus.emit('test', 'data');
      expect(fn1).toHaveBeenCalled();
      expect(fn2).toHaveBeenCalled();
      expect(err).toHaveBeenCalled();
      err.mockRestore();
    });

    it('should pass undefined data when emitted without payload', () => {
      const fn = vi.fn();
      bus.on('test', fn);
      bus.emit('test');
      expect(fn).toHaveBeenCalledWith(undefined);
    });
  });

  describe('off', () => {
    it('should remove a specific listener', () => {
      const fn = vi.fn();
      bus.on('test', fn);
      bus.off('test', fn);
      bus.emit('test', 'data');
      expect(fn).not.toHaveBeenCalled();
    });

    it('should not remove other listeners', () => {
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      bus.on('test', fn1);
      bus.on('test', fn2);
      bus.off('test', fn1);
      bus.emit('test', 'data');
      expect(fn1).not.toHaveBeenCalled();
      expect(fn2).toHaveBeenCalledWith('data');
    });

    it('should handle removing non-existent listener', () => {
      expect(() => bus.off('test', () => {})).not.toThrow();
    });

    it('should handle removing from non-existent event', () => {
      expect(() => bus.off('nonexistent', () => {})).not.toThrow();
    });
  });

  describe('once', () => {
    it('should call listener only once', () => {
      const fn = vi.fn();
      bus.once('test', fn);
      bus.emit('test', 'first');
      bus.emit('test', 'second');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('first');
    });
  });

  describe('clear', () => {
    it('should clear a specific event', () => {
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      bus.on('a', fn1);
      bus.on('b', fn2);
      bus.clear('a');
      bus.emit('a', 'data');
      bus.emit('b', 'data');
      expect(fn1).not.toHaveBeenCalled();
      expect(fn2).toHaveBeenCalled();
    });

    it('should clear all events when called without args', () => {
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      bus.on('a', fn1);
      bus.on('b', fn2);
      bus.clear();
      bus.emit('a', 'data');
      bus.emit('b', 'data');
      expect(fn1).not.toHaveBeenCalled();
      expect(fn2).not.toHaveBeenCalled();
    });
  });
});
