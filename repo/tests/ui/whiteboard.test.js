import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Whiteboard } from '../../js/ui/components/whiteboard.js';
import { whiteboardService } from '../../js/services/whiteboard-service.js';
import { resetAll, setCurrentUser } from '../helpers.js';

// Minimal ResizeObserver polyfill for jsdom (whiteboard uses it to track resizes)
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = RO;
}

// jsdom does not implement Canvas 2D. Install a no-op context so renderElements can run.
if (!HTMLCanvasElement.prototype.getContext.__mocked) {
  HTMLCanvasElement.prototype.getContext = function () {
    return {
      setTransform() {}, clearRect() {}, save() {}, restore() {},
      beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, rect() {},
      ellipse() {}, stroke() {}, fill() {}, fillRect() {}, strokeRect() {},
      fillText() {}, strokeText() {}, drawImage() {}, translate() {}, scale() {}, rotate() {},
      set lineWidth(_v) {}, set strokeStyle(_v) {}, set fillStyle(_v) {},
      set font(_v) {}, set textBaseline(_v) {}, set textAlign(_v) {},
      set lineCap(_v) {}, set lineJoin(_v) {}, set globalAlpha(_v) {},
      measureText: () => ({ width: 0 })
    };
  };
  HTMLCanvasElement.prototype.getContext.__mocked = true;
}

function mountWhiteboard(roomId = 'room-1') {
  const container = document.createElement('div');
  container.style.width = '800px';
  container.style.height = '600px';
  document.body.appendChild(container);

  // Give jsdom a non-zero bounding rect so zoom math is stable
  container.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => {}
  });

  const wb = new Whiteboard(container, { roomId });
  wb.mount();
  return { wb, container };
}

