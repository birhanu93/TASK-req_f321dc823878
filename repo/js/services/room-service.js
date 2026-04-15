import { db } from '../core/db.js';
import { bus } from '../core/event-bus.js';
import { store } from '../core/store.js';
import { sync } from '../core/sync.js';
import { autosave } from '../core/autosave.js';
import { enforceQuota, invalidateCache } from '../core/quota-guard.js';
import { postToWorker } from '../core/worker-pool.js';
import { activityService } from './activity-service.js';
import { uuid, now, estimateSize } from '../core/utils.js';

const STORAGE_LIMIT = 200 * 1024 * 1024;
const STORAGE_WARNING = 180 * 1024 * 1024;
const MAX_SNAPSHOTS = 50;

export const roomService = {
  async createRoom(name, description = '') {
    const currentUser = store.get('currentUser');
    const room = {
      id: uuid(),
      name,
      description,
      createdBy: currentUser?.id || null,
      storageBytesUsed: 0,
      snapshotCount: 0,
      createdAt: now(),
      updatedAt: now()
    };
    await db.put('rooms', room);
    autosave.markDirty('rooms', room.id, room);
    // Track funnel milestone
    import('./ops-service.js').then(m => m.opsService.trackEvent('room_created', { roomId: room.id })).catch(() => {});
    bus.emit('room:created', room);
    sync.broadcast({ type: 'db-change', store: 'rooms', key: room.id, data: room });
    return room;
  },

  async getRoom(id) {
    return db.get('rooms', id);
  },

  async listRooms() {
    const rooms = await db.getAll('rooms');
    return rooms.sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async updateRoom(id, data) {
    const room = await db.get('rooms', id);
    if (!room) throw new Error('Room not found');
    const { id: _id, createdBy: _cb, createdAt: _ca, ...allowed } = data;
    Object.assign(room, allowed, { updatedAt: now() });
    await db.put('rooms', room);
    autosave.markDirty('rooms', room.id, room);
    bus.emit('room:updated', room);
    sync.broadcast({ type: 'db-change', store: 'rooms', key: room.id, data: room });
    return room;
  },

  async deleteRoom(id) {
    const relatedStores = [
      'whiteboardElements', 'comments', 'stickyNotes', 'stickyGroups',
      'chatMessages', 'activityLogs', 'snapshots'
    ];
    for (const storeName of relatedStores) {
      const items = await db.getAllByIndex(storeName, 'roomId', id);
      if (items.length > 0) {
        await db.deleteBatch(storeName, items.map(i => i.id || i.tabId));
      }
    }
    // Also clean presence
    const presences = await db.getAllByIndex('presence', 'roomId', id);
    if (presences.length > 0) {
      await db.deleteBatch('presence', presences.map(p => p.tabId));
    }
    await db.delete('rooms', id);
    bus.emit('room:deleted', { id });
    sync.broadcast({ type: 'db-change', store: 'rooms', key: id, action: 'delete' });
  },

  async getStorageUsed(roomId) {
    const stores = [
      'whiteboardElements', 'comments', 'stickyNotes', 'stickyGroups',
      'chatMessages', 'activityLogs', 'snapshots'
    ];
    let total = 0;
    for (const storeName of stores) {
      const items = await db.getAllByIndex(storeName, 'roomId', roomId);
      for (const item of items) {
        total += estimateSize(item);
      }
    }
    const room = await db.get('rooms', roomId);
    if (room) {
      room.storageBytesUsed = total;
      await db.put('rooms', room);
    }
    return total;
  },

  async checkStorageQuota(roomId) {
    const used = await this.getStorageUsed(roomId);
    return {
      used,
      limit: STORAGE_LIMIT,
      warning: STORAGE_WARNING,
      exceeded: used >= STORAGE_LIMIT,
      nearLimit: used >= STORAGE_WARNING
    };
  },

  async getCleanupSuggestions(roomId) {
    const elements = await db.getAllByIndex('whiteboardElements', 'roomId', roomId);
    const images = elements
      .filter(e => e.type === 'image' || e.type === 'sticker')
      .map(e => ({ id: e.id, type: e.type, size: estimateSize(e), createdAt: e.createdAt }))
      .sort((a, b) => b.size - a.size)
      .slice(0, 20);

    const snapshots = await db.getAllByIndex('snapshots', 'roomId', roomId);
    const oldestSnapshots = snapshots
      .map(s => ({ id: s.id, label: s.label, size: s.sizeBytes || estimateSize(s), createdAt: s.createdAt }))
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, 20);

    const messages = await db.getAllByIndex('chatMessages', 'roomId', roomId);
    const oldMessages = messages
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, 100)
      .map(m => ({ id: m.id, size: estimateSize(m), createdAt: m.createdAt }));

    return { images, oldestSnapshots, oldMessages };
  },

  async createSnapshot(roomId, label = '') {
    const room = await db.get('rooms', roomId);
    if (!room) throw new Error('Room not found');

    await enforceQuota(roomId);

    const existingSnapshots = await db.getAllByIndex('snapshots', 'roomId', roomId);
    if (existingSnapshots.length >= MAX_SNAPSHOTS) {
      throw new Error(`Maximum ${MAX_SNAPSHOTS} snapshots reached. Delete old snapshots first.`);
    }

    // Gather room data
    const whiteboardElements = await db.getAllByIndex('whiteboardElements', 'roomId', roomId);
    const comments = await db.getAllByIndex('comments', 'roomId', roomId);
    const stickyNotes = await db.getAllByIndex('stickyNotes', 'roomId', roomId);
    const stickyGroups = await db.getAllByIndex('stickyGroups', 'roomId', roomId);
    const chatMessages = await db.getAllByIndex('chatMessages', 'roomId', roomId);

    const snapshotPayload = {
      room: { name: room.name, description: room.description },
      whiteboardElements,
      comments,
      stickyNotes,
      stickyGroups,
      chatMessages
    };

    // Try worker-backed serialization; fall back to main thread
    let blob, sizeBytes;
    const workerResult = postToWorker('snapshot', 'create-snapshot', snapshotPayload);
    if (workerResult) {
      const result = await workerResult;
      blob = result.blob;
      sizeBytes = result.sizeBytes;
    } else {
      blob = JSON.stringify(snapshotPayload);
      sizeBytes = new Blob([blob]).size;
    }
    const currentUser = store.get('currentUser');

    const snapshot = {
      id: uuid(),
      roomId,
      label: label || `Snapshot ${existingSnapshots.length + 1}`,
      blob,
      sizeBytes,
      createdBy: currentUser?.id || null,
      createdAt: now()
    };

    await db.put('snapshots', snapshot);
    invalidateCache(roomId);

    room.snapshotCount = existingSnapshots.length + 1;
    room.updatedAt = now();
    await db.put('rooms', room);
    autosave.markDirty('rooms', room.id, room);

    activityService.logActivity(roomId, 'snapshot', 'room', roomId, `Snapshot "${snapshot.label}" created`, { snapshotId: snapshot.id, sizeBytes });
    bus.emit('snapshot:created', { roomId, snapshotId: snapshot.id });
    sync.broadcast({ type: 'db-change', store: 'snapshots', key: snapshot.id });
    return snapshot;
  },

  async listSnapshots(roomId) {
    const snapshots = await db.getAllByIndex('snapshots', 'roomId', roomId);
    return snapshots
      .map(s => ({ ...s, blob: undefined }))
      .sort((a, b) => b.createdAt - a.createdAt);
  },

  async rollbackSnapshot(roomId, snapshotId) {
    const snapshot = await db.get('snapshots', snapshotId);
    if (!snapshot || snapshot.roomId !== roomId) throw new Error('Snapshot not found');

    const data = JSON.parse(snapshot.blob);

    // Clear current room data
    const storesToClear = ['whiteboardElements', 'comments', 'stickyNotes', 'stickyGroups', 'chatMessages'];
    for (const storeName of storesToClear) {
      const items = await db.getAllByIndex(storeName, 'roomId', roomId);
      if (items.length > 0) {
        await db.deleteBatch(storeName, items.map(i => i.id));
      }
    }

    // Restore from snapshot
    if (data.whiteboardElements?.length) await db.putBatch('whiteboardElements', data.whiteboardElements);
    if (data.comments?.length) await db.putBatch('comments', data.comments);
    if (data.stickyNotes?.length) await db.putBatch('stickyNotes', data.stickyNotes);
    if (data.stickyGroups?.length) await db.putBatch('stickyGroups', data.stickyGroups);
    if (data.chatMessages?.length) await db.putBatch('chatMessages', data.chatMessages);

    activityService.logActivity(roomId, 'rollback', 'room', snapshotId, `Rolled back to snapshot "${snapshot.label || snapshotId}"`);
    bus.emit('snapshot:rolled-back', { roomId, snapshotId });
    sync.broadcast({ type: 'db-change', store: 'rooms', key: roomId, action: 'rollback' });
  },

  async deleteSnapshot(snapshotId) {
    const snapshot = await db.get('snapshots', snapshotId);
    if (!snapshot) return;
    await db.delete('snapshots', snapshotId);

    const room = await db.get('rooms', snapshot.roomId);
    if (room) {
      const remaining = await db.getAllByIndex('snapshots', 'roomId', snapshot.roomId);
      room.snapshotCount = remaining.length;
      await db.put('rooms', room);
    }

    bus.emit('snapshot:deleted', { snapshotId, roomId: snapshot.roomId });
    sync.broadcast({ type: 'db-change', store: 'snapshots', key: snapshotId, action: 'delete' });
  }
};
