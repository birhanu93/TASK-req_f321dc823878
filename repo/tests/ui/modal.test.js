import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Modal } from '../../js/ui/components/modal.js';

// Flush rAF (modal uses requestAnimationFrame for the open animation)
function flushOpenAnim() {
  vi.advanceTimersByTime(20); // > 1 frame
}
function flushCloseAnim() {
  vi.advanceTimersByTime(200);
}

describe('Modal component (direct DOM, no mocks)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers(); // fakes setTimeout AND requestAnimationFrame (jsdom)
  });
  afterEach(() => {
    // Run all pending timers so nothing leaks into the next test
    vi.runAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('render: input → DOM output', () => {
    it('mounts a single .modal-backdrop with the given title and string content', () => {
      const m = new Modal({ title: 'Hello', content: '<p id="x">body</p>' });
      m.render();
      flushOpenAnim();

      const backdrops = document.querySelectorAll('.modal-backdrop');
      expect(backdrops.length).toBe(1);

      const title = document.querySelector('.modal-title');
      expect(title.textContent).toBe('Hello');

      const body = document.querySelector('.modal-body');
      expect(body.innerHTML).toBe('<p id="x">body</p>');

      // Opening animation class is added via requestAnimationFrame
      expect(backdrops[0].classList.contains('modal-backdrop--open')).toBe(true);
    });

    it('appends an HTMLElement content node directly (no innerHTML re-serialization)', () => {
      const node = document.createElement('section');
      node.id = 'custom-body';
      node.textContent = 'live node';

      const m = new Modal({ title: 't', content: node });
      m.render();
      flushOpenAnim();

      const body = document.querySelector('.modal-body');
      expect(body.children.length).toBe(1);
      expect(body.children[0]).toBe(node); // identity preserved
      expect(body.children[0].id).toBe('custom-body');
    });

    it('applies the correct inline max-width for each size', () => {
      const cases = [
        ['sm', 'max-width: 400px'],
        ['md', 'max-width: 560px'],
        ['lg', 'max-width: 720px'],
        ['xl', 'max-width: 900px']
      ];
      for (const [size, expected] of cases) {
        document.body.innerHTML = '';
        const m = new Modal({ size, content: '' });
        m.render();
        const container = document.querySelector('.modal-container');
        expect(container.getAttribute('style')).toContain(expected);
      }
    });

    it('renders a footer only when provided', () => {
      const m1 = new Modal({ content: '' });
      m1.render();
      expect(document.querySelector('.modal-footer')).toBeNull();
      document.body.innerHTML = '';

      const m2 = new Modal({ content: '', footer: '<button class="f-btn">OK</button>' });
      m2.render();
      const footer = document.querySelector('.modal-footer');
      expect(footer).toBeTruthy();
      expect(footer.querySelector('.f-btn')).toBeTruthy();
    });

    it('omits the close button when closable=false', () => {
      const m = new Modal({ closable: false });
      m.render();
      expect(document.querySelector('.modal-close')).toBeNull();
    });
  });

  describe('state transitions: open → close', () => {
    it('close() removes the backdrop class immediately and the node after the 200ms transition, then fires onClose exactly once', () => {
      const onClose = vi.fn();
      const m = new Modal({ content: 'x', onClose });
      m.render();
      flushOpenAnim();

      expect(document.querySelectorAll('.modal-backdrop').length).toBe(1);
      expect(onClose).not.toHaveBeenCalled();

      m.close();
      // Class removed synchronously
      expect(document.querySelector('.modal-backdrop').classList.contains('modal-backdrop--open')).toBe(false);
      // Node still in DOM during transition
      expect(document.querySelectorAll('.modal-backdrop').length).toBe(1);

      flushCloseAnim();
      expect(document.querySelectorAll('.modal-backdrop').length).toBe(0);
      expect(m.el).toBeNull();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('clicking the close button triggers close and removes the modal', () => {
      const m = new Modal({});
      m.render();
      flushOpenAnim();

      document.querySelector('.modal-close').click();
      flushCloseAnim();

      expect(document.querySelectorAll('.modal-backdrop').length).toBe(0);
    });

    it('clicking the backdrop (not the container) closes the modal', () => {
      const m = new Modal({});
      m.render();
      flushOpenAnim();

      const backdrop = document.querySelector('.modal-backdrop');
      // Dispatch a click whose target IS the backdrop (the handler checks e.target === this.el)
      backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      flushCloseAnim();

      expect(document.querySelectorAll('.modal-backdrop').length).toBe(0);
    });

    it('Escape key closes a closable modal, does NOT close non-closable', () => {
      const m = new Modal({ closable: true });
      m.render();
      flushOpenAnim();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      flushCloseAnim();
      expect(document.querySelectorAll('.modal-backdrop').length).toBe(0);

      const m2 = new Modal({ closable: false });
      m2.render();
      flushOpenAnim();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      flushCloseAnim();
      // Non-closable: still present
      expect(document.querySelectorAll('.modal-backdrop').length).toBe(1);
    });

    it('close() is a no-op when already closed (does not throw, does not invoke onClose again)', () => {
      const onClose = vi.fn();
      const m = new Modal({ onClose });
      m.render();
      flushOpenAnim();
      m.close();
      flushCloseAnim();
      expect(onClose).toHaveBeenCalledTimes(1);

      m.close(); // second call
      flushCloseAnim();
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('setContent: mutation', () => {
    it('replaces body HTML via setContent() after render', () => {
      const m = new Modal({ content: '<span>old</span>' });
      m.render();
      flushOpenAnim();
      expect(document.querySelector('.modal-body').innerHTML).toBe('<span>old</span>');
      m.setContent('<span>new</span>');
      expect(document.querySelector('.modal-body').innerHTML).toBe('<span>new</span>');
    });
  });
});
