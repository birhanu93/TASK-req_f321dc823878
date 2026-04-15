import { db } from '../core/db.js';
import { bus } from '../core/event-bus.js';
import { store } from '../core/store.js';
import { sync } from '../core/sync.js';
import { invalidateCache } from '../core/quota-guard.js';
import { postToWorker } from '../core/worker-pool.js';
import { uuid, now, estimateSize, downloadBlob, readFileAsText } from '../core/utils.js';
import { activityService } from './activity-service.js';

const MAX_EXPORT_SIZE = 50 * 1024 * 1024; // 50 MB
const CONFLICT_WINDOW_MS = 10_000; // 10 seconds
const CONFLICT_THRESHOLD = 2; // more than 2 updates within window triggers conflict

const DATA_STORES = [
  'whiteboardElements',
  'comments',
  'stickyNotes',
  'stickyGroups',
  'chatMessages'
];

export const importExportService = {
  async exportRoom(roomId) {
    try {
      const room = await db.get('rooms', roomId);
      if (!room) throw new Error('Room not found');

      const [
        whiteboardElements,
        comments,
        stickyNotes,
        stickyGroups,
        chatMessages,
        activityLogs
      ] = await Promise.all([
        db.getAllByIndex('whiteboardElements', 'roomId', roomId),
        db.getAllByIndex('comments', 'roomId', roomId),
        db.getAllByIndex('stickyNotes', 'roomId', roomId),
        db.getAllByIndex('stickyGroups', 'roomId', roomId),
        db.getAllByIndex('chatMessages', 'roomId', roomId),
        db.getAllByIndex('activityLogs', 'roomId', roomId)
      ]);

      const exportPayload = {
        room,
        whiteboardElements,
        comments,
        stickyNotes,
        stickyGroups,
        chatMessages,
        activityLogs
      };

      // Try worker-backed build; fall back to main thread
      let json, size;
      const workerResult = postToWorker('export', 'build-export', exportPayload);
      if (workerResult) {
        const result = await workerResult;
        json = result.json;
        size = result.sizeBytes;
      } else {
        const exportData = { version: 1, exportedAt: now(), ...exportPayload };
        size = estimateSize(exportData);
        if (size > MAX_EXPORT_SIZE) {
          throw new Error(`Export size (${(size / 1024 / 1024).toFixed(1)} MB) exceeds 50 MB limit`);
        }
        json = JSON.stringify(exportData, null, 2);
      }
      const blob = new Blob([json], { type: 'application/json' });
      const filename = `alignspace-room-${room.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${Date.now()}.json`;

      downloadBlob(blob, filename);

      await activityService.logActivity(
        roomId,
        'export',
        'room',
        roomId,
        `Room "${room.name}" exported`,
        { sizeBytes: size }
      );

      return { success: true, filename, sizeBytes: size };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  async importRoom(file) {
    const result = { imported: 0, updated: 0, conflicts: 0, errors: [] };

    try {
      const text = await readFileAsText(file);

      // Try worker-backed parse; fall back to main thread
      let data;
      const workerParse = postToWorker('export', 'parse-import', { fileContent: text });
      if (workerParse) {
        data = await workerParse;
      } else {
        try { data = JSON.parse(text); } catch { throw new Error('Invalid JSON file'); }
        if (!data.version) throw new Error('Missing version field');
        if (data.version !== 1) throw new Error(`Unsupported export version: ${data.version}`);
      }

      if (!data.room || !data.room.id) {
        throw new Error('Export file missing room data');
      }

      const roomId = data.room.id;

      // Import/update the room record
      const existingRoom = await db.get('rooms', roomId);
      if (existingRoom) {
        const incomingTime = data.room.updatedAt || data.room.createdAt || 0;
        const localTime = existingRoom.updatedAt || existingRoom.createdAt || 0;
        if (incomingTime > localTime) {
          existingRoom.name = data.room.name || existingRoom.name;
          existingRoom.description = data.room.description ?? existingRoom.description;
          existingRoom.updatedAt = now();
          await db.put('rooms', existingRoom);
          result.updated++;
        }
      } else {
        await db.put('rooms', { ...data.room, updatedAt: now() });
        result.imported++;
      }

      // Merge each data store
      for (const storeName of DATA_STORES) {
        const incoming = data[storeName];
        if (!Array.isArray(incoming) || incoming.length === 0) continue;

        try {
          const storeResult = await this._mergeRecords(storeName, incoming, roomId);
          result.imported += storeResult.imported;
          result.updated += storeResult.updated;
          result.conflicts += storeResult.conflicts;
        } catch (err) {
          result.errors.push(`${storeName}: ${err.message}`);
        }
      }

      // Import activity logs as-is (append only, no merge)
      if (Array.isArray(data.activityLogs) && data.activityLogs.length > 0) {
        for (const log of data.activityLogs) {
          const existing = await db.get('activityLogs', log.id);
          if (!existing) {
            await db.put('activityLogs', log);
            result.imported++;
          }
        }
      }

      invalidateCache(roomId);

      await activityService.logActivity(
        roomId,
        'import',
        'room',
        roomId,
        `Room imported: ${result.imported} new, ${result.updated} updated, ${result.conflicts} conflicts`,
        { imported: result.imported, updated: result.updated, conflicts: result.conflicts }
      );

      bus.emit('import:completed', { roomId, ...result });
      sync.broadcast({ type: 'db-change', store: 'rooms', key: roomId, action: 'import' });

      return result;
    } catch (err) {
      result.errors.push(err.message);
      return result;
    }
  },

  async _mergeRecords(storeName, incoming, roomId) {
    const stats = { imported: 0, updated: 0, conflicts: 0 };

    // Track edits per element for conflict detection:
    // key = element id, value = array of timestamps of edits in this merge
    const editTimestamps = {};

    for (const record of incoming) {
      if (!record.id) {
        stats.imported++;
        const newRecord = { ...record, id: uuid() };
        await db.put(storeName, newRecord);
        continue;
      }

      const local = await db.get(storeName, record.id);

      if (!local) {
        // Not found locally — insert
        await db.put(storeName, record);
        stats.imported++;
      } else {
        // Found locally — compare timestamps (last modified wins)
        const incomingTime = record.updatedAt || record.createdAt || 0;
        const localTime = local.updatedAt || local.createdAt || 0;

        // Track unique edit timestamps for conflict detection.
        // Each distinct createdAt/updatedAt value represents a separate edit event.
        if (!editTimestamps[record.id]) {
          editTimestamps[record.id] = new Set();
        }
        const tsSet = editTimestamps[record.id];
        if (incomingTime) tsSet.add(incomingTime);
        if (record.createdAt && record.createdAt !== incomingTime) tsSet.add(record.createdAt);
        if (localTime) tsSet.add(localTime);
        if (local.createdAt && local.createdAt !== localTime) tsSet.add(local.createdAt);

        // Check for conflict: >2 unique edits within 10 seconds
        const timestamps = [...tsSet].sort((a, b) => a - b);
        const hasConflict = timestamps.length > CONFLICT_THRESHOLD &&
          (timestamps[timestamps.length - 1] - timestamps[0]) < CONFLICT_WINDOW_MS;

        if (hasConflict) {
          // Create a conflict duplicate
          const conflictRecord = {
            ...record,
            id: uuid(),
            conflictFlag: true,
            conflictSourceId: record.id,
            roomId,
            updatedAt: now()
          };
          await db.put(storeName, conflictRecord);
          stats.conflicts++;

          await activityService.logActivity(
            roomId,
            'conflict-detected',
            storeName,
            record.id,
            `Merge conflict on ${storeName} element ${record.id} — duplicate created`,
            { conflictId: conflictRecord.id, originalId: record.id }
          );
        } else if (incomingTime > localTime) {
          // Incoming is newer — update
          await db.put(storeName, { ...record, updatedAt: now() });
          stats.updated++;
        }
        // else local is newer or same — keep local, do nothing
      }
    }

    return stats;
  }
};
