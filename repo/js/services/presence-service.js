import { db } from '../core/db.js';
import { bus } from '../core/event-bus.js';
import { store } from '../core/store.js';
import { sync } from '../core/sync.js';
import { now } from '../core/utils.js';

const STORE = 'presence';
const HEARTBEAT_INTERVAL_MS = 10_000;
const STALE_THRESHOLD_MS = 30_000;
const IDLE_TIMEOUT_MS = 180_000; // 3 minutes

let heartbeatTimer = null;
let idleTimer = null;
let currentRoomId = null;
let currentStatus = 'active';

/** Bound references for cleanup */
let boundOnActivity = null;
let boundOnBeforeUnload = null;

export const presenceService = {
  /**
   * Initialize the presence service.
   * Registers beforeunload cleanup and user-activity listeners for idle detection.
   */
  init() {
    boundOnBeforeUnload = () => {
      this.leaveRoom();
    };
    window.addEventListener('beforeunload', boundOnBeforeUnload);

    // Activity listeners for idle detection
    boundOnActivity = () => {
      this._resetIdleTimer();
      if (currentRoomId) {
        const record = this._getCurrentRecord();
        if (record && record.status === 'idle') {
          this.setActive();
        }
      }
    };

    const activityEvents = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];
    for (const evt of activityEvents) {
      document.addEventListener(evt, boundOnActivity, { passive: true });
    }
  },

  /**
   * Clean up all intervals, timers, and event listeners.
   */
  destroy() {
    this.leaveRoom();

    if (boundOnBeforeUnload) {
      window.removeEventListener('beforeunload', boundOnBeforeUnload);
      boundOnBeforeUnload = null;
    }

    if (boundOnActivity) {
      const activityEvents = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];
      for (const evt of activityEvents) {
        document.removeEventListener(evt, boundOnActivity);
      }
      boundOnActivity = null;
    }

    this._clearIdleTimer();
  },

  /**
   * Enter a room: write a presence record, start heartbeat, broadcast.
   * @param {string} roomId
   */
  async enterRoom(roomId) {
    // Leave any previous room first
    if (currentRoomId) {
      await this.leaveRoom();
    }

    const currentUser = store.get('currentUser');
    const tabId = sync.getTabId();

    const record = {
      tabId,
      profileId: currentUser?.id || null,
      roomId,
      status: 'active',
      lastHeartbeat: now()
    };

    await db.put(STORE, record);
    currentRoomId = roomId;
    currentStatus = 'active';

    // Start heartbeat
    heartbeatTimer = setInterval(async () => {
      await this._heartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    // Start idle detection timer
    this._resetIdleTimer();

    bus.emit('presence:enter', { tabId, roomId, profileId: record.profileId });
    sync.broadcast({ type: 'db-change', store: STORE, action: 'enter', roomId, tabId });
  },

  /**
   * Leave the current room: delete presence record, stop heartbeat, broadcast.
   */
  async leaveRoom() {
    if (!currentRoomId) return;

    const tabId = sync.getTabId();
    const roomId = currentRoomId;

    // Stop heartbeat
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    this._clearIdleTimer();

    // Remove presence record
    try {
      await db.delete(STORE, tabId);
    } catch (err) {
      // Best-effort during unload
      console.warn('[Presence] Failed to delete presence record:', err);
    }

    currentRoomId = null;
    currentStatus = 'active';

    bus.emit('presence:leave', { tabId, roomId });
    sync.broadcast({ type: 'db-change', store: STORE, action: 'leave', roomId, tabId });
  },

  /**
   * Set the current user's presence status to 'idle'.
   */
  async setIdle() {
    const tabId = sync.getTabId();
    const record = await db.get(STORE, tabId);
    if (!record) return;

    record.status = 'idle';
    record.lastHeartbeat = now();
    await db.put(STORE, record);
    currentStatus = 'idle';

    bus.emit('presence:idle', { tabId, roomId: record.roomId });
    sync.broadcast({ type: 'db-change', store: STORE, action: 'idle', roomId: record.roomId, tabId });
  },

  /**
   * Set the current user's presence status back to 'active'.
   */
  async setActive() {
    const tabId = sync.getTabId();
    const record = await db.get(STORE, tabId);
    if (!record) return;

    record.status = 'active';
    record.lastHeartbeat = now();
    await db.put(STORE, record);
    currentStatus = 'active';

    bus.emit('presence:active', { tabId, roomId: record.roomId });
    sync.broadcast({ type: 'db-change', store: STORE, action: 'active', roomId: record.roomId, tabId });
  },

  /**
   * Get all active presence records for a room.
   * Prunes stale records (>30s since last heartbeat) before returning.
   * @param {string} roomId
   * @returns {Array<object>} Presence records with profile info
   */
  async getRoomPresence(roomId) {
    const records = await db.getAllByIndex(STORE, 'roomId', roomId);
    const threshold = now() - STALE_THRESHOLD_MS;
    const active = [];
    const staleIds = [];

    for (const record of records) {
      if (record.lastHeartbeat < threshold) {
        staleIds.push(record.tabId);
      } else {
        active.push(record);
      }
    }

    // Prune stale records
    if (staleIds.length > 0) {
      await db.deleteBatch(STORE, staleIds);
    }

    return active;
  },

  /**
   * Send a heartbeat: update lastHeartbeat timestamp.
   * @private
   */
  async _heartbeat() {
    const tabId = sync.getTabId();
    const record = await db.get(STORE, tabId);
    if (!record) return;

    record.lastHeartbeat = now();
    await db.put(STORE, record);
  },

  /**
   * Get the current presence status synchronously.
   * Used for quick status checks within event handlers.
   * @private
   */
  _getCurrentRecord() {
    return currentRoomId ? { status: currentStatus, roomId: currentRoomId } : null;
  },

  /**
   * Reset the idle detection timer. After 3 minutes of inactivity, set status to idle.
   * @private
   */
  _resetIdleTimer() {
    this._clearIdleTimer();
    idleTimer = setTimeout(() => {
      if (currentRoomId) {
        this.setIdle();
      }
    }, IDLE_TIMEOUT_MS);
  },

  /**
   * Clear the idle timer.
   * @private
   */
  _clearIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }
};
