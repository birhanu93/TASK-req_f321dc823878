import { db } from '../core/db.js';
import { bus } from '../core/event-bus.js';
import { store } from '../core/store.js';
import { sync } from '../core/sync.js';
import { autosave } from '../core/autosave.js';
import { enforceQuota, invalidateCache } from '../core/quota-guard.js';
import { postToWorker } from '../core/worker-pool.js';
import { activityService } from './activity-service.js';
import { uuid, now } from '../core/utils.js';

const NOTES_STORE = 'stickyNotes';
const GROUPS_STORE = 'stickyGroups';
const MAX_CSV_ROWS = 1000;
const STAGGER_OFFSET = 30;
const DEFAULT_COLOR = '#FFEB3B';

export const stickyService = {
  /**
   * Create a sticky note.
   * @param {string} roomId
   * @param {object} data - { title, body, color, posX, posY, groupId }
   * @returns {object} The created note
   */
  async createNote(roomId, data = {}) {
    if (!roomId) throw new Error('roomId is required');
    await enforceQuota(roomId);

    const currentUser = store.get('currentUser');

    const note = {
      id: uuid(),
      roomId,
      title: data.title || '',
      body: data.body || '',
      color: data.color || DEFAULT_COLOR,
      posX: data.posX ?? 0,
      posY: data.posY ?? 0,
      groupId: data.groupId || null,
      deleted: false,
      createdBy: currentUser?.id || null,
      createdAt: now(),
      updatedAt: now()
    };

    await db.put(NOTES_STORE, note);
    autosave.markDirty(NOTES_STORE, note.id, note);
    invalidateCache(roomId);
    activityService.logActivity(roomId, 'create', 'stickyNote', note.id, `Created sticky note "${note.title}"`);
    bus.emit('sticky:created', note);
    sync.broadcast({ type: 'db-change', store: NOTES_STORE, action: 'add', id: note.id, roomId });
    return note;
  },

  /**
   * Update an existing sticky note by merging changes.
   * @param {string} id
   * @param {object} changes
   * @returns {object} The updated note
   */
  async updateNote(id, changes) {
    const note = await db.get(NOTES_STORE, id);
    if (!note) throw new Error('Note not found');

    const { id: _id, roomId: _rid, createdBy: _cb, createdAt: _ca, ...allowed } = changes;
    Object.assign(note, allowed, { updatedAt: now() });
    await db.put(NOTES_STORE, note);
    autosave.markDirty(NOTES_STORE, note.id, note);
    invalidateCache(note.roomId);

    bus.emit('sticky:updated', note);
    sync.broadcast({ type: 'db-change', store: NOTES_STORE, action: 'update', id: note.id, roomId: note.roomId });
    return note;
  },

  /**
   * Soft-delete a sticky note.
   * @param {string} id
   */
  async deleteNote(id) {
    const note = await db.get(NOTES_STORE, id);
    if (!note) throw new Error('Note not found');

    note.deleted = true;
    note.updatedAt = now();
    await db.put(NOTES_STORE, note);
    autosave.markDirty(NOTES_STORE, note.id, note);
    invalidateCache(note.roomId);
    activityService.logActivity(note.roomId, 'delete', 'stickyNote', note.id, `Deleted sticky note "${note.title}"`);

    bus.emit('sticky:deleted', { id, roomId: note.roomId });
    sync.broadcast({ type: 'db-change', store: NOTES_STORE, action: 'delete', id, roomId: note.roomId });
  },

  /**
   * Move a sticky note to a new position.
   * @param {string} id
   * @param {number} posX
   * @param {number} posY
   * @returns {object} The updated note
   */
  async moveNote(id, posX, posY) {
    const note = await db.get(NOTES_STORE, id);
    if (!note) throw new Error('Note not found');

    note.posX = posX;
    note.posY = posY;
    note.updatedAt = now();
    await db.put(NOTES_STORE, note);
    autosave.markDirty(NOTES_STORE, note.id, note);

    bus.emit('sticky:moved', { id, posX, posY, roomId: note.roomId });
    sync.broadcast({ type: 'db-change', store: NOTES_STORE, action: 'move', id, roomId: note.roomId });
    return note;
  },

  /**
   * Get all non-deleted sticky notes for a room.
   * @param {string} roomId
   * @returns {Array<object>}
   */
  async getNotesByRoom(roomId) {
    const notes = await db.getAllByIndex(NOTES_STORE, 'roomId', roomId);
    return notes.filter(n => !n.deleted);
  },

  /**
   * Create a sticky group.
   * @param {string} roomId
   * @param {string} name
   * @param {string} color
   * @returns {object} The created group
   */
  async createGroup(roomId, name, color) {
    if (!roomId) throw new Error('roomId is required');
    if (!name) throw new Error('Group name is required');

    const group = {
      id: uuid(),
      roomId,
      name,
      color: color || DEFAULT_COLOR,
      createdAt: now(),
      updatedAt: now()
    };

    await db.put(GROUPS_STORE, group);
    bus.emit('sticky:group-created', group);
    return group;
  },

  /**
   * Get all groups for a room.
   * @param {string} roomId
   * @returns {Array<object>}
   */
  async getGroups(roomId) {
    return db.getAllByIndex(GROUPS_STORE, 'roomId', roomId);
  },

  /**
   * Delete a group and ungroup all its notes.
   * @param {string} id
   */
  async deleteGroup(id) {
    const group = await db.get(GROUPS_STORE, id);
    if (!group) throw new Error('Group not found');

    // Ungroup all notes belonging to this group
    const notes = await db.getAllByIndex(NOTES_STORE, 'groupId', id);
    for (const note of notes) {
      note.groupId = null;
      note.updatedAt = now();
    }
    if (notes.length > 0) {
      await db.putBatch(NOTES_STORE, notes);
    }

    await db.delete(GROUPS_STORE, id);
    bus.emit('sticky:group-deleted', { id, roomId: group.roomId });
    sync.broadcast({ type: 'db-change', store: GROUPS_STORE, action: 'delete', id, roomId: group.roomId });
  },

  /**
   * Assign a sticky note to a group.
   * @param {string} noteId
   * @param {string|null} groupId
   * @returns {object} The updated note
   */
  async assignToGroup(noteId, groupId) {
    const note = await db.get(NOTES_STORE, noteId);
    if (!note) throw new Error('Note not found');

    note.groupId = groupId;
    note.updatedAt = now();
    await db.put(NOTES_STORE, note);
    autosave.markDirty(NOTES_STORE, note.id, note);

    bus.emit('sticky:updated', note);
    sync.broadcast({ type: 'db-change', store: NOTES_STORE, action: 'update', id: noteId, roomId: note.roomId });
    return note;
  },

  /**
   * Import sticky notes from CSV text.
   * Required columns: 'title' and 'body'. Extra columns are ignored.
   * Max 1000 rows. Handles quoted fields, commas within quotes, header detection.
   *
   * @param {string} roomId
   * @param {string} csvText
   * @returns {{ imported: number, errors: Array<{ row: number, column: string, message: string }> }}
   */
  async importCSV(roomId, csvText, onProgress) {
    if (!roomId) throw new Error('roomId is required');
    if (!csvText || csvText.trim().length === 0) throw new Error('CSV text is empty');
    await enforceQuota(roomId);

    // Try worker-backed parsing; fall back to main thread
    let parsed;
    const workerResult = postToWorker('csv', 'parse-csv', { csvText, maxRows: MAX_CSV_ROWS }, onProgress);
    if (workerResult) {
      parsed = await workerResult;
    } else {
      parsed = this._parseCSVInline(csvText);
    }

    const { valid, errors } = parsed;

    // Create notes with staggered positioning
    const currentUser = store.get('currentUser');
    const notes = valid.map((item, idx) => ({
      id: uuid(),
      roomId,
      title: item.title,
      body: item.body,
      color: DEFAULT_COLOR,
      posX: STAGGER_OFFSET * (idx % 20),
      posY: STAGGER_OFFSET * Math.floor(idx / 20),
      groupId: null,
      deleted: false,
      createdBy: currentUser?.id || null,
      createdAt: now(),
      updatedAt: now()
    }));

    if (notes.length > 0) {
      await db.putBatch(NOTES_STORE, notes);
      invalidateCache(roomId);
    }

    activityService.logActivity(roomId, 'import', 'stickyNote', roomId, `Imported ${notes.length} sticky notes from CSV`, { count: notes.length, errorCount: errors.length });
    bus.emit('sticky:imported', { roomId, count: notes.length });
    sync.broadcast({ type: 'db-change', store: NOTES_STORE, action: 'import', roomId, count: notes.length });

    return { imported: notes.length, errors };
  },

  /** Main-thread fallback for CSV parsing when Worker is unavailable */
  _parseCSVInline(csvText) {
    const lines = _parseCSV(csvText);
    if (lines.length < 2) {
      throw new Error('CSV must contain a header row and at least one data row');
    }

    const headers = lines[0].map(h => h.trim().toLowerCase());
    const titleIdx = headers.indexOf('title');
    const bodyIdx = headers.indexOf('body');
    const errors = [];

    if (titleIdx === -1) errors.push({ row: 1, column: 'title', message: 'Missing required column: title' });
    if (bodyIdx === -1) errors.push({ row: 1, column: 'body', message: 'Missing required column: body' });
    if (titleIdx === -1 || bodyIdx === -1) return { valid: [], errors };

    const dataRows = lines.slice(1);
    if (dataRows.length > MAX_CSV_ROWS) {
      errors.push({ row: 0, column: '', message: `CSV exceeds maximum of ${MAX_CSV_ROWS} rows. Only the first ${MAX_CSV_ROWS} rows will be processed.` });
    }

    const valid = [];
    const limit = Math.min(dataRows.length, MAX_CSV_ROWS);
    for (let i = 0; i < limit; i++) {
      const row = dataRows[i];
      const rowNum = i + 2;
      const title = (row[titleIdx] || '').trim();
      const body = (row[bodyIdx] || '').trim();
      if (!title && !body) { errors.push({ row: rowNum, column: 'title', message: 'Both title and body are empty' }); continue; }
      if (!title) { errors.push({ row: rowNum, column: 'title', message: 'Title is empty' }); continue; }
      valid.push({ title, body, sourceRow: rowNum });
    }
    return { valid, errors };
  },

  /**
   * Convert an array of import errors to a CSV string for download.
   * @param {Array<{ row: number, column: string, message: string }>} errors
   * @returns {string} CSV text
   */
  exportErrorCSV(errors) {
    if (!errors || errors.length === 0) return '';

    const header = 'row,column,message';
    const rows = errors.map(e =>
      `${e.row},${_escapeCSVField(e.column)},${_escapeCSVField(e.message)}`
    );

    return [header, ...rows].join('\n');
  }
};

