import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Drawer } from '../../js/ui/components/drawer.js';

function flushRAF() { vi.advanceTimersByTime(20); }

describe('Drawer component (direct DOM, no mocks)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('render: input → DOM output', () => {
    it('renders a right-side drawer by default with the given title and string content', () => {
      const d = new Drawer({ title: 'Chat', content: '<p>hello</p>' });
      d.render();
      flushRAF();

      const backdrop = document.querySelector('.drawer-backdrop');
      expect(backdrop).toBeTruthy();
      expect(backdrop.classList.contains('drawer-backdrop--open')).toBe(true);

      const drawer = document.querySelector('.drawer');
      expect(drawer.classList.contains('drawer--right')).toBe(true);
      expect(drawer.getAttribute('style')).toContain('width: 360px');

      expect(document.querySelector('.drawer__title').textContent).toBe('Chat');
      expect(document.querySelector('.drawer__body').innerHTML).toBe('<p>hello</p>');
    });

    it('honors side="left" and a custom width', () => {
      const d = new Drawer({ title: 't', side: 'left', width: '500px' });
      d.render();

      const drawer = document.querySelector('.drawer');
      expect(drawer.classList.contains('drawer--left')).toBe(true);
      expect(drawer.classList.contains('drawer--right')).toBe(false);
      expect(drawer.getAttribute('style')).toContain('width: 500px');
    });

    it('appends HTMLElement content by identity (not serialized)', () => {
      const node = document.createElement('div');
      node.id = 'inner';
      const d = new Drawer({ content: node });
      d.render();
      const body = document.querySelector('.drawer__body');
      expect(body.children.length).toBe(1);
      expect(body.children[0]).toBe(node);
    });
  });

  describe('state transitions: close paths', () => {
    it('close button click → removes class, removes node after 300ms transition, fires onClose exactly once', () => {
      const onClose = vi.fn();
      const d = new Drawer({ onClose });
      d.render();

      document.querySelector('.drawer__close').click();
      expect(document.querySelector('.drawer-backdrop').classList.contains('drawer-backdrop--open')).toBe(false);
      expect(document.querySelectorAll('.drawer-backdrop').length).toBe(1);

      vi.advanceTimersByTime(300);
      expect(document.querySelectorAll('.drawer-backdrop').length).toBe(0);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('clicking the backdrop (not the drawer panel) closes it', () => {
      const d = new Drawer({});
      d.render();
      const backdrop = document.querySelector('.drawer-backdrop');
      backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      vi.advanceTimersByTime(300);
      expect(document.querySelectorAll('.drawer-backdrop').length).toBe(0);
    });

    it('clicking inside the drawer panel does NOT close it', () => {
      const d = new Drawer({ content: '<p class="inside">x</p>' });
      d.render();
      document.querySelector('.inside').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      vi.advanceTimersByTime(500);
      expect(document.querySelectorAll('.drawer-backdrop').length).toBe(1);
    });

    it('Escape key closes the drawer', () => {
      const d = new Drawer({});
      d.render();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      vi.advanceTimersByTime(300);
      expect(document.querySelectorAll('.drawer-backdrop').length).toBe(0);
    });

    it('close() is a no-op when already closed (onClose fires only once)', () => {
      const onClose = vi.fn();
      const d = new Drawer({ onClose });
      d.render();
      d.close();
      vi.advanceTimersByTime(300);
      d.close();
      vi.advanceTimersByTime(300);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('getBody accessor', () => {
    it('returns the .drawer__body element while mounted, null after close', () => {
      const d = new Drawer({ content: 'x' });
      d.render();
      const body = d.getBody();
      expect(body).toBeTruthy();
      expect(body.classList.contains('drawer__body')).toBe(true);

      d.close();
      vi.advanceTimersByTime(300);
      expect(d.getBody()).toBeUndefined(); // el is null → optional chaining yields undefined
    });
  });
});
