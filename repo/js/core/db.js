const DB_NAME = 'alignspace_db';
const DB_VERSION = 1;

let dbInstance = null;

const MIGRATIONS = [
  // Version 1 — initial schema
  (db) => {
    // Profiles
    const profiles = db.createObjectStore('profiles', { keyPath: 'id' });
    profiles.createIndex('username', 'username', { unique: true });

    // Sessions
    const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
    sessions.createIndex('profileId', 'profileId');
    sessions.createIndex('lastActivity', 'lastActivity');

    // Rooms
    const rooms = db.createObjectStore('rooms', { keyPath: 'id' });
    rooms.createIndex('name', 'name');
    rooms.createIndex('createdBy', 'createdBy');
    rooms.createIndex('updatedAt', 'updatedAt');

    // Whiteboard Elements
    const wbElements = db.createObjectStore('whiteboardElements', { keyPath: 'id' });
    wbElements.createIndex('roomId', 'roomId');
    wbElements.createIndex('roomId_type', ['roomId', 'type']);
    wbElements.createIndex('updatedAt', 'updatedAt');

    // Comments
    const comments = db.createObjectStore('comments', { keyPath: 'id' });
    comments.createIndex('elementId', 'elementId');
    comments.createIndex('elementId_createdAt', ['elementId', 'createdAt']);
    comments.createIndex('roomId', 'roomId');
    comments.createIndex('parentId', 'parentId');

    // Sticky Notes
    const stickyNotes = db.createObjectStore('stickyNotes', { keyPath: 'id' });
    stickyNotes.createIndex('roomId', 'roomId');
    stickyNotes.createIndex('groupId', 'groupId');
    stickyNotes.createIndex('roomId_groupId', ['roomId', 'groupId']);
    stickyNotes.createIndex('updatedAt', 'updatedAt');

    // Sticky Groups
    const stickyGroups = db.createObjectStore('stickyGroups', { keyPath: 'id' });
    stickyGroups.createIndex('roomId', 'roomId');

    // Chat Messages
    const chatMessages = db.createObjectStore('chatMessages', { keyPath: 'id' });
    chatMessages.createIndex('roomId', 'roomId');
    chatMessages.createIndex('roomId_createdAt', ['roomId', 'createdAt']);
    chatMessages.createIndex('authorId', 'authorId');

    // Presence
    const presence = db.createObjectStore('presence', { keyPath: 'tabId' });
    presence.createIndex('roomId', 'roomId');
    presence.createIndex('profileId', 'profileId');

    // Activity Logs
    const activityLogs = db.createObjectStore('activityLogs', { keyPath: 'id' });
    activityLogs.createIndex('roomId', 'roomId');
    activityLogs.createIndex('roomId_createdAt', ['roomId', 'createdAt']);
    activityLogs.createIndex('action', 'action');

    // Snapshots
    const snapshots = db.createObjectStore('snapshots', { keyPath: 'id' });
    snapshots.createIndex('roomId', 'roomId');
    snapshots.createIndex('roomId_createdAt', ['roomId', 'createdAt']);

    // Notifications
    const notifications = db.createObjectStore('notifications', { keyPath: 'id' });
    notifications.createIndex('profileId', 'profileId');
    notifications.createIndex('profileId_createdAt', ['profileId', 'createdAt']);
    notifications.createIndex('read', 'read');

    // Relationships
    const relationships = db.createObjectStore('relationships', { keyPath: 'id' });
    relationships.createIndex('fromId', 'fromId');
    relationships.createIndex('toId', 'toId');
    relationships.createIndex('fromId_status', ['fromId', 'status']);
    relationships.createIndex('type', 'type');

    // Ops - Announcements
    const opsAnnouncements = db.createObjectStore('opsAnnouncements', { keyPath: 'id' });
    opsAnnouncements.createIndex('active', 'active');
    opsAnnouncements.createIndex('createdAt', 'createdAt');

    // Ops - Templates
    db.createObjectStore('opsTemplates', { keyPath: 'id' });

    // Ops - Sensitive Words
    const opsSensitiveWords = db.createObjectStore('opsSensitiveWords', { keyPath: 'id' });
    opsSensitiveWords.createIndex('word', 'word', { unique: true });

    // Ops - Rules
    db.createObjectStore('opsRules', { keyPath: 'id' });

    // Canary Flags
    db.createObjectStore('canaryFlags', { keyPath: 'key' });

    // Analytics Events
    const analyticsEvents = db.createObjectStore('analyticsEvents', { keyPath: 'id' });
    analyticsEvents.createIndex('event', 'event');
    analyticsEvents.createIndex('event_timestamp', ['event', 'timestamp']);
    analyticsEvents.createIndex('sessionId', 'sessionId');

    // Meal Plans
    const mealPlans = db.createObjectStore('mealPlans', { keyPath: 'id' });
    mealPlans.createIndex('profileId', 'profileId');
    mealPlans.createIndex('date', 'date');
    mealPlans.createIndex('profileId_date', ['profileId', 'date']);

    // Nutrient Database
    const nutrientDb = db.createObjectStore('nutrientDb', { keyPath: 'id' });
    nutrientDb.createIndex('name', 'name');
    nutrientDb.createIndex('barcode', 'barcode');

    // Bookings
    const bookings = db.createObjectStore('bookings', { keyPath: 'id' });
    bookings.createIndex('profileId', 'profileId');
    bookings.createIndex('status', 'status');
    bookings.createIndex('profileId_status', ['profileId', 'status']);
    bookings.createIndex('updatedAt', 'updatedAt');

    // Booking Policies
    db.createObjectStore('bookingPolicies', { keyPath: 'id' });
  }
];

