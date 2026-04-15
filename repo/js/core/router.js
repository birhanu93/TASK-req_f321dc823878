import { bus } from './event-bus.js';
import { store } from './store.js';

const routes = [];
let currentComponent = null;
let currentRoute = null;
let appContainer = null;

export const router = {
  init(container) {
    appContainer = container;
    window.addEventListener('hashchange', () => this._onHashChange());
    this._onHashChange();
  },

  register(pattern, componentFactory, options = {}) {
    const paramNames = [];
    const regexStr = pattern.replace(/:([^/]+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    routes.push({
      pattern,
      regex: new RegExp(`^${regexStr}$`),
      paramNames,
      componentFactory,
      guard: options.guard || null,
      layout: options.layout || null
    });
  },

  navigate(hash) {
    if (!hash.startsWith('#')) hash = '#' + hash;
    if (window.location.hash === hash) {
      this._onHashChange();
    } else {
      window.location.hash = hash;
    }
  },

  replace(hash) {
    if (!hash.startsWith('#')) hash = '#' + hash;
    history.replaceState(null, '', hash);
    this._onHashChange();
  },

  getCurrentPath() {
    return window.location.hash.slice(1) || '/login';
  },

  getCurrentParams() {
    return currentRoute?.params || {};
  },

  _onHashChange() {
    const path = this.getCurrentPath();
    const match = this._match(path);

    if (!match) {
      this._render404();
      return;
    }

    const { route, params } = match;

    if (route.guard) {
      const redirect = route.guard(params);
      if (redirect) {
        this.replace(redirect);
        return;
      }
    }

    if (currentComponent) {
      currentComponent.destroy();
      currentComponent = null;
    }

    currentRoute = { route, params, path };
    bus.emit('route:change', { path, params, pattern: route.pattern });

    currentComponent = route.componentFactory(appContainer, params);
    currentComponent.mount();
  },

  _match(path) {
    for (const route of routes) {
      const m = path.match(route.regex);
      if (m) {
        const params = {};
        route.paramNames.forEach((name, i) => {
          params[name] = decodeURIComponent(m[i + 1]);
        });
        return { route, params };
      }
    }
    return null;
  },

  _render404() {
    if (currentComponent) {
      currentComponent.destroy();
      currentComponent = null;
    }
    appContainer.innerHTML = `
      <div class="centered-page">
        <div class="centered-card" style="text-align: center">
          <h1 style="font-size: var(--text-3xl); font-weight: var(--fw-bold); margin-bottom: var(--sp-4)">404</h1>
          <p style="color: var(--c-text-secondary); margin-bottom: var(--sp-6)">Page not found</p>
          <a href="#/rooms" class="btn btn--primary">Go to Rooms</a>
        </div>
      </div>
    `;
  }
};
