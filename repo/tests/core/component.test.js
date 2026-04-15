import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Component } from '../../js/core/component.js';
import { bus } from '../../js/core/event-bus.js';

beforeEach(() => {
  bus.clear();
});

describe('Component', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('should initialize with container and props', () => {
    const c = new Component(container, { id: '1' });
    expect(c.container).toBe(container);
    expect(c.props).toEqual({ id: '1' });
    expect(c.state).toEqual({});
    expect(c._mounted).toBe(false);
  });

  it('should default props to empty object', () => {
    const c = new Component(container);
    expect(c.props).toEqual({});
  });

  describe('mount / render', () => {
    it('should set _mounted to true on mount', () => {
      const c = new Component(container);
      c.mount();
      expect(c._mounted).toBe(true);
    });

    it('should call render on mount', () => {
      const c = new Component(container);
      c.render = vi.fn();
      c.mount();
      expect(c.render).toHaveBeenCalled();
    });
  });

  describe('setState', () => {
    it('should merge state', () => {
      const c = new Component(container);
      c.state = { a: 1, b: 2 };
      c.setState({ b: 3, c: 4 });
      expect(c.state).toEqual({ a: 1, b: 3, c: 4 });
    });

    it('should call render when mounted', () => {
      const c = new Component(container);
      c.render = vi.fn();
      c.mount();
      c.render.mockClear();
      c.setState({ x: 1 });
      expect(c.render).toHaveBeenCalled();
    });

    it('should not call render when not mounted', () => {
      const c = new Component(container);
      c.render = vi.fn();
      c.setState({ x: 1 });
      expect(c.render).not.toHaveBeenCalled();
    });
  });

  describe('subscribeTo / destroy', () => {
    it('should subscribe to bus events', () => {
      const c = new Component(container);
      const fn = vi.fn();
      c.subscribeTo('test:event', fn);
      bus.emit('test:event', 'data');
      expect(fn).toHaveBeenCalledWith('data');
    });

    it('should unsubscribe all on destroy', () => {
      const c = new Component(container);
      const fn = vi.fn();
      c.subscribeTo('test:event', fn);
      c.mount();
      c.destroy();
      bus.emit('test:event', 'data');
      expect(fn).not.toHaveBeenCalled();
    });

    it('should set _mounted to false on destroy', () => {
      const c = new Component(container);
      c.mount();
      c.destroy();
      expect(c._mounted).toBe(false);
    });

    it('should clear container innerHTML on destroy', () => {
      container.innerHTML = '<p>content</p>';
      const c = new Component(container);
      c.mount();
      c.destroy();
      expect(container.innerHTML).toBe('');
    });

    it('should destroy children', () => {
      const parent = new Component(container);
      const childContainer = document.createElement('div');
      container.appendChild(childContainer);
      const child = new Component(childContainer);
      child.destroy = vi.fn();
      parent.addChild(child);
      parent.destroy();
      expect(child.destroy).toHaveBeenCalled();
    });
  });

  describe('$ / $$', () => {
    it('should query single element', () => {
      container.innerHTML = '<p class="test">hello</p>';
      const c = new Component(container);
      expect(c.$('.test')).toBeTruthy();
      expect(c.$('.test').textContent).toBe('hello');
    });

    it('should query multiple elements', () => {
      container.innerHTML = '<p class="item">a</p><p class="item">b</p>';
      const c = new Component(container);
      expect(c.$$('.item').length).toBe(2);
    });

    it('should return null for non-existent element', () => {
      const c = new Component(container);
      expect(c.$('.nonexistent')).toBeNull();
    });
  });

  describe('delegate', () => {
    it('should delegate events to matching children', () => {
      container.innerHTML = '<button class="btn" data-id="1">Click</button>';
      const c = new Component(container);
      const fn = vi.fn();
      c.delegate('click', '.btn', fn);
      container.querySelector('.btn').click();
      expect(fn).toHaveBeenCalled();
    });

    it('should not fire for non-matching elements', () => {
      container.innerHTML = '<span class="other">nope</span>';
      const c = new Component(container);
      const fn = vi.fn();
      c.delegate('click', '.btn', fn);
      container.querySelector('.other').click();
      expect(fn).not.toHaveBeenCalled();
    });
  });
});
