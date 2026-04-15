const PREFIX = 'alignspace_';

export const storage = {
  get(key, defaultValue = null) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (raw === null) return defaultValue;
      return JSON.parse(raw);
    } catch {
      return defaultValue;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch (err) {
      console.error('[Storage] Failed to write:', err);
    }
  },

  remove(key) {
    localStorage.removeItem(PREFIX + key);
  },

  clear() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
  }
};

export const STORAGE_KEYS = {
  CURRENT_USER: 'current_user',
  ROLE: 'role',
  LOCK_TIMEOUT_MS: 'lock_timeout_ms',
  CHAT_SOUND: 'chat_sound',
  SIDEBAR_OPEN: 'sidebar_open',
  LAST_ROOM: 'last_room',
  NOTIFICATION_TOGGLES: 'notification_toggles',
  TEMPLATE_DEFAULTS: 'template_defaults'
};
