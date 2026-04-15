// Export/Import Web Worker
// Handles room data serialization for file export and merge logic for imports

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

self.onmessage = function(e) {
  const { type, id, payload } = e.data;

  if (type === 'build-export') {
    try {
      const result = buildExport(payload);
      self.postMessage({ type: 'build-export-result', id, payload: result });
    } catch (err) {
      self.postMessage({ type: 'build-export-error', id, error: err.message });
    }
  }

  if (type === 'parse-import') {
    try {
      const result = parseImport(payload.fileContent);
      self.postMessage({ type: 'parse-import-result', id, payload: result });
    } catch (err) {
      self.postMessage({ type: 'parse-import-error', id, error: err.message });
    }
  }

  if (type === 'compute-merge') {
    try {
      const result = computeMerge(payload.local, payload.incoming);
      self.postMessage({ type: 'compute-merge-result', id, payload: result });
    } catch (err) {
      self.postMessage({ type: 'compute-merge-error', id, error: err.message });
    }
  }
};

function buildExport(data) {
  const exportData = {
    version: 1,
    exportedAt: Date.now(),
    room: data.room,
    whiteboardElements: data.whiteboardElements || [],
    comments: data.comments || [],
    stickyNotes: data.stickyNotes || [],
    stickyGroups: data.stickyGroups || [],
    chatMessages: data.chatMessages || [],
    activityLogs: data.activityLogs || []
  };

  const json = JSON.stringify(exportData, null, 2);
  const sizeBytes = new Blob([json]).size;

  if (sizeBytes > MAX_FILE_SIZE) {
    throw new Error(`Export file too large: ${(sizeBytes / 1024 / 1024).toFixed(1)} MB (max 50 MB)`);
  }

  return { json, sizeBytes };
}

function parseImport(fileContent) {
  let data;
  try {
    data = JSON.parse(fileContent);
  } catch {
    throw new Error('Invalid JSON file');
  }

  if (!data.version) {
    throw new Error('Missing version field - not a valid AlignSpace export');
  }

  if (data.version !== 1) {
    throw new Error(`Unsupported export version: ${data.version}`);
  }

  return {
    version: data.version,
    exportedAt: data.exportedAt,
    room: data.room,
    whiteboardElements: data.whiteboardElements || [],
    comments: data.comments || [],
    stickyNotes: data.stickyNotes || [],
    stickyGroups: data.stickyGroups || [],
    chatMessages: data.chatMessages || [],
    activityLogs: data.activityLogs || []
  };
}

function computeMerge(local, incoming) {
  const result = { toInsert: [], toUpdate: [], conflicts: [] };
  const localMap = new Map(local.map(r => [r.id, r]));
  const editTracker = new Map(); // id -> [timestamps]

  for (const record of incoming) {
    const existing = localMap.get(record.id);

    if (!existing) {
      result.toInsert.push(record);
    } else {
      const existingTime = existing.updatedAt || existing.createdAt || 0;
      const incomingTime = record.updatedAt || record.createdAt || 0;

      // Track edits for conflict detection
      if (!editTracker.has(record.id)) {
        editTracker.set(record.id, [existingTime]);
      }
      editTracker.get(record.id).push(incomingTime);

      if (incomingTime > existingTime) {
        result.toUpdate.push(record);
      }
    }
  }

  // Detect conflicts: >2 edits within 10 seconds
  for (const [id, timestamps] of editTracker) {
    if (timestamps.length > 2) {
      timestamps.sort((a, b) => a - b);
      const window = timestamps[timestamps.length - 1] - timestamps[0];
      if (window <= 10000) {
        const record = incoming.find(r => r.id === id) || localMap.get(id);
        if (record) {
          result.conflicts.push({
            originalId: id,
            record: { ...record, id: crypto.randomUUID(), conflictFlag: true, conflictSourceId: id }
          });
        }
      }
    }
  }

  return result;
}