export async function openDB() {
  if (dbInstance) return dbInstance;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      for (let i = event.oldVersion; i < event.newVersion; i++) {
        if (MIGRATIONS[i]) MIGRATIONS[i](db);
      }
    };
    request.onsuccess = () => {
      dbInstance = request.result;
      dbInstance.onversionchange = () => {
        dbInstance.close();
        dbInstance = null;
      };
      resolve(dbInstance);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getDB() {
  if (!dbInstance) await openDB();
  return dbInstance;
}

function tx(storeName, mode = 'readonly') {
  return getDB().then(db => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    return { transaction, store };
  });
}

function txMulti(storeNames, mode = 'readonly') {
  return getDB().then(db => {
    const transaction = db.transaction(storeNames, mode);
    const stores = {};
    for (const name of storeNames) {
      stores[name] = transaction.objectStore(name);
    }
    return { transaction, stores };
  });
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const db = {
  async put(storeName, data) {
    const { store } = await tx(storeName, 'readwrite');
    return promisify(store.put(data));
  },

  async add(storeName, data) {
    const { store } = await tx(storeName, 'readwrite');
    return promisify(store.add(data));
  },

  async get(storeName, key) {
    const { store } = await tx(storeName);
    return promisify(store.get(key));
  },

  async getAll(storeName) {
    const { store } = await tx(storeName);
    return promisify(store.getAll());
  },

  async getAllByIndex(storeName, indexName, value) {
    const { store } = await tx(storeName);
    const index = store.index(indexName);
    const range = IDBKeyRange.only(value);
    return promisify(index.getAll(range));
  },

  async getAllByRange(storeName, indexName, lower, upper) {
    const { store } = await tx(storeName);
    const index = store.index(indexName);
    const range = IDBKeyRange.bound(
      lower, upper,
      false, false
    );
    return promisify(index.getAll(range));
  },

  async getByIndex(storeName, indexName, value) {
    const { store } = await tx(storeName);
    const index = store.index(indexName);
    return promisify(index.get(value));
  },

  async delete(storeName, key) {
    const { store } = await tx(storeName, 'readwrite');
    return promisify(store.delete(key));
  },

  async clear(storeName) {
    const { store } = await tx(storeName, 'readwrite');
    return promisify(store.clear());
  },

  async count(storeName, indexName, value) {
    const { store } = await tx(storeName);
    if (indexName && value !== undefined) {
      const index = store.index(indexName);
      return promisify(index.count(IDBKeyRange.only(value)));
    }
    return promisify(store.count());
  },

  async putBatch(storeName, items) {
    const { store, transaction } = await tx(storeName, 'readwrite');
    for (const item of items) {
      store.put(item);
    }
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  },

  async deleteBatch(storeName, keys) {
    const { store, transaction } = await tx(storeName, 'readwrite');
    for (const key of keys) {
      store.delete(key);
    }
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  },

  async getAllSorted(storeName, indexName, direction = 'next', limit) {
    const { store } = await tx(storeName);
    const source = indexName ? store.index(indexName) : store;
    return new Promise((resolve, reject) => {
      const results = [];
      const request = source.openCursor(null, direction);
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && (!limit || results.length < limit)) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error);
    });
  },

  async transaction(storeNames, mode, callback) {
    const { transaction, stores } = await txMulti(storeNames, mode);
    callback(stores, transaction);
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }
};
