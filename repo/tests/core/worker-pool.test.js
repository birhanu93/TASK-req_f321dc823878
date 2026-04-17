import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Direct unit test for core/worker-pool with a real in-process Worker polyfill.
 *
 * worker-pool.js caches `workersAvailable = typeof Worker !== 'undefined'` at module load
 * time, and jsdom does not define Worker. We therefore install a polyfill constructor on
 * `globalThis.Worker` BEFORE the module is loaded and use `vi.resetModules()` +
 * dynamic `import()` so every test gets a fresh module evaluation that sees the polyfill.
 *
 * Messages flow through `postMessage` → MessageEvent on the polyfill Worker, so worker-pool's
 * correlation, progress, and error-routing branches run against a real dispatcher — not a
 * `vi.spyOn(... 'postToWorker')` mock.
 */

// Hand-rolled handlers that reply via the caller-supplied `reply` function.
// No vitest spies — just echo semantics exercised by each test case.
const HANDLERS = {
  '/js/workers/csv-worker.js': (msg, reply) => {
    if (msg.type === 'parse-csv') {
      reply({ type: 'parse-csv-result', id: msg.id, payload: { parsed: msg.payload.csvText } });
    } else if (msg.type === 'parse-csv-progress') {
      reply({ type: 'progress', id: msg.id, payload: { done: 1, total: 2 } });
      reply({ type: 'progress', id: msg.id, payload: { done: 2, total: 2 } });
      reply({ type: 'parse-csv-result', id: msg.id, payload: { parsed: 'ok' } });
    } else if (msg.type === 'parse-csv-error') {
      reply({ type: 'parse-csv-error', id: msg.id, error: 'boom' });
    } else if (msg.type === 'interleave') {
      // Reply with a wrong id first — worker-pool must silently ignore it
      reply({ type: 'parse-csv-result', id: 'WRONG-ID', payload: { ghost: true } });
      reply({ type: 'parse-csv-result', id: msg.id, payload: { correlated: true } });
    }
  },
  '/js/workers/snapshot-worker.js': (msg, reply) => {
    reply({ type: 'create-snapshot-result', id: msg.id, payload: { sizeBytes: 42 } });
  }
};

function installWorker(customHandlers, countRef) {
  class FakeWorker extends EventTarget {
    constructor(url) {
      super();
      if (countRef) countRef.count++;
      this.url = url;
      this.terminated = false;
      const handler = customHandlers[url];
      if (!handler) throw new Error(`No fake handler for worker url: ${url}`);
      this._handler = handler;
    }
    postMessage(data) {
      if (this.terminated) return;
      Promise.resolve().then(() => {
        this._handler(data, (replyData) => {
          if (!this.terminated) {
            this.dispatchEvent(new MessageEvent('message', { data: replyData }));
          }
        });
      });
    }
    terminate() { this.terminated = true; }
  }
  globalThis.Worker = FakeWorker;
}

async function loadFreshWorkerPool() {
  // Force re-evaluation so `workersAvailable = typeof Worker !== 'undefined'` re-reads globalThis
  vi.resetModules();
  return await import('../../js/core/worker-pool.js');
}

describe('core/worker-pool (direct, in-process Worker polyfill — no postToWorker spies)', () => {
  beforeEach(() => {
    installWorker(HANDLERS);
  });

  afterEach(async () => {
    // Clean up any workers cached in the fresh module graph
    try {
      const mod = await import('../../js/core/worker-pool.js');
      mod.terminateAll?.();
    } catch { /* ignore */ }
    delete globalThis.Worker;
  });

  describe('isAvailable()', () => {
    it('returns true when a Worker constructor is defined on the global at module load', async () => {
      const { isAvailable } = await loadFreshWorkerPool();
      expect(isAvailable()).toBe(true);
    });
  });

  describe('request/response correlation', () => {
    it('resolves with the worker payload tagged with the same id it dispatched', async () => {
      const { postToWorker } = await loadFreshWorkerPool();
      const result = await postToWorker('csv', 'parse-csv', { csvText: 'hello' });
      expect(result).toEqual({ parsed: 'hello' });
    });

    it('ignores messages whose id does not match the request, then resolves on the correct id', async () => {
      const { postToWorker } = await loadFreshWorkerPool();
      const result = await postToWorker('csv', 'interleave', { anything: true });
      expect(result).toEqual({ correlated: true });
    });

    it('dispatches to the URL corresponding to the worker name', async () => {
      const { postToWorker } = await loadFreshWorkerPool();
      const result = await postToWorker('snapshot', 'create-snapshot', { room: { id: 'r' } });
      expect(result).toEqual({ sizeBytes: 42 });
    });
  });

  describe('progress callback', () => {
    it('invokes onProgress for every "progress"-type message without resolving the promise', async () => {
      const { postToWorker } = await loadFreshWorkerPool();
      const progress = [];
      const result = await postToWorker('csv', 'parse-csv-progress', {}, (p) => progress.push(p));

      expect(progress).toEqual([
        { done: 1, total: 2 },
        { done: 2, total: 2 }
      ]);
      expect(result).toEqual({ parsed: 'ok' });
    });
  });

  describe('error routing', () => {
    it('rejects with an Error carrying the worker\'s error string when the response type ends with "-error"', async () => {
      const { postToWorker } = await loadFreshWorkerPool();
      await expect(postToWorker('csv', 'parse-csv-error', {})).rejects.toThrow('boom');
    });
  });

  describe('unknown worker name', () => {
    it('throws synchronously when asked for a worker name that is not registered', async () => {
      const { postToWorker } = await loadFreshWorkerPool();
      expect(() => postToWorker('not-a-real-worker', 'any', {})).toThrow(/Unknown worker/);
    });
  });

  describe('worker reuse (module-scope cache)', () => {
    it('reuses the same Worker instance across calls with the same name', async () => {
      const counter = { count: 0 };
      installWorker(HANDLERS, counter);
      const { postToWorker } = await loadFreshWorkerPool();

      const r1 = await postToWorker('csv', 'parse-csv', { csvText: 'a' });
      const r2 = await postToWorker('csv', 'parse-csv', { csvText: 'b' });

      expect(r1).toEqual({ parsed: 'a' });
      expect(r2).toEqual({ parsed: 'b' });
      expect(counter.count).toBe(1);
    });
  });

  describe('fallback when Worker construction throws', () => {
    it('returns null (caller uses the fallback path) when new Worker() throws at runtime', async () => {
      class ThrowingWorker { constructor() { throw new Error('workers disabled'); } }
      globalThis.Worker = ThrowingWorker;
      const { postToWorker } = await loadFreshWorkerPool();
      expect(postToWorker('csv', 'parse-csv', { csvText: 'x' })).toBeNull();
    });

    it('returns null when Worker is not defined at module load', async () => {
      delete globalThis.Worker;
      const { postToWorker, isAvailable } = await loadFreshWorkerPool();
      expect(isAvailable()).toBe(false);
      expect(postToWorker('csv', 'parse-csv', { csvText: 'x' })).toBeNull();
    });
  });
});
