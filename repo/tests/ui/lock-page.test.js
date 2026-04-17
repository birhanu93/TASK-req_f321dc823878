import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LockPage } from '../../js/ui/pages/lock-page.js';
import { router } from '../../js/core/router.js';
import { store } from '../../js/core/store.js';
import { createProfile, login, lockSession } from '../../js/services/auth-service.js';
import { resetAll } from '../helpers.js';

function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const page = new LockPage(container, {});
  page.mount();
  return { page, container };
}

async function waitUntil(pred, ms = 200) {
  for (let i = 0; i < ms / 5; i++) {
    if (pred()) return;
    await new Promise(r => setTimeout(r, 5));
  }
}

describe('LockPage (real auth-service, real db)', () => {
  let navSpy;
  beforeEach(async () => {
    await resetAll();
    document.body.innerHTML = '';
    navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => {});
    // Seed + lock a real user
    await createProfile('dana', 'Dana', 'password123');
    await login('dana', 'password123');
    await lockSession();
  });
  afterEach(() => {
    navSpy.mockRestore();
    document.body.innerHTML = '';
  });

  describe('render', () => {
    it('shows the locked user\'s display name and avatar letter', () => {
      const { container } = mount();
      // Avatar letter is first char of display name ("D")
      const avatar = container.querySelector('.avatar');
      expect(avatar.textContent.trim()).toBe('D');
      // Display name heading
      const heading = container.querySelector('h2');
      expect(heading.textContent.trim()).toBe('Dana');
      // Subtext
      expect(container.textContent).toContain('Session locked');
    });

    it('renders a password input and an Unlock button', () => {
      const { container } = mount();
      expect(container.querySelector('#lock-password')).toBeTruthy();
      expect(container.querySelector('button[type="submit"]').textContent.trim()).toBe('Unlock');
      expect(container.querySelector('#switch-user-btn')).toBeTruthy();
    });
  });

  describe('unlock flow', () => {
    it('rejects an empty password with an inline error and does not navigate', async () => {
      const { container, page } = mount();
      container.querySelector('#unlock-form').dispatchEvent(new Event('submit'));
      await waitUntil(() => page.state.error);
      expect(page.state.error).toBe('Password is required');
      expect(navSpy).not.toHaveBeenCalled();
      expect(store.get('locked')).toBe(true);
    });

    it('rejects the wrong password with an inline error, keeps session locked, clears password field', async () => {
      const { container, page } = mount();
      container.querySelector('#lock-password').value = 'not-the-password';
      container.querySelector('#lock-password').dispatchEvent(new Event('input'));
      container.querySelector('#unlock-form').dispatchEvent(new Event('submit'));

      await waitUntil(() => page.state.error);
      expect(page.state.error).toBe('Incorrect password');
      expect(page.state.password).toBe('');
      expect(store.get('locked')).toBe(true);
      expect(navSpy).not.toHaveBeenCalled();
    });

    it('unlocks and navigates to /rooms on correct password (locked → unlocked transition)', async () => {
      const { container } = mount();
      expect(store.get('locked')).toBe(true);

      container.querySelector('#lock-password').value = 'password123';
      container.querySelector('#lock-password').dispatchEvent(new Event('input'));
      container.querySelector('#unlock-form').dispatchEvent(new Event('submit'));

      // navigate fires after unlockSession resolves, so waiting for navSpy guarantees
      // the full handler completed
      await waitUntil(() => navSpy.mock.calls.length > 0);
      expect(store.get('locked')).toBe(false);
      expect(navSpy).toHaveBeenCalledWith('/rooms');
    });
  });

  describe('switch user', () => {
    it('Switch User button logs out and navigates to /login', async () => {
      const { container } = mount();
      container.querySelector('#switch-user-btn').click();

      await waitUntil(() => !store.get('currentUser'));
      expect(store.get('currentUser')).toBeFalsy();
      expect(navSpy).toHaveBeenCalledWith('/login');
    });
  });
});