describe('Whiteboard component (real service, fake-indexeddb, no service mocks)', () => {
  beforeEach(async () => {
    await resetAll();
    setCurrentUser();
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('render: toolbar & controls', () => {
    it('renders all 7 tools, 10 preset colors, 4 stroke widths', () => {
      const { wb } = mountWhiteboard();

      const tools = wb.container.querySelectorAll('.wb-toolbar [data-tool]');
      expect(tools.length).toBe(7);
      expect(Array.from(tools).map(t => t.dataset.tool)).toEqual(
        ['select', 'pen', 'rect', 'ellipse', 'line', 'image', 'text']
      );

      const swatches = wb.container.querySelectorAll('[data-color]');
      expect(swatches.length).toBe(10);

      const strokes = wb.container.querySelectorAll('[data-stroke]');
      expect(strokes.length).toBe(4);
      expect(Array.from(strokes).map(s => parseInt(s.dataset.stroke, 10))).toEqual([1, 2, 4, 8]);
    });

    it('marks "select" as the initial active tool and "#000000" as initial color', () => {
      const { wb } = mountWhiteboard();
      const active = wb.container.querySelector('.wb-toolbar__btn--active[data-tool]');
      expect(active.dataset.tool).toBe('select');

      const selectedSwatch = wb.container.querySelector('.wb-color-swatch--selected');
      expect(selectedSwatch.dataset.color).toBe('#000000');
    });

    it('renders zoom display starting at 100%', () => {
      const { wb } = mountWhiteboard();
      expect(wb.container.querySelector('#wb-zoom-level').textContent).toBe('100%');
    });

    it('disables delete, undo, and redo buttons when there is no selection / history', () => {
      const { wb } = mountWhiteboard();
      expect(wb.container.querySelector('#wb-delete-btn').disabled).toBe(true);
      expect(wb.container.querySelector('#wb-undo-btn').disabled).toBe(true);
      expect(wb.container.querySelector('#wb-redo-btn').disabled).toBe(true);
    });
  });

  describe('state transitions: tool selection', () => {
    it('clicking a tool button updates internal _activeTool and moves the active class', () => {
      const { wb } = mountWhiteboard();
      expect(wb._activeTool).toBe('select');

      wb.container.querySelector('[data-tool="pen"]').click();
      expect(wb._activeTool).toBe('pen');

      const active = wb.container.querySelector('.wb-toolbar__btn--active[data-tool]');
      expect(active.dataset.tool).toBe('pen');
      // Previously-active "select" no longer active
      expect(
        wb.container.querySelector('[data-tool="select"]').classList.contains('wb-toolbar__btn--active')
      ).toBe(false);

      // Cursor updates
      expect(wb.container.querySelector('.whiteboard').style.cursor).toBe('crosshair');
    });

    it('selecting a non-select tool clears any existing selection', () => {
      const { wb } = mountWhiteboard();
      wb._selectedId = 'some-id';
      wb.container.querySelector('[data-tool="rect"]').click();
      expect(wb._selectedId).toBeNull();
    });
  });

  describe('state transitions: color & stroke width', () => {
    it('clicking a color swatch changes _strokeColor and swaps the --selected class', () => {
      const { wb } = mountWhiteboard();
      const target = wb.container.querySelector('[data-color="#ef4444"]');
      target.click();
      expect(wb._strokeColor).toBe('#ef4444');
      expect(target.classList.contains('wb-color-swatch--selected')).toBe(true);
      // Previous selection cleared
      expect(
        wb.container.querySelector('[data-color="#000000"]').classList.contains('wb-color-swatch--selected')
      ).toBe(false);
    });

    it('clicking a stroke-width option updates _strokeWidth', () => {
      const { wb } = mountWhiteboard();
      wb.container.querySelector('[data-stroke="4"]').click();
      expect(wb._strokeWidth).toBe(4);
      expect(
        wb.container.querySelector('[data-stroke="4"]').classList.contains('wb-stroke-option--selected')
      ).toBe(true);
    });

    it('toggling fill flips _fillEnabled and the button active class', () => {
      const { wb } = mountWhiteboard();
      const fillBtn = wb.container.querySelector('#wb-fill-toggle');
      expect(wb._fillEnabled).toBe(false);
      fillBtn.click();
      expect(wb._fillEnabled).toBe(true);
      expect(fillBtn.classList.contains('wb-toolbar__btn--active')).toBe(true);
      fillBtn.click();
      expect(wb._fillEnabled).toBe(false);
      expect(fillBtn.classList.contains('wb-toolbar__btn--active')).toBe(false);
    });
  });

  describe('state transitions: zoom', () => {
    it('zoom-in increases zoom in 0.1 increments, updating the display', () => {
      const { wb } = mountWhiteboard();
      expect(wb._zoom).toBe(1);
      wb.container.querySelector('#wb-zoom-in').click();
      expect(wb._zoom).toBeCloseTo(1.1, 5);
      expect(wb.container.querySelector('#wb-zoom-level').textContent).toBe('110%');
    });

    it('zoom-out decreases zoom in 0.1 increments', () => {
      const { wb } = mountWhiteboard();
      wb.container.querySelector('#wb-zoom-out').click();
      expect(wb._zoom).toBeCloseTo(0.9, 5);
      expect(wb.container.querySelector('#wb-zoom-level').textContent).toBe('90%');
    });

    it('clicking the zoom-level label resets zoom to 1 (100%)', () => {
      const { wb } = mountWhiteboard();
      wb._setZoom(2);
      expect(wb._zoom).toBe(2);
      wb.container.querySelector('#wb-zoom-level').click();
      expect(wb._zoom).toBe(1);
      expect(wb.container.querySelector('#wb-zoom-level').textContent).toBe('100%');
    });

    it('zoom is clamped to [0.1, 5]', () => {
      const { wb } = mountWhiteboard();
      wb._setZoom(100);
      expect(wb._zoom).toBe(5);
      wb._setZoom(0);
      expect(wb._zoom).toBe(0.1);
    });
  });

  describe('integration with real whiteboardService (no mocks)', () => {
    it('loads pre-existing elements from the DB on mount and puts them into _elements', async () => {
      // Seed the real DB via the real service
      const rect = await whiteboardService.createElement('room-load', 'rect', {
        x: 10, y: 20, width: 100, height: 50, strokeColor: '#000', strokeWidth: 2
      });

      const { wb } = mountWhiteboard('room-load');
      // _loadElements is async; poll until it completes (a few IDB microtask hops)
      for (let i = 0; i < 20 && wb._elements.size === 0; i++) {
        await new Promise(r => setTimeout(r, 5));
      }

      expect(wb._elements.size).toBe(1);
      expect(wb._elements.get(rect.id)).toMatchObject({
        id: rect.id, type: 'rect', x: 10, y: 20, width: 100, height: 50, roomId: 'room-load'
      });
    });

    it('receives whiteboard:element-created events for the same room and adds them (cross-tab path, real bus)', async () => {
      const { wb } = mountWhiteboard('room-sync');
      await new Promise(r => setTimeout(r, 0));
      expect(wb._elements.size).toBe(0);

      // Create from another context — the service emits bus events synchronously
      await whiteboardService.createElement('room-sync', 'ellipse', {
        x: 0, y: 0, width: 50, height: 50
      });
      // _elements should now contain the new one
      expect(wb._elements.size).toBe(1);
      const el = [...wb._elements.values()][0];
      expect(el.type).toBe('ellipse');
      expect(el.roomId).toBe('room-sync');
    });

    it('ignores whiteboard:element-created events from a different room', async () => {
      const { wb } = mountWhiteboard('room-A');
      await new Promise(r => setTimeout(r, 0));

      await whiteboardService.createElement('room-B', 'rect', { x: 0, y: 0, width: 5, height: 5 });
      expect(wb._elements.size).toBe(0);
    });
  });
});
