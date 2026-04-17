/**
 * High-fidelity E2E user journey: login → rooms → create room → enter room → logout.
 *
 * Uses the real router, the real auth/room/presence/ops/whiteboard/sticky/activity/chat
 * services, and real fake-indexeddb. No service mocks, no router navigate spy — navigation
 * actually changes `window.location.hash` and remounts page components into the same app
 * container, exactly like in a browser.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { router } from '../../js/core/router.js';
import { bus } from '../../js/core/event-bus.js';
import { store } from '../../js/core/store.js';
import { storage, STORAGE_KEYS } from '../../js/core/storage.js';
import { LoginPage } from '../../js/ui/pages/login-page.js';
import { LockPage } from '../../js/ui/pages/lock-page.js';
import { RoomListPage } from '../../js/ui/pages/room-list-page.js';
import { RoomPage } from '../../js/ui/pages/room-page.js';
import { NotificationsPage } from '../../js/ui/pages/notifications-page.js';
import { createProfile } from '../../js/services/auth-service.js';
import { resetAll } from '../helpers.js';

// jsdom needs ResizeObserver + canvas 2D context for the whiteboard component
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

// Route guards, copied from js/app.js (the same logic the shipped boot uses).
function requireAuth() {
  const user = store.get('currentUser');
  if (!user) return '/login';
  if (store.get('locked')) return '/lock';
  return null;
}
function requireGuest() {
  const user = store.get('currentUser');
  if (user && !store.get('locked')) return '/rooms';
  return null;
}
function requireLocked() {
  if (!store.get('currentUser')) return '/login';
  if (!store.get('locked')) return '/rooms';
  return null;
}

async function waitFor(pred, ms = 1000) {
  for (let i = 0; i < ms / 10; i++) {
    if (await pred()) return true;
    await new Promise(r => setTimeout(r, 10));
  }
  return false;
}

function currentPagePattern() {
  return window.location.hash.slice(1).split('/')[1] || '';
}

describe('E2E user journey (real router + real services + fake-indexeddb)', () => {
  let appContainer;

  beforeEach(async () => {
    await resetAll();
    bus.clear();
    document.body.innerHTML = '';
    appContainer = document.createElement('div');
    appContainer.id = 'app';
    document.body.appendChild(appContainer);

    history.replaceState(null, '', '/');
    // Start fresh — no user, no role
    store.delete('currentUser');
    store.delete('locked');
    store.delete('role');
    storage.remove(STORAGE_KEYS.CURRENT_USER);

    // Register the real routes with the real guards
    router.register('/login', (c, p) => new LoginPage(c, p), { guard: requireGuest });
    router.register('/lock', (c, p) => new LockPage(c, p), { guard: requireLocked });
    router.register('/rooms', (c, p) => new RoomListPage(c, p), { guard: requireAuth });
    router.register('/rooms/:id', (c, p) => new RoomPage(c, p), { guard: requireAuth });
    router.register('/notifications', (c, p) => new NotificationsPage(c, p), { guard: requireAuth });

    router.init(appContainer);
  });

  afterEach(() => {
    bus.clear();
    document.body.innerHTML = '';
    // Reset global nav state for isolation
    history.replaceState(null, '', '/');
  });

  it('walks login → rooms → create room → enter room → back to rooms → logout → login, asserting at each transition', async () => {
    // ─── Step 0: seed a real profile via the real auth service ───
    const profile = await createProfile('journeyuser', 'Journey User', 'correct-horse');

    // ─── Step 1: unauthenticated visit to #/rooms is redirected to #/login by the guard ───
    router.navigate('/rooms');
    await waitFor(() =>
      window.location.hash === '#/login' &&
      appContainer.querySelector('#auth-form') !== null
    );
    expect(window.location.hash).toBe('#/login');
    expect(appContainer.querySelector('#auth-form')).toBeTruthy();
    expect(appContainer.querySelector('#login-username')).toBeTruthy();

    // ─── Step 2: submit login form with correct credentials ───
    appContainer.querySelector('#login-username').value = 'journeyuser';
    appContainer.querySelector('#login-username').dispatchEvent(new Event('input'));
    appContainer.querySelector('#login-password').value = 'correct-horse';
    appContainer.querySelector('#login-password').dispatchEvent(new Event('input'));
    appContainer.querySelector('#auth-form').dispatchEvent(new Event('submit'));

    // Auth resolves, router navigates, hashchange fires, RoomListPage mounts.
    // Wait on the observable page render rather than the hash string.
    await waitFor(() =>
      window.location.hash === '#/rooms' &&
      appContainer.querySelector('.page-title')?.textContent === 'Rooms'
    );
    expect(window.location.hash).toBe('#/rooms');
    // State: currentUser populated
    const currentUser = store.get('currentUser');
    expect(currentUser?.username).toBe('journeyuser');
    expect(currentUser?.id).toBe(profile.id);
    // UI: RoomListPage rendered with empty state (loading may finish a tick later)
    await waitFor(() => appContainer.querySelector('.empty-state__title')?.textContent === 'No rooms yet');
    expect(appContainer.querySelector('.empty-state__title').textContent).toBe('No rooms yet');

    // ─── Step 3: create a room via the create-room modal in the real page ───
    appContainer.querySelector('.js-create-room').click();
    await waitFor(() => document.querySelector('#create-room-form') !== null);

    document.querySelector('#room-name').value = 'Journey Room';
    document.querySelector('#room-description').value = 'Walk-through room';
    document.querySelector('.js-confirm-create').click();

    // After submit: room is persisted, modal closes, router navigates to /rooms/:id
    await waitFor(() =>
      /^#\/rooms\/[^/]+$/.test(window.location.hash) &&
      appContainer.querySelector('.room-header__name') !== null
    );
    const createdRoomId = window.location.hash.match(/^#\/rooms\/(.+)$/)[1];
    expect(createdRoomId).toBeTruthy();

    // The RoomPage should be mounted and loaded
    await waitFor(() => appContainer.querySelector('.room-header__name'));
    expect(appContainer.querySelector('.room-header__name').textContent).toBe('Journey Room');
    // Whiteboard / Stickies / Activity tabs are rendered
    const tabs = Array.from(appContainer.querySelectorAll('.js-tab')).map(t => t.dataset.tab);
    expect(tabs).toEqual(['whiteboard', 'stickies', 'activity']);
    // The whiteboard container was mounted by the real component
    expect(appContainer.querySelector('.wb-toolbar')).toBeTruthy();

    // ─── Step 4: switch to the Stickies tab (state transition without re-route) ───
    appContainer.querySelector('.js-tab[data-tab="stickies"]').click();
    const active = appContainer.querySelector('.room-sidebar__tab--active');
    expect(active.dataset.tab).toBe('stickies');
    // Still the same route (no hash change)
    expect(window.location.hash).toBe(`#/rooms/${createdRoomId}`);

    // ─── Step 5: back to room list via the back button (hash change) ───
    appContainer.querySelector('.room-header__back.js-back-to-rooms').click();
    await waitFor(() =>
      window.location.hash === '#/rooms' &&
      appContainer.querySelector('.page-title')?.textContent === 'Rooms'
    );
    expect(window.location.hash).toBe('#/rooms');

    // The room we created appears in the list (real service read)
    await waitFor(() => appContainer.querySelectorAll('.room-card').length === 1);
    expect(appContainer.querySelector('.room-card__name').textContent).toBe('Journey Room');
    expect(appContainer.querySelector('.page-subtitle').textContent).toBe('1 room');

    // ─── Step 6: logout via the avatar menu ───
    appContainer.querySelector('.js-user-avatar').click();
    await waitFor(() => appContainer.querySelector('.js-menu-logout') !== null);
    appContainer.querySelector('.js-menu-logout').click();

    await waitFor(() =>
      window.location.hash === '#/login' &&
      appContainer.querySelector('#auth-form') !== null
    );
    expect(window.location.hash).toBe('#/login');
    expect(store.get('currentUser')).toBeFalsy();
    // LoginPage re-rendered
    expect(appContainer.querySelector('#auth-form')).toBeTruthy();

    // ─── Step 7: guest trying #/rooms again gets redirected to #/login (closure of the loop) ───
    router.navigate('/rooms');
    await waitFor(() =>
      window.location.hash === '#/login' &&
      appContainer.querySelector('#auth-form') !== null
    );
    expect(window.location.hash).toBe('#/login');
  });

  it('signing in with a bad password keeps the user on #/login with an inline error', async () => {
    await createProfile('e2euser', 'E2E', 'password-ok-123');

    router.navigate('/login');
    await waitFor(() => appContainer.querySelector('#auth-form') !== null);

    appContainer.querySelector('#login-username').value = 'e2euser';
    appContainer.querySelector('#login-username').dispatchEvent(new Event('input'));
    appContainer.querySelector('#login-password').value = 'WRONG';
    appContainer.querySelector('#login-password').dispatchEvent(new Event('input'));
    appContainer.querySelector('#auth-form').dispatchEvent(new Event('submit'));

    await waitFor(() => appContainer.textContent.includes('Invalid username or password'));
    expect(window.location.hash).toBe('#/login');
    expect(store.get('currentUser')).toBeFalsy();
  });
});
