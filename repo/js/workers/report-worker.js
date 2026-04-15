// Report generation Web Worker
// Handles analytics aggregation and CSV report generation

self.onmessage = function(e) {
  const { type, id, payload } = e.data;

  if (type === 'generate-funnel') {
    try {
      const result = generateFunnel(payload.events, payload.steps);
      self.postMessage({ type: 'generate-funnel-result', id, payload: result });
    } catch (err) {
      self.postMessage({ type: 'generate-funnel-error', id, error: err.message });
    }
  }

  if (type === 'generate-csv') {
    try {
      const result = generateCSV(payload.data, payload.columns);
      self.postMessage({ type: 'generate-csv-result', id, payload: result });
    } catch (err) {
      self.postMessage({ type: 'generate-csv-error', id, error: err.message });
    }
  }

  if (type === 'aggregate-events') {
    try {
      const result = aggregateEvents(payload.events, payload.groupBy);
      self.postMessage({ type: 'aggregate-events-result', id, payload: result });
    } catch (err) {
      self.postMessage({ type: 'aggregate-events-error', id, error: err.message });
    }
  }
};

function generateFunnel(events, steps) {
  const sessionsByStep = new Map();

  for (const step of steps) {
    sessionsByStep.set(step, new Set());
  }

  for (const event of events) {
    if (sessionsByStep.has(event.event) && event.sessionId) {
      sessionsByStep.get(event.event).add(event.sessionId);
    }
  }

  const firstStepCount = sessionsByStep.get(steps[0])?.size || 0;

  return steps.map((step, index) => {
    const count = sessionsByStep.get(step)?.size || 0;
    const rate = firstStepCount > 0 ? count / firstStepCount : 0;
    const dropoff = index > 0
      ? 1 - (count / (sessionsByStep.get(steps[index - 1])?.size || 1))
      : 0;
    return { step, count, rate: Math.round(rate * 100), dropoff: Math.round(dropoff * 100) };
  });
}

function generateCSV(data, columns) {
  if (!data || data.length === 0) return '';

  const cols = columns || Object.keys(data[0]);
  const lines = [cols.map(escapeCSVField).join(',')];

  for (const row of data) {
    const values = cols.map(col => {
      const val = row[col];
      if (val === null || val === undefined) return '';
      if (typeof val === 'object') return escapeCSVField(JSON.stringify(val));
      return escapeCSVField(String(val));
    });
    lines.push(values.join(','));
  }

  return lines.join('\n');
}

function escapeCSVField(field) {
  if (field.includes(',') || field.includes('"') || field.includes('\n') || field.includes('\r')) {
    return '"' + field.replace(/"/g, '""') + '"';
  }
  return field;
}

function aggregateEvents(events, groupBy) {
  const groups = new Map();

  for (const event of events) {
    let key;
    if (groupBy === 'event') {
      key = event.event;
    } else if (groupBy === 'day') {
      key = new Date(event.timestamp).toISOString().split('T')[0];
    } else if (groupBy === 'hour') {
      const d = new Date(event.timestamp);
      key = `${d.toISOString().split('T')[0]} ${String(d.getHours()).padStart(2, '0')}:00`;
    } else {
      key = event[groupBy] || 'unknown';
    }

    if (!groups.has(key)) {
      groups.set(key, { key, count: 0, uniqueSessions: new Set() });
    }
    const group = groups.get(key);
    group.count++;
    if (event.sessionId) group.uniqueSessions.add(event.sessionId);
  }

  return Array.from(groups.values()).map(g => ({
    key: g.key,
    count: g.count,
    uniqueSessions: g.uniqueSessions.size
  })).sort((a, b) => b.count - a.count);
}
