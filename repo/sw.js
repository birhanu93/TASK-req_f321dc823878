const CACHE_NAME = 'alignspace-v2';

const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/tokens.css',
  '/css/reset.css',
  '/css/layout.css',
  '/css/components.css',
  '/css/modules/auth.css',
  '/css/modules/rooms.css',
  '/css/modules/whiteboard.css',
  '/css/modules/sticky-notes.css',
  '/css/modules/chat.css',
  '/css/modules/presence.css',
  '/css/modules/activity-feed.css',
  '/css/modules/ops-console.css',
  '/css/modules/relationships.css',
  '/css/modules/meal-planner.css',
  '/css/modules/booking.css',
  '/css/modules/notifications.css',
  '/js/app.js',
  '/js/core/event-bus.js',
  '/js/core/store.js',
  '/js/core/router.js',
  '/js/core/db.js',
  '/js/core/storage.js',
  '/js/core/sync.js',
  '/js/core/autosave.js',
  '/js/core/component.js',
  '/js/core/utils.js',
  '/js/services/auth-service.js',
  '/js/services/room-service.js',
  '/js/services/whiteboard-service.js',
  '/js/services/sticky-service.js',
  '/js/services/chat-service.js',
  '/js/services/presence-service.js',
  '/js/services/activity-service.js',
  '/js/services/notification-service.js',
  '/js/services/ops-service.js',
  '/js/services/relationship-service.js',
  '/js/services/meal-service.js',
  '/js/services/booking-service.js',
  '/js/services/import-export-service.js',
  '/js/services/sensitive-word-service.js',
  '/js/ui/components/modal.js',
  '/js/ui/components/toast.js',
  '/js/ui/components/drawer.js',
  '/js/ui/components/confirm-dialog.js',
  '/js/ui/components/whiteboard.js',
  '/js/ui/pages/login-page.js',
  '/js/ui/pages/lock-page.js',
  '/js/ui/pages/room-list-page.js',
  '/js/ui/pages/room-page.js',
  '/js/ui/pages/ops-console-page.js',
  '/js/ui/pages/relationships-page.js',
  '/js/ui/pages/meal-planner-page.js',
  '/js/ui/pages/booking-page.js',
  '/js/ui/pages/notifications-page.js',
  '/js/workers/csv-worker.js',
  '/js/workers/snapshot-worker.js',
  '/js/workers/export-worker.js',
  '/js/workers/report-worker.js',
  '/data/nutrients.json'
];

// Install — cache all static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS_TO_CACHE))
      .then(() => self.skipWaiting())
      .catch(err => {
        console.warn('[SW] Pre-cache failed (some assets may not exist yet):', err);
        return self.skipWaiting();
      })
  );
});

// Activate — clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(
        names
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch — cache-first strategy for app assets
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip chrome-extension and other non-http
  const url = new URL(event.request.url);
  if (!url.protocol.startsWith('http')) return;

  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) return cached;
        return fetch(event.request)
          .then(response => {
            // Cache successful responses for app assets
            if (response.ok && url.origin === self.location.origin) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
            }
            return response;
          })
          .catch(() => {
            // For navigation requests, serve index.html from cache
            if (event.request.mode === 'navigate') {
              return caches.match('/index.html');
            }
            return new Response('Offline', { status: 503 });
          });
      })
  );
});

// Listen for messages from clients
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
