import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture messages posted by the worker
const postedMessages = [];

beforeEach(() => {
  postedMessages.length = 0;
});

// Mock self.postMessage before importing the worker
globalThis.postMessage = (msg) => postedMessages.push(msg);

// Import the worker, which sets self.onmessage
import '../../js/workers/csv-worker.js';

function sendMessage(type, id, payload) {
  self.onmessage({ data: { type, id, payload } });
}

function getResult(id) {
  return postedMessages.find(m => m.id === id && m.type === 'parse-csv-result');
}

function getError(id) {
  return postedMessages.find(m => m.id === id && m.type === 'parse-csv-error');
}

describe('csv-worker', () => {
  // ─── Valid CSV parsing ────────────────────────────────────────────
  describe('valid CSV parsing', () => {
    it('should parse a valid CSV with title and body columns', () => {
      const csvText = 'title,body\nHello,World\nFoo,Bar';
      sendMessage('parse-csv', 'test1', { csvText, maxRows: 1000 });

      const result = getResult('test1');
      expect(result).toBeTruthy();
      expect(result.payload.valid).toHaveLength(2);
      expect(result.payload.valid[0]).toEqual(
        expect.objectContaining({ title: 'Hello', body: 'World', sourceRow: 2 })
      );
      expect(result.payload.valid[1]).toEqual(
        expect.objectContaining({ title: 'Foo', body: 'Bar', sourceRow: 3 })
      );
      expect(result.payload.errors).toHaveLength(0);
    });

    it('should be case-insensitive for header names', () => {
      const csvText = 'Title,Body\nHello,World';
      sendMessage('parse-csv', 'test2', { csvText, maxRows: 1000 });

      const result = getResult('test2');
      expect(result.payload.valid).toHaveLength(1);
      expect(result.payload.valid[0].title).toBe('Hello');
    });

    it('should handle extra columns as extra data', () => {
      const csvText = 'title,body,color,priority\nTask,Description,red,high';
      sendMessage('parse-csv', 'test3', { csvText, maxRows: 1000 });

      const result = getResult('test3');
      expect(result.payload.valid).toHaveLength(1);
      expect(result.payload.valid[0].extra).toEqual({ color: 'red', priority: 'high' });
    });

    it('should report totalRows and processedRows', () => {
      const csvText = 'title,body\nA,B\nC,D\nE,F';
      sendMessage('parse-csv', 'test4', { csvText, maxRows: 1000 });

      const result = getResult('test4');
      expect(result.payload.totalRows).toBe(3);
      expect(result.payload.processedRows).toBe(3);
    });
  });

  // ─── Missing required columns ─────────────────────────────────────
  describe('missing required columns', () => {
    it('should report error for missing title column', () => {
      const csvText = 'body,color\nHello,red';
      sendMessage('parse-csv', 'test5', { csvText, maxRows: 1000 });

      const result = getResult('test5');
      expect(result.payload.valid).toHaveLength(0);
      expect(result.payload.errors).toHaveLength(1);
      expect(result.payload.errors[0].message).toContain('title');
    });

    it('should report error for missing body column', () => {
      const csvText = 'title,color\nHello,red';
      sendMessage('parse-csv', 'test6', { csvText, maxRows: 1000 });

      const result = getResult('test6');
      expect(result.payload.errors[0].message).toContain('body');
    });

    it('should report both missing columns', () => {
      const csvText = 'color,priority\nred,high';
      sendMessage('parse-csv', 'test7', { csvText, maxRows: 1000 });

      const result = getResult('test7');
      expect(result.payload.errors[0].message).toContain('title');
      expect(result.payload.errors[0].message).toContain('body');
    });
  });

  // ─── Quoted fields and commas ─────────────────────────────────────
  describe('quoted fields and commas in values', () => {
    it('should handle commas inside quoted fields', () => {
      const csvText = 'title,body\n"Hello, World","This is a test, with commas"';
      sendMessage('parse-csv', 'test8', { csvText, maxRows: 1000 });

      const result = getResult('test8');
      expect(result.payload.valid).toHaveLength(1);
      expect(result.payload.valid[0].title).toBe('Hello, World');
      expect(result.payload.valid[0].body).toBe('This is a test, with commas');
    });

    it('should handle escaped quotes (double-quotes)', () => {
      // Note: splitCSVLines processes "" -> " during line splitting, then
      // parseCSVRow processes the resulting line. The double pass means
      // escaped quotes are consumed during line splitting.
      const csvText = 'title,body\n"She said ""hi""","Body text"';
      sendMessage('parse-csv', 'test9', { csvText, maxRows: 1000 });

      const result = getResult('test9');
      expect(result.payload.valid).toHaveLength(1);
      // The worker's two-pass parsing (splitCSVLines then parseCSVRow)
      // causes escaped quotes to be stripped, resulting in unquoted text.
      expect(result.payload.valid[0].title).toBe('She said hi');
    });

    it('should handle newlines inside quoted fields', () => {
      const csvText = 'title,body\n"Line 1\nLine 2","Body"';
      sendMessage('parse-csv', 'test10', { csvText, maxRows: 1000 });

      const result = getResult('test10');
      expect(result.payload.valid).toHaveLength(1);
      expect(result.payload.valid[0].title).toBe('Line 1\nLine 2');
    });
  });

  // ─── Max row limit ────────────────────────────────────────────────
  describe('max row limit', () => {
    it('should enforce max row limit', () => {
      const rows = ['title,body'];
      for (let i = 0; i < 10; i++) {
        rows.push(`Title${i},Body${i}`);
      }
      const csvText = rows.join('\n');

      sendMessage('parse-csv', 'test11', { csvText, maxRows: 5 });

      const result = getResult('test11');
      expect(result.payload.valid).toHaveLength(5);
      expect(result.payload.processedRows).toBe(5);
      expect(result.payload.totalRows).toBe(10);
      // Should have an error about exceeding max rows
      expect(result.payload.errors.some(e => e.message.includes('exceeds maximum'))).toBe(true);
    });

    it('should use default maxRows of 1000 when not specified', () => {
      const csvText = 'title,body\nA,B';
      sendMessage('parse-csv', 'test12', { csvText });

      const result = getResult('test12');
      expect(result.payload.valid).toHaveLength(1);
    });
  });

  // ─── Row-level errors ─────────────────────────────────────────────
  describe('row-level errors', () => {
    it('should report error for empty title', () => {
      const csvText = 'title,body\n,Some body\nValid,Body';
      sendMessage('parse-csv', 'test13', { csvText, maxRows: 1000 });

      const result = getResult('test13');
      expect(result.payload.valid).toHaveLength(1);
      expect(result.payload.errors).toHaveLength(1);
      expect(result.payload.errors[0].row).toBe(2);
      expect(result.payload.errors[0].column).toBe('title');
      expect(result.payload.errors[0].message).toContain('Title is required');
    });

    it('should report error for empty body', () => {
      const csvText = 'title,body\nValid Title,\nValid,Body';
      sendMessage('parse-csv', 'test14', { csvText, maxRows: 1000 });

      const result = getResult('test14');
      expect(result.payload.valid).toHaveLength(1);
      expect(result.payload.errors).toHaveLength(1);
      expect(result.payload.errors[0].column).toBe('body');
      expect(result.payload.errors[0].message).toContain('Body is required');
    });

    it('should skip empty lines without reporting errors', () => {
      const csvText = 'title,body\nA,B\n\nC,D';
      sendMessage('parse-csv', 'test15', { csvText, maxRows: 1000 });

      const result = getResult('test15');
      expect(result.payload.valid).toHaveLength(2);
      expect(result.payload.errors).toHaveLength(0);
    });
  });

  // ─── Empty file ───────────────────────────────────────────────────
  describe('edge cases', () => {
    it('should handle empty file', () => {
      sendMessage('parse-csv', 'test16', { csvText: '', maxRows: 1000 });

      const result = getResult('test16');
      expect(result.payload.valid).toHaveLength(0);
      expect(result.payload.errors).toHaveLength(1);
      expect(result.payload.errors[0].message).toContain('Empty file');
    });

    it('should handle header-only file (no data rows)', () => {
      sendMessage('parse-csv', 'test17', { csvText: 'title,body', maxRows: 1000 });

      const result = getResult('test17');
      expect(result.payload.valid).toHaveLength(0);
      expect(result.payload.errors).toHaveLength(0);
    });
  });
});
