import { openDB, db } from '../js/core/db.js';
import { store } from '../js/core/store.js';
import { bus } from '../js/core/event-bus.js';

const ALL_STORES = [
  'profiles', 'sessions', 'rooms', 'whiteboardElements', 'comments',
  'stickyNotes', 'stickyGroups', 'chatMessages', 'presence', 'activityLogs',
  'snapshots', 'notifications', 'relationships', 'opsAnnouncements',
  'opsTemplates', 'opsSensitiveWords', 'opsRules', 'canaryFlags',
  'analyticsEvents', 'mealPlans', 'nutrientDb', 'bookings', 'bookingPolicies'
];

export async function resetDB() {
  await openDB();
  for (const s of ALL_STORES) {
    try { await db.clear(s); } catch { /* ok */ }
  }
}

export function resetStore() {
  const all = store.getAll();
  for (const key of Object.keys(all)) {
    store.delete(key);
  }
}

export function resetBus() {
  bus.clear();
}

export function setCurrentUser(user = { id: 'u1', username: 'testuser', displayName: 'Test User', sessionId: 's1' }) {
  store.set('currentUser', user);
  return user;
}

export async function resetAll() {
  await resetDB();
  resetStore();
  resetBus();
}
