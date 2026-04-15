import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetAll, setCurrentUser } from '../helpers.js';
import { db } from '../../js/core/db.js';
import { bus } from '../../js/core/event-bus.js';
import { importExportService } from '../../js/services/import-export-service.js';

// Mock downloadBlob since we are in a test environment (no real DOM download)
vi.mock('../../js/core/utils.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    downloadBlob: vi.fn()
  };
});

beforeEach(async () => {
  await resetAll();
  setCurrentUser();
});

// Helper to create a room and seed some data
async function seedRoom(roomId, roomName) {
  const room = {
    id: roomId,
    name: roomName,
    description: 'Test room',
    createdBy: 'u1',
    createdAt: 1000,
    updatedAt: 1000
  };
  await db.put('rooms', room);
  return room;
}

async function seedWhiteboardElement(roomId, id, updatedAt) {
  const el = {
    id,
    roomId,
    type: 'rect',
    x: 0, y: 0, width: 100, height: 100,
    createdAt: updatedAt,
    updatedAt
  };
  await db.put('whiteboardElements', el);
  return el;
}

describe('importExportService', () => {
  // ─── exportRoom ───────────────────────────────────────────────────
  describe('exportRoom', () => {
    it('should gather room data and return success', async () => {
      await seedRoom('r1', 'My Room');
      await seedWhiteboardElement('r1', 'wb1', Date.now());

      const result = await importExportService.exportRoom('r1');
      expect(result.success).toBe(true);
      expect(result).toHaveProperty('filename');
      expect(result.filename).toContain('my-room');
      expect(result).toHaveProperty('sizeBytes');
      expect(result.sizeBytes).toBeGreaterThan(0);
    });

    it('should return error for non-existent room', async () => {
      const result = await importExportService.exportRoom('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Room not found');
    });

    it('should log an activity entry after export', async () => {
      await seedRoom('r1', 'My Room');
      await importExportService.exportRoom('r1');

      const logs = await db.getAllByIndex('activityLogs', 'roomId', 'r1');
      const exportLog = logs.find(l => l.action === 'export');
      expect(exportLog).toBeTruthy();
      expect(exportLog.summary).toContain('My Room');
    });
  });

  // ─── importRoom ───────────────────────────────────────────────────
  describe('importRoom', () => {
    function makeExportFile(data) {
      const json = JSON.stringify(data);
      return new File([json], 'test-export.json', { type: 'application/json' });
    }

    it('should import a new room from export data', async () => {
      const exportData = {
        version: 1,
        exportedAt: Date.now(),
        room: { id: 'r1', name: 'Imported Room', description: 'From export', createdAt: 1000, updatedAt: 1000 },
        whiteboardElements: [
          { id: 'wb1', roomId: 'r1', type: 'rect', createdAt: 1000, updatedAt: 1000 }
        ],
        comments: [],
        stickyNotes: [],
        stickyGroups: [],
        chatMessages: [],
        activityLogs: []
      };

      const file = makeExportFile(exportData);
      const result = await importExportService.importRoom(file);

      expect(result.errors).toHaveLength(0);
      expect(result.imported).toBeGreaterThanOrEqual(2); // room + 1 whiteboard element

      // Verify room was created
      const room = await db.get('rooms', 'r1');
      expect(room).toBeTruthy();
      expect(room.name).toBe('Imported Room');

      // Verify whiteboard element was created
      const wb = await db.get('whiteboardElements', 'wb1');
      expect(wb).toBeTruthy();
    });

    it('should update existing records when incoming is newer (last-modified-wins)', async () => {
      // Create an existing room with older timestamp
      await seedRoom('r1', 'Old Name');

      const exportData = {
        version: 1,
        exportedAt: Date.now(),
        room: { id: 'r1', name: 'New Name', description: 'Updated', createdAt: 500, updatedAt: 2000 },
        whiteboardElements: [],
        comments: [],
        stickyNotes: [],
        stickyGroups: [],
        chatMessages: [],
        activityLogs: []
      };

      const file = makeExportFile(exportData);
      const result = await importExportService.importRoom(file);

      expect(result.updated).toBeGreaterThanOrEqual(1);

      const room = await db.get('rooms', 'r1');
      expect(room.name).toBe('New Name');
    });

    it('should not update room when local is newer', async () => {
      // Create an existing room with newer timestamp
      const room = { id: 'r1', name: 'Local Name', description: 'Local', createdBy: 'u1', createdAt: 3000, updatedAt: 3000 };
      await db.put('rooms', room);

      const exportData = {
        version: 1,
        exportedAt: Date.now(),
        room: { id: 'r1', name: 'Import Name', description: 'Import', createdAt: 500, updatedAt: 1000 },
        whiteboardElements: [],
        comments: [],
        stickyNotes: [],
        stickyGroups: [],
        chatMessages: [],
        activityLogs: []
      };

      const file = makeExportFile(exportData);
      await importExportService.importRoom(file);

      const stored = await db.get('rooms', 'r1');
      expect(stored.name).toBe('Local Name');
    });

    it('should insert new records in data stores', async () => {
      await seedRoom('r1', 'Room');

      const exportData = {
        version: 1,
        exportedAt: Date.now(),
        room: { id: 'r1', name: 'Room', createdAt: 1000, updatedAt: 1000 },
        whiteboardElements: [
          { id: 'wb1', roomId: 'r1', type: 'rect', createdAt: 1000, updatedAt: 1000 },
          { id: 'wb2', roomId: 'r1', type: 'circle', createdAt: 1000, updatedAt: 1000 }
        ],
        comments: [
          { id: 'c1', roomId: 'r1', text: 'Hello', createdAt: 1000, updatedAt: 1000 }
        ],
        stickyNotes: [],
        stickyGroups: [],
        chatMessages: [],
        activityLogs: []
      };

      const file = makeExportFile(exportData);
      const result = await importExportService.importRoom(file);

      expect(result.imported).toBeGreaterThanOrEqual(3); // 2 wb + 1 comment

      const wb1 = await db.get('whiteboardElements', 'wb1');
      const wb2 = await db.get('whiteboardElements', 'wb2');
      const c1 = await db.get('comments', 'c1');
      expect(wb1).toBeTruthy();
      expect(wb2).toBeTruthy();
      expect(c1).toBeTruthy();
    });

    it('should update existing data-store records when incoming is newer', async () => {
      await seedRoom('r1', 'Room');
      await seedWhiteboardElement('r1', 'wb1', 1000);

      const exportData = {
        version: 1,
        exportedAt: Date.now(),
        room: { id: 'r1', name: 'Room', createdAt: 1000, updatedAt: 1000 },
        whiteboardElements: [
          { id: 'wb1', roomId: 'r1', type: 'updated-rect', x: 50, y: 50, createdAt: 1000, updatedAt: 5000 }
        ],
        comments: [],
        stickyNotes: [],
        stickyGroups: [],
        chatMessages: [],
        activityLogs: []
      };

      const file = makeExportFile(exportData);
      const result = await importExportService.importRoom(file);

      expect(result.updated).toBeGreaterThanOrEqual(1);
      const wb = await db.get('whiteboardElements', 'wb1');
      expect(wb.type).toBe('updated-rect');
    });

    it('should reject invalid JSON file', async () => {
      const file = new File(['not json{{{'], 'bad.json', { type: 'application/json' });
      const result = await importExportService.importRoom(file);
      expect(result.errors).toContain('Invalid JSON file');
    });

    it('should reject unsupported version', async () => {
      const exportData = { version: 99, room: { id: 'r1' } };
      const file = makeExportFile(exportData);
      const result = await importExportService.importRoom(file);
      expect(result.errors.some(e => e.includes('Unsupported export version'))).toBe(true);
    });

    it('should reject file missing room data', async () => {
      const exportData = { version: 1, exportedAt: Date.now() };
      const file = makeExportFile(exportData);
      const result = await importExportService.importRoom(file);
      expect(result.errors.some(e => e.includes('missing room data'))).toBe(true);
    });

    it('should detect merge conflict when same element has 3+ edits within 10 seconds', async () => {
      await seedRoom('r1', 'Room');
      // Local element: created at T=1000, updated at T=1005 (two distinct events)
      await db.put('whiteboardElements', {
        id: 'wb1', roomId: 'r1', type: 'rect',
        x: 0, y: 0,
        createdAt: 1000,
        updatedAt: 1005
      });

      // Incoming element: same id, created at T=1000, updated at T=1008 (third distinct event)
      const exportData = {
        version: 1,
        exportedAt: Date.now(),
        room: { id: 'r1', name: 'Room', createdAt: 1000, updatedAt: 1000 },
        whiteboardElements: [
          { id: 'wb1', roomId: 'r1', type: 'rect', x: 50, y: 50, createdAt: 1000, updatedAt: 1008 }
        ],
        comments: [],
        stickyNotes: [],
        stickyGroups: [],
        chatMessages: [],
        activityLogs: []
      };

      const file = makeExportFile(exportData);
      const result = await importExportService.importRoom(file);

      // Should detect a conflict (3 unique timestamps: 1000, 1005, 1008 within 8ms < 10s)
      expect(result.conflicts).toBeGreaterThanOrEqual(1);

      // Conflict duplicate should exist in the DB
      const allElements = await db.getAll('whiteboardElements');
      const conflictDupes = allElements.filter(e => e.conflictFlag === true && e.conflictSourceId === 'wb1');
      expect(conflictDupes.length).toBe(1);
      expect(conflictDupes[0].x).toBe(50);
    });

    it('should log activity for merge conflicts', async () => {
      await seedRoom('r1', 'Room');
      await db.put('whiteboardElements', {
        id: 'wb1', roomId: 'r1', type: 'rect',
        createdAt: 1000, updatedAt: 1005
      });

      const exportData = {
        version: 1,
        exportedAt: Date.now(),
        room: { id: 'r1', name: 'Room', createdAt: 1000, updatedAt: 1000 },
        whiteboardElements: [
          { id: 'wb1', roomId: 'r1', type: 'rect', createdAt: 1000, updatedAt: 1008 }
        ],
        comments: [],
        stickyNotes: [],
        stickyGroups: [],
        chatMessages: [],
        activityLogs: []
      };

      const file = makeExportFile(exportData);
      await importExportService.importRoom(file);

      const logs = await db.getAllByIndex('activityLogs', 'roomId', 'r1');
      const conflictLog = logs.find(l => l.action === 'conflict-detected');
      expect(conflictLog).toBeTruthy();
      expect(conflictLog.summary).toContain('wb1');
    });

    it('should not detect conflict when edits are spread over more than 10 seconds', async () => {
      await seedRoom('r1', 'Room');
      // Local: created at T=1000, updated at T=1005
      await db.put('whiteboardElements', {
        id: 'wb1', roomId: 'r1', type: 'rect',
        createdAt: 1000, updatedAt: 1005
      });

      // Incoming: created at T=1000, updated much later (T=20000, >10s from T=1000)
      const exportData = {
        version: 1,
        exportedAt: Date.now(),
        room: { id: 'r1', name: 'Room', createdAt: 1000, updatedAt: 1000 },
        whiteboardElements: [
          { id: 'wb1', roomId: 'r1', type: 'rect', x: 99, createdAt: 1000, updatedAt: 20000 }
        ],
        comments: [],
        stickyNotes: [],
        stickyGroups: [],
        chatMessages: [],
        activityLogs: []
      };

      const file = makeExportFile(exportData);
      const result = await importExportService.importRoom(file);

      expect(result.conflicts).toBe(0);
      // Incoming is newer, should update
      const wb = await db.get('whiteboardElements', 'wb1');
      expect(wb.x).toBe(99);
    });

    it('should not detect conflict when only 2 unique timestamps exist', async () => {
      await seedRoom('r1', 'Room');
      // Local: created and updated at same time (1 unique timestamp)
      await db.put('whiteboardElements', {
        id: 'wb1', roomId: 'r1', type: 'rect',
        createdAt: 1000, updatedAt: 1000
      });

      // Incoming: created at same base, updated slightly later (2 unique timestamps total)
      const exportData = {
        version: 1,
        exportedAt: Date.now(),
        room: { id: 'r1', name: 'Room', createdAt: 1000, updatedAt: 1000 },
        whiteboardElements: [
          { id: 'wb1', roomId: 'r1', type: 'rect', x: 10, createdAt: 1000, updatedAt: 1003 }
        ],
        comments: [],
        stickyNotes: [],
        stickyGroups: [],
        chatMessages: [],
        activityLogs: []
      };

      const file = makeExportFile(exportData);
      const result = await importExportService.importRoom(file);

      // Only 2 unique timestamps (1000, 1003): not > 2, no conflict
      expect(result.conflicts).toBe(0);
      expect(result.updated).toBeGreaterThanOrEqual(1);
    });

    it('should emit import:completed event', async () => {
      await seedRoom('r1', 'Room');
      const handler = vi.fn();
      bus.on('import:completed', handler);

      const exportData = {
        version: 1,
        exportedAt: Date.now(),
        room: { id: 'r1', name: 'Room', createdAt: 1000, updatedAt: 1000 },
        whiteboardElements: [],
        comments: [],
        stickyNotes: [],
        stickyGroups: [],
        chatMessages: [],
        activityLogs: []
      };

      const file = makeExportFile(exportData);
      await importExportService.importRoom(file);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].roomId).toBe('r1');
    });

    it('should import activity logs as append-only (no merge)', async () => {
      await seedRoom('r1', 'Room');

      const exportData = {
        version: 1,
        exportedAt: Date.now(),
        room: { id: 'r1', name: 'Room', createdAt: 1000, updatedAt: 1000 },
        whiteboardElements: [],
        comments: [],
        stickyNotes: [],
        stickyGroups: [],
        chatMessages: [],
        activityLogs: [
          { id: 'log1', roomId: 'r1', action: 'create', createdAt: 1000 },
          { id: 'log2', roomId: 'r1', action: 'update', createdAt: 2000 }
        ]
      };

      const file = makeExportFile(exportData);
      const result = await importExportService.importRoom(file);

      // The 2 activity logs should be imported
      expect(result.imported).toBeGreaterThanOrEqual(2);

      const log1 = await db.get('activityLogs', 'log1');
      const log2 = await db.get('activityLogs', 'log2');
      expect(log1).toBeTruthy();
      expect(log2).toBeTruthy();
    });

    it('should not duplicate existing activity logs', async () => {
      await seedRoom('r1', 'Room');

      // Pre-insert an activity log
      await db.put('activityLogs', { id: 'log1', roomId: 'r1', action: 'create', createdAt: 1000 });

      const exportData = {
        version: 1,
        exportedAt: Date.now(),
        room: { id: 'r1', name: 'Room', createdAt: 1000, updatedAt: 1000 },
        whiteboardElements: [],
        comments: [],
        stickyNotes: [],
        stickyGroups: [],
        chatMessages: [],
        activityLogs: [
          { id: 'log1', roomId: 'r1', action: 'create', createdAt: 1000 }
        ]
      };

      const file = makeExportFile(exportData);
      await importExportService.importRoom(file);

      // Should still only have one log1
      const logs = await db.getAll('activityLogs');
      const log1s = logs.filter(l => l.id === 'log1');
      expect(log1s).toHaveLength(1);
    });
  });
});
