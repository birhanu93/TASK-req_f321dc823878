import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture messages posted by the worker
const postedMessages = [];

beforeEach(() => {
  postedMessages.length = 0;
});

// Mock self.postMessage before importing the worker
globalThis.postMessage = (msg) => postedMessages.push(msg);

// Import the worker, which sets self.onmessage
import '../../js/workers/report-worker.js';

function sendMessage(type, id, payload) {
  self.onmessage({ data: { type, id, payload } });
}

function getResult(type, id) {
  return postedMessages.find(m => m.id === id && m.type === type);
}

describe('report-worker', () => {
  // ─── generateFunnel ───────────────────────────────────────────────
  describe('generateFunnel', () => {
    it('should count unique sessions per step', () => {
      const events = [
        { event: 'pageview', sessionId: 's1' },
        { event: 'pageview', sessionId: 's2' },
        { event: 'pageview', sessionId: 's1' }, // duplicate session
        { event: 'signup', sessionId: 's1' },
        { event: 'signup', sessionId: 's2' },
        { event: 'purchase', sessionId: 's1' }
      ];
      const steps = ['pageview', 'signup', 'purchase'];

      sendMessage('generate-funnel', 'fun1', { events, steps });

      const result = getResult('generate-funnel-result', 'fun1');
      expect(result).toBeTruthy();

      const payload = result.payload;
      expect(payload).toHaveLength(3);

      // pageview: 2 unique sessions
      expect(payload[0].step).toBe('pageview');
      expect(payload[0].count).toBe(2);

      // signup: 2 unique sessions
      expect(payload[1].step).toBe('signup');
      expect(payload[1].count).toBe(2);

      // purchase: 1 unique session
      expect(payload[2].step).toBe('purchase');
      expect(payload[2].count).toBe(1);
    });

    it('should calculate rate as percentage relative to first step', () => {
      const events = [
        { event: 'view', sessionId: 's1' },
        { event: 'view', sessionId: 's2' },
        { event: 'view', sessionId: 's3' },
        { event: 'view', sessionId: 's4' },
        { event: 'click', sessionId: 's1' },
        { event: 'click', sessionId: 's2' },
        { event: 'buy', sessionId: 's1' }
      ];
      const steps = ['view', 'click', 'buy'];

      sendMessage('generate-funnel', 'fun2', { events, steps });

      const result = getResult('generate-funnel-result', 'fun2');
      const payload = result.payload;

      // view: 4 sessions, rate = 100%
      expect(payload[0].rate).toBe(100);
      // click: 2 sessions, rate = 2/4 = 50%
      expect(payload[1].rate).toBe(50);
      // buy: 1 session, rate = 1/4 = 25%
      expect(payload[2].rate).toBe(25);
    });

    it('should calculate dropoff rate between consecutive steps', () => {
      const events = [
        { event: 'step1', sessionId: 's1' },
        { event: 'step1', sessionId: 's2' },
        { event: 'step1', sessionId: 's3' },
        { event: 'step1', sessionId: 's4' },
        { event: 'step2', sessionId: 's1' },
        { event: 'step2', sessionId: 's2' },
        { event: 'step3', sessionId: 's1' }
      ];
      const steps = ['step1', 'step2', 'step3'];

      sendMessage('generate-funnel', 'fun3', { events, steps });

      const result = getResult('generate-funnel-result', 'fun3');
      const payload = result.payload;

      // First step has no dropoff
      expect(payload[0].dropoff).toBe(0);
      // step2 dropoff: 1 - (2/4) = 50%
      expect(payload[1].dropoff).toBe(50);
      // step3 dropoff: 1 - (1/2) = 50%
      expect(payload[2].dropoff).toBe(50);
    });

    it('should handle empty events', () => {
      sendMessage('generate-funnel', 'fun4', { events: [], steps: ['a', 'b'] });

      const result = getResult('generate-funnel-result', 'fun4');
      expect(result.payload).toHaveLength(2);
      expect(result.payload[0].count).toBe(0);
      expect(result.payload[0].rate).toBe(0);
    });

    it('should ignore events without sessionId', () => {
      const events = [
        { event: 'pageview', sessionId: 's1' },
        { event: 'pageview' }, // no sessionId
        { event: 'signup', sessionId: 's1' }
      ];
      const steps = ['pageview', 'signup'];

      sendMessage('generate-funnel', 'fun5', { events, steps });

      const result = getResult('generate-funnel-result', 'fun5');
      expect(result.payload[0].count).toBe(1);
    });

    it('should ignore events not in the steps list', () => {
      const events = [
        { event: 'pageview', sessionId: 's1' },
        { event: 'unrelated', sessionId: 's1' },
        { event: 'signup', sessionId: 's1' }
      ];
      const steps = ['pageview', 'signup'];

      sendMessage('generate-funnel', 'fun6', { events, steps });

      const result = getResult('generate-funnel-result', 'fun6');
      expect(result.payload).toHaveLength(2);
    });
  });

  // ─── generateCSV ──────────────────────────────────────────────────
  describe('generateCSV', () => {
    it('should create CSV with headers and data rows', () => {
      const data = [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 }
      ];
      const columns = ['name', 'age'];

      sendMessage('generate-csv', 'csv1', { data, columns });

      const result = getResult('generate-csv-result', 'csv1');
      expect(result).toBeTruthy();

      const lines = result.payload.split('\n');
      expect(lines[0]).toBe('name,age');
      expect(lines[1]).toBe('Alice,30');
      expect(lines[2]).toBe('Bob,25');
    });

    it('should auto-detect columns from data keys when columns not provided', () => {
      const data = [{ x: 1, y: 2, z: 3 }];

      sendMessage('generate-csv', 'csv2', { data });

      const result = getResult('generate-csv-result', 'csv2');
      const lines = result.payload.split('\n');
      expect(lines[0]).toBe('x,y,z');
      expect(lines[1]).toBe('1,2,3');
    });

    it('should escape fields containing commas', () => {
      const data = [{ name: 'Doe, Jane', city: 'New York' }];
      const columns = ['name', 'city'];

      sendMessage('generate-csv', 'csv3', { data, columns });

      const result = getResult('generate-csv-result', 'csv3');
      const lines = result.payload.split('\n');
      expect(lines[1]).toBe('"Doe, Jane",New York');
    });

    it('should escape fields containing quotes', () => {
      const data = [{ title: 'She said "hello"', body: 'text' }];
      const columns = ['title', 'body'];

      sendMessage('generate-csv', 'csv4', { data, columns });

      const result = getResult('generate-csv-result', 'csv4');
      const lines = result.payload.split('\n');
      expect(lines[1]).toBe('"She said ""hello""",text');
    });

    it('should handle null and undefined values as empty string', () => {
      const data = [{ a: null, b: undefined, c: 'ok' }];
      const columns = ['a', 'b', 'c'];

      sendMessage('generate-csv', 'csv5', { data, columns });

      const result = getResult('generate-csv-result', 'csv5');
      const lines = result.payload.split('\n');
      expect(lines[1]).toBe(',,ok');
    });

    it('should serialize object values as JSON', () => {
      const data = [{ name: 'Test', meta: { key: 'value' } }];
      const columns = ['name', 'meta'];

      sendMessage('generate-csv', 'csv6', { data, columns });

      const result = getResult('generate-csv-result', 'csv6');
      const lines = result.payload.split('\n');
      // JSON contains commas, so it should be quoted
      expect(lines[1]).toContain('"');
    });

    it('should return empty string for empty data', () => {
      sendMessage('generate-csv', 'csv7', { data: [], columns: ['a', 'b'] });

      const result = getResult('generate-csv-result', 'csv7');
      expect(result.payload).toBe('');
    });

    it('should return empty string for null data', () => {
      sendMessage('generate-csv', 'csv8', { data: null, columns: ['a'] });

      const result = getResult('generate-csv-result', 'csv8');
      expect(result.payload).toBe('');
    });
  });

  // ─── aggregateEvents ──────────────────────────────────────────────
  describe('aggregateEvents', () => {
    it('should group by event name', () => {
      const events = [
        { event: 'click', sessionId: 's1', timestamp: 1000 },
        { event: 'click', sessionId: 's2', timestamp: 2000 },
        { event: 'view', sessionId: 's1', timestamp: 3000 },
        { event: 'view', sessionId: 's1', timestamp: 4000 },
        { event: 'view', sessionId: 's2', timestamp: 5000 }
      ];

      sendMessage('aggregate-events', 'agg1', { events, groupBy: 'event' });

      const result = getResult('aggregate-events-result', 'agg1');
      expect(result).toBeTruthy();

      const payload = result.payload;
      // Sorted by count descending
      expect(payload[0].key).toBe('view');
      expect(payload[0].count).toBe(3);
      expect(payload[0].uniqueSessions).toBe(2);

      expect(payload[1].key).toBe('click');
      expect(payload[1].count).toBe(2);
      expect(payload[1].uniqueSessions).toBe(2);
    });

    it('should group by day', () => {
      const events = [
        { event: 'click', sessionId: 's1', timestamp: new Date('2026-04-14T10:00:00Z').getTime() },
        { event: 'click', sessionId: 's2', timestamp: new Date('2026-04-14T15:00:00Z').getTime() },
        { event: 'click', sessionId: 's1', timestamp: new Date('2026-04-15T08:00:00Z').getTime() }
      ];

      sendMessage('aggregate-events', 'agg2', { events, groupBy: 'day' });

      const result = getResult('aggregate-events-result', 'agg2');
      const payload = result.payload;
      expect(payload).toHaveLength(2);

      // The day with 2 events should come first (sorted by count desc)
      const april14 = payload.find(g => g.key === '2026-04-14');
      const april15 = payload.find(g => g.key === '2026-04-15');
      expect(april14).toBeTruthy();
      expect(april14.count).toBe(2);
      expect(april15).toBeTruthy();
      expect(april15.count).toBe(1);
    });

    it('should group by hour', () => {
      // Use timestamps where two events share the same local hour
      // Build timestamps from a known local-time base to avoid timezone issues
      const base = new Date(2026, 3, 14, 14, 0, 0).getTime(); // Apr 14, 2026 14:00 local
      const events = [
        { event: 'click', sessionId: 's1', timestamp: base },
        { event: 'click', sessionId: 's2', timestamp: base + 15 * 60 * 1000 }, // 14:15 local
        { event: 'click', sessionId: 's1', timestamp: base + 60 * 60 * 1000 }  // 15:00 local
      ];

      sendMessage('aggregate-events', 'agg3', { events, groupBy: 'hour' });

      const result = getResult('aggregate-events-result', 'agg3');
      const payload = result.payload;
      expect(payload).toHaveLength(2);

      // The group with 2 events should be sorted first (by count desc)
      expect(payload[0].count).toBe(2);
      expect(payload[1].count).toBe(1);
    });

    it('should group by arbitrary field', () => {
      const events = [
        { event: 'click', sessionId: 's1', timestamp: 1000, browser: 'chrome' },
        { event: 'click', sessionId: 's2', timestamp: 2000, browser: 'chrome' },
        { event: 'click', sessionId: 's3', timestamp: 3000, browser: 'firefox' }
      ];

      sendMessage('aggregate-events', 'agg4', { events, groupBy: 'browser' });

      const result = getResult('aggregate-events-result', 'agg4');
      const payload = result.payload;
      expect(payload).toHaveLength(2);

      const chrome = payload.find(g => g.key === 'chrome');
      expect(chrome.count).toBe(2);
      expect(chrome.uniqueSessions).toBe(2);

      const firefox = payload.find(g => g.key === 'firefox');
      expect(firefox.count).toBe(1);
    });

    it('should track unique sessions per group', () => {
      const events = [
        { event: 'click', sessionId: 's1', timestamp: 1000 },
        { event: 'click', sessionId: 's1', timestamp: 2000 }, // same session
        { event: 'click', sessionId: 's2', timestamp: 3000 }
      ];

      sendMessage('aggregate-events', 'agg5', { events, groupBy: 'event' });

      const result = getResult('aggregate-events-result', 'agg5');
      expect(result.payload[0].count).toBe(3);
      expect(result.payload[0].uniqueSessions).toBe(2);
    });

    it('should sort results by count descending', () => {
      const events = [
        { event: 'rare', sessionId: 's1', timestamp: 1000 },
        { event: 'common', sessionId: 's1', timestamp: 2000 },
        { event: 'common', sessionId: 's2', timestamp: 3000 },
        { event: 'common', sessionId: 's3', timestamp: 4000 }
      ];

      sendMessage('aggregate-events', 'agg6', { events, groupBy: 'event' });

      const result = getResult('aggregate-events-result', 'agg6');
      expect(result.payload[0].key).toBe('common');
      expect(result.payload[0].count).toBe(3);
      expect(result.payload[1].key).toBe('rare');
      expect(result.payload[1].count).toBe(1);
    });

    it('should handle empty events', () => {
      sendMessage('aggregate-events', 'agg7', { events: [], groupBy: 'event' });

      const result = getResult('aggregate-events-result', 'agg7');
      expect(result.payload).toHaveLength(0);
    });

    it('should use "unknown" for missing groupBy field', () => {
      const events = [
        { event: 'click', sessionId: 's1', timestamp: 1000 }
      ];

      sendMessage('aggregate-events', 'agg8', { events, groupBy: 'nonexistent' });

      const result = getResult('aggregate-events-result', 'agg8');
      expect(result.payload[0].key).toBe('unknown');
    });
  });
});