/**
 * Parse CSV text into a 2D array of strings.
 * Handles: quoted fields, commas inside quotes, escaped quotes (""), newlines in quotes.
 * @param {string} text
 * @returns {Array<Array<string>>}
 */
function _parseCSV(text) {
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        // Check for escaped quote ""
        if (i + 1 < text.length && text[i + 1] === '"') {
          currentField += '"';
          i += 2;
        } else {
          // End of quoted field
          inQuotes = false;
          i++;
        }
      } else {
        currentField += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        currentRow.push(currentField);
        currentField = '';
        i++;
      } else if (ch === '\r') {
        // Handle \r\n or standalone \r
        currentRow.push(currentField);
        currentField = '';
        if (currentRow.length > 0 || currentRow.some(f => f.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        i++;
        if (i < text.length && text[i] === '\n') {
          i++;
        }
      } else if (ch === '\n') {
        currentRow.push(currentField);
        currentField = '';
        if (currentRow.length > 0 || currentRow.some(f => f.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        i++;
      } else {
        currentField += ch;
        i++;
      }
    }
  }

  // Handle last field/row
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

/**
 * Escape a value for CSV output. Wraps in quotes if it contains commas, quotes, or newlines.
 * @param {string} value
 * @returns {string}
 */
function _escapeCSVField(value) {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}
