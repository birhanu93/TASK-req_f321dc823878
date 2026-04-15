import { db } from '../core/db.js';
import { bus } from '../core/event-bus.js';
import { store } from '../core/store.js';
import { sync } from '../core/sync.js';
import { uuid, now } from '../core/utils.js';

export const activityService = {
  async logActivity(roomId, action, targetType, targetId, summary, metadata = {}) {
    const currentUser = store.get('currentUser');
    const entry = {
      id: uuid(),
      roomId,
      actorId: currentUser?.id || null,
      action,
      targetType,
      targetId,
      summary,
      metadata,
      createdAt: now()
    };
    await db.put('activityLogs', entry);
    bus.emit('activity:logged', entry);
    sync.broadcast({ type: 'db-change', store: 'activityLogs', key: entry.id, data: entry });
    return entry;
  },

  async getActivityFeed(roomId, options = {}) {
    const { limit = 50, action, since } = options;
    let logs = await db.getAllByIndex('activityLogs', 'roomId', roomId);

    if (action) {
      logs = logs.filter(l => l.action === action);
    }
    if (since) {
      logs = logs.filter(l => l.createdAt >= since);
    }

    logs.sort((a, b) => b.createdAt - a.createdAt);
    return logs.slice(0, limit);
  },

  async clearActivityFeed(roomId) {
    const logs = await db.getAllByIndex('activityLogs', 'roomId', roomId);
    if (logs.length > 0) {
      await db.deleteBatch('activityLogs', logs.map(l => l.id));
    }
  }
};
