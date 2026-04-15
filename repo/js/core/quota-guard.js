import { db } from './db.js';
import { bus } from './event-bus.js';
import { estimateSize } from './utils.js';

const STORAGE_LIMIT = 200 * 1024 * 1024;
const STORAGE_WARNING = 180 * 1024 * 1024;

const ROOM_STORES = [
  'whiteboardElements', 'comments', 'stickyNotes', 'stickyGroups',
  'chatMessages', 'activityLogs', 'snapshots'
];

let cachedUsage = new Map(); // roomId → { bytes, timestamp }
const CACHE_TTL = 10000; // 10 seconds

export async function getUsage(roomId) {
  const cached = cachedUsage.get(roomId);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached.bytes;
  }
  let total = 0;
  for (const storeName of ROOM_STORES) {
    const items = await db.getAllByIndex(storeName, 'roomId', roomId);
    for (const item of items) {
      total += estimateSize(item);
    }
  }
  cachedUsage.set(roomId, { bytes: total, timestamp: Date.now() });
  return total;
}

export function invalidateCache(roomId) {
  cachedUsage.delete(roomId);
}

export async function enforceQuota(roomId) {
  const used = await getUsage(roomId);
  if (used >= STORAGE_LIMIT) {
    throw new Error(
      `Storage limit exceeded for this room (${(used / 1024 / 1024).toFixed(1)} MB / ${(STORAGE_LIMIT / 1024 / 1024).toFixed(0)} MB). ` +
      `Delete unused content to free space.`
    );
  }
  if (used >= STORAGE_WARNING) {
    bus.emit('room:storage-warning', { roomId, used, limit: STORAGE_LIMIT, warning: STORAGE_WARNING });
  }
}

export const LIMITS = { STORAGE_LIMIT, STORAGE_WARNING };
