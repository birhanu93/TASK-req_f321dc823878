import { db } from '../core/db.js';
import { bus } from '../core/event-bus.js';
import { store } from '../core/store.js';
import { sync } from '../core/sync.js';
import { autosave } from '../core/autosave.js';
import { enforceQuota, invalidateCache } from '../core/quota-guard.js';
import { uuid, now } from '../core/utils.js';
import { sensitiveWordService } from './sensitive-word-service.js';
import { activityService } from './activity-service.js';

const STORE = 'chatMessages';
const MAX_BODY_LENGTH = 500;
const RATE_LIMIT_COUNT = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_CAP = 500;

/** Per-user in-memory map of send timestamps for rate limiting */
const sendTimestampsByUser = new Map();

export const chatService = {
  /**
   * Send a chat message to a room.
   * Validates body length, enforces rate limit, checks sensitive words,
   * saves the message, enforces the room message cap, and broadcasts.
   *
   * @param {string} roomId
   * @param {string} body - Message text (max 500 chars)
   * @returns {{ message: object, warnings?: Array<{ word: string, severity: string }> }}
   */
  async sendMessage(roomId, body) {
    // Validate body length
    if (!body || body.length === 0) {
      throw new Error('Message body cannot be empty');
    }
    if (body.length > MAX_BODY_LENGTH) {
      throw new Error(`Message body exceeds ${MAX_BODY_LENGTH} characters`);
    }

    // Get current user
    const currentUser = store.get('currentUser');
    if (!currentUser || !currentUser.id) {
      throw new Error('Must be logged in to send messages');
    }

    // Rate limit — check and record atomically before any async work
    this._enforceRateLimit(currentUser.id);
    const userTimestamps = sendTimestampsByUser.get(currentUser.id);
    userTimestamps.push(Date.now());

    // Storage quota
    await enforceQuota(roomId);

    // Sensitive word check
    const sensitiveResult = sensitiveWordService.check(body);

    // Build message record
    const message = {
      id: uuid(),
      roomId,
      authorId: currentUser.id,
      body,
      deleted: false,
      createdAt: now()
    };

    // Persist
    await db.put(STORE, message);
    autosave.markDirty(STORE, message.id, message);
    invalidateCache(roomId);

    // Enforce message cap for the room
    await this._enforceCap(roomId, DEFAULT_CAP);

    // Notify
    bus.emit('chat:message', message);
    sync.broadcast({ type: 'db-change', store: STORE, action: 'add', id: message.id, roomId });

    // Return the message along with any sensitive-word warnings
    const result = { message };
    if (sensitiveResult.hasSensitive) {
      result.warnings = sensitiveResult.matches;
    }
    return result;
  },

  /**
   * Get messages for a room, sorted by createdAt descending.
   * @param {string} roomId
   * @param {number} limit
   * @returns {Array<object>}
   */
  async getMessages(roomId, limit = 500) {
    const messages = await db.getAllByIndex(STORE, 'roomId', roomId);
    // Sort descending by createdAt
    messages.sort((a, b) => b.createdAt - a.createdAt);
    return messages.slice(0, limit);
  },

  /**
   * Soft-delete a message by setting deleted: true.
   * @param {string} id
   */
  async deleteMessage(id) {
    const message = await db.get(STORE, id);
    if (!message) {
      throw new Error('Message not found');
    }
    message.deleted = true;
    await db.put(STORE, message);
    activityService.logActivity(message.roomId, 'delete', 'chatMessage', id, 'Deleted a chat message');

    bus.emit('chat:message:deleted', { id });
    sync.broadcast({ type: 'db-change', store: STORE, action: 'delete', id });
  },

  /**
   * Enforce rate limit: max 10 messages per 60 seconds per user.
   * Throws if the limit is exceeded.
   * @param {string} userId
   * @private
   */
  _enforceRateLimit(userId) {
    if (!sendTimestampsByUser.has(userId)) {
      sendTimestampsByUser.set(userId, []);
    }
    const timestamps = sendTimestampsByUser.get(userId);
    const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;

    // Prune old timestamps
    while (timestamps.length > 0 && timestamps[0] <= cutoff) {
      timestamps.shift();
    }

    if (timestamps.length >= RATE_LIMIT_COUNT) {
      throw new Error('Rate limit exceeded. Please wait before sending more messages.');
    }
  },

  /**
   * Enforce a message cap per room. If the room has more than `max` messages,
   * delete the oldest ones.
   * @param {string} roomId
   * @param {number} max
   * @private
   */
  async _enforceCap(roomId, max = DEFAULT_CAP) {
    const messages = await db.getAllByIndex(STORE, 'roomId', roomId);
    if (messages.length <= max) return;

    // Sort ascending by createdAt so oldest are first
    messages.sort((a, b) => a.createdAt - b.createdAt);

    const excess = messages.length - max;
    const toDelete = messages.slice(0, excess).map(m => m.id);
    await db.deleteBatch(STORE, toDelete);
  }
};
