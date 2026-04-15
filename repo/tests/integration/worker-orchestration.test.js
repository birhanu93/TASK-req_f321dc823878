import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetAll, setCurrentUser } from '../helpers.js';
import { postToWorker, terminateAll, isAvailable } from '../../js/core/worker-pool.js';
import { stickyService } from '../../js/services/sticky-service.js';
import { roomService } from '../../js/services/room-service.js';
import { importExportService } from '../../js/services/import-export-service.js';
import { whiteboardService } from '../../js/services/whiteboard-service.js';
import { chatService } from '../../js/services/chat-service.js';
import { autosave } from '../../js/core/autosave.js';
import { db } from '../../js/core/db.js';

describe('Integration: Worker-backed task orchestration', () => {
  let room;

  beforeEach(async () => {
    await resetAll();
    setCurrentUser();
    autosave.destroy();
    autosave.init(async () => {});
    room = await roomService.createRoom('Worker Room');
  });

  afterEach(() => {
    autosave.destroy();
  });

  describe('worker-pool module', () => {
    it('should export postToWorker function', () => {
      expect(typeof postToWorker).toBe('function');
    });

    it('should export terminateAll function', () => {
      expect(typeof terminateAll).toBe('function');
    });

    it('should export isAvailable function', () => {
      expect(typeof isAvailable).toBe('function');
    });

    it('postToWorker returns null when Worker is unavailable (test env)', () => {
      const result = postToWorker('csv', 'parse-csv', { csvText: 'a,b', maxRows: 10 });
      expect(result).toBeNull();
    });

    it('terminateAll should not throw when no workers exist', () => {
      expect(() => terminateAll()).not.toThrow();
    });
  });

  describe('CSV parsing via stickyService.importCSV (worker fallback)', () => {
    it('should parse valid CSV and create notes', async () => {
      const result = await stickyService.importCSV(room.id, 'title,body\nHello,World\nFoo,Bar');
      expect(result.imported).toBe(2);
      expect(result.errors).toHaveLength(0);

      const notes = await stickyService.getNotesByRoom(room.id);
      expect(notes).toHaveLength(2);
    });

    it('should report errors for missing columns', async () => {
      const result = await stickyService.importCSV(room.id, 'name,desc\nA,B');
      expect(result.imported).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle quoted fields with commas', async () => {
      const result = await stickyService.importCSV(room.id, 'title,body\n"Hello, World","Body text"');
      expect(result.imported).toBe(1);
      const notes = await stickyService.getNotesByRoom(room.id);
      expect(notes[0].title).toBe('Hello, World');
    });

    it('should enforce 1000 row limit', async () => {
      let csv = 'title,body\n';
      for (let i = 0; i < 1005; i++) csv += `T${i},B${i}\n`;
      const result = await stickyService.importCSV(room.id, csv);
      expect(result.imported).toBe(1000);
      expect(result.errors.some(e => e.message.includes('exceeds maximum'))).toBe(true);
    });

    it('should report row-level errors for empty titles', async () => {
      const result = await stickyService.importCSV(room.id, 'title,body\n,NoTitle\nGood,OK');
      expect(result.imported).toBe(1);
      expect(result.errors.some(e => e.column === 'title')).toBe(true);
    });
  });

  describe('Snapshot serialization via roomService (worker fallback)', () => {
    it('should create snapshot with serialized data', async () => {
      await whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0 });
      await stickyService.createNote(room.id, { title: 'N', body: 'B' });

      const snapshot = await roomService.createSnapshot(room.id, 'test-snap');
      expect(snapshot.sizeBytes).toBeGreaterThan(0);
      expect(snapshot.blob).toBeTruthy();

      const data = JSON.parse(snapshot.blob);
      expect(data.whiteboardElements.length).toBeGreaterThanOrEqual(1);
      expect(data.stickyNotes.length).toBeGreaterThanOrEqual(1);
    });

    it('should rollback from snapshot', async () => {
      await whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0 });
      const snap = await roomService.createSnapshot(room.id, 'before');

      await whiteboardService.createElement(room.id, 'ellipse', { x: 50, y: 50 });
      let els = await whiteboardService.getElementsByRoom(room.id);
      expect(els.length).toBe(2);

      await roomService.rollbackSnapshot(room.id, snap.id);
      els = await whiteboardService.getElementsByRoom(room.id);
      expect(els.length).toBe(1);
    });
  });

  describe('Export/import via importExportService (worker fallback)', () => {
    it('should export room data', async () => {
      await whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0 });
      const result = await importExportService.exportRoom(room.id);
      // Export calls downloadBlob which may fail in test env, but we get a result
      expect(result).toBeTruthy();
    });

    it('should import room data with merge', async () => {
      const importData = {
        version: 1,
        exportedAt: Date.now(),
        room: { id: 'new-room', name: 'Imported', createdAt: Date.now(), updatedAt: Date.now() },
        whiteboardElements: [{ id: 'el1', roomId: 'new-room', type: 'rect', createdAt: Date.now(), updatedAt: Date.now() }],
        comments: [], stickyNotes: [], stickyGroups: [], chatMessages: [], activityLogs: []
      };
      const file = new File([JSON.stringify(importData)], 'test.json', { type: 'application/json' });
      const result = await importExportService.importRoom(file);
      expect(result.imported).toBeGreaterThanOrEqual(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid JSON import', async () => {
      const file = new File(['not json'], 'bad.json', { type: 'application/json' });
      const result = await importExportService.importRoom(file);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Services correctly attempt worker then fallback', () => {
    it('stickyService.importCSV calls postToWorker (returns null in test env)', async () => {
      const spy = vi.spyOn(await import('../../js/core/worker-pool.js'), 'postToWorker');
      await stickyService.importCSV(room.id, 'title,body\nA,B');
      expect(spy).toHaveBeenCalledWith('csv', 'parse-csv', expect.any(Object), undefined);
      spy.mockRestore();
    });

    it('roomService.createSnapshot calls postToWorker (returns null in test env)', async () => {
      const spy = vi.spyOn(await import('../../js/core/worker-pool.js'), 'postToWorker');
      await roomService.createSnapshot(room.id, 'snap');
      expect(spy).toHaveBeenCalledWith('snapshot', 'create-snapshot', expect.any(Object));
      spy.mockRestore();
    });

    it('importExportService.exportRoom calls postToWorker for build-export', async () => {
      const spy = vi.spyOn(await import('../../js/core/worker-pool.js'), 'postToWorker');
      await importExportService.exportRoom(room.id);
      expect(spy).toHaveBeenCalledWith('export', 'build-export', expect.any(Object));
      spy.mockRestore();
    });
  });
});
