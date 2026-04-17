import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showToast } from '../../js/ui/components/toast.js';

function flushRAF() {
  vi.advanceTimersByTime(20);
}

describe('Toast component (direct DOM, no mocks)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('creation: input → DOM output', () => {
    it('creates a single toast-container and appends a .toast element with the message text', async () => {
      showToast('Hello world');

      const container = document.querySelector('.toast-container');
      expect(container).toBeTruthy();

      const toasts = document.querySelectorAll('.toast');
      expect(toasts.length).toBe(1);
      expect(toasts[0].querySelector('.toast__message').textContent).toBe('Hello world');
    });

    it('applies the correct modifier class for each type and uses "info" by default', () => {
      showToast('ok', { type: 'success' });
      showToast('err', { type: 'error' });
      showToast('warn', { type: 'warning' });
      showToast('default'); // no type → 'info'

      const byType = (t) => document.querySelector(`.toast--${t}`);
      expect(byType('success')).toBeTruthy();
      expect(byType('error')).toBeTruthy();
      expect(byType('warning')).toBeTruthy();
      expect(byType('info')).toBeTruthy();
    });

    it('reuses the same container across multiple toasts (no duplicates)', () => {
      showToast('one');
      showToast('two');
      showToast('three');

      expect(document.querySelectorAll('.toast-container').length).toBe(1);
      expect(document.querySelectorAll('.toast').length).toBe(3);
    });

    it('adds the --visible class on the next animation frame (state transition: render → visible)', () => {
      showToast('m');
      const toast = document.querySelector('.toast');
      expect(toast.classList.contains('toast--visible')).toBe(false);
      flushRAF();
      expect(toast.classList.contains('toast--visible')).toBe(true);
    });
  });

  describe('auto-dismiss: timing', () => {
    it('auto-dismisses after the default 4000ms duration', () => {
      showToast('bye');
      expect(document.querySelectorAll('.toast').length).toBe(1);

      vi.advanceTimersByTime(3999);
      expect(document.querySelectorAll('.toast').length).toBe(1);

      vi.advanceTimersByTime(1); // now at 4000ms — dismiss scheduled
      // dismiss adds --exiting, then removes after 300ms
      expect(document.querySelector('.toast').classList.contains('toast--exiting')).toBe(true);
      vi.advanceTimersByTime(300);
      expect(document.querySelectorAll('.toast').length).toBe(0);
    });

    it('respects a custom duration', () => {
      showToast('short', { duration: 1000 });
      vi.advanceTimersByTime(999);
      expect(document.querySelectorAll('.toast').length).toBe(1);
      vi.advanceTimersByTime(1);
      vi.advanceTimersByTime(300);
      expect(document.querySelectorAll('.toast').length).toBe(0);
    });

    it('duration=0 falls back to the default 4000ms (falsy-guard behavior)', () => {
      // Note: showToast uses `options.duration || 4000`, so explicit 0 is falsy and
      // coerces to the default. This pins the current documented behavior.
      showToast('sticky', { duration: 0 });
      vi.advanceTimersByTime(3999);
      expect(document.querySelectorAll('.toast').length).toBe(1);
      vi.advanceTimersByTime(1);
      expect(document.querySelector('.toast').classList.contains('toast--exiting')).toBe(true);
    });
  });

  describe('manual dismiss button', () => {
    it('clicking .toast__dismiss removes the toast after the 300ms exit animation', () => {
      showToast('m');
      const toast = document.querySelector('.toast');
      toast.querySelector('.toast__dismiss').click();

      expect(toast.classList.contains('toast--exiting')).toBe(true);
      expect(document.querySelectorAll('.toast').length).toBe(1);

      vi.advanceTimersByTime(300);
      expect(document.querySelectorAll('.toast').length).toBe(0);
    });

    it('showToast returns a dismiss function that fires the same exit animation', () => {
      const dismiss = showToast('m', { duration: 0 });
      expect(typeof dismiss).toBe('function');
      dismiss();
      expect(document.querySelector('.toast').classList.contains('toast--exiting')).toBe(true);
      vi.advanceTimersByTime(300);
      expect(document.querySelectorAll('.toast').length).toBe(0);
    });
  });

  describe('action button', () => {
    it('invokes action.onClick AND dismisses when the action button is clicked', () => {
      const onClick = vi.fn();
      showToast('clickable', { duration: 0, action: { label: 'Undo', onClick } });

      const btn = document.querySelector('.toast__action-btn');
      expect(btn.textContent).toBe('Undo');

      btn.click();
      expect(onClick).toHaveBeenCalledTimes(1);
      expect(document.querySelector('.toast').classList.contains('toast--exiting')).toBe(true);
    });

    it('does not render an action button when no action is provided', () => {
      showToast('m');
      expect(document.querySelector('.toast__action-btn')).toBeNull();
    });
  });
});
