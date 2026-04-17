import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { router } from '../../js/core/router.js';
import { bus } from '../../js/core/event-bus.js';
import { Component } from '../../js/core/component.js';

// Tiny page component — records lifecycle for assertion
function makeRecordingComponent(tag) {
  return class extends Component {
    mount() { super.mount(); this._mounted = true; }
    render() { this.container.innerHTML = `<section data-page="${tag}">page:${tag}</section>`; }
    destroy() { this._mounted = false; super.destroy(); }
  };
}

function resetHash(hash = '#/init') {
  // Directly mutate the hash without firing events (router will read current on init/onHashChange)
  history.replaceState(null, '', hash);
}

async function navigateHash(hash) {
  // Manually set the hash; jsdom fires 'hashchange' asynchronously so the caller
  // awaits one microtask/timer tick before reading the DOM.
  const target = hash.startsWith('#') ? hash : `#${hash}`;
  const previous = window.location.hash;
  window.location.hash = target;
  if (previous === window.location.hash) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
  await new Promise(r => setTimeout(r, 0));
}

describe('core/router (direct, real hashchange dispatch)', () => {
  let appContainer;

  beforeEach(() => {
    // Clean bus subscribers, routes array, and DOM
    bus.clear();
    document.body.innerHTML = '';
    appContainer = document.createElement('div');
    appContainer.id = 'app';
    document.body.appendChild(appContainer);

    // Reset the router's internal routes registry — the module keeps a private `routes` array
    // and there is no public reset. Re-importing is handled once per test file. Clearing its
    // backing array via the module's own `register` calls is not supported, so every test uses
    // disjoint patterns and reads back via the current hash.
    resetHash('#/never-matched-initial');
  });

  afterEach(() => {
    bus.clear();
    document.body.innerHTML = '';
  });

  describe('path parsing + param extraction', () => {
    it('matches a literal path and mounts the registered component into the app container', () => {
      const Page = makeRecordingComponent('home');
      router.register('/home-1', (container, params) => new Page(container, params));

      resetHash('#/home-1');
      router.init(appContainer);

      const section = appContainer.querySelector('[data-page="home"]');
      expect(section, 'page component must have been mounted').toBeTruthy();
      expect(section.textContent).toBe('page:home');
    });

    it('extracts URL-decoded named params (:id) and passes them to the factory', () => {
      let capturedParams = null;
      class P extends Component {
        render() { this.container.innerHTML = `<div data-id="${this.props.id}"></div>`; }
      }
      router.register('/rooms-1/:id', (container, params) => {
        capturedParams = params;
        return new P(container, params);
      });

      resetHash('#/rooms-1/room%20with%20space');
      router.init(appContainer);

      expect(capturedParams).toEqual({ id: 'room with space' });
      expect(appContainer.querySelector('[data-id]').dataset.id).toBe('room with space');
      expect(router.getCurrentParams()).toEqual({ id: 'room with space' });
    });

    it('getCurrentPath() returns the current hash path or defaults to /login when empty', () => {
      resetHash('#/foo/bar');
      expect(router.getCurrentPath()).toBe('/foo/bar');

      // No hash → default is '/login'
      history.replaceState(null, '', window.location.pathname);
      expect(router.getCurrentPath()).toBe('/login');
    });
  });

  describe('guard redirects', () => {
    it('redirects to the guard-returned path before mounting the component', () => {
      const Protected = makeRecordingComponent('protected');
      const PublicPage = makeRecordingComponent('login-page');

      router.register('/login-2', (c, p) => new PublicPage(c, p));
      router.register('/protected-2', (c, p) => new Protected(c, p), {
        guard: () => '/login-2' // always redirect
      });

      resetHash('#/protected-2');
      router.init(appContainer);

      // Landed on the redirect target, NOT the protected page
      expect(appContainer.querySelector('[data-page="login-page"]')).toBeTruthy();
      expect(appContainer.querySelector('[data-page="protected"]')).toBeNull();
      expect(window.location.hash).toBe('#/login-2');
    });

    it('allows the route through when the guard returns falsy', () => {
      const Secret = makeRecordingComponent('secret');
      router.register('/secret-3', (c, p) => new Secret(c, p), { guard: () => null });

      resetHash('#/secret-3');
      router.init(appContainer);

      expect(appContainer.querySelector('[data-page="secret"]')).toBeTruthy();
    });
  });

  describe('transition: destroy previous, emit route:change, mount next', () => {
    it('destroys the previous component and mounts the new one on hash change, emitting route:change with path + pattern', async () => {
      const destroyOrder = [];
      class A extends Component {
        render() { this.container.innerHTML = '<div data-page="A"></div>'; }
        destroy() { destroyOrder.push('A'); super.destroy(); }
      }
      class B extends Component {
        render() { this.container.innerHTML = '<div data-page="B"></div>'; }
      }

      router.register('/a-4', (c, p) => new A(c, p));
      router.register('/b-4', (c, p) => new B(c, p));

      const emitted = [];
      bus.on('route:change', (e) => emitted.push(e));

      resetHash('#/a-4');
      router.init(appContainer);
      expect(appContainer.querySelector('[data-page="A"]')).toBeTruthy();

      await navigateHash('/b-4');
      expect(destroyOrder).toEqual(['A']);
      expect(appContainer.querySelector('[data-page="A"]')).toBeNull();
      expect(appContainer.querySelector('[data-page="B"]')).toBeTruthy();

      // route:change fired twice: once for init, once for navigation
      expect(emitted.length).toBeGreaterThanOrEqual(2);
      const last = emitted[emitted.length - 1];
      expect(last.path).toBe('/b-4');
      expect(last.pattern).toBe('/b-4');
      expect(last.params).toEqual({});
    });
  });

  describe('404 fallback', () => {
    it('renders the 404 fragment when no route matches and offers a "Go to Rooms" link', () => {
      // Use a hash that no route in any suite has registered
      resetHash('#/this-route-definitely-does-not-exist-404-5');
      router.init(appContainer);

      expect(appContainer.textContent).toContain('404');
      expect(appContainer.textContent).toContain('Page not found');
      expect(appContainer.querySelector('a[href="#/rooms"]')).toBeTruthy();
    });
  });

  describe('navigate() vs replace()', () => {
    it('navigate() updates window.location.hash, replace() uses history.replaceState (no extra history entry, still triggers render)', async () => {
      const PageA = makeRecordingComponent('nav-a');
      const PageB = makeRecordingComponent('nav-b');
      router.register('/nav-a-6', (c, p) => new PageA(c, p));
      router.register('/nav-b-6', (c, p) => new PageB(c, p));

      resetHash('#/nav-a-6');
      router.init(appContainer);
      expect(appContainer.querySelector('[data-page="nav-a"]')).toBeTruthy();

      router.navigate('/nav-b-6');
      // jsdom fires hashchange asynchronously — wait a tick before asserting
      await new Promise(r => setTimeout(r, 0));
      expect(window.location.hash).toBe('#/nav-b-6');
      expect(appContainer.querySelector('[data-page="nav-b"]')).toBeTruthy();

      router.replace('/nav-a-6');
      await new Promise(r => setTimeout(r, 0));
      expect(window.location.hash).toBe('#/nav-a-6');
      expect(appContainer.querySelector('[data-page="nav-a"]')).toBeTruthy();
    });

    it('navigate() to the current hash re-runs _onHashChange (idempotent remount path)', async () => {
      let mountCount = 0;
      class P extends Component {
        mount() { super.mount(); mountCount++; }
        render() { this.container.innerHTML = '<div data-page="idem"></div>'; }
      }
      router.register('/idem-7', (c, p) => new P(c, p));

      resetHash('#/idem-7');
      router.init(appContainer);
      expect(mountCount).toBe(1);

      // Same hash — navigate() must explicitly call _onHashChange (synchronous branch)
      router.navigate('/idem-7');
      expect(mountCount).toBe(2);
    });
  });
});
