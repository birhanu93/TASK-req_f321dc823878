// CSV parsing Web Worker
// Handles CSV import validation for sticky notes

self.onmessage = function(e) {
  const { type, id, payload } = e.data;

  if (type === 'parse-csv') {
    try {
      const result = parseCSV(payload.csvText, payload.maxRows || 1000);
      self.postMessage({ type: 'parse-csv-result', id, payload: result });
    } catch (err) {
      self.postMessage({ type: 'parse-csv-error', id, error: err.message });
    }
  }
};

function parseCSV(text, maxRows) {
  const lines = splitCSVLines(text);
  if (lines.length === 0) {
    return { valid: [], errors: [{ row: 0, column: '', message: 'Empty file' }] };
  }

  // Parse header
  const headers = parseCSVRow(lines[0]).map(h => h.trim().toLowerCase());
  const titleIdx = headers.indexOf('title');
  const bodyIdx = headers.indexOf('body');

  if (titleIdx === -1 || bodyIdx === -1) {
    const missing = [];
    if (titleIdx === -1) missing.push('title');
    if (bodyIdx === -1) missing.push('body');
    return {
      valid: [],
      errors: [{ row: 1, column: '', message: `Missing required column(s): ${missing.join(', ')}` }]
    };
  }

  const valid = [];
  const errors = [];
  const dataLines = lines.slice(1);

  if (dataLines.length > maxRows) {
    errors.push({ row: 0, column: '', message: `File exceeds maximum of ${maxRows} rows (found ${dataLines.length})` });
  }

  const limit = Math.min(dataLines.length, maxRows);

  for (let i = 0; i < limit; i++) {
    const rowNum = i + 2; // 1-indexed, skip header
    const line = dataLines[i].trim();
    if (!line) continue;

    const fields = parseCSVRow(line);
    const title = (fields[titleIdx] || '').trim();
    const body = (fields[bodyIdx] || '').trim();

    if (!title) {
      errors.push({ row: rowNum, column: 'title', message: 'Title is required' });
      continue;
    }

    if (!body) {
      errors.push({ row: rowNum, column: 'body', message: 'Body is required' });
      continue;
    }

    // Collect all other columns as extra data
    const extra = {};
    for (let j = 0; j < headers.length; j++) {
      if (j !== titleIdx && j !== bodyIdx && headers[j]) {
        extra[headers[j]] = (fields[j] || '').trim();
      }
    }

    valid.push({ title, body, extra, sourceRow: rowNum });

    // Report progress periodically
    if (i > 0 && i % 100 === 0) {
      self.postMessage({ type: 'progress', id, payload: { percent: Math.round((i / limit) * 100) } });
    }
  }

  return { valid, errors, totalRows: dataLines.length, processedRows: limit };
}

function splitCSVLines(text) {
  const lines = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
        current += ch;
      }
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      lines.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim()) lines.push(current);
  return lines;
}

function parseCSVRow(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  fields.push(current);
  return fields;
}
