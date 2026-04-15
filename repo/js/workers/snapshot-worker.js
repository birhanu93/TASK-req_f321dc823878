// Snapshot serialization Web Worker
// Handles room state serialization for snapshots

self.onmessage = function(e) {
  const { type, id, payload } = e.data;

  if (type === 'create-snapshot') {
    try {
      const result = serializeSnapshot(payload);
      self.postMessage({ type: 'create-snapshot-result', id, payload: result });
    } catch (err) {
      self.postMessage({ type: 'create-snapshot-error', id, error: err.message });
    }
  }

  if (type === 'restore-snapshot') {
    try {
      const result = deserializeSnapshot(payload.blob);
      self.postMessage({ type: 'restore-snapshot-result', id, payload: result });
    } catch (err) {
      self.postMessage({ type: 'restore-snapshot-error', id, error: err.message });
    }
  }
};

function serializeSnapshot(data) {
  const snapshot = {
    room: data.room,
    whiteboardElements: data.whiteboardElements || [],
    comments: data.comments || [],
    stickyNotes: data.stickyNotes || [],
    stickyGroups: data.stickyGroups || [],
    chatMessages: data.chatMessages || []
  };

  const blob = JSON.stringify(snapshot);
  const sizeBytes = new Blob([blob]).size;

  return { blob, sizeBytes };
}

function deserializeSnapshot(blob) {
  const data = JSON.parse(blob);
  return {
    room: data.room,
    whiteboardElements: data.whiteboardElements || [],
    comments: data.comments || [],
    stickyNotes: data.stickyNotes || [],
    stickyGroups: data.stickyGroups || [],
    chatMessages: data.chatMessages || []
  };
}
