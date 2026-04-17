import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomPage } from '../../js/ui/pages/room-page.js';
import { router } from '../../js/core/router.js';
import { store } from '../../js/core/store.js';
import { roomService } from '../../js/services/room-service.js';
import { resetAll, setCurrentUser } from '../helpers.js';

// Dependencies needed by the mounted Whiteboard child component
class RO { observe() {} unobserve() {} disconnect() {} }
if (typeof globalThis.ResizeObserver === 'undefined') globalThis.ResizeObserver = RO;
if (!HTMLCanvasElement.prototype.getContext.__mocked) {
  HTMLCanvasElement.prototype.getContext = function () {
    return {
      setTransform() {}, clearRect() {}, save() {}, restore() {},
      beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, rect() {},
      ellipse() {}, stroke() {}, fill() {}, fillRect() {}, strokeRect() {},
      fillText() {}, drawImage() {}, translate() {}, scale() {}, rotate() {},
      set lineWidth(_v) {}, set strokeStyle(_v) {}, set fillStyle(_v) {},
      measureText: () => ({ width: 0 })
    };
  };
  HTMLCanvasElement.prototype.getContext.__mocked = true;
}

function mount(roomId) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const page = new RoomPage(container, { id: roomId });
  page.mount();
  return { page, container };
}

async function waitFor(pred, ms = 500) {
  for (let i = 0; i < ms / 10; i++) {
    if (pred()) return true;
    await new Promise(r => setTimeout(r, 10));
  }
  return false;
}

describe('RoomPage (real room-service, real db)', () => {
  let navSpy;
  beforeEach(async () => {
    await resetAll();
    setCurrentUser();
    document.body.innerHTML = '';
    navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => {});
  });
  afterEach(() => {
    navSpy.mockRestore();
    document.body.innerHTML = '';
  });

  describe('loading & not-found', () => {
    it('renders an error state with a Back button when the roomId does not exist', async () => {
      const { container, page } = mount('does-not-exist');
      await waitFor(() => page.state.error || !page.state.loading);
      expect(page.state.error).toBe('Room not found');
      expect(container.textContent).toContain('Room not found');
      expect(container.querySelector('.js-back-to-rooms')).toBeTruthy();
    });

    it('Back button in error state navigates to /rooms', async () => {
      const { container, page } = mount('does-not-exist');
      await waitFor(() => page.state.error);
      container.querySelector('.js-back-to-rooms').click();
      expect(navSpy).toHaveBeenCalledWith('/rooms');
    });
  });

  describe('loaded room: render → content', () => {
    let room;
    beforeEach(async () => {
      room = await roomService.createRoom('Design Sync', 'For design reviews');
    });

    it('renders the room header with the room name and description', async () => {
      const { container, page } = mount(room.id);
      await waitFor(() => !page.state.loading && page.state.room);

      expect(container.querySelector('.room-header__name').textContent).toBe('Design Sync');
      expect(container.querySelector('.room-header__status').textContent).toBe('For design reviews');
    });

    it('renders three tabs (Whiteboard, Stickies, Activity) with Whiteboard active by default', async () => {
      const { container, page } = mount(room.id);
      await waitFor(() => page.state.room);

      const tabs = container.querySelectorAll('.js-tab');
      expect(tabs.length).toBe(3);
      expect(Array.from(tabs).map(t => t.dataset.tab)).toEqual(['whiteboard', 'stickies', 'activity']);

      const active = container.querySelector('.room-sidebar__tab--active');
      expect(active.dataset.tab).toBe('whiteboard');
    });

    it('renders top-right action buttons: Chat, Snapshot, Import, Export, Settings', async () => {
      const { container, page } = mount(room.id);
      await waitFor(() => page.state.room);

      expect(container.querySelector('.js-open-chat')).toBeTruthy();
      expect(container.querySelector('.js-snapshot')).toBeTruthy();
      expect(container.querySelector('.js-import')).toBeTruthy();
      expect(container.querySelector('.js-export')).toBeTruthy();
      expect(container.querySelector('.js-room-settings')).toBeTruthy();
    });
  });

  describe('tab switching: state transition', () => {
    let room;
    beforeEach(async () => {
      room = await roomService.createRoom('Tabs Test', '');
    });

    it('clicking the Stickies tab activates it and updates sidebar content', async () => {
      const { container, page } = mount(room.id);
      await waitFor(() => page.state.room);

      container.querySelector('.js-tab[data-tab="stickies"]').click();
      expect(page.state.activeTab).toBe('stickies');

      const active = container.querySelector('.room-sidebar__tab--active');
      expect(active.dataset.tab).toBe('stickies');
    });

    it('clicking the Activity tab activates it', async () => {
      const { container, page } = mount(room.id);
      await waitFor(() => page.state.room);
      container.querySelector('.js-tab[data-tab="activity"]').click();
      expect(page.state.activeTab).toBe('activity');
      expect(container.querySelector('.room-sidebar__tab--active').dataset.tab).toBe('activity');
    });
  });

  describe('navigation: back to rooms', () => {
    it('top-left back button navigates to /rooms', async () => {
      const room = await roomService.createRoom('Nav Test', '');
      const { container, page } = mount(room.id);
      await waitFor(() => page.state.room);

      container.querySelector('.room-header__back.js-back-to-rooms').click();
      expect(navSpy).toHaveBeenCalledWith('/rooms');
    });
  });
});
