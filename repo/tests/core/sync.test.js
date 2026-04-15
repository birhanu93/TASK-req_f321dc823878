import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sync } from '../../js/core/sync.js';

describe('Sync', () => {
  afterEach(() => {
    sync.destroy();
  });

  describe('init', () => {
    it('should initialize without error', () => {
      expect(() => sync.init()).not.toThrow();
    });

    it('should be idempotent', () => {
      sync.init();
      expect(() => sync.init()).not.toThrow();
    });
  });

  describe('getTabId', () => {
    it('should return a string', () => {
      expect(typeof sync.getTabId()).toBe('string');
    });

    it('should return same id on repeated calls', () => {
      expect(sync.getTabId()).toBe(sync.getTabId());
    });
  });

  describe('broadcast', () => {
    it('should not throw when channel is not initialized', () => {
      sync.destroy();
      expect(() => sync.broadcast({ type: 'test' })).not.toThrow();
    });

    it('should not throw when channel is initialized', () => {
      sync.init();
      expect(() => sync.broadcast({ type: 'test', data: 'hello' })).not.toThrow();
    });
  });

  describe('destroy', () => {
    it('should close the channel', () => {
      sync.init();
      sync.destroy();
      // After destroy, broadcast should be a no-op
      expect(() => sync.broadcast({ type: 'test' })).not.toThrow();
    });
  });
});
