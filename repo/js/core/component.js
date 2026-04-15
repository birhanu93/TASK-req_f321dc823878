import { bus } from './event-bus.js';

export class Component {
  constructor(container, props = {}) {
    this.container = container;
    this.props = props;
    this.state = {};
    this._subscriptions = [];
    this._storeUnsubs = [];
    this._children = [];
    this._mounted = false;
  }

  setState(partial) {
    Object.assign(this.state, partial);
    if (this._mounted) this.render();
  }

  subscribeTo(event, handler) {
    bus.on(event, handler);
    this._subscriptions.push({ event, handler });
  }

  watchStore(store, path, handler) {
    const unsub = store.watch(path, handler);
    this._storeUnsubs.push(unsub);
  }

  addChild(child) {
    this._children.push(child);
    return child;
  }

  mount() {
    this._mounted = true;
    this.render();
  }

  render() {
    // Override in subclass
  }

  destroy() {
    this._mounted = false;
    this._subscriptions.forEach(s => bus.off(s.event, s.handler));
    this._subscriptions = [];
    this._storeUnsubs.forEach(unsub => unsub());
    this._storeUnsubs = [];
    this._children.forEach(c => c.destroy());
    this._children = [];
    if (this.container) this.container.innerHTML = '';
  }

  $(selector) {
    return this.container.querySelector(selector);
  }

  $$(selector) {
    return this.container.querySelectorAll(selector);
  }

  on(selector, event, handler) {
    const el = typeof selector === 'string' ? this.$(selector) : selector;
    if (el) el.addEventListener(event, handler);
  }

  delegate(event, selector, handler) {
    this.container.addEventListener(event, (e) => {
      const target = e.target.closest(selector);
      if (target && this.container.contains(target)) {
        handler(e, target);
      }
    });
  }
}
