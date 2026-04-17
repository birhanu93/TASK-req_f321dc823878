import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { confirmDialog } from '../../js/ui/components/confirm-dialog.js';

describe('confirmDialog (direct DOM, promise-based)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('render', () => {
    it('mounts a modal with the provided title, message, and button labels', async () => {
      const promise = confirmDialog({
        title: 'Delete?',
        message: 'This cannot be undone',
        confirmText: 'Yes delete',
        cancelText: 'Keep'
      });
      vi.advanceTimersByTime(20); // flush open rAF

      expect(document.querySelector('.modal-title').textContent).toBe('Delete?');
      expect(document.querySelector('.modal-body').textContent).toContain('This cannot be undone');
      expect(document.querySelector('.js-confirm').textContent).toBe('Yes delete');
      expect(document.querySelector('.js-cancel').textContent).toBe('Keep');

      document.querySelector('.js-cancel').click();
      vi.advanceTimersByTime(300);
      await expect(promise).resolves.toBe(false);
    });

    it('uses default title/labels when none supplied', async () => {
      const p = confirmDialog();
      vi.advanceTimersByTime(20);
      expect(document.querySelector('.modal-title').textContent).toBe('Confirm');
      expect(document.querySelector('.js-confirm').textContent).toBe('Confirm');
      expect(document.querySelector('.js-cancel').textContent).toBe('Cancel');
      document.querySelector('.js-cancel').click();
      vi.advanceTimersByTime(300);
      await p;
    });

    it('applies btn--danger class to the confirm button when danger=true', async () => {
      const p = confirmDialog({ danger: true });
      vi.advanceTimersByTime(20);
      const btn = document.querySelector('.js-confirm');
      expect(btn.classList.contains('btn--danger')).toBe(true);
      document.querySelector('.js-cancel').click();
      vi.advanceTimersByTime(300);
      await p;
    });
  });

  describe('resolution semantics', () => {
    it('resolves true when confirm is clicked, and tears down the modal', async () => {
      const p = confirmDialog({ title: 'Go?' });
      vi.advanceTimersByTime(20);
      document.querySelector('.js-confirm').click();
      vi.advanceTimersByTime(300);
      await expect(p).resolves.toBe(true);
      expect(document.querySelectorAll('.modal-backdrop').length).toBe(0);
    });

    it('resolves false when cancel is clicked', async () => {
      const p = confirmDialog({ title: 'Go?' });
      vi.advanceTimersByTime(20);
      document.querySelector('.js-cancel').click();
      vi.advanceTimersByTime(300);
      await expect(p).resolves.toBe(false);
      expect(document.querySelectorAll('.modal-backdrop').length).toBe(0);
    });

    it('resolves false when the user presses Escape (onClose path)', async () => {
      const p = confirmDialog({ title: 'Go?' });
      vi.advanceTimersByTime(20);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      vi.advanceTimersByTime(300);
      await expect(p).resolves.toBe(false);
    });

    it('resolves false when the user clicks the backdrop', async () => {
      const p = confirmDialog({ title: 'Go?' });
      vi.advanceTimersByTime(20);
      const backdrop = document.querySelector('.modal-backdrop');
      backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      vi.advanceTimersByTime(300);
      await expect(p).resolves.toBe(false);
    });
  });
});
