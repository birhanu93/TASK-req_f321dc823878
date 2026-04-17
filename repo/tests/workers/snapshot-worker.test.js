import { describe, it, expect, beforeEach } from 'vitest';

// Capture messages posted by the worker
const postedMessages = [];

beforeEach(() => {
  postedMessages.length = 0;
});

// Install postMessage before the worker module is imported — it binds self.onmessage at load time.
globalThis.postMessage = (msg) => postedMessages.push(msg);

// Import the worker (executes in-process; assigns self.onmessage). No mocks — real execution.
import '../../js/workers/snapshot-worker.js';

function send(type, id, payload) {
  self.onmessage({ data: { type, id, payload } });
}

function findMessage(id, type) {
  return postedMessages.find(m => m.id === id && m.type === type);
}

describe('snapshot-worker (direct, in-process)', () => {
  describe('create-snapshot: input → output', () => {
    it('serializes a full room payload into a stable JSON string with byte size', () => {
      const payload = {
        room: { id: 'room-1', name: 'Demo', createdAt: 111 },
        whiteboardElements: [{ id: 'e1', type: 'rect', x: 0, y: 0, width: 10, height: 10 }],
        comments: [{ id: 'c1', text: 'hi' }],
        stickyNotes: [{ id: 's1', title: 'T', body: 'B' }],
        stickyGroups: [{ id: 'g1', name: 'G' }],
        chatMessages: [{ id: 'm1', text: 'hello' }]
      };

      send('create-snapshot', 'id-1', payload);

      const msg = findMessage('id-1', 'create-snapshot-result');
      expect(msg, 'worker must post a create-snapshot-result').toBeTruthy();

      // Output shape
      expect(msg).toEqual({
        type: 'create-snapshot-result',
        id: 'id-1',
        payload: { blob: expect.any(String), sizeBytes: expect.any(Number) }
      });

      // State transition: blob is a JSON string that round-trips back to every input collection
      const parsed = JSON.parse(msg.payload.blob);
      expect(parsed.room).toEqual(payload.room);
      expect(parsed.whiteboardElements).toEqual(payload.whiteboardElements);
      expect(parsed.comments).toEqual(payload.comments);
      expect(parsed.stickyNotes).toEqual(payload.stickyNotes);
      expect(parsed.stickyGroups).toEqual(payload.stickyGroups);
      expect(parsed.chatMessages).toEqual(payload.chatMessages);

      // sizeBytes equals the real byte length of the serialized blob
      expect(msg.payload.sizeBytes).toBe(new Blob([msg.payload.blob]).size);
      expect(msg.payload.sizeBytes).toBeGreaterThan(0);
    });

    it('defaults missing collections to empty arrays and keeps room as-is', () => {
      send('create-snapshot', 'id-2', { room: { id: 'r2' } });

      const msg = findMessage('id-2', 'create-snapshot-result');
      expect(msg).toBeTruthy();
      const parsed = JSON.parse(msg.payload.blob);

      expect(parsed.room).toEqual({ id: 'r2' });
      expect(parsed.whiteboardElements).toEqual([]);
      expect(parsed.comments).toEqual([]);
      expect(parsed.stickyNotes).toEqual([]);
      expect(parsed.stickyGroups).toEqual([]);
      expect(parsed.chatMessages).toEqual([]);
    });

    it('sizeBytes grows with payload size (state transition: more data → larger blob)', () => {
      send('create-snapshot', 'small', { room: { id: 'r' }, chatMessages: [] });
      const small = findMessage('small', 'create-snapshot-result').payload.sizeBytes;

      const bigChat = Array.from({ length: 200 }, (_, i) => ({ id: `m${i}`, text: 'x'.repeat(100) }));
      send('create-snapshot', 'big', { room: { id: 'r' }, chatMessages: bigChat });
      const big = findMessage('big', 'create-snapshot-result').payload.sizeBytes;

      expect(big).toBeGreaterThan(small);
      // Lower bound: at least the raw text we added
      expect(big - small).toBeGreaterThan(200 * 100);
    });

    it('posts create-snapshot-error when payload cannot be serialized (circular ref)', () => {
      const cyclic = { room: { id: 'c' } };
      cyclic.room.self = cyclic.room;

      send('create-snapshot', 'err-1', cyclic);

      const err = findMessage('err-1', 'create-snapshot-error');
      expect(err, 'cyclic payloads must surface as create-snapshot-error').toBeTruthy();
      expect(err.error).toMatch(/circular|JSON/i);
      // And NO success message was posted for that id
      expect(findMessage('err-1', 'create-snapshot-result')).toBeUndefined();
    });
  });

  describe('restore-snapshot: input → output', () => {
    it('parses a blob back into the six canonical collections', () => {
      const original = {
        room: { id: 'r', name: 'X' },
        whiteboardElements: [{ id: 'e1' }],
        comments: [{ id: 'c1' }],
        stickyNotes: [{ id: 's1' }],
        stickyGroups: [],
        chatMessages: [{ id: 'm1' }]
      };
      const blob = JSON.stringify(original);

      send('restore-snapshot', 'r-1', { blob });

      const msg = findMessage('r-1', 'restore-snapshot-result');
      expect(msg).toBeTruthy();
      expect(msg.payload).toEqual(original);
    });

    it('fills missing arrays with [] during restore (backwards-compatible)', () => {
      const blob = JSON.stringify({ room: { id: 'legacy' } });

      send('restore-snapshot', 'r-2', { blob });

      const msg = findMessage('r-2', 'restore-snapshot-result');
      expect(msg.payload).toEqual({
        room: { id: 'legacy' },
        whiteboardElements: [],
        comments: [],
        stickyNotes: [],
        stickyGroups: [],
        chatMessages: []
      });
    });

    it('posts restore-snapshot-error on invalid JSON', () => {
      send('restore-snapshot', 'r-err', { blob: '{not-json' });

      const err = findMessage('r-err', 'restore-snapshot-error');
      expect(err).toBeTruthy();
      expect(err.error).toMatch(/JSON|Unexpected/i);
      expect(findMessage('r-err', 'restore-snapshot-result')).toBeUndefined();
    });
  });

  describe('round trip (create → restore)', () => {
    it('a snapshot created by the worker restores to semantically identical data', () => {
      const payload = {
        room: { id: 'rt', name: 'Round Trip', createdAt: 42 },
        whiteboardElements: [
          { id: 'e1', type: 'rect', x: 1, y: 2, width: 30, height: 40 },
          { id: 'e2', type: 'line', x: 0, y: 0, x2: 100, y2: 100 }
        ],
        comments: [{ id: 'c1', elementId: 'e1', text: 'note' }],
        stickyNotes: [{ id: 's1', title: 'T', body: 'B', color: 'yellow' }],
        stickyGroups: [{ id: 'g1', name: 'Group' }],
        chatMessages: [{ id: 'm1', text: 'hello', ts: 1 }]
      };

      send('create-snapshot', 'rt-create', payload);
      const created = findMessage('rt-create', 'create-snapshot-result');
      expect(created).toBeTruthy();

      send('restore-snapshot', 'rt-restore', { blob: created.payload.blob });
      const restored = findMessage('rt-restore', 'restore-snapshot-result');
      expect(restored).toBeTruthy();
      expect(restored.payload).toEqual(payload);
    });
  });

  describe('unknown message types', () => {
    it('ignores messages whose type is neither create-snapshot nor restore-snapshot', () => {
      send('delete-snapshot', 'noop', { anything: true });

      // No result or error for that id
      expect(postedMessages.filter(m => m.id === 'noop')).toHaveLength(0);
    });
  });
});
