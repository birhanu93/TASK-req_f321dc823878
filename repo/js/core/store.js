const state = {};
const watchers = {};

export const store = {
  get(path) {
    return path.split('.').reduce((obj, key) => obj?.[key], state);
  },

  set(path, value) {
    const keys = path.split('.');
    let obj = state;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (obj[k] == null || typeof obj[k] !== 'object') obj[k] = {};
      obj = obj[k];
    }
    obj[keys[keys.length - 1]] = value;
    this._notify(path, value);
  },

  delete(path) {
    const keys = path.split('.');
    let obj = state;
    for (let i = 0; i < keys.length - 1; i++) {
      obj = obj?.[keys[i]];
      if (!obj) return;
    }
    delete obj[keys[keys.length - 1]];
    this._notify(path, undefined);
  },

  watch(path, fn) {
    (watchers[path] ??= []).push(fn);
    return () => {
      watchers[path] = watchers[path].filter(f => f !== fn);
    };
  },

  getAll() {
    return structuredClone(state);
  },

  _notify(changedPath, value) {
    for (const watchPath in watchers) {
      if (changedPath.startsWith(watchPath) || watchPath.startsWith(changedPath)) {
        const fns = watchers[watchPath];
        for (let i = 0; i < fns.length; i++) {
          try {
            fns[i](value, changedPath);
          } catch (err) {
            console.error(`[Store] Error in watcher for "${watchPath}":`, err);
          }
        }
      }
    }
  }
};
