import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetAll, setCurrentUser } from '../helpers.js';
import { db } from '../../js/core/db.js';
import { store } from '../../js/core/store.js';
import { bus } from '../../js/core/event-bus.js';
import { storage, STORAGE_KEYS } from '../../js/core/storage.js';
import {
  createProfile,
  login,
  getProfile,
  updateProfile,
  getCurrentSession,
  lockSession,
  unlockSession,
  logout
} from '../../js/services/auth-service.js';

beforeEach(async () => {
  await resetAll();
});

describe('auth-service', () => {
  // ---------------------------------------------------------------
  // createProfile
  // ---------------------------------------------------------------
  describe('createProfile', () => {
    it('should create a profile and return safe fields', async () => {
      const result = await createProfile('alice', 'Alice A', 'secret123');
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('username', 'alice');
      expect(result).toHaveProperty('displayName', 'Alice A');
      expect(result).toHaveProperty('createdAt');
      expect(result).toHaveProperty('updatedAt');
      // Must not expose sensitive fields
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('salt');
    });

    it('should persist the profile in the database', async () => {
      const result = await createProfile('alice', 'Alice A', 'secret123');
      const stored = await db.get('profiles', result.id);
      expect(stored).toBeTruthy();
      expect(stored.username).toBe('alice');
      // DB record should contain sensitive fields
      expect(stored).toHaveProperty('passwordHash');
      expect(stored).toHaveProperty('salt');
    });

    it('should hash the password (not store plain-text)', async () => {
      const result = await createProfile('alice', 'Alice A', 'secret123');
      const stored = await db.get('profiles', result.id);
      expect(stored.passwordHash).not.toBe('secret123');
      expect(stored.passwordHash.length).toBeGreaterThan(0);
      expect(stored.salt.length).toBeGreaterThan(0);
    });

    it('should reject a duplicate username', async () => {
      await createProfile('alice', 'Alice A', 'secret123');
      await expect(createProfile('alice', 'Alice B', 'other456'))
        .rejects.toThrow('Username already taken');
    });
  });

  // ---------------------------------------------------------------
  // login
  // ---------------------------------------------------------------
  describe('login', () => {
    it('should succeed with correct credentials', async () => {
      await createProfile('bob', 'Bob B', 'pass1234');
      const { session, profile } = await login('bob', 'pass1234');
      expect(session).toHaveProperty('id');
      expect(session.locked).toBe(false);
      expect(profile.username).toBe('bob');
      expect(profile.displayName).toBe('Bob B');
    });

    it('should set store.currentUser on success', async () => {
      await createProfile('bob', 'Bob B', 'pass1234');
      await login('bob', 'pass1234');
      const currentUser = store.get('currentUser');
      expect(currentUser).toBeTruthy();
      expect(currentUser.username).toBe('bob');
      expect(currentUser).toHaveProperty('sessionId');
    });

    it('should persist session to localStorage', async () => {
      await createProfile('bob', 'Bob B', 'pass1234');
      await login('bob', 'pass1234');
      const stored = storage.get(STORAGE_KEYS.CURRENT_USER);
      expect(stored).toBeTruthy();
      expect(stored.username).toBe('bob');
    });

    it('should emit auth:login event', async () => {
      await createProfile('bob', 'Bob B', 'pass1234');
      const handler = vi.fn();
      bus.on('auth:login', handler);
      await login('bob', 'pass1234');
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].username).toBe('bob');
    });

    it('should reject invalid password', async () => {
      await createProfile('bob', 'Bob B', 'pass1234');
      await expect(login('bob', 'wrongpass'))
        .rejects.toThrow('Invalid username or password');
    });

    it('should reject non-existent username', async () => {
      await expect(login('nobody', 'pass1234'))
        .rejects.toThrow('Invalid username or password');
    });
  });

  // ---------------------------------------------------------------
  // getProfile
  // ---------------------------------------------------------------
  describe('getProfile', () => {
    it('should return profile without sensitive fields', async () => {
      const created = await createProfile('carol', 'Carol C', 'pw123456');
      const profile = await getProfile(created.id);
      expect(profile).toBeTruthy();
      expect(profile.username).toBe('carol');
      expect(profile).not.toHaveProperty('passwordHash');
      expect(profile).not.toHaveProperty('salt');
    });

    it('should return null for missing profile', async () => {
      const profile = await getProfile('nonexistent-id');
      expect(profile).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // updateProfile
  // ---------------------------------------------------------------
  describe('updateProfile', () => {
    it('should update allowed fields', async () => {
      const created = await createProfile('dave', 'Dave D', 'pw123456');
      const updated = await updateProfile(created.id, { displayName: 'Dave Updated' });
      expect(updated.displayName).toBe('Dave Updated');
      expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
    });

    it('should not allow overwriting passwordHash, salt, or id', async () => {
      const created = await createProfile('dave', 'Dave D', 'pw123456');
      await updateProfile(created.id, {
        passwordHash: 'hackedHash',
        salt: 'hackedSalt',
        id: 'hackedId'
      });
      const stored = await db.get('profiles', created.id);
      expect(stored.passwordHash).not.toBe('hackedHash');
      expect(stored.salt).not.toBe('hackedSalt');
      expect(stored.id).toBe(created.id);
    });

    it('should sync store for the current user', async () => {
      const created = await createProfile('dave', 'Dave D', 'pw123456');
      await login('dave', 'pw123456');
      await updateProfile(created.id, { displayName: 'Dave New' });
      const currentUser = store.get('currentUser');
      expect(currentUser.displayName).toBe('Dave New');
    });

    it('should throw for missing profile', async () => {
      await expect(updateProfile('nonexistent', { displayName: 'X' }))
        .rejects.toThrow('Profile not found');
    });
  });

  // ---------------------------------------------------------------
  // lockSession / unlockSession
  // ---------------------------------------------------------------
  describe('lockSession', () => {
    it('should set store.locked to true', async () => {
      await createProfile('eve', 'Eve E', 'pw123456');
      await login('eve', 'pw123456');
      await lockSession();
      expect(store.get('locked')).toBe(true);
    });

    it('should emit auth:lock event', async () => {
      await createProfile('eve', 'Eve E', 'pw123456');
      await login('eve', 'pw123456');
      const handler = vi.fn();
      bus.on('auth:lock', handler);
      await lockSession();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should update session record in DB', async () => {
      await createProfile('eve', 'Eve E', 'pw123456');
      const { session } = await login('eve', 'pw123456');
      await lockSession();
      const dbSession = await db.get('sessions', session.id);
      expect(dbSession.locked).toBe(true);
    });
  });

  describe('unlockSession', () => {
    it('should unlock with correct password', async () => {
      await createProfile('eve', 'Eve E', 'pw123456');
      await login('eve', 'pw123456');
      await lockSession();
      expect(store.get('locked')).toBe(true);
      await unlockSession('pw123456');
      expect(store.get('locked')).toBe(false);
    });

    it('should reject incorrect password', async () => {
      await createProfile('eve', 'Eve E', 'pw123456');
      await login('eve', 'pw123456');
      await lockSession();
      await expect(unlockSession('wrongpw'))
        .rejects.toThrow('Incorrect password');
    });

    it('should throw when no active session', async () => {
      await expect(unlockSession('pw123456'))
        .rejects.toThrow('No active session');
    });

    it('should emit auth:unlock event', async () => {
      await createProfile('eve', 'Eve E', 'pw123456');
      await login('eve', 'pw123456');
      await lockSession();
      const handler = vi.fn();
      bus.on('auth:unlock', handler);
      await unlockSession('pw123456');
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------
  // logout
  // ---------------------------------------------------------------
  describe('logout', () => {
    it('should clear store.currentUser and locked', async () => {
      await createProfile('frank', 'Frank F', 'pw123456');
      await login('frank', 'pw123456');
      await logout();
      expect(store.get('currentUser')).toBeNull();
      expect(store.get('locked')).toBe(false);
    });

    it('should remove session from DB', async () => {
      await createProfile('frank', 'Frank F', 'pw123456');
      const { session } = await login('frank', 'pw123456');
      await logout();
      const dbSession = await db.get('sessions', session.id);
      expect(dbSession).toBeUndefined();
    });

    it('should clear localStorage current user', async () => {
      await createProfile('frank', 'Frank F', 'pw123456');
      await login('frank', 'pw123456');
      await logout();
      const stored = storage.get(STORAGE_KEYS.CURRENT_USER);
      expect(stored).toBeNull();
    });

    it('should emit auth:logout event', async () => {
      await createProfile('frank', 'Frank F', 'pw123456');
      await login('frank', 'pw123456');
      const handler = vi.fn();
      bus.on('auth:logout', handler);
      await logout();
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------
  // getCurrentSession
  // ---------------------------------------------------------------
  describe('getCurrentSession', () => {
    it('should return currentUser from store', async () => {
      await createProfile('gina', 'Gina G', 'pw123456');
      await login('gina', 'pw123456');
      const session = getCurrentSession();
      expect(session).toBeTruthy();
      expect(session.username).toBe('gina');
    });

    it('should fall back to localStorage when store is empty', async () => {
      const user = { id: 'u99', username: 'cached', displayName: 'Cached', sessionId: 's99' };
      storage.set(STORAGE_KEYS.CURRENT_USER, user);
      // store is empty after resetAll, so getCurrentSession should check localStorage
      const session = getCurrentSession();
      expect(session).toBeTruthy();
      expect(session.username).toBe('cached');
      // Should also restore to store
      expect(store.get('currentUser')).toEqual(user);
    });

    it('should return null when no session exists anywhere', async () => {
      const session = getCurrentSession();
      expect(session).toBeNull();
    });
  });
});
