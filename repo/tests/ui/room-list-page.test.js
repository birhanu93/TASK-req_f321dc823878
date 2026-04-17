import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomListPage } from '../../js/ui/pages/room-list-page.js';
import { router } from '../../js/core/router.js';
import { store } from '../../js/core/store.js';
import { storage, STORAGE_KEYS } from '../../js/core/storage.js';
import { roomService } from '../../js/services/room-service.js';
import { resetAll, setCurrentUser } from '../helpers.js';

function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const page = new RoomListPage(container, {});
  page.mount();
  return { page, container };
}

async function waitFor(pred, ms = 300) {
  for (let i = 0; i < ms / 5; i++) {
    if (pred()) return true;
    await new Promise(r => setTimeout(r, 5));
  }
  return false;
}

describe('RoomListPage (real room-service, real db)', () => {
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

  describe('render: app shell', () => {
    it('renders the sidebar, header role toggle, user avatar, and a Create Room button', async () => {
      const { container, page } = mount();
      await waitFor(() => !page.state.loading);

      expect(container.querySelector('.sidebar')).toBeTruthy();
      expect(container.querySelector('.js-role-toggle')).toBeTruthy();
      expect(container.querySelector('.js-user-avatar')).toBeTruthy();
      expect(container.querySelector('.js-create-room')).toBeTruthy();
      expect(container.querySelector('.page-title').textContent).toBe('Rooms');
    });

    it('shows the empty state when no rooms exist', async () => {
      const { container, page } = mount();
      await waitFor(() => !page.state.loading);

      expect(container.querySelector('.empty-state__title').textContent).toBe('No rooms yet');
      expect(container.querySelectorAll('.room-card').length).toBe(0);
      expect(container.querySelector('.page-subtitle').textContent).toBe('0 rooms');
    });
  });

  describe('rendering rooms from real service', () => {
    it('renders one .room-card per room and updates the subtitle count (pluralization included)', async () => {
      await roomService.createRoom('Design Review', 'd1');
      await roomService.createRoom('Sprint Plan', 'd2');

      const { container, page } = mount();
      await waitFor(() => page.state.rooms.length === 2);

      const cards = container.querySelectorAll('.room-card');
      expect(cards.length).toBe(2);
      expect(container.querySelector('.page-subtitle').textContent).toBe('2 rooms');

      // Each card has the room's name rendered
      const names = Array.from(container.querySelectorAll('.room-card__name')).map(n => n.textContent.trim());
      expect(names).toEqual(expect.arrayContaining(['Design Review', 'Sprint Plan']));
    });

    it('singular subtitle is "1 room" (no s)', async () => {
      await roomService.createRoom('Solo', '');
      const { container, page } = mount();
      await waitFor(() => page.state.rooms.length === 1);
      expect(container.querySelector('.page-subtitle').textContent).toBe('1 room');
    });

    it('clicking a room card navigates to /rooms/:id', async () => {
      const room = await roomService.createRoom('Alpha', '');
      const { container, page } = mount();
      await waitFor(() => page.state.rooms.length === 1);
      container.querySelector('.js-room-card').click();
      expect(navSpy).toHaveBeenCalledWith(`/rooms/${room.id}`);
    });
  });

  describe('role toggle: user → ops → user', () => {
    it('flipping the toggle updates store, localStorage, and shows the Administration sidebar section', async () => {
      const { container, page } = mount();
      await waitFor(() => !page.state.loading);

      // Initial: user role, no Administration section
      expect(page.state.role).toBe('user');
      expect(container.textContent).not.toContain('Administration');

      container.querySelector('.js-role-toggle').click();

      expect(page.state.role).toBe('ops');
      expect(store.get('role')).toBe('ops');
      expect(storage.get(STORAGE_KEYS.ROLE)).toBe('ops');
      expect(container.textContent).toContain('Administration');
      // Toggle button label
      expect(container.querySelector('.js-role-toggle').textContent.trim()).toBe('Ops');

      // Flip back
      container.querySelector('.js-role-toggle').click();
      expect(page.state.role).toBe('user');
      expect(container.textContent).not.toContain('Administration');
    });
  });

  describe('user menu', () => {
    it('clicking the avatar opens a dropdown with Profile / Switch User / Logout', async () => {
      const { container, page } = mount();
      await waitFor(() => !page.state.loading);

      expect(container.querySelector('.user-menu__dropdown')).toBeNull();
      container.querySelector('.js-user-avatar').click();
      expect(container.querySelector('.user-menu__dropdown')).toBeTruthy();
      expect(container.querySelector('.js-menu-profile')).toBeTruthy();
      expect(container.querySelector('.js-menu-switch-user')).toBeTruthy();
      expect(container.querySelector('.js-menu-logout')).toBeTruthy();
    });

    it('notifications button in the header navigates to /notifications', async () => {
      const { container, page } = mount();
      await waitFor(() => !page.state.loading);
      container.querySelector('.js-notifications-btn').click();
      expect(navSpy).toHaveBeenCalledWith('/notifications');
    });
  });
});
