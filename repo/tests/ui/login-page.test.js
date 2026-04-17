import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LoginPage } from '../../js/ui/pages/login-page.js';
import { router } from '../../js/core/router.js';
import { store } from '../../js/core/store.js';
import { createProfile } from '../../js/services/auth-service.js';
import { resetAll } from '../helpers.js';

function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const page = new LoginPage(container, {});
  page.mount();
  return { page, container };
}

describe('LoginPage (direct, real auth-service + real db)', () => {
  let navSpy;
  beforeEach(async () => {
    await resetAll();
    document.body.innerHTML = '';
    navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => {});
  });
  afterEach(() => {
    navSpy.mockRestore();
    document.body.innerHTML = '';
  });

  describe('render: initial sign-in mode', () => {
    it('renders the Sign In form by default with username and password fields and no display-name field', () => {
      const { container } = mount();
      expect(container.querySelector('.tab[data-mode="signin"]').classList.contains('tab--active')).toBe(true);
      expect(container.querySelector('.tab[data-mode="signup"]').classList.contains('tab--active')).toBe(false);
      expect(container.querySelector('#login-username')).toBeTruthy();
      expect(container.querySelector('#login-password')).toBeTruthy();
      expect(container.querySelector('#login-displayname')).toBeNull();
      expect(container.querySelector('button[type="submit"]').textContent.trim()).toBe('Sign In');
    });

    it('switches to signup mode when the Create Account tab is clicked, showing the display-name field', () => {
      const { container, page } = mount();
      container.querySelector('.tab[data-mode="signup"]').click();

      expect(page.state.mode).toBe('signup');
      expect(container.querySelector('#login-displayname')).toBeTruthy();
      expect(container.querySelector('button[type="submit"]').textContent.trim()).toBe('Create Account');
    });
  });

  describe('validation: input → error state', () => {
    it('renders an error banner when the form is submitted with no username', async () => {
      const { container } = mount();
      container.querySelector('#login-password').value = 'somepass';
      container.querySelector('#login-password').dispatchEvent(new Event('input'));
      container.querySelector('#auth-form').dispatchEvent(new Event('submit'));
      // setState re-renders synchronously
      const err = container.querySelector('[style*="--c-danger-light"]');
      expect(err?.textContent).toContain('Username is required');
    });

    it('renders an error banner when submitted with no password', () => {
      const { container } = mount();
      container.querySelector('#login-username').value = 'alice';
      container.querySelector('#login-username').dispatchEvent(new Event('input'));
      container.querySelector('#auth-form').dispatchEvent(new Event('submit'));
      const err = container.querySelector('[style*="--c-danger-light"]');
      expect(err?.textContent).toContain('Password is required');
    });

    it('signup mode rejects passwords shorter than 6 characters', () => {
      const { container, page } = mount();
      container.querySelector('.tab[data-mode="signup"]').click();
      container.querySelector('#login-username').value = 'alice';
      container.querySelector('#login-username').dispatchEvent(new Event('input'));
      container.querySelector('#login-password').value = 'short';
      container.querySelector('#login-password').dispatchEvent(new Event('input'));
      container.querySelector('#auth-form').dispatchEvent(new Event('submit'));
      expect(page.state.error).toContain('at least 6 characters');
    });
  });

  describe('successful sign-in: state transition + router navigation', () => {
    it('signs in an existing profile, sets currentUser in the store, and navigates to /rooms', async () => {
      await createProfile('alice', 'Alice', 'password123');

      const { container } = mount();
      container.querySelector('#login-username').value = 'alice';
      container.querySelector('#login-username').dispatchEvent(new Event('input'));
      container.querySelector('#login-password').value = 'password123';
      container.querySelector('#login-password').dispatchEvent(new Event('input'));

      container.querySelector('#auth-form').dispatchEvent(new Event('submit'));

      // Await the async login (a couple of microtask hops)
      for (let i = 0; i < 20 && !store.get('currentUser'); i++) {
        await new Promise(r => setTimeout(r, 5));
      }

      const user = store.get('currentUser');
      expect(user, 'currentUser must be populated after login').toBeTruthy();
      expect(user.username).toBe('alice');
      expect(user.displayName).toBe('Alice');
      expect(navSpy).toHaveBeenCalledWith('/rooms');
    });

    it('surfaces "Invalid username or password" on bad credentials, does not navigate', async () => {
      await createProfile('bob', 'Bob', 'password123');

      const { container, page } = mount();
      container.querySelector('#login-username').value = 'bob';
      container.querySelector('#login-username').dispatchEvent(new Event('input'));
      container.querySelector('#login-password').value = 'WRONG_password';
      container.querySelector('#login-password').dispatchEvent(new Event('input'));
      container.querySelector('#auth-form').dispatchEvent(new Event('submit'));

      for (let i = 0; i < 20 && !page.state.error; i++) {
        await new Promise(r => setTimeout(r, 5));
      }
      expect(page.state.error).toBe('Invalid username or password');
      expect(navSpy).not.toHaveBeenCalled();
      expect(store.get('currentUser')).toBeFalsy();
    });
  });

  describe('signup flow: creates profile then auto-logs-in', () => {
    it('creates a new profile and navigates to /rooms', async () => {
      const { container } = mount();
      container.querySelector('.tab[data-mode="signup"]').click();

      container.querySelector('#login-username').value = 'carol';
      container.querySelector('#login-username').dispatchEvent(new Event('input'));
      container.querySelector('#login-displayname').value = 'Carol Q';
      container.querySelector('#login-displayname').dispatchEvent(new Event('input'));
      container.querySelector('#login-password').value = 'super-secret';
      container.querySelector('#login-password').dispatchEvent(new Event('input'));

      container.querySelector('#auth-form').dispatchEvent(new Event('submit'));

      for (let i = 0; i < 30 && !store.get('currentUser'); i++) {
        await new Promise(r => setTimeout(r, 5));
      }

      const user = store.get('currentUser');
      expect(user?.username).toBe('carol');
      expect(user?.displayName).toBe('Carol Q');
      expect(navSpy).toHaveBeenCalledWith('/rooms');
    });
  });
});
