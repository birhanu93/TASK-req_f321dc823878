import { Component } from '../../core/component.js';
import { store } from '../../core/store.js';
import { bus } from '../../core/event-bus.js';
import { uuid, now, escapeHTML, clamp, debounce } from '../../core/utils.js';
import { whiteboardService } from '../../services/whiteboard-service.js';
import { activityService } from '../../services/activity-service.js';
import { showToast } from './toast.js';
import { Modal } from './modal.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOOLS = [
  { id: 'select', label: 'Select', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></svg>' },
  { id: 'pen', label: 'Pen', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>' },
  { id: 'rect', label: 'Rectangle', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>' },
  { id: 'ellipse', label: 'Ellipse', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="12" rx="10" ry="8"/></svg>' },
  { id: 'line', label: 'Line', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="19" x2="19" y2="5"/></svg>' },
  { id: 'image', label: 'Image', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' },
  { id: 'text', label: 'Text', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>' }
];

const PRESET_COLORS = [
  '#000000', '#374151', '#ef4444', '#f97316', '#eab308',
  '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#ffffff'
];

const STROKE_WIDTHS = [1, 2, 4, 8];

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.1;
const MAX_UNDO = 50;
const GRID_SIZE = 24;
const NOTES_MAX = 20000;
const NOTES_WARN = 19000;

// ---------------------------------------------------------------------------
// SVG Namespace
// ---------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';

// ---------------------------------------------------------------------------
// Helper: build a smooth SVG path from an array of [x, y] points
// ---------------------------------------------------------------------------

function buildSmoothPath(points) {
  if (points.length === 0) return '';
  if (points.length === 1) {
    return `M ${points[0][0]} ${points[0][1]} L ${points[0][0]} ${points[0][1]}`;
  }
  if (points.length === 2) {
    return `M ${points[0][0]} ${points[0][1]} L ${points[1][0]} ${points[1][1]}`;
  }

  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const cpX = (points[i][0] + points[i + 1][0]) / 2;
    const cpY = (points[i][1] + points[i + 1][1]) / 2;
    d += ` Q ${points[i][0]} ${points[i][1]} ${cpX} ${cpY}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last[0]} ${last[1]}`;
  return d;
}

// ---------------------------------------------------------------------------
// Helper: bounding box of a set of points
// ---------------------------------------------------------------------------

function pointsBBox(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ---------------------------------------------------------------------------
// Helper: element bounding box (works for all types)
// ---------------------------------------------------------------------------

function elementBBox(el) {
  switch (el.type) {
    case 'pen': {
      const pts = el.points || [];
      if (pts.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
      return pointsBBox(pts);
    }
    case 'line':
      return {
        x: Math.min(el.x, el.x2),
        y: Math.min(el.y, el.y2),
        width: Math.abs(el.x2 - el.x),
        height: Math.abs(el.y2 - el.y)
      };
    default:
      return { x: el.x || 0, y: el.y || 0, width: el.width || 0, height: el.height || 0 };
  }
}

// ---------------------------------------------------------------------------
// Helper: hit test for a point against an element
// ---------------------------------------------------------------------------

function hitTestElement(el, px, py, tolerance) {
  const tol = tolerance || 8;
  switch (el.type) {
    case 'pen': {
      const pts = el.points || [];
      for (let i = 0; i < pts.length - 1; i++) {
        if (distToSegment(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) < tol + (el.strokeWidth || 2)) {
          return true;
        }
      }
      return false;
    }
    case 'line': {
      return distToSegment(px, py, el.x, el.y, el.x2, el.y2) < tol + (el.strokeWidth || 2);
    }
    case 'rect':
    case 'image':
    case 'sticker': {
      return px >= el.x - tol && px <= el.x + el.width + tol &&
             py >= el.y - tol && py <= el.y + el.height + tol;
    }
    case 'ellipse': {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      const rx = el.width / 2 + tol;
      const ry = el.height / 2 + tol;
      if (rx === 0 || ry === 0) return false;
      const val = ((px - cx) * (px - cx)) / (rx * rx) + ((py - cy) * (py - cy)) / (ry * ry);
      return val <= 1;
    }
    default:
      return false;
  }
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// ---------------------------------------------------------------------------
// Whiteboard Component
// ---------------------------------------------------------------------------

export class Whiteboard extends Component {
  constructor(container, props = {}) {
    super(container, props);

    this.roomId = props.roomId;

    // View transform
    this._panX = 0;
    this._panY = 0;
    this._zoom = 1;

    // Drawing state
    this._activeTool = 'select';
    this._strokeColor = '#000000';
    this._strokeWidth = 2;
    this._fillEnabled = false;
    this._fillColor = 'transparent';

    // Element store (map by id)
    this._elements = new Map();
    this._nextZIndex = 1;

    // Selection
    this._selectedId = null;
    this._resizeHandle = null; // which handle is being dragged

    // Interaction state
    this._isDrawing = false;
    this._isPanning = false;
    this._isMoving = false;
    this._isResizing = false;
    this._isTextEditing = false;
    this._spaceDown = false;
    this._dragStart = null;     // { x, y } in canvas coords
    this._dragStartScreen = null; // { x, y } in screen coords (for pan)
    this._panStartX = 0;
    this._panStartY = 0;
    this._currentPoints = [];    // for pen tool
    this._previewEl = null;      // SVG element being previewed

    // Move tracking
    this._moveStartX = 0;
    this._moveStartY = 0;
    this._moveElStartX = 0;
    this._moveElStartY = 0;

    // Resize tracking
    this._resizeStartBBox = null;
    this._resizeStartMouse = null;

    // Undo/Redo
    this._undoStack = [];
    this._redoStack = [];

    // Notes panel state
    this._notesPanelOpen = false;
    this._notesPanelElementId = null;

    // DOM references (set in render)
    this._canvas = null;
    this._ctx = null;
    this._svg = null;
    this._selectionOverlay = null;
    this._toolbarEl = null;
    this._notesPanelEl = null;
    this._gridEl = null;

    // Bound handlers
    this._onMouseDown = this._handleMouseDown.bind(this);
    this._onMouseMove = this._handleMouseMove.bind(this);
    this._onMouseUp = this._handleMouseUp.bind(this);
    this._onWheel = this._handleWheel.bind(this);
    this._onKeyDown = this._handleKeyDown.bind(this);
    this._onKeyUp = this._handleKeyUp.bind(this);
    this._onDblClick = this._handleDblClick.bind(this);
    this._onContextMenu = (e) => e.preventDefault();

    this._saveNotes = debounce(this._persistNotes.bind(this), 500);
  }

  // ========================================================================
  // Lifecycle
  // ========================================================================

  mount() {
    super.mount();
    this._loadElements();

    // Cross-tab sync events
    this.subscribeTo('whiteboard:element-created', (el) => {
      if (el.roomId === this.roomId && !this._elements.has(el.id)) {
        this._elements.set(el.id, el);
        this._renderElements();
      }
    });

    this.subscribeTo('whiteboard:element-updated', (el) => {
      if (el.roomId === this.roomId) {
        this._elements.set(el.id, el);
        this._renderElements();
      }
    });

    this.subscribeTo('whiteboard:element-deleted', ({ id, roomId }) => {
      if (roomId === this.roomId) {
        this._elements.delete(id);
        if (this._selectedId === id) this._clearSelection();
        this._renderElements();
      }
    });

    this.subscribeTo('whiteboard:element-moved', ({ id, x, y, roomId }) => {
      if (roomId === this.roomId) {
        const el = this._elements.get(id);
        if (el) {
          el.x = x;
          el.y = y;
          this._renderElements();
        }
      }
    });
  }

  destroy() {
    // Remove global listeners
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    this._detachCanvasListeners();
    super.destroy();
  }

  // ========================================================================
  // Data
  // ========================================================================

  async _loadElements() {
    try {
      const elements = await whiteboardService.getElementsByRoom(this.roomId);
      this._elements.clear();
      for (const el of elements) {
        this._elements.set(el.id, el);
        if (el.zIndex >= this._nextZIndex) this._nextZIndex = el.zIndex + 1;
      }
      this._renderElements();
    } catch (err) {
      console.error('[Whiteboard] Failed to load elements:', err);
      showToast('Failed to load whiteboard elements', { type: 'error' });
    }
  }

  // ========================================================================
  // Render
  // ========================================================================

  render() {
    // Build main HTML structure -- only on first render or full re-render
    this.container.innerHTML = `
      <div class="whiteboard" data-tool="${this._activeTool}">
        <div class="whiteboard__grid-bg"></div>
        <canvas class="whiteboard__canvas" id="wb-canvas"></canvas>
        <svg class="whiteboard__canvas" id="wb-svg" xmlns="${SVG_NS}" style="position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none;"></svg>

        <div class="wb-selection-layer" id="wb-selection-layer" style="position: absolute; inset: 0; pointer-events: none; z-index: 5;"></div>

        ${this._renderToolbar()}
        ${this._renderZoomControls()}
        ${this._renderNotesPanel()}
      </div>
    `;

    // Cache DOM refs
    this._canvas = this.$('#wb-canvas');
    this._ctx = this._canvas.getContext('2d');
    this._svg = this.$('#wb-svg');
    this._selectionOverlay = this.$('#wb-selection-layer');
    this._toolbarEl = this.$('.wb-toolbar');
    this._notesPanelEl = this.$('.wb-notes-panel');
    this._gridEl = this.$('.whiteboard__grid-bg');

    // Size canvas to container
    this._resizeCanvas();
    this._resizeObserver = new ResizeObserver(() => this._resizeCanvas());
    this._resizeObserver.observe(this.container);

    // Attach event listeners
    this._attachCanvasListeners();
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);

    // Toolbar events
    this._bindToolbarEvents();

    // Render existing elements
    this._renderElements();
  }

  _resizeCanvas() {
    if (!this._canvas) return;
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this._canvas.width = rect.width * dpr;
    this._canvas.height = rect.height * dpr;
    this._canvas.style.width = rect.width + 'px';
    this._canvas.style.height = rect.height + 'px';
    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._renderElements();
  }

  // -----------------------------------------------------------------------
  // Toolbar HTML
  // -----------------------------------------------------------------------

  _renderToolbar() {
    const toolBtns = TOOLS.map(t => `
      <button
        class="wb-toolbar__btn ${this._activeTool === t.id ? 'wb-toolbar__btn--active' : ''}"
        data-tool="${t.id}"
        title="${t.label}"
        type="button"
      >${t.icon}</button>
    `).join('');

    const colorSwatches = PRESET_COLORS.map(c => `
      <span
        class="wb-color-swatch ${this._strokeColor === c ? 'wb-color-swatch--selected' : ''}"
        data-color="${c}"
        style="background: ${c}; ${c === '#ffffff' ? 'border: 1px solid #d1d5db;' : ''}"
        title="${c}"
      ></span>
    `).join('');

    const strokeOptions = STROKE_WIDTHS.map(w => `
      <span
        class="wb-stroke-option ${this._strokeWidth === w ? 'wb-stroke-option--selected' : ''}"
        data-stroke="${w}"
        title="${w}px"
      >
        <span class="wb-stroke-preview" style="width: ${Math.min(w * 3, 20)}px; height: ${w}px;"></span>
      </span>
    `).join('');

    return `
      <div class="wb-toolbar">
        ${toolBtns}

        <div class="wb-toolbar__divider"></div>

        <div class="wb-color-picker" id="wb-color-picker">
          ${colorSwatches}
          <label class="wb-color-swatch" style="background: conic-gradient(red, yellow, lime, aqua, blue, magenta, red); cursor: pointer;" title="Custom color">
            <input type="color" value="${this._strokeColor}" id="wb-custom-color"
              style="opacity: 0; position: absolute; width: 0; height: 0; pointer-events: none;" />
          </label>
        </div>

        <div class="wb-toolbar__divider"></div>

        <div class="wb-stroke-selector" id="wb-stroke-selector">
          ${strokeOptions}
        </div>

        <div class="wb-toolbar__divider"></div>

        <button
          class="wb-toolbar__btn ${this._fillEnabled ? 'wb-toolbar__btn--active' : ''}"
          id="wb-fill-toggle"
          title="Toggle fill"
          type="button"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="${this._fillEnabled ? this._strokeColor : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>
        </button>

        <div class="wb-toolbar__divider"></div>

        <button
          class="wb-toolbar__btn"
          id="wb-delete-btn"
          title="Delete selected (Del)"
          type="button"
          ${this._selectedId ? '' : 'disabled'}
          style="${this._selectedId ? '' : 'opacity: 0.4; cursor: not-allowed;'}"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>

        <div class="wb-toolbar__divider"></div>

        <button class="wb-toolbar__btn" id="wb-undo-btn" title="Undo (Ctrl+Z)" type="button"
          ${this._undoStack.length === 0 ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
        </button>
        <button class="wb-toolbar__btn" id="wb-redo-btn" title="Redo (Ctrl+Shift+Z)" type="button"
          ${this._redoStack.length === 0 ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"/></svg>
        </button>
      </div>
    `;
  }

  // -----------------------------------------------------------------------
  // Zoom controls HTML
  // -----------------------------------------------------------------------

  _renderZoomControls() {
    const pct = Math.round(this._zoom * 100);
    return `
      <div class="wb-zoom">
        <button class="wb-zoom__btn" id="wb-zoom-out" title="Zoom out" type="button"
          ${this._zoom <= MIN_ZOOM ? 'disabled' : ''}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <span class="wb-zoom__level" id="wb-zoom-level" title="Click to reset to 100%">${pct}%</span>
        <button class="wb-zoom__btn" id="wb-zoom-in" title="Zoom in" type="button"
          ${this._zoom >= MAX_ZOOM ? 'disabled' : ''}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <button class="wb-zoom__btn" id="wb-zoom-fit" title="Fit to screen" type="button">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
        </button>
      </div>
    `;
  }

  // -----------------------------------------------------------------------
  // Notes panel HTML
  // -----------------------------------------------------------------------

  _renderNotesPanel() {
    return `
      <div class="wb-notes-panel ${this._notesPanelOpen ? 'wb-notes-panel--open' : ''}" id="wb-notes-panel">
        <div class="wb-notes-panel__header">
          <span class="wb-notes-panel__title">Element Notes</span>
          <button class="wb-toolbar__btn" id="wb-notes-close" title="Close" type="button">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="wb-notes-panel__list" style="padding: var(--sp-3);">
          <textarea
            id="wb-notes-textarea"
            class="form-input"
            style="width: 100%; min-height: 200px; resize: vertical; font-size: var(--text-sm);"
            maxlength="${NOTES_MAX}"
            placeholder="Add notes for this element..."
          ></textarea>
          <div id="wb-notes-counter" style="font-size: var(--text-xs); color: var(--c-text-muted); margin-top: var(--sp-1); text-align: right;">0 / ${NOTES_MAX}</div>
          <button class="btn btn--primary btn--sm" id="wb-notes-save" type="button" style="margin-top: var(--sp-2); width: 100%;">Save Notes</button>
        </div>
      </div>
    `;
  }

  // -----------------------------------------------------------------------
  // Toolbar event binding
  // -----------------------------------------------------------------------

  _bindToolbarEvents() {
    // Tool selection
    this.delegate('click', '[data-tool]', (_e, target) => {
      const tool = target.dataset.tool;
      if (tool === 'image') {
        this._openImagePicker();
        return;
      }
      this._activeTool = tool;
      this._updateToolbarActiveStates();
      this._updateCursor();
      if (tool !== 'select') this._clearSelection();
    });

    // Color swatches
    this.delegate('click', '[data-color]', (_e, target) => {
      this._strokeColor = target.dataset.color;
      this._updateColorActiveStates();
    });

    // Custom color
    const customColorInput = this.$('#wb-custom-color');
    if (customColorInput) {
      customColorInput.addEventListener('input', (e) => {
        this._strokeColor = e.target.value;
        this._updateColorActiveStates();
      });
    }

    // Stroke width
    this.delegate('click', '[data-stroke]', (_e, target) => {
      this._strokeWidth = parseInt(target.dataset.stroke, 10);
      this._updateStrokeActiveStates();
    });

    // Fill toggle
    const fillBtn = this.$('#wb-fill-toggle');
    if (fillBtn) {
      fillBtn.addEventListener('click', () => {
        this._fillEnabled = !this._fillEnabled;
        fillBtn.classList.toggle('wb-toolbar__btn--active', this._fillEnabled);
        const svgRect = fillBtn.querySelector('svg rect');
        if (svgRect) svgRect.setAttribute('fill', this._fillEnabled ? this._strokeColor : 'none');
      });
    }

    // Delete
    const deleteBtn = this.$('#wb-delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => this._deleteSelected());
    }

    // Undo / Redo
    const undoBtn = this.$('#wb-undo-btn');
    if (undoBtn) undoBtn.addEventListener('click', () => this._undo());

    const redoBtn = this.$('#wb-redo-btn');
    if (redoBtn) redoBtn.addEventListener('click', () => this._redo());

    // Zoom controls
    const zoomIn = this.$('#wb-zoom-in');
    if (zoomIn) zoomIn.addEventListener('click', () => this._setZoom(this._zoom + ZOOM_STEP));

    const zoomOut = this.$('#wb-zoom-out');
    if (zoomOut) zoomOut.addEventListener('click', () => this._setZoom(this._zoom - ZOOM_STEP));

    const zoomLevel = this.$('#wb-zoom-level');
    if (zoomLevel) zoomLevel.addEventListener('click', () => this._setZoom(1));

    const zoomFit = this.$('#wb-zoom-fit');
    if (zoomFit) zoomFit.addEventListener('click', () => this._zoomToFit());

    // Notes panel
    const notesClose = this.$('#wb-notes-close');
    if (notesClose) {
      notesClose.addEventListener('click', () => this._closeNotesPanel());
    }

    const notesSave = this.$('#wb-notes-save');
    if (notesSave) {
      notesSave.addEventListener('click', () => this._persistNotesNow());
    }

    const notesTextarea = this.$('#wb-notes-textarea');
    if (notesTextarea) {
      notesTextarea.addEventListener('input', () => {
        this._updateNotesCounter();
        this._saveNotes();
      });
      notesTextarea.addEventListener('blur', () => {
        this._persistNotesNow();
      });
    }
  }

  // -----------------------------------------------------------------------
  // Toolbar state updates (without full re-render)
  // -----------------------------------------------------------------------

  _updateToolbarActiveStates() {
    if (!this._toolbarEl) return;
    this._toolbarEl.querySelectorAll('[data-tool]').forEach(btn => {
      btn.classList.toggle('wb-toolbar__btn--active', btn.dataset.tool === this._activeTool);
    });
  }

  _updateColorActiveStates() {
    if (!this.container) return;
    const picker = this.$('#wb-color-picker');
    if (!picker) return;
    picker.querySelectorAll('[data-color]').forEach(sw => {
      sw.classList.toggle('wb-color-swatch--selected', sw.dataset.color === this._strokeColor);
    });
  }

  _updateStrokeActiveStates() {
    if (!this.container) return;
    const sel = this.$('#wb-stroke-selector');
    if (!sel) return;
    sel.querySelectorAll('[data-stroke]').forEach(opt => {
      opt.classList.toggle('wb-stroke-option--selected', parseInt(opt.dataset.stroke, 10) === this._strokeWidth);
    });
  }

  _updateDeleteBtn() {
    const btn = this.$('#wb-delete-btn');
    if (!btn) return;
    if (this._selectedId) {
      btn.disabled = false;
      btn.style.opacity = '';
      btn.style.cursor = '';
    } else {
      btn.disabled = true;
      btn.style.opacity = '0.4';
      btn.style.cursor = 'not-allowed';
    }
  }

  _updateUndoRedoBtns() {
    const undoBtn = this.$('#wb-undo-btn');
    const redoBtn = this.$('#wb-redo-btn');
    if (undoBtn) {
      undoBtn.disabled = this._undoStack.length === 0;
      undoBtn.style.opacity = this._undoStack.length === 0 ? '0.4' : '';
      undoBtn.style.cursor = this._undoStack.length === 0 ? 'not-allowed' : '';
    }
    if (redoBtn) {
      redoBtn.disabled = this._redoStack.length === 0;
      redoBtn.style.opacity = this._redoStack.length === 0 ? '0.4' : '';
      redoBtn.style.cursor = this._redoStack.length === 0 ? 'not-allowed' : '';
    }
  }

  _updateZoomDisplay() {
    const el = this.$('#wb-zoom-level');
    if (el) el.textContent = Math.round(this._zoom * 100) + '%';

    const zoomIn = this.$('#wb-zoom-in');
    const zoomOut = this.$('#wb-zoom-out');
    if (zoomIn) zoomIn.disabled = this._zoom >= MAX_ZOOM;
    if (zoomOut) zoomOut.disabled = this._zoom <= MIN_ZOOM;
  }

  _updateCursor() {
    const wb = this.$('.whiteboard');
    if (!wb) return;
    wb.dataset.tool = this._activeTool;

    switch (this._activeTool) {
      case 'select': wb.style.cursor = 'default'; break;
      case 'pen': wb.style.cursor = 'crosshair'; break;
      case 'text': wb.style.cursor = 'text'; break;
      default: wb.style.cursor = 'crosshair'; break;
    }
  }

  // ========================================================================
  // Canvas / SVG event listeners
  // ========================================================================

  _attachCanvasListeners() {
    const wb = this.$('.whiteboard');
    if (!wb) return;
    wb.addEventListener('mousedown', this._onMouseDown);
    wb.addEventListener('mousemove', this._onMouseMove);
    wb.addEventListener('mouseup', this._onMouseUp);
    wb.addEventListener('mouseleave', this._onMouseUp);
    wb.addEventListener('wheel', this._onWheel, { passive: false });
    wb.addEventListener('dblclick', this._onDblClick);
    wb.addEventListener('contextmenu', this._onContextMenu);
  }

  _detachCanvasListeners() {
    const wb = this.$('.whiteboard');
    if (!wb) return;
    wb.removeEventListener('mousedown', this._onMouseDown);
    wb.removeEventListener('mousemove', this._onMouseMove);
    wb.removeEventListener('mouseup', this._onMouseUp);
    wb.removeEventListener('mouseleave', this._onMouseUp);
    wb.removeEventListener('wheel', this._onWheel);
    wb.removeEventListener('dblclick', this._onDblClick);
    wb.removeEventListener('contextmenu', this._onContextMenu);
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
  }

  // ========================================================================
  // Coordinate helpers
  // ========================================================================

  /** Convert screen (mouse event) coordinates to canvas (world) coordinates */
  _screenToCanvas(screenX, screenY) {
    const rect = this.container.getBoundingClientRect();
    return {
      x: (screenX - rect.left - this._panX) / this._zoom,
      y: (screenY - rect.top - this._panY) / this._zoom
    };
  }

  /** Convert canvas (world) coordinates to screen coordinates */
  _canvasToScreen(cx, cy) {
    const rect = this.container.getBoundingClientRect();
    return {
      x: cx * this._zoom + this._panX + rect.left,
      y: cy * this._zoom + this._panY + rect.top
    };
  }

  // ========================================================================
  // Mouse handlers
  // ========================================================================

  _handleMouseDown(e) {
    if (this._isTextEditing) return;

    // Middle-mouse panning
    if (e.button === 1) {
      e.preventDefault();
      this._startPan(e);
      return;
    }

    // Space+drag panning
    if (this._spaceDown && e.button === 0) {
      this._startPan(e);
      return;
    }

    if (e.button !== 0) return;

    // Check if click is on a resize handle
    const handleEl = e.target.closest('.wb-selection__handle');
    if (handleEl && this._selectedId) {
      this._startResize(e, handleEl);
      return;
    }

    const pos = this._screenToCanvas(e.clientX, e.clientY);

    switch (this._activeTool) {
      case 'select':
        this._handleSelectDown(e, pos);
        break;
      case 'pen':
        this._startPenStroke(pos);
        break;
      case 'rect':
      case 'ellipse':
      case 'line':
        this._startShape(pos);
        break;
      case 'text':
        this._startTextInput(pos);
        break;
    }
  }

  _handleMouseMove(e) {
    if (this._isPanning) {
      this._doPan(e);
      return;
    }

    if (this._isTextEditing) return;

    const pos = this._screenToCanvas(e.clientX, e.clientY);

    if (this._isDrawing) {
      switch (this._activeTool) {
        case 'pen':
          this._continuePenStroke(pos);
          break;
        case 'rect':
        case 'ellipse':
        case 'line':
          this._previewShape(pos);
          break;
      }
      return;
    }

    if (this._isMoving) {
      this._doMove(e, pos);
      return;
    }

    if (this._isResizing) {
      this._doResize(e, pos);
      return;
    }
  }

  _handleMouseUp(e) {
    if (this._isPanning) {
      this._endPan();
      return;
    }

    if (this._isDrawing) {
      const pos = this._screenToCanvas(e.clientX, e.clientY);
      switch (this._activeTool) {
        case 'pen':
          this._endPenStroke(pos);
          break;
        case 'rect':
        case 'ellipse':
        case 'line':
          this._endShape(pos);
          break;
      }
      return;
    }

    if (this._isMoving) {
      this._endMove();
      return;
    }

    if (this._isResizing) {
      this._endResize();
      return;
    }
  }

  _handleWheel(e) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = -e.deltaY * 0.001;
      const rect = this.container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const newZoom = clamp(this._zoom + delta * this._zoom, MIN_ZOOM, MAX_ZOOM);

      // Zoom towards mouse position
      this._panX = mx - (mx - this._panX) * (newZoom / this._zoom);
      this._panY = my - (my - this._panY) * (newZoom / this._zoom);
      this._zoom = newZoom;

      this._applyViewTransform();
      this._updateZoomDisplay();
    }
  }

  _handleKeyDown(e) {
    if (e.key === ' ' && !this._spaceDown && !this._isTextEditing) {
      e.preventDefault();
      this._spaceDown = true;
      const wb = this.$('.whiteboard');
      if (wb) wb.style.cursor = 'grab';
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!this._isTextEditing && this._selectedId) {
        e.preventDefault();
        this._deleteSelected();
      }
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      this._undo();
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
      e.preventDefault();
      this._redo();
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
      e.preventDefault();
      this._redo();
    }

    // Escape deselects
    if (e.key === 'Escape') {
      if (this._isTextEditing) {
        this._commitTextInput();
      }
      this._clearSelection();
      this._closeNotesPanel();
    }
  }

  _handleKeyUp(e) {
    if (e.key === ' ') {
      this._spaceDown = false;
      this._updateCursor();
    }
  }

  _handleDblClick(e) {
    if (this._activeTool !== 'select') return;
    const pos = this._screenToCanvas(e.clientX, e.clientY);
    const el = this._hitTest(pos.x, pos.y);
    if (el) {
      this._openNotesPanel(el.id);
    }
  }

  // ========================================================================
  // Select tool
  // ========================================================================

  _handleSelectDown(e, pos) {
    const el = this._hitTest(pos.x, pos.y);
    if (el) {
      this._selectElement(el.id);
      // Start moving
      this._isMoving = true;
      this._moveStartX = pos.x;
      this._moveStartY = pos.y;

      if (el.type === 'pen') {
        const bbox = elementBBox(el);
        this._moveElStartX = bbox.x;
        this._moveElStartY = bbox.y;
      } else {
        this._moveElStartX = el.x || 0;
        this._moveElStartY = el.y || 0;
      }

      // For line type, also save x2/y2
      if (el.type === 'line') {
        this._moveElStartX2 = el.x2;
        this._moveElStartY2 = el.y2;
      }
    } else {
      this._clearSelection();
    }
  }

  _selectElement(id) {
    this._selectedId = id;
    this._renderSelection();
    this._updateDeleteBtn();
    bus.emit('whiteboard:selection-changed', { id, roomId: this.roomId });
  }

  _clearSelection() {
    this._selectedId = null;
    this._renderSelection();
    this._updateDeleteBtn();
    bus.emit('whiteboard:selection-changed', { id: null, roomId: this.roomId });
  }

  _hitTest(x, y) {
    // Iterate in reverse z-order (top-most first)
    const sorted = Array.from(this._elements.values())
      .sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));

    const tolerance = 6 / this._zoom;
    for (const el of sorted) {
      if (hitTestElement(el, x, y, tolerance)) return el;
    }
    return null;
  }

  // ========================================================================
  // Pan
  // ========================================================================

  _startPan(e) {
    this._isPanning = true;
    this._dragStartScreen = { x: e.clientX, y: e.clientY };
    this._panStartX = this._panX;
    this._panStartY = this._panY;
    const wb = this.$('.whiteboard');
    if (wb) wb.style.cursor = 'grabbing';
  }

  _doPan(e) {
    const dx = e.clientX - this._dragStartScreen.x;
    const dy = e.clientY - this._dragStartScreen.y;
    this._panX = this._panStartX + dx;
    this._panY = this._panStartY + dy;
    this._applyViewTransform();
  }

  _endPan() {
    this._isPanning = false;
    this._updateCursor();
  }

  // ========================================================================
  // Pen tool
  // ========================================================================

  _startPenStroke(pos) {
    this._isDrawing = true;
    this._currentPoints = [[pos.x, pos.y]];
    this._renderPenPreview();
  }

  _continuePenStroke(pos) {
    this._currentPoints.push([pos.x, pos.y]);
    this._renderPenPreview();
  }

  async _endPenStroke(_pos) {
    this._isDrawing = false;
    const points = this._currentPoints;
    this._currentPoints = [];
    this._clearPenPreview();

    if (points.length < 2) return;

    const data = {
      points,
      strokeColor: this._strokeColor,
      strokeWidth: this._strokeWidth,
      zIndex: this._nextZIndex++
    };

    try {
      const el = await whiteboardService.createElement(this.roomId, 'pen', data);
      this._elements.set(el.id, el);
      this._pushUndo({ type: 'create', elementId: el.id, data: { ...el } });
      this._renderElements();
      activityService.logActivity(this.roomId, 'create', 'whiteboard-element', el.id, 'Drew a pen stroke');
    } catch (err) {
      console.error('[Whiteboard] Failed to create pen element:', err);
      showToast('Failed to save drawing', { type: 'error' });
    }
  }

  _renderPenPreview() {
    if (!this._ctx) return;
    // We draw the live pen stroke on the canvas
    this._renderElements(); // Redraw base then overlay preview
    const ctx = this._ctx;
    ctx.save();
    ctx.translate(this._panX, this._panY);
    ctx.scale(this._zoom, this._zoom);
    ctx.beginPath();
    ctx.strokeStyle = this._strokeColor;
    ctx.lineWidth = this._strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const pts = this._currentPoints;
    if (pts.length > 0) {
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const cpX = (pts[i][0] + pts[i + 1][0]) / 2;
        const cpY = (pts[i][1] + pts[i + 1][1]) / 2;
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], cpX, cpY);
      }
      if (pts.length > 1) {
        const last = pts[pts.length - 1];
        ctx.lineTo(last[0], last[1]);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  _clearPenPreview() {
    // Just re-render elements, which clears the canvas first
    this._renderElements();
  }

  // ========================================================================
  // Shape tools (rect, ellipse, line)
  // ========================================================================

  _startShape(pos) {
    this._isDrawing = true;
    this._dragStart = { x: pos.x, y: pos.y };
    this._createPreviewSVG();
  }

  _previewShape(pos) {
    if (!this._previewEl || !this._dragStart) return;

    const x0 = this._dragStart.x;
    const y0 = this._dragStart.y;
    const x1 = pos.x;
    const y1 = pos.y;

    switch (this._activeTool) {
      case 'rect': {
        const rx = Math.min(x0, x1);
        const ry = Math.min(y0, y1);
        const rw = Math.abs(x1 - x0);
        const rh = Math.abs(y1 - y0);
        this._previewEl.setAttribute('x', rx);
        this._previewEl.setAttribute('y', ry);
        this._previewEl.setAttribute('width', rw);
        this._previewEl.setAttribute('height', rh);
        break;
      }
      case 'ellipse': {
        const cx = (x0 + x1) / 2;
        const cy = (y0 + y1) / 2;
        const erx = Math.abs(x1 - x0) / 2;
        const ery = Math.abs(y1 - y0) / 2;
        this._previewEl.setAttribute('cx', cx);
        this._previewEl.setAttribute('cy', cy);
        this._previewEl.setAttribute('rx', erx);
        this._previewEl.setAttribute('ry', ery);
        break;
      }
      case 'line': {
        this._previewEl.setAttribute('x1', x0);
        this._previewEl.setAttribute('y1', y0);
        this._previewEl.setAttribute('x2', x1);
        this._previewEl.setAttribute('y2', y1);
        break;
      }
    }
  }

  async _endShape(pos) {
    this._isDrawing = false;
    this._removePreviewSVG();

    if (!this._dragStart) return;

    const x0 = this._dragStart.x;
    const y0 = this._dragStart.y;
    const x1 = pos.x;
    const y1 = pos.y;
    this._dragStart = null;

    // Discard tiny shapes
    if (Math.abs(x1 - x0) < 2 && Math.abs(y1 - y0) < 2) return;

    let data;
    let type = this._activeTool;

    switch (type) {
      case 'rect':
        data = {
          x: Math.min(x0, x1),
          y: Math.min(y0, y1),
          width: Math.abs(x1 - x0),
          height: Math.abs(y1 - y0),
          strokeColor: this._strokeColor,
          strokeWidth: this._strokeWidth,
          fillColor: this._fillEnabled ? this._strokeColor : 'transparent',
          zIndex: this._nextZIndex++
        };
        break;
      case 'ellipse':
        data = {
          x: Math.min(x0, x1),
          y: Math.min(y0, y1),
          width: Math.abs(x1 - x0),
          height: Math.abs(y1 - y0),
          strokeColor: this._strokeColor,
          strokeWidth: this._strokeWidth,
          fillColor: this._fillEnabled ? this._strokeColor : 'transparent',
          zIndex: this._nextZIndex++
        };
        break;
      case 'line':
        data = {
          x: x0,
          y: y0,
          x2: x1,
          y2: y1,
          strokeColor: this._strokeColor,
          strokeWidth: this._strokeWidth,
          zIndex: this._nextZIndex++
        };
        break;
    }

    try {
      const el = await whiteboardService.createElement(this.roomId, type, data);
      this._elements.set(el.id, el);
      this._pushUndo({ type: 'create', elementId: el.id, data: { ...el } });
      this._renderElements();
      const label = type === 'rect' ? 'rectangle' : type;
      activityService.logActivity(this.roomId, 'create', 'whiteboard-element', el.id, `Created a ${label}`);
    } catch (err) {
      console.error('[Whiteboard] Failed to create shape:', err);
      showToast('Failed to save shape', { type: 'error' });
    }
  }

  _createPreviewSVG() {
    if (!this._svg) return;
    this._removePreviewSVG();

    let el;
    const common = {
      stroke: this._strokeColor,
      'stroke-width': this._strokeWidth / this._zoom,
      fill: this._fillEnabled ? this._strokeColor : 'none',
      'stroke-dasharray': '5,5',
      opacity: '0.7'
    };

    switch (this._activeTool) {
      case 'rect':
        el = document.createElementNS(SVG_NS, 'rect');
        break;
      case 'ellipse':
        el = document.createElementNS(SVG_NS, 'ellipse');
        break;
      case 'line':
        el = document.createElementNS(SVG_NS, 'line');
        delete common.fill;
        break;
    }

    if (!el) return;

    for (const [k, v] of Object.entries(common)) {
      el.setAttribute(k, v);
    }
    el.setAttribute('id', 'wb-preview-shape');

    // The SVG viewBox is transformed with the view, so apply it to a group
    let g = this._svg.querySelector('#wb-preview-group');
    if (!g) {
      g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('id', 'wb-preview-group');
      g.setAttribute('transform', `translate(${this._panX},${this._panY}) scale(${this._zoom})`);
      this._svg.appendChild(g);
    }
    g.appendChild(el);
    this._previewEl = el;
  }

  _removePreviewSVG() {
    if (this._previewEl) {
      this._previewEl.remove();
      this._previewEl = null;
    }
    const g = this._svg?.querySelector('#wb-preview-group');
    if (g) g.remove();
  }

  // ========================================================================
  // Image tool
  // ========================================================================

  _openImagePicker() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;

      if (file.size > 5 * 1024 * 1024) {
        showToast('Image must be under 5 MB', { type: 'warning' });
        return;
      }

      try {
        const dataUrl = await this._readFileAsDataURL(file);
        const img = new Image();
        img.onload = async () => {
          // Place at center of view
          const rect = this.container.getBoundingClientRect();
          const centerCanvas = this._screenToCanvas(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2
          );

          const maxW = 400;
          const maxH = 300;
          let w = img.naturalWidth;
          let h = img.naturalHeight;
          if (w > maxW) { h = h * (maxW / w); w = maxW; }
          if (h > maxH) { w = w * (maxH / h); h = maxH; }

          const data = {
            x: centerCanvas.x - w / 2,
            y: centerCanvas.y - h / 2,
            width: w,
            height: h,
            src: dataUrl,
            zIndex: this._nextZIndex++
          };

          const el = await whiteboardService.createElement(this.roomId, 'image', data);
          this._elements.set(el.id, el);
          this._pushUndo({ type: 'create', elementId: el.id, data: { ...el } });
          this._renderElements();
          this._selectElement(el.id);
          this._activeTool = 'select';
          this._updateToolbarActiveStates();
          this._updateCursor();
          activityService.logActivity(this.roomId, 'create', 'whiteboard-element', el.id, 'Added an image');
        };
        img.src = dataUrl;
      } catch (err) {
        console.error('[Whiteboard] Failed to load image:', err);
        showToast('Failed to load image', { type: 'error' });
      }
    });
    input.click();
  }

  _readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  // ========================================================================
  // Text tool
  // ========================================================================

  _startTextInput(pos) {
    if (this._isTextEditing) {
      this._commitTextInput();
      return;
    }

    this._isTextEditing = true;
    this._textInputPos = { x: pos.x, y: pos.y };

    // Create an overlay text input
    const screenPos = this._canvasToScreen(pos.x, pos.y);
    const rect = this.container.getBoundingClientRect();

    const input = document.createElement('textarea');
    input.className = 'wb-text-input';
    input.style.cssText = `
      position: absolute;
      left: ${screenPos.x - rect.left}px;
      top: ${screenPos.y - rect.top}px;
      min-width: 100px;
      min-height: 30px;
      font-size: ${16 * this._zoom}px;
      font-family: inherit;
      color: ${this._strokeColor};
      background: transparent;
      border: 1px dashed var(--c-primary);
      outline: none;
      padding: 4px 6px;
      resize: both;
      z-index: 20;
      white-space: pre-wrap;
    `;
    input.placeholder = 'Type here...';

    this._textInput = input;
    this.container.querySelector('.whiteboard').appendChild(input);
    input.focus();

    input.addEventListener('blur', () => {
      // Small delay to allow for deliberate clicks
      setTimeout(() => this._commitTextInput(), 100);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this._cancelTextInput();
      }
      // Enter without shift commits
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._commitTextInput();
      }
    });
  }

  async _commitTextInput() {
    if (!this._isTextEditing || !this._textInput) return;
    const text = this._textInput.value.trim();
    this._isTextEditing = false;

    if (this._textInput.parentNode) {
      this._textInput.remove();
    }
    this._textInput = null;

    if (!text) return;

    // Store as a rect-type element with text content
    // We use 'sticker' type to hold text since the service supports it
    // Actually, we'll use rect with a text property for simplicity,
    // but the service only allows certain types. Let's use 'sticker'.
    const pos = this._textInputPos;
    const data = {
      x: pos.x,
      y: pos.y,
      width: Math.max(text.length * 10, 100),
      height: 40,
      text,
      strokeColor: this._strokeColor,
      strokeWidth: 0,
      fillColor: 'transparent',
      fontSize: 16,
      zIndex: this._nextZIndex++
    };

    try {
      const el = await whiteboardService.createElement(this.roomId, 'sticker', data);
      this._elements.set(el.id, el);
      this._pushUndo({ type: 'create', elementId: el.id, data: { ...el } });
      this._renderElements();
      activityService.logActivity(this.roomId, 'create', 'whiteboard-element', el.id, 'Added text');
    } catch (err) {
      console.error('[Whiteboard] Failed to create text element:', err);
      showToast('Failed to save text', { type: 'error' });
    }
  }

  _cancelTextInput() {
    this._isTextEditing = false;
    if (this._textInput && this._textInput.parentNode) {
      this._textInput.remove();
    }
    this._textInput = null;
  }

  // ========================================================================
  // Move
  // ========================================================================

  _doMove(e, pos) {
    const el = this._elements.get(this._selectedId);
    if (!el) return;

    const dx = pos.x - this._moveStartX;
    const dy = pos.y - this._moveStartY;

    if (el.type === 'pen') {
      // Move all points
      const bbox = elementBBox(el);
      const origBBox = { x: this._moveElStartX, y: this._moveElStartY };
      const offsetX = dx;
      const offsetY = dy;
      // We need to translate from original positions, so we track the delta
      // and apply relative to stored original bbox
      // Actually, for pen we store original points on drag start
      if (!this._moveOriginalPoints) {
        this._moveOriginalPoints = el.points.map(p => [...p]);
      }
      el.points = this._moveOriginalPoints.map(([px, py]) => [px + dx, py + dy]);
    } else if (el.type === 'line') {
      el.x = this._moveElStartX + dx;
      el.y = this._moveElStartY + dy;
      el.x2 = this._moveElStartX2 + dx;
      el.y2 = this._moveElStartY2 + dy;
    } else {
      el.x = this._moveElStartX + dx;
      el.y = this._moveElStartY + dy;
    }

    this._renderElements();
    this._renderSelection();
  }

  async _endMove() {
    this._isMoving = false;
    this._moveOriginalPoints = null;

    const el = this._elements.get(this._selectedId);
    if (!el) return;

    // Check if actually moved
    if (el.type === 'pen') {
      // Persist the whole element update
      try {
        await whiteboardService.updateElement(el.id, { points: el.points });
        this._pushUndo({
          type: 'move',
          elementId: el.id,
          before: { points: this._moveOriginalPoints },
          after: { points: el.points }
        });
      } catch (err) {
        console.error('[Whiteboard] Failed to move pen element:', err);
      }
    } else if (el.type === 'line') {
      const movedX = el.x !== this._moveElStartX || el.y !== this._moveElStartY;
      if (movedX) {
        try {
          await whiteboardService.updateElement(el.id, { x: el.x, y: el.y, x2: el.x2, y2: el.y2 });
          this._pushUndo({
            type: 'move',
            elementId: el.id,
            before: { x: this._moveElStartX, y: this._moveElStartY, x2: this._moveElStartX2, y2: this._moveElStartY2 },
            after: { x: el.x, y: el.y, x2: el.x2, y2: el.y2 }
          });
        } catch (err) {
          console.error('[Whiteboard] Failed to move line element:', err);
        }
      }
    } else {
      const movedX = el.x !== this._moveElStartX;
      const movedY = el.y !== this._moveElStartY;
      if (movedX || movedY) {
        try {
          await whiteboardService.moveElement(el.id, el.x, el.y);
          this._pushUndo({
            type: 'move',
            elementId: el.id,
            before: { x: this._moveElStartX, y: this._moveElStartY },
            after: { x: el.x, y: el.y }
          });
        } catch (err) {
          console.error('[Whiteboard] Failed to move element:', err);
        }
      }
    }
  }

  // ========================================================================
  // Resize
  // ========================================================================

  _startResize(e, handleEl) {
    e.stopPropagation();
    this._isResizing = true;

    // Determine which handle
    const classes = handleEl.className;
    if (classes.includes('--tl')) this._resizeHandle = 'tl';
    else if (classes.includes('--tr')) this._resizeHandle = 'tr';
    else if (classes.includes('--bl')) this._resizeHandle = 'bl';
    else if (classes.includes('--br')) this._resizeHandle = 'br';
    else if (classes.includes('--t')) this._resizeHandle = 't';
    else if (classes.includes('--b')) this._resizeHandle = 'b';
    else if (classes.includes('--l')) this._resizeHandle = 'l';
    else if (classes.includes('--r')) this._resizeHandle = 'r';

    const el = this._elements.get(this._selectedId);
    if (!el) return;

    this._resizeStartBBox = { ...elementBBox(el) };
    this._resizeStartMouse = this._screenToCanvas(e.clientX, e.clientY);
  }

  _doResize(e, pos) {
    const el = this._elements.get(this._selectedId);
    if (!el || !this._resizeStartBBox || !this._resizeStartMouse) return;

    // Pen and line don't support handle resize well, skip
    if (el.type === 'pen' || el.type === 'line') return;

    const dx = pos.x - this._resizeStartMouse.x;
    const dy = pos.y - this._resizeStartMouse.y;
    const bb = this._resizeStartBBox;

    let newX = bb.x;
    let newY = bb.y;
    let newW = bb.width;
    let newH = bb.height;

    const handle = this._resizeHandle;

    if (handle.includes('l')) {
      newX = bb.x + dx;
      newW = bb.width - dx;
    }
    if (handle.includes('r')) {
      newW = bb.width + dx;
    }
    if (handle.includes('t')) {
      newY = bb.y + dy;
      newH = bb.height - dy;
    }
    if (handle.includes('b')) {
      newH = bb.height + dy;
    }

    // Enforce minimum size
    if (newW < 10) { newW = 10; if (handle.includes('l')) newX = bb.x + bb.width - 10; }
    if (newH < 10) { newH = 10; if (handle.includes('t')) newY = bb.y + bb.height - 10; }

    el.x = newX;
    el.y = newY;
    el.width = newW;
    el.height = newH;

    this._renderElements();
    this._renderSelection();
  }

  async _endResize() {
    this._isResizing = false;
    const el = this._elements.get(this._selectedId);
    if (!el || !this._resizeStartBBox) return;

    const before = this._resizeStartBBox;
    const after = { x: el.x, y: el.y, width: el.width, height: el.height };

    if (before.x !== after.x || before.y !== after.y || before.width !== after.width || before.height !== after.height) {
      try {
        await whiteboardService.updateElement(el.id, { x: el.x, y: el.y, width: el.width, height: el.height });
        this._pushUndo({
          type: 'resize',
          elementId: el.id,
          before,
          after
        });
      } catch (err) {
        console.error('[Whiteboard] Failed to resize element:', err);
      }
    }

    this._resizeStartBBox = null;
    this._resizeStartMouse = null;
    this._resizeHandle = null;
  }

  // ========================================================================
  // Delete
  // ========================================================================

  async _deleteSelected() {
    if (!this._selectedId) return;
    const id = this._selectedId;
    const el = this._elements.get(id);
    if (!el) return;

    this._clearSelection();

    try {
      await whiteboardService.deleteElement(id);
      this._elements.delete(id);
      this._pushUndo({ type: 'delete', elementId: id, data: { ...el } });
      this._renderElements();
      activityService.logActivity(this.roomId, 'delete', 'whiteboard-element', id, `Deleted a ${el.type}`);
    } catch (err) {
      console.error('[Whiteboard] Failed to delete element:', err);
      showToast('Failed to delete element', { type: 'error' });
    }
  }

  // ========================================================================
  // Undo / Redo
  // ========================================================================

  _pushUndo(cmd) {
    this._undoStack.push(cmd);
    if (this._undoStack.length > MAX_UNDO) this._undoStack.shift();
    this._redoStack = [];
    this._updateUndoRedoBtns();
  }

  async _undo() {
    if (this._undoStack.length === 0) return;
    const cmd = this._undoStack.pop();
    this._redoStack.push(cmd);

    try {
      switch (cmd.type) {
        case 'create': {
          await whiteboardService.deleteElement(cmd.elementId);
          this._elements.delete(cmd.elementId);
          if (this._selectedId === cmd.elementId) this._clearSelection();
          break;
        }
        case 'delete': {
          const el = await whiteboardService.createElement(this.roomId, cmd.data.type, cmd.data);
          // The new element gets a new id, but we want to keep the original id for redo
          // Actually, createElement generates a new id. We need to update our reference.
          this._elements.set(el.id, el);
          // Update the cmd to reflect the new id for redo
          cmd._restoredId = el.id;
          break;
        }
        case 'move': {
          const el = this._elements.get(cmd.elementId);
          if (el) {
            Object.assign(el, cmd.before);
            if (el.type === 'pen' && cmd.before.points) {
              await whiteboardService.updateElement(el.id, { points: cmd.before.points });
            } else if (el.type === 'line') {
              await whiteboardService.updateElement(el.id, cmd.before);
            } else {
              await whiteboardService.moveElement(el.id, cmd.before.x, cmd.before.y);
            }
          }
          break;
        }
        case 'resize': {
          const el = this._elements.get(cmd.elementId);
          if (el) {
            Object.assign(el, cmd.before);
            await whiteboardService.updateElement(el.id, cmd.before);
          }
          break;
        }
      }
    } catch (err) {
      console.error('[Whiteboard] Undo failed:', err);
    }

    this._renderElements();
    this._renderSelection();
    this._updateUndoRedoBtns();
  }

  async _redo() {
    if (this._redoStack.length === 0) return;
    const cmd = this._redoStack.pop();
    this._undoStack.push(cmd);

    try {
      switch (cmd.type) {
        case 'create': {
          const el = await whiteboardService.createElement(this.roomId, cmd.data.type, cmd.data);
          this._elements.set(el.id, el);
          cmd.elementId = el.id; // Update id
          break;
        }
        case 'delete': {
          const delId = cmd._restoredId || cmd.elementId;
          await whiteboardService.deleteElement(delId);
          this._elements.delete(delId);
          if (this._selectedId === delId) this._clearSelection();
          break;
        }
        case 'move': {
          const el = this._elements.get(cmd.elementId);
          if (el) {
            Object.assign(el, cmd.after);
            if (el.type === 'pen' && cmd.after.points) {
              await whiteboardService.updateElement(el.id, { points: cmd.after.points });
            } else if (el.type === 'line') {
              await whiteboardService.updateElement(el.id, cmd.after);
            } else {
              await whiteboardService.moveElement(el.id, cmd.after.x, cmd.after.y);
            }
          }
          break;
        }
        case 'resize': {
          const el = this._elements.get(cmd.elementId);
          if (el) {
            Object.assign(el, cmd.after);
            await whiteboardService.updateElement(el.id, cmd.after);
          }
          break;
        }
      }
    } catch (err) {
      console.error('[Whiteboard] Redo failed:', err);
    }

    this._renderElements();
    this._renderSelection();
    this._updateUndoRedoBtns();
  }

  // ========================================================================
  // Zoom
  // ========================================================================

  _setZoom(newZoom) {
    const rect = this.container.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    newZoom = clamp(newZoom, MIN_ZOOM, MAX_ZOOM);

    // Zoom towards center
    this._panX = cx - (cx - this._panX) * (newZoom / this._zoom);
    this._panY = cy - (cy - this._panY) * (newZoom / this._zoom);
    this._zoom = newZoom;

    this._applyViewTransform();
    this._updateZoomDisplay();
  }

  _zoomToFit() {
    if (this._elements.size === 0) {
      this._panX = 0;
      this._panY = 0;
      this._zoom = 1;
      this._applyViewTransform();
      this._updateZoomDisplay();
      return;
    }

    // Compute bounding box of all elements
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of this._elements.values()) {
      const bb = elementBBox(el);
      if (bb.x < minX) minX = bb.x;
      if (bb.y < minY) minY = bb.y;
      if (bb.x + bb.width > maxX) maxX = bb.x + bb.width;
      if (bb.y + bb.height > maxY) maxY = bb.y + bb.height;
    }

    const contentW = maxX - minX || 100;
    const contentH = maxY - minY || 100;

    const rect = this.container.getBoundingClientRect();
    const padding = 60;
    const availW = rect.width - padding * 2;
    const availH = rect.height - padding * 2;

    const zoom = clamp(Math.min(availW / contentW, availH / contentH), MIN_ZOOM, MAX_ZOOM);

    this._zoom = zoom;
    this._panX = (rect.width - contentW * zoom) / 2 - minX * zoom;
    this._panY = (rect.height - contentH * zoom) / 2 - minY * zoom;

    this._applyViewTransform();
    this._updateZoomDisplay();
  }

  // ========================================================================
  // View transform
  // ========================================================================

  _applyViewTransform() {
    // Update grid background position
    if (this._gridEl) {
      const scaledSize = GRID_SIZE * this._zoom;
      this._gridEl.style.backgroundSize = `${scaledSize}px ${scaledSize}px`;
      this._gridEl.style.backgroundPosition = `${this._panX}px ${this._panY}px`;
    }

    // Re-render elements with new transform
    this._renderElements();
    this._renderSelection();
  }

  // ========================================================================
  // Rendering elements
  // ========================================================================

  _renderElements() {
    if (!this._ctx || !this._svg) return;

    const rect = this.container.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    // Clear canvas
    this._ctx.clearRect(0, 0, w, h);

    // Clear SVG (except preview group)
    const previewGroup = this._svg.querySelector('#wb-preview-group');
    this._svg.innerHTML = '';
    if (previewGroup) this._svg.appendChild(previewGroup);

    // Sort elements by zIndex
    const sorted = Array.from(this._elements.values())
      .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

    // Create a single SVG group for all shape elements
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('transform', `translate(${this._panX},${this._panY}) scale(${this._zoom})`);
    g.style.pointerEvents = 'none';

    for (const el of sorted) {
      switch (el.type) {
        case 'pen':
          this._drawPenElement(el);
          break;
        case 'rect':
          this._drawRectSVG(el, g);
          break;
        case 'ellipse':
          this._drawEllipseSVG(el, g);
          break;
        case 'line':
          this._drawLineSVG(el, g);
          break;
        case 'image':
          this._drawImageElement(el, g);
          break;
        case 'sticker':
          this._drawTextElement(el, g);
          break;
      }
    }

    this._svg.appendChild(g);

    // Update preview group transform if it exists
    if (previewGroup) {
      previewGroup.setAttribute('transform', `translate(${this._panX},${this._panY}) scale(${this._zoom})`);
    }
  }

  // -- Pen strokes on Canvas 2D --

  _drawPenElement(el) {
    const ctx = this._ctx;
    const pts = el.points;
    if (!pts || pts.length < 2) return;

    ctx.save();
    ctx.translate(this._panX, this._panY);
    ctx.scale(this._zoom, this._zoom);
    ctx.beginPath();
    ctx.strokeStyle = el.strokeColor || '#000';
    ctx.lineWidth = el.strokeWidth || 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const cpX = (pts[i][0] + pts[i + 1][0]) / 2;
      const cpY = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], cpX, cpY);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last[0], last[1]);
    ctx.stroke();
    ctx.restore();
  }

  // -- Shapes on SVG --

  _drawRectSVG(el, group) {
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', el.x);
    r.setAttribute('y', el.y);
    r.setAttribute('width', el.width);
    r.setAttribute('height', el.height);
    r.setAttribute('stroke', el.strokeColor || '#000');
    r.setAttribute('stroke-width', el.strokeWidth || 2);
    r.setAttribute('fill', el.fillColor || 'none');
    r.setAttribute('rx', '2');
    r.setAttribute('data-id', el.id);
    group.appendChild(r);
  }

  _drawEllipseSVG(el, group) {
    const e = document.createElementNS(SVG_NS, 'ellipse');
    e.setAttribute('cx', el.x + el.width / 2);
    e.setAttribute('cy', el.y + el.height / 2);
    e.setAttribute('rx', el.width / 2);
    e.setAttribute('ry', el.height / 2);
    e.setAttribute('stroke', el.strokeColor || '#000');
    e.setAttribute('stroke-width', el.strokeWidth || 2);
    e.setAttribute('fill', el.fillColor || 'none');
    e.setAttribute('data-id', el.id);
    group.appendChild(e);
  }

  _drawLineSVG(el, group) {
    const l = document.createElementNS(SVG_NS, 'line');
    l.setAttribute('x1', el.x);
    l.setAttribute('y1', el.y);
    l.setAttribute('x2', el.x2);
    l.setAttribute('y2', el.y2);
    l.setAttribute('stroke', el.strokeColor || '#000');
    l.setAttribute('stroke-width', el.strokeWidth || 2);
    l.setAttribute('stroke-linecap', 'round');
    l.setAttribute('data-id', el.id);
    group.appendChild(l);
  }

  _drawImageElement(el, group) {
    const img = document.createElementNS(SVG_NS, 'image');
    img.setAttribute('x', el.x);
    img.setAttribute('y', el.y);
    img.setAttribute('width', el.width);
    img.setAttribute('height', el.height);
    img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', el.src || '');
    img.setAttribute('preserveAspectRatio', 'none');
    img.setAttribute('data-id', el.id);
    group.appendChild(img);
  }

  _drawTextElement(el, group) {
    // Background rect for text
    if (el.fillColor && el.fillColor !== 'transparent') {
      const bg = document.createElementNS(SVG_NS, 'rect');
      bg.setAttribute('x', el.x);
      bg.setAttribute('y', el.y);
      bg.setAttribute('width', el.width);
      bg.setAttribute('height', el.height);
      bg.setAttribute('fill', el.fillColor);
      bg.setAttribute('rx', '4');
      group.appendChild(bg);
    }

    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', el.x + 6);
    text.setAttribute('y', el.y + (el.fontSize || 16) + 4);
    text.setAttribute('font-size', el.fontSize || 16);
    text.setAttribute('fill', el.strokeColor || '#000');
    text.setAttribute('font-family', 'inherit');
    text.setAttribute('data-id', el.id);
    text.textContent = el.text || '';
    group.appendChild(text);

    // Invisible hit-area rect
    const hitRect = document.createElementNS(SVG_NS, 'rect');
    hitRect.setAttribute('x', el.x);
    hitRect.setAttribute('y', el.y);
    hitRect.setAttribute('width', el.width);
    hitRect.setAttribute('height', el.height);
    hitRect.setAttribute('fill', 'transparent');
    hitRect.setAttribute('stroke', 'none');
    hitRect.setAttribute('data-id', el.id);
    group.appendChild(hitRect);
  }

  // ========================================================================
  // Selection rendering
  // ========================================================================

  _renderSelection() {
    const overlay = this._selectionOverlay;
    if (!overlay) return;

    if (!this._selectedId) {
      overlay.innerHTML = '';
      return;
    }

    const el = this._elements.get(this._selectedId);
    if (!el) {
      overlay.innerHTML = '';
      return;
    }

    const bb = elementBBox(el);

    // Convert to screen coords relative to container
    const rect = this.container.getBoundingClientRect();
    const sx = bb.x * this._zoom + this._panX;
    const sy = bb.y * this._zoom + this._panY;
    const sw = bb.width * this._zoom;
    const sh = bb.height * this._zoom;

    overlay.innerHTML = `
      <div class="wb-selection" style="left: ${sx}px; top: ${sy}px; width: ${sw}px; height: ${sh}px; pointer-events: none;">
        <div class="wb-selection__handle wb-selection__handle--tl"></div>
        <div class="wb-selection__handle wb-selection__handle--tr"></div>
        <div class="wb-selection__handle wb-selection__handle--bl"></div>
        <div class="wb-selection__handle wb-selection__handle--br"></div>
        <div class="wb-selection__handle wb-selection__handle--t"></div>
        <div class="wb-selection__handle wb-selection__handle--b"></div>
        <div class="wb-selection__handle wb-selection__handle--l"></div>
        <div class="wb-selection__handle wb-selection__handle--r"></div>
      </div>
    `;
  }

  // ========================================================================
  // Notes panel
  // ========================================================================

  _openNotesPanel(elementId) {
    this._notesPanelElementId = elementId;
    this._notesPanelOpen = true;

    const panel = this.$('#wb-notes-panel');
    if (panel) panel.classList.add('wb-notes-panel--open');

    const textarea = this.$('#wb-notes-textarea');
    const el = this._elements.get(elementId);
    if (textarea && el) {
      textarea.value = el.notes || '';
      this._updateNotesCounter();
    }
  }

  _closeNotesPanel() {
    this._notesPanelOpen = false;
    this._notesPanelElementId = null;

    const panel = this.$('#wb-notes-panel');
    if (panel) panel.classList.remove('wb-notes-panel--open');
  }

  _updateNotesCounter() {
    const textarea = this.$('#wb-notes-textarea');
    const counter = this.$('#wb-notes-counter');
    if (!textarea || !counter) return;

    const len = textarea.value.length;
    counter.textContent = `${len} / ${NOTES_MAX}`;

    if (len >= NOTES_WARN) {
      counter.style.color = 'var(--c-warning)';
    } else {
      counter.style.color = 'var(--c-text-muted)';
    }

    if (len >= NOTES_MAX) {
      counter.style.color = 'var(--c-danger)';
    }
  }

  async _persistNotes() {
    await this._persistNotesNow();
  }

  async _persistNotesNow() {
    if (!this._notesPanelElementId) return;

    const textarea = this.$('#wb-notes-textarea');
    if (!textarea) return;

    const notes = textarea.value;
    const elId = this._notesPanelElementId;
    const el = this._elements.get(elId);
    if (!el) return;

    if (el.notes === notes) return; // No change

    try {
      await whiteboardService.updateNotes(elId, notes);
      el.notes = notes;
    } catch (err) {
      console.error('[Whiteboard] Failed to save notes:', err);
      showToast('Failed to save notes: ' + (err.message || 'Unknown error'), { type: 'error' });
    }
  }
}
