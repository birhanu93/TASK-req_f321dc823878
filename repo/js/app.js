import { openDB } from './core/db.js';
import { bus } from './core/event-bus.js';
import { store } from './core/store.js';
import { router } from './core/router.js';
import { storage, STORAGE_KEYS } from './core/storage.js';
import { sync } from './core/sync.js';
import { autosave } from './core/autosave.js';
import { db } from './core/db.js';

import { Modal } from './ui/components/modal.js';
import { Toast } from './ui/components/toast.js';
import { Drawer } from './ui/components/drawer.js';

import { presenceService } from './services/presence-service.js';
import { sensitiveWordService } from './services/sensitive-word-service.js';
import { mealService } from './services/meal-service.js';

import { LoginPage } from './ui/pages/login-page.js';
import { LockPage } from './ui/pages/lock-page.js';
import { RoomListPage } from './ui/pages/room-list-page.js';
import { RoomPage } from './ui/pages/room-page.js';
import { OpsConsolePage } from './ui/pages/ops-console-page.js';
import { RelationshipsPage } from './ui/pages/relationships-page.js';
import { MealPlannerPage } from './ui/pages/meal-planner-page.js';
import { BookingPage } from './ui/pages/booking-page.js';
import { NotificationsPage } from './ui/pages/notifications-page.js';

// Inject component styles
function injectStyles() {
  const styleEl = document.getElementById('dynamic-styles');
  styleEl.textContent = [
    Modal.styles,
    Toast.styles,
    Drawer.styles
  ].join('\n');
}

// Auth guard
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

function requireOps() {
  const authRedirect = requireAuth();
  if (authRedirect) return authRedirect;
  const role = store.get('role') || storage.get(STORAGE_KEYS.ROLE, 'user');
  if (role !== 'ops') return '/rooms';
  return null;
}

// Idle detection for lock screen
let idleTimer = null;
const LOCK_TIMEOUT = 20 * 60 * 1000; // 20 minutes

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  if (!store.get('currentUser') || store.get('locked')) return;
  idleTimer = setTimeout(() => {
    store.set('locked', true);
    router.navigate('/lock');
    bus.emit('auth:lock');
  }, LOCK_TIMEOUT);
}

function initIdleDetection() {
  const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
  events.forEach(evt => {
    document.addEventListener(evt, resetIdleTimer, { passive: true });
  });
  resetIdleTimer();
}

// Autosave flush handler
async function handleAutosaveFlush(batch) {
  for (const [storeName, items] of batch) {
    const records = [...items.values()];
    await db.putBatch(storeName, records);
    sync.broadcast({ type: 'db-change', store: storeName, keys: records.map(r => r.id) });
  }
}

// Multi-tab sync consumer: when another tab writes to IDB, reconcile local state
export function initSyncConsumer() {
  bus.on('sync:remote', (msg) => {
    if (msg.type !== 'db-change') return;
    const s = msg.store;
    const currentRoom = store.get('currentRoom');
    const roomId = msg.roomId || msg.data?.roomId;

    // Presence changes — re-emit so room-page picks them up
    if (s === 'presence') {
      bus.emit(`presence:${msg.action || 'update'}`, msg);
      return;
    }

    // Chat messages from other tabs
    if (s === 'chatMessages' && msg.action === 'add' && currentRoom?.id === roomId) {
      // Fetch the new message and re-emit so room-page chat appends it
      db.get('chatMessages', msg.id).then(m => {
        if (m) bus.emit('chat:message', m);
      }).catch(() => {});
      return;
    }

    // Whiteboard / sticky changes from other tabs
    if ((s === 'whiteboardElements' || s === 'stickyNotes' || s === 'stickyGroups' ||
         s === 'comments') && currentRoom?.id === roomId) {
      bus.emit(`sync:${s}:refresh`, { action: msg.action, id: msg.id || msg.key, roomId });
      return;
    }

    // Notifications
    if (s === 'notifications') {
      bus.emit('notification:new', msg.data || {});
      return;
    }

    // Room-level changes (import, rollback)
    if (s === 'rooms' && (msg.action === 'import' || msg.action === 'rollback') &&
        currentRoom?.id === (msg.key || roomId)) {
      bus.emit('room:remote-refresh', { roomId: msg.key || roomId, action: msg.action });
      return;
    }
  });
}

// Register routes
function registerRoutes() {
  router.register('/login', (c, p) => new LoginPage(c, p), { guard: requireGuest });
  router.register('/lock', (c, p) => new LockPage(c, p), { guard: requireLocked });
  router.register('/rooms', (c, p) => new RoomListPage(c, p), { guard: requireAuth });
  router.register('/rooms/:id', (c, p) => new RoomPage(c, p), { guard: requireAuth });
  router.register('/ops', (c, p) => new OpsConsolePage(c, p), { guard: requireOps });
  router.register('/ops/:section', (c, p) => new OpsConsolePage(c, p), { guard: requireOps });
  router.register('/relationships', (c, p) => new RelationshipsPage(c, p), { guard: requireAuth });
  router.register('/meals', (c, p) => new MealPlannerPage(c, p), { guard: requireAuth });
  router.register('/bookings', (c, p) => new BookingPage(c, p), { guard: requireAuth });
  router.register('/notifications', (c, p) => new NotificationsPage(c, p), { guard: requireAuth });
}

// Service Worker registration
async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/sw.js');
    } catch (err) {
      console.warn('[SW] Registration failed:', err);
    }
  }
}

// Boot
async function boot() {
  try {
    await openDB();
    injectStyles();

    // Restore session from storage
    const savedUser = storage.get(STORAGE_KEYS.CURRENT_USER);
    if (savedUser) {
      store.set('currentUser', savedUser);
    }
    store.set('role', storage.get(STORAGE_KEYS.ROLE, 'user'));
    store.set('locked', false);

    // Initialize systems
    sync.init();
    autosave.init(handleAutosaveFlush);
    initIdleDetection();
    presenceService.init();
    sensitiveWordService.loadWords().catch(err =>
      console.warn('[App] Failed to preload sensitive words:', err)
    );
    mealService.initNutrientDb().catch(err => {
      console.warn('[App] Failed to seed nutrient database:', err);
      bus.emit('nutrient:init-failed', { error: err.message || 'Unknown error' });
    });
    initSyncConsumer();

    // Register routes and start
    const appContainer = document.getElementById('app');
    registerRoutes();
    router.init(appContainer);

    // Default route
    if (!window.location.hash) {
      router.navigate(savedUser ? '/rooms' : '/login');
    }

    // Register service worker
    registerServiceWorker();

    bus.emit('app:ready');
  } catch (err) {
    console.error('[App] Boot failed:', err);
    document.getElementById('app').innerHTML = `
      <div class="centered-page">
        <div class="centered-card" style="text-align: center">
          <h1 style="font-size: var(--text-2xl); font-weight: var(--fw-bold); margin-bottom: var(--sp-4); color: var(--c-danger)">Failed to Start</h1>
          <p style="color: var(--c-text-secondary); margin-bottom: var(--sp-4)">${err.message}</p>
          <button class="btn btn--primary" onclick="location.reload()">Retry</button>
        </div>
      </div>
    `;
  }
}

// Only boot when running in a browser (not during test imports)
if (typeof document !== 'undefined' && document.getElementById('app')) {
  boot();
}
