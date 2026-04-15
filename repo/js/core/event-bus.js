const listeners = {};

export const bus = {
  on(event, fn) {
    (listeners[event] ??= []).push(fn);
  },

  off(event, fn) {
    if (!listeners[event]) return;
    listeners[event] = listeners[event].filter(f => f !== fn);
  },

  emit(event, data) {
    const fns = listeners[event];
    if (!fns) return;
    for (let i = 0; i < fns.length; i++) {
      try {
        fns[i](data);
      } catch (err) {
        console.error(`[EventBus] Error in listener for "${event}":`, err);
      }
    }
  },

  once(event, fn) {
    const wrapper = (data) => {
      bus.off(event, wrapper);
      fn(data);
    };
    bus.on(event, wrapper);
  },

  clear(event) {
    if (event) {
      delete listeners[event];
    } else {
      for (const key in listeners) delete listeners[key];
    }
  }
};
