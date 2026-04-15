import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture messages posted by the worker
const postedMessages = [];

beforeEach(() => {
  postedMessages.length = 0;
});

// Mock self.postMessage before importing the worker
globalThis.postMessage = (msg) => postedMessages.push(msg);

// Import the worker, which sets self.onmessage
import '../../js/workers/export-worker.js';

function sendMessage(type, id, payload) {
  self.onmessage({ data: { type, id, payload } });
}

function getResult(type, id) {
  return postedMessages.find(m => m.id === id && m.type === type);
}

describe('export-worker', () => {
  // ─── buildExport ──────────────────────────────────────────────────
  describe('buildExport', () => {
    it('should create JSON export with version field', () => {
      const data = {
        room: { id: 'r1', name: 'Test Room' },
        whiteboardElements: [{ id: 'wb1', type: 'rect' }],
        comments: [],
        stickyNotes: [],
        stickyGroups: [],
        chatMessages: [],
        activityLogs: []
      };

      sendMessage('build-export', 'exp1', data);

      const result = getResult('build-export-result', 'exp1');
      expect(result).toBeTruthy();

      const parsed = JSON.parse(result.payload.json);
      expect(parsed.version).toBe(1);
      expect(parsed).toHaveProperty('exportedAt');
      expect(parsed.room).toEqual(data.room);
      expect(parsed.whiteboardElements).toHaveLength(1);
    });

    it('should report the size in bytes', () => {
      const data = {
        room: { id: 'r1', name: 'Test Room' },
        whiteboardElements: [],
        comments: [],
        stickyNotes: [],
        stickyGroups: [],
        chatMessages: [],
        activityLogs: []
      };

      sendMessage('build-export', 'exp2', data);

      const result = getResult('build-export-result', 'exp2');
      expect(result.payload.sizeBytes).toBeGreaterThan(0);
    });

    it('should default missing arrays to empty arrays', () => {
      const data = { room: { id: 'r1', name: 'Test' } };

      sendMessage('build-export', 'exp3', data);

      const result = getResult('build-export-result', 'exp3');
      const parsed = JSON.parse(result.payload.json);
      expect(parsed.whiteboardElements).toEqual([]);
      expect(parsed.comments).toEqual([]);
      expect(parsed.stickyNotes).toEqual([]);
      expect(parsed.stickyGroups).toEqual([]);
      expect(parsed.chatMessages).toEqual([]);
      expect(parsed.activityLogs).toEqual([]);
    });

    it('should reject export exceeding 50 MB size limit', () => {
      // Create a very large data payload
      const largeArray = [];
      const bigString = 'x'.repeat(1000);
      for (let i = 0; i < 60000; i++) {
        largeArray.push({ id: `item-${i}`, data: bigString });
      }

      const data = {
        room: { id: 'r1', name: 'Big Room' },
        whiteboardElements: largeArray
      };

      sendMessage('build-export', 'exp4', data);

      const error = getResult('build-export-error', 'exp4');
      expect(error).toBeTruthy();
      expect(error.error).toContain('too large');
    });
  });

  // ─── parseImport ──────────────────────────────────────────────────
  describe('parseImport', () => {
    it('should parse valid JSON export', () => {
      const exportData = {
        version: 1,
        exportedAt: Date.now(),
        room: { id: 'r1', name: 'Imported' },
        whiteboardElements: [{ id: 'wb1' }],
        comments: [],
        stickyNotes: [],
        stickyGroups: [],
        chatMessages: [],
        activityLogs: []
      };

      sendMessage('parse-import', 'imp1', { fileContent: JSON.stringify(exportData) });

      const result = getResult('parse-import-result', 'imp1');
      expect(result).toBeTruthy();
      expect(result.payload.version).toBe(1);
      expect(result.payload.room).toEqual(exportData.room);
      expect(result.payload.whiteboardElements).toHaveLength(1);
    });

    it('should reject invalid JSON', () => {
      sendMessage('parse-import', 'imp2', { fileContent: 'not valid json{{{' });

      const error = getResult('parse-import-error', 'imp2');
      expect(error).toBeTruthy();
      expect(error.error).toContain('Invalid JSON');
    });

    it('should reject data missing version field', () => {
      sendMessage('parse-import', 'imp3', { fileContent: JSON.stringify({ room: { id: 'r1' } }) });

      const error = getResult('parse-import-error', 'imp3');
      expect(error).toBeTruthy();
      expect(error.error).toContain('Missing version');
    });

    it('should reject unsupported version', () => {
      sendMessage('parse-import', 'imp4', { fileContent: JSON.stringify({ version: 99 }) });

      const error = getResult('parse-import-error', 'imp4');
      expect(error).toBeTruthy();
      expect(error.error).toContain('Unsupported export version');
    });

    it('should default missing arrays to empty arrays', () => {
      const exportData = {
        version: 1,
        exportedAt: Date.now(),
        room: { id: 'r1', name: 'Minimal' }
      };

      sendMessage('parse-import', 'imp5', { fileContent: JSON.stringify(exportData) });

      const result = getResult('parse-import-result', 'imp5');
      expect(result.payload.whiteboardElements).toEqual([]);
      expect(result.payload.comments).toEqual([]);
      expect(result.payload.chatMessages).toEqual([]);
    });
  });

  // ─── computeMerge ─────────────────────────────────────────────────
  describe('computeMerge', () => {
    it('should insert records not found locally', () => {
      const local = [];
      const incoming = [
        { id: 'a1', name: 'New', createdAt: 1000, updatedAt: 1000 }
      ];

      sendMessage('compute-merge', 'merge1', { local, incoming });

      const result = getResult('compute-merge-result', 'merge1');
      expect(result.payload.toInsert).toHaveLength(1);
      expect(result.payload.toInsert[0].id).toBe('a1');
      expect(result.payload.toUpdate).toHaveLength(0);
      expect(result.payload.conflicts).toHaveLength(0);
    });

    it('should update records when incoming is newer', () => {
      const local = [
        { id: 'a1', name: 'Old', createdAt: 1000, updatedAt: 1000 }
      ];
      const incoming = [
        { id: 'a1', name: 'Updated', createdAt: 1000, updatedAt: 5000 }
      ];

      sendMessage('compute-merge', 'merge2', { local, incoming });

      const result = getResult('compute-merge-result', 'merge2');
      expect(result.payload.toInsert).toHaveLength(0);
      expect(result.payload.toUpdate).toHaveLength(1);
      expect(result.payload.toUpdate[0].name).toBe('Updated');
    });

    it('should not update records when local is newer', () => {
      const local = [
        { id: 'a1', name: 'Local', createdAt: 1000, updatedAt: 5000 }
      ];
      const incoming = [
        { id: 'a1', name: 'Old Import', createdAt: 1000, updatedAt: 2000 }
      ];

      sendMessage('compute-merge', 'merge3', { local, incoming });

      const result = getResult('compute-merge-result', 'merge3');
      expect(result.payload.toUpdate).toHaveLength(0);
    });

    it('should detect conflicts when >2 edits within 10 seconds', () => {
      // The conflict detection requires: >2 timestamps within 10s window
      // editTracker pushes existingTime then incomingTime for each incoming record
      // For a single incoming record with one local match: 2 timestamps -- not >2
      // We need multiple incoming records with the same id, or timestamps that generate >2 entries
      // Looking at the code: for each incoming record with same id, it pushes existingTime once
      // then incomingTime. If there are 3+ timestamps total and window <= 10s, it's a conflict.
      // With single incoming record matching single local, we get exactly 2 timestamps -- no conflict.
      // We need multiple incoming records with the same id to get >2 timestamps.
      const local = [
        { id: 'a1', name: 'Local', createdAt: 1000, updatedAt: 1001 }
      ];
      const incoming = [
        { id: 'a1', name: 'Import1', createdAt: 1000, updatedAt: 1002 },
        { id: 'a1', name: 'Import2', createdAt: 1000, updatedAt: 1003 }
      ];

      sendMessage('compute-merge', 'merge4', { local, incoming });

      const result = getResult('compute-merge-result', 'merge4');
      expect(result.payload.conflicts.length).toBeGreaterThanOrEqual(1);
      expect(result.payload.conflicts[0].originalId).toBe('a1');
      expect(result.payload.conflicts[0].record.conflictFlag).toBe(true);
      expect(result.payload.conflicts[0].record.conflictSourceId).toBe('a1');
    });

    it('should not detect conflicts when timestamps are far apart', () => {
      const local = [
        { id: 'a1', name: 'Local', createdAt: 1000, updatedAt: 1000 }
      ];
      const incoming = [
        { id: 'a1', name: 'Import', createdAt: 1000, updatedAt: 50_000 }
      ];

      sendMessage('compute-merge', 'merge5', { local, incoming });

      const result = getResult('compute-merge-result', 'merge5');
      expect(result.payload.conflicts).toHaveLength(0);
    });

    it('should handle a mix of inserts, updates, and unchanged', () => {
      const local = [
        { id: 'a1', name: 'Existing', createdAt: 1000, updatedAt: 3000 },
        { id: 'a2', name: 'Older', createdAt: 1000, updatedAt: 1000 }
      ];
      const incoming = [
        { id: 'a2', name: 'Newer', createdAt: 1000, updatedAt: 5000 },
        { id: 'a3', name: 'Brand New', createdAt: 4000, updatedAt: 4000 }
      ];

      sendMessage('compute-merge', 'merge6', { local, incoming });

      const result = getResult('compute-merge-result', 'merge6');
      expect(result.payload.toInsert).toHaveLength(1);
      expect(result.payload.toInsert[0].id).toBe('a3');
      expect(result.payload.toUpdate).toHaveLength(1);
      expect(result.payload.toUpdate[0].id).toBe('a2');
    });
  });
});
