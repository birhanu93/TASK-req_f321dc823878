import { bus } from './event-bus.js';

const INTERVAL_MS = 5000;
const dirtyQueues = new Map();
let timer = null;
let flushCallback = null;

export const autosave = {
  init(onFlush) {
    flushCallback = onFlush;
    timer = setInterval(() => this.flush(), INTERVAL_MS);
  },

  markDirty(storeName, id, data) {
    if (!dirtyQueues.has(storeName)) {
      dirtyQueues.set(storeName, new Map());
    }
    dirtyQueues.get(storeName).set(id, data);
  },

  async flush() {
    if (dirtyQueues.size === 0) return;

    const batch = new Map(dirtyQueues);
    dirtyQueues.clear();

    try {
      if (flushCallback) {
        await flushCallback(batch);
      }
      bus.emit('autosave:complete', { stores: [...batch.keys()] });
    } catch (err) {
      console.error('[Autosave] Flush error:', err);
      for (const [store, items] of batch) {
        if (!dirtyQueues.has(store)) dirtyQueues.set(store, new Map());
        const q = dirtyQueues.get(store);
        for (const [id, data] of items) {
          if (!q.has(id)) q.set(id, data);
        }
      }
      bus.emit('autosave:error', { error: err });
    }
  },

  hasPending() {
    return dirtyQueues.size > 0;
  },

  destroy() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    dirtyQueues.clear();
    flushCallback = null;
  }
};
