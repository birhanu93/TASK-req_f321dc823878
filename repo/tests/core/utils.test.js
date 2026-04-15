import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  uuid, now, formatDate, formatTime, formatDateTime, relativeTime,
  debounce, throttle, escapeHTML, clamp, formatBytes,
  initial, slugify, estimateSize
} from '../../js/core/utils.js';

describe('Utils', () => {
  describe('uuid', () => {
    it('should return a string', () => {
      expect(typeof uuid()).toBe('string');
    });

    it('should return unique values', () => {
      const a = uuid();
      const b = uuid();
      expect(a).not.toBe(b);
    });

    it('should have UUID-like length', () => {
      expect(uuid().length).toBe(36);
    });
  });

  describe('now', () => {
    it('should return a number', () => {
      expect(typeof now()).toBe('number');
    });

    it('should return a recent timestamp', () => {
      const ts = now();
      expect(ts).toBeGreaterThan(Date.now() - 1000);
      expect(ts).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('formatDate', () => {
    it('should return a string', () => {
      expect(typeof formatDate(Date.now())).toBe('string');
    });
  });

  describe('formatTime', () => {
    it('should return a string', () => {
      expect(typeof formatTime(Date.now())).toBe('string');
    });
  });

  describe('formatDateTime', () => {
    it('should contain both date and time parts', () => {
      const result = formatDateTime(Date.now());
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(5);
    });
  });

  describe('relativeTime', () => {
    it('should return "just now" for recent timestamps', () => {
      expect(relativeTime(Date.now())).toBe('just now');
    });

    it('should return minutes ago', () => {
      const fiveMinAgo = Date.now() - 5 * 60 * 1000;
      expect(relativeTime(fiveMinAgo)).toBe('5m ago');
    });

    it('should return hours ago', () => {
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      expect(relativeTime(twoHoursAgo)).toBe('2h ago');
    });

    it('should return days ago', () => {
      const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
      expect(relativeTime(threeDaysAgo)).toBe('3d ago');
    });

    it('should return formatted date for old timestamps', () => {
      const oldDate = Date.now() - 60 * 24 * 60 * 60 * 1000;
      const result = relativeTime(oldDate);
      expect(result).not.toContain('ago');
    });
  });

  describe('debounce', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('should delay execution', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);
      debounced('a');
      expect(fn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledWith('a');
    });

    it('should reset timer on subsequent calls', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);
      debounced('a');
      vi.advanceTimersByTime(50);
      debounced('b');
      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('b');
    });
  });

  describe('throttle', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('should execute immediately on first call', () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);
      throttled('a');
      expect(fn).toHaveBeenCalledWith('a');
    });

    it('should throttle subsequent calls', () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);
      throttled('a');
      throttled('b');
      throttled('c');
      expect(fn).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('escapeHTML', () => {
    it('should escape & < > characters', () => {
      expect(escapeHTML('&')).toBe('&amp;');
      expect(escapeHTML('<')).toBe('&lt;');
      expect(escapeHTML('>')).toBe('&gt;');
    });

    it('should not modify safe strings', () => {
      expect(escapeHTML('hello')).toBe('hello');
    });

    it('should handle mixed content', () => {
      expect(escapeHTML('<b>test</b>')).toBe('&lt;b&gt;test&lt;/b&gt;');
    });
  });

  describe('clamp', () => {
    it('should clamp values below min', () => {
      expect(clamp(-5, 0, 10)).toBe(0);
    });

    it('should clamp values above max', () => {
      expect(clamp(15, 0, 10)).toBe(10);
    });

    it('should not change values within range', () => {
      expect(clamp(5, 0, 10)).toBe(5);
    });

    it('should handle edge values', () => {
      expect(clamp(0, 0, 10)).toBe(0);
      expect(clamp(10, 0, 10)).toBe(10);
    });
  });

  describe('formatBytes', () => {
    it('should format 0 bytes', () => {
      expect(formatBytes(0)).toBe('0 B');
    });

    it('should format bytes', () => {
      expect(formatBytes(500)).toBe('500.0 B');
    });

    it('should format KB', () => {
      expect(formatBytes(1024)).toBe('1.0 KB');
    });

    it('should format MB', () => {
      expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    });

    it('should format GB', () => {
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
    });
  });

  describe('initial', () => {
    it('should return first letter uppercased', () => {
      expect(initial('alice')).toBe('A');
    });

    it('should return ? for empty name', () => {
      expect(initial('')).toBe('?');
    });

    it('should return ? for null', () => {
      expect(initial(null)).toBe('?');
    });

    it('should return ? for undefined', () => {
      expect(initial(undefined)).toBe('?');
    });
  });

  describe('slugify', () => {
    it('should lowercase and replace spaces', () => {
      expect(slugify('Hello World')).toBe('hello-world');
    });

    it('should remove special characters', () => {
      expect(slugify('Hello! World?')).toBe('hello-world');
    });

    it('should trim leading/trailing hyphens', () => {
      expect(slugify('--hello--')).toBe('hello');
    });
  });

  describe('estimateSize', () => {
    it('should return a positive number', () => {
      expect(estimateSize({ a: 1 })).toBeGreaterThan(0);
    });

    it('should return larger size for larger objects', () => {
      const small = estimateSize({ a: 1 });
      const large = estimateSize({ a: 1, b: 'hello world', c: [1, 2, 3] });
      expect(large).toBeGreaterThan(small);
    });
  });
});
