import { db } from '../core/db.js';
import { bus } from '../core/event-bus.js';
import { store } from '../core/store.js';
import { sync } from '../core/sync.js';
import { autosave } from '../core/autosave.js';
import { enforceQuota, invalidateCache } from '../core/quota-guard.js';
import { activityService } from './activity-service.js';
import { sensitiveWordService } from './sensitive-word-service.js';
import { uuid, now } from '../core/utils.js';

const ELEMENTS_STORE = 'whiteboardElements';
const COMMENTS_STORE = 'comments';
const VALID_TYPES = ['pen', 'rect', 'ellipse', 'line', 'image', 'sticker'];
const MAX_NOTES_LENGTH = 20000;

export const whiteboardService = {
  /**
   * Create a whiteboard element.
   * @param {string} roomId
   * @param {'pen'|'rect'|'ellipse'|'line'|'image'|'sticker'} type
   * @param {object} data - Coordinates, style info, etc.
   * @returns {object} The created element
   */
  async createElement(roomId, type, data = {}) {
    if (!roomId) throw new Error('roomId is required');
    if (!VALID_TYPES.includes(type)) {
      throw new Error(`Invalid element type: ${type}. Must be one of: ${VALID_TYPES.join(', ')}`);
    }

    await enforceQuota(roomId);
    const currentUser = store.get('currentUser');

    const element = {
      id: uuid(),
      roomId,
      type,
      ...data,
      zIndex: data.zIndex ?? 0,
      notes: '',
      deleted: false,
      createdBy: currentUser?.id || null,
      createdAt: now(),
      updatedAt: now()
    };

    await db.put(ELEMENTS_STORE, element);
    autosave.markDirty(ELEMENTS_STORE, element.id, element);
    invalidateCache(roomId);
    activityService.logActivity(roomId, 'create', 'whiteboardElement', element.id, `Created ${type} element`);
    import('./ops-service.js').then(m => m.opsService.trackEvent('first_whiteboard_edit', { roomId, elementId: element.id })).catch(() => {});
    bus.emit('whiteboard:element-created', element);
    sync.broadcast({ type: 'db-change', store: ELEMENTS_STORE, action: 'add', id: element.id, roomId });
    return element;
  },

  /**
   * Update an existing whiteboard element by merging changes.
   * @param {string} id
   * @param {object} changes
   * @returns {object} The updated element
   */
  async updateElement(id, changes) {
    const element = await db.get(ELEMENTS_STORE, id);
    if (!element) throw new Error('Element not found');

    const { id: _id, roomId: _rid, createdBy: _cb, createdAt: _ca, ...allowed } = changes;
    Object.assign(element, allowed, { updatedAt: now() });
    await db.put(ELEMENTS_STORE, element);
    autosave.markDirty(ELEMENTS_STORE, element.id, element);
    invalidateCache(element.roomId);
    activityService.logActivity(element.roomId, 'edit', 'whiteboardElement', element.id, `Edited ${element.type} element`);

    bus.emit('whiteboard:element-updated', element);
    sync.broadcast({ type: 'db-change', store: ELEMENTS_STORE, action: 'update', id: element.id, roomId: element.roomId });
    return element;
  },

  /**
   * Soft-delete a whiteboard element and its associated comments.
   * @param {string} id
   */
  async deleteElement(id) {
    const element = await db.get(ELEMENTS_STORE, id);
    if (!element) throw new Error('Element not found');

    element.deleted = true;
    element.updatedAt = now();
    await db.put(ELEMENTS_STORE, element);
    autosave.markDirty(ELEMENTS_STORE, element.id, element);
    invalidateCache(element.roomId);
    activityService.logActivity(element.roomId, 'delete', 'whiteboardElement', element.id, `Deleted ${element.type} element`);

    // Soft-delete associated comments
    const comments = await db.getAllByIndex(COMMENTS_STORE, 'elementId', id);
    for (const comment of comments) {
      comment.deleted = true;
      comment.updatedAt = now();
    }
    if (comments.length > 0) {
      await db.putBatch(COMMENTS_STORE, comments);
    }

    bus.emit('whiteboard:element-deleted', { id, roomId: element.roomId });
    sync.broadcast({ type: 'db-change', store: ELEMENTS_STORE, action: 'delete', id, roomId: element.roomId });
  },

  /**
   * Move an element to a new position.
   * @param {string} id
   * @param {number} x
   * @param {number} y
   * @returns {object} The updated element
   */
  async moveElement(id, x, y) {
    const element = await db.get(ELEMENTS_STORE, id);
    if (!element) throw new Error('Element not found');

    element.x = x;
    element.y = y;
    element.updatedAt = now();
    await db.put(ELEMENTS_STORE, element);
    autosave.markDirty(ELEMENTS_STORE, element.id, element);
    activityService.logActivity(element.roomId, 'move', 'whiteboardElement', element.id, `Moved ${element.type} element`);

    bus.emit('whiteboard:element-moved', { id, x, y, roomId: element.roomId });
    sync.broadcast({ type: 'db-change', store: ELEMENTS_STORE, action: 'move', id, roomId: element.roomId });
    return element;
  },

  /**
   * Update the notes field on an element.
   * @param {string} id
   * @param {string} notes
   * @returns {object} The updated element
   */
  async updateNotes(id, notes) {
    if (typeof notes !== 'string') throw new Error('Notes must be a string');
    if (notes.length > MAX_NOTES_LENGTH) {
      throw new Error(`Notes cannot exceed ${MAX_NOTES_LENGTH} characters`);
    }

    const element = await db.get(ELEMENTS_STORE, id);
    if (!element) throw new Error('Element not found');

    element.notes = notes;
    element.updatedAt = now();
    await db.put(ELEMENTS_STORE, element);
    autosave.markDirty(ELEMENTS_STORE, element.id, element);

    bus.emit('whiteboard:notes-updated', { id, notes, roomId: element.roomId });
    return element;
  },

  /**
   * Get all non-deleted elements for a room, sorted by zIndex ascending.
   * @param {string} roomId
   * @returns {Array<object>}
   */
  async getElementsByRoom(roomId) {
    const elements = await db.getAllByIndex(ELEMENTS_STORE, 'roomId', roomId);
    return elements
      .filter(e => !e.deleted)
      .sort((a, b) => a.zIndex - b.zIndex);
  },

  /**
   * Reorder an element by updating its zIndex.
   * @param {string} id
   * @param {number} newZIndex
   * @returns {object} The updated element
   */
  async reorderElement(id, newZIndex) {
    const element = await db.get(ELEMENTS_STORE, id);
    if (!element) throw new Error('Element not found');

    element.zIndex = newZIndex;
    element.updatedAt = now();
    await db.put(ELEMENTS_STORE, element);
    autosave.markDirty(ELEMENTS_STORE, element.id, element);

    bus.emit('whiteboard:element-updated', element);
    sync.broadcast({ type: 'db-change', store: ELEMENTS_STORE, action: 'reorder', id, roomId: element.roomId });
    return element;
  },

  // --- Comments ---

  /**
   * Add a comment to a whiteboard element.
   * @param {string} elementId
   * @param {string} body
   * @param {string|null} parentId - null for root comment, id for reply
   * @returns {object} The created comment
   */
  async addComment(elementId, body, parentId = null) {
    if (!body || body.trim().length === 0) throw new Error('Comment body cannot be empty');

    const element = await db.get(ELEMENTS_STORE, elementId);
    if (!element) throw new Error('Element not found');

    await enforceQuota(element.roomId);

    // Sensitive word check
    const sensitiveResult = sensitiveWordService.check(body);

    const currentUser = store.get('currentUser');

    const comment = {
      id: uuid(),
      elementId,
      roomId: element.roomId,
      parentId,
      body,
      deleted: false,
      authorId: currentUser?.id || null,
      createdAt: now(),
      updatedAt: now()
    };

    await db.put(COMMENTS_STORE, comment);
    autosave.markDirty(COMMENTS_STORE, comment.id, comment);
    invalidateCache(element.roomId);
    activityService.logActivity(element.roomId, 'create', 'comment', comment.id, parentId ? 'Replied to a comment' : 'Added a comment');
    import('./ops-service.js').then(m => m.opsService.trackEvent('first_comment', { roomId: element.roomId, commentId: comment.id })).catch(() => {});
    bus.emit('comment:added', comment);
    sync.broadcast({ type: 'db-change', store: COMMENTS_STORE, action: 'add', id: comment.id, elementId, roomId: element.roomId });

    const result = { comment };
    if (sensitiveResult.hasSensitive) {
      result.warnings = sensitiveResult.matches;
    }
    return result;
  },

  /**
   * Get all comments for an element, sorted by createdAt, built into a thread tree.
   * @param {string} elementId
   * @returns {Array<object>} Root-level comments with nested `replies` arrays
   */
  async getComments(elementId) {
    const comments = await db.getAllByIndex(COMMENTS_STORE, 'elementId', elementId);
    const active = comments
      .filter(c => !c.deleted)
      .sort((a, b) => a.createdAt - b.createdAt);

    // Build thread tree
    const map = {};
    const roots = [];

    for (const comment of active) {
      map[comment.id] = { ...comment, replies: [] };
    }

    for (const comment of active) {
      const node = map[comment.id];
      if (comment.parentId && map[comment.parentId]) {
        map[comment.parentId].replies.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  },

  /**
   * Update a comment's body.
   * @param {string} id
   * @param {string} body
   * @returns {object} The updated comment
   */
  async updateComment(id, body) {
    if (!body || body.trim().length === 0) throw new Error('Comment body cannot be empty');

    const comment = await db.get(COMMENTS_STORE, id);
    if (!comment) throw new Error('Comment not found');

    // Sensitive word check
    const sensitiveResult = sensitiveWordService.check(body);

    comment.body = body;
    comment.updatedAt = now();
    await db.put(COMMENTS_STORE, comment);

    bus.emit('comment:updated', comment);
    sync.broadcast({ type: 'db-change', store: COMMENTS_STORE, action: 'update', id });

    const result = { comment };
    if (sensitiveResult.hasSensitive) {
      result.warnings = sensitiveResult.matches;
    }
    return result;
  },

  /**
   * Soft-delete a comment.
   * @param {string} id
   */
  async deleteComment(id) {
    const comment = await db.get(COMMENTS_STORE, id);
    if (!comment) throw new Error('Comment not found');

    comment.deleted = true;
    comment.updatedAt = now();
    await db.put(COMMENTS_STORE, comment);

    bus.emit('comment:deleted', { id, elementId: comment.elementId });
    sync.broadcast({ type: 'db-change', store: COMMENTS_STORE, action: 'delete', id });
  }
};
