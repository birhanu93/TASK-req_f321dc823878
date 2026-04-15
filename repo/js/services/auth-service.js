import { db } from '../core/db.js';
import { bus } from '../core/event-bus.js';
import { store } from '../core/store.js';
import { storage, STORAGE_KEYS } from '../core/storage.js';
import { uuid, now } from '../core/utils.js';

const PBKDF2_ITERATIONS = 100000;
const SALT_BYTES = 16;
const KEY_LENGTH_BITS = 256;

/**
 * Derive a PBKDF2 key from a password and salt.
 * Returns a hex-encoded hash string.
 */
async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    KEY_LENGTH_BITS
  );
  return bufferToHex(new Uint8Array(bits));
}

function generateSalt() {
  return crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

function bufferToHex(buffer) {
  return Array.from(buffer).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuffer(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Create a new local profile.
 * @param {string} username - Unique username
 * @param {string} displayName - Display name
 * @param {string} password - Plain-text password (min 6 chars)
 * @returns {object} The created profile (without passwordHash/salt)
 */
export async function createProfile(username, displayName, password) {
  // Check for duplicate username
  const existing = await db.getByIndex('profiles', 'username', username);
  if (existing) {
    throw new Error('Username already taken');
  }

  const salt = generateSalt();
  const passwordHash = await hashPassword(password, salt);

  const profile = {
    id: uuid(),
    username,
    displayName,
    passwordHash,
    salt: bufferToHex(salt),
    createdAt: now(),
    updatedAt: now()
  };

  await db.put('profiles', profile);

  // Return a safe copy without secrets
  const { passwordHash: _, salt: __, ...safeProfile } = profile;
  return safeProfile;
}

/**
 * Authenticate a user by username + password.
 * Creates a session and sets the current user in store/storage.
 * @returns {object} The session and profile info
 */
export async function login(username, password) {
  const profile = await db.getByIndex('profiles', 'username', username);
  if (!profile) {
    throw new Error('Invalid username or password');
  }

  const salt = hexToBuffer(profile.salt);
  const hash = await hashPassword(password, salt);

  if (hash !== profile.passwordHash) {
    throw new Error('Invalid username or password');
  }

  // Create session
  const session = {
    id: uuid(),
    profileId: profile.id,
    locked: false,
    lastActivity: now(),
    createdAt: now()
  };

  await db.put('sessions', session);

  const currentUser = {
    id: profile.id,
    username: profile.username,
    displayName: profile.displayName,
    sessionId: session.id
  };

  store.set('currentUser', currentUser);
  store.set('locked', false);
  storage.set(STORAGE_KEYS.CURRENT_USER, currentUser);

  bus.emit('auth:login', currentUser);

  return { session, profile: currentUser };
}

/**
 * Get a profile by ID.
 * Returns the profile without sensitive fields.
 */
export async function getProfile(id) {
  const profile = await db.get('profiles', id);
  if (!profile) return null;

  const { passwordHash, salt, ...safeProfile } = profile;
  return safeProfile;
}

/**
 * Update profile fields (displayName, etc.).
 * Does not allow changing passwordHash/salt/id directly.
 */
export async function updateProfile(id, data) {
  const profile = await db.get('profiles', id);
  if (!profile) {
    throw new Error('Profile not found');
  }

  // Prevent overwriting sensitive fields via this method
  const { passwordHash, salt, id: _id, ...allowed } = data;

  Object.assign(profile, allowed, { updatedAt: now() });
  await db.put('profiles', profile);

  // If the updated profile is the current user, update store/storage
  const currentUser = store.get('currentUser');
  if (currentUser && currentUser.id === id) {
    const updatedUser = {
      ...currentUser,
      displayName: profile.displayName,
      username: profile.username
    };
    store.set('currentUser', updatedUser);
    storage.set(STORAGE_KEYS.CURRENT_USER, updatedUser);
  }

  const { passwordHash: _ph, salt: _s, ...safeProfile } = profile;
  return safeProfile;
}

/**
 * Get the current session from store, falling back to localStorage.
 * Returns null if no session exists.
 */
export function getCurrentSession() {
  let currentUser = store.get('currentUser');
  if (!currentUser) {
    currentUser = storage.get(STORAGE_KEYS.CURRENT_USER);
    if (currentUser) {
      store.set('currentUser', currentUser);
    }
  }
  return currentUser || null;
}

/**
 * Lock the current session (require password re-entry).
 */
export async function lockSession() {
  const currentUser = getCurrentSession();
  if (!currentUser) return;

  store.set('locked', true);

  // Update session record in DB
  if (currentUser.sessionId) {
    const session = await db.get('sessions', currentUser.sessionId);
    if (session) {
      session.locked = true;
      session.lastActivity = now();
      await db.put('sessions', session);
    }
  }

  bus.emit('auth:lock', { profileId: currentUser.id });
}

/**
 * Unlock the session by verifying the user's password.
 */
export async function unlockSession(password) {
  const currentUser = getCurrentSession();
  if (!currentUser) {
    throw new Error('No active session');
  }

  const profile = await db.get('profiles', currentUser.id);
  if (!profile) {
    throw new Error('Profile not found');
  }

  const salt = hexToBuffer(profile.salt);
  const hash = await hashPassword(password, salt);

  if (hash !== profile.passwordHash) {
    throw new Error('Incorrect password');
  }

  store.set('locked', false);

  // Update session record in DB
  if (currentUser.sessionId) {
    const session = await db.get('sessions', currentUser.sessionId);
    if (session) {
      session.locked = false;
      session.lastActivity = now();
      await db.put('sessions', session);
    }
  }

  bus.emit('auth:unlock', { profileId: currentUser.id });
}

/**
 * Log out the current user. Clears session data.
 */
export async function logout() {
  const currentUser = getCurrentSession();

  // Remove session from DB
  if (currentUser?.sessionId) {
    await db.delete('sessions', currentUser.sessionId);
  }

  store.set('currentUser', null);
  store.set('locked', false);
  storage.remove(STORAGE_KEYS.CURRENT_USER);

  bus.emit('auth:logout', { profileId: currentUser?.id });
}
