import { bus } from './event-bus.js';
import { uuid } from './utils.js';

const TAB_ID = uuid();
let channel = null;

export const sync = {
  init() {
    if (channel) return;
    try {
      channel = new BroadcastChannel('alignspace');
      channel.onmessage = (event) => {
        const msg = event.data;
        if (msg.tabId === TAB_ID) return;
        bus.emit('sync:remote', msg);
        if (msg.type === 'db-change') {
          bus.emit(`sync:${msg.store}`, msg);
        }
      };
    } catch (err) {
      console.warn('[Sync] BroadcastChannel not supported:', err);
    }
  },

  broadcast(msg) {
    if (!channel) return;
    try {
      channel.postMessage({ ...msg, tabId: TAB_ID, timestamp: Date.now() });
    } catch (err) {
      console.warn('[Sync] Failed to broadcast:', err);
    }
  },

  getTabId() {
    return TAB_ID;
  },

  destroy() {
    if (channel) {
      channel.close();
      channel = null;
    }
  }
};
