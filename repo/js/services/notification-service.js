import { db } from '../core/db.js';
import { bus } from '../core/event-bus.js';
import { sync } from '../core/sync.js';
import { uuid, now } from '../core/utils.js';

const STORE = 'notifications';
const DEFAULT_CAP = 200;

export const notificationService = {
  /**
   * Create a notification for a profile.
   * Enforces a 200-notification cap per profile, removing the oldest if exceeded.
   *
   * @param {string} profileId - Recipient profile ID
   * @param {string} type - Notification type (e.g. 'mention', 'reply', 'invite')
   * @param {string} title - Short title
   * @param {string} body - Notification body text
   * @param {string} [linkTo] - Optional navigation target (e.g. '/room/abc')
   * @returns {object} The created notification
   */
  async createNotification(profileId, type, title, body, linkTo) {
    const notification = {
      id: uuid(),
      profileId,
      type,
      title,
      body,
      linkTo: linkTo || null,
      read: false,
      createdAt: now()
    };

    await db.put(STORE, notification);

    // Enforce per-profile cap
    await this._enforceCap(profileId, DEFAULT_CAP);

    bus.emit('notification:new', notification);
    sync.broadcast({
      type: 'db-change',
      store: STORE,
      action: 'add',
      id: notification.id,
      profileId
    });

    return notification;
  },

  /**
   * Get notifications for a profile, sorted by createdAt descending.
   *
   * @param {string} profileId
   * @param {object} [options]
   * @param {number} [options.limit] - Max results to return
   * @param {boolean} [options.unreadOnly] - If true, return only unread notifications
   * @returns {Array<object>}
   */
  async getNotifications(profileId, options = {}) {
    const { limit, unreadOnly } = options;

    let notifications = await db.getAllByIndex(STORE, 'profileId', profileId);

    if (unreadOnly) {
      notifications = notifications.filter(n => !n.read);
    }

    // Sort descending by createdAt
    notifications.sort((a, b) => b.createdAt - a.createdAt);

    if (limit && limit > 0) {
      notifications = notifications.slice(0, limit);
    }

    return notifications;
  },

  /**
   * Mark a single notification as read.
   * @param {string} id
   */
  async markRead(id) {
    const notification = await db.get(STORE, id);
    if (!notification) {
      throw new Error('Notification not found');
    }

    notification.read = true;
    await db.put(STORE, notification);
  },

  /**
   * Mark all notifications as read for a given profile.
   * @param {string} profileId
   */
  async markAllRead(profileId) {
    const notifications = await db.getAllByIndex(STORE, 'profileId', profileId);
    const unread = notifications.filter(n => !n.read);

    if (unread.length === 0) return;

    const updated = unread.map(n => ({ ...n, read: true }));
    await db.putBatch(STORE, updated);
  },

  /**
   * Delete a notification permanently.
   * @param {string} id
   */
  async deleteNotification(id) {
    await db.delete(STORE, id);
  },

  /**
   * Get the count of unread notifications for a profile.
   * @param {string} profileId
   * @returns {number}
   */
  async getUnreadCount(profileId) {
    const notifications = await db.getAllByIndex(STORE, 'profileId', profileId);
    return notifications.filter(n => !n.read).length;
  },

  /**
   * Enforce a notification cap per profile. If the profile has more than `max`
   * notifications, delete the oldest ones.
   * @param {string} profileId
   * @param {number} max
   * @private
   */
  async _enforceCap(profileId, max = DEFAULT_CAP) {
    const notifications = await db.getAllByIndex(STORE, 'profileId', profileId);
    if (notifications.length <= max) return;

    // Sort ascending by createdAt so oldest come first
    notifications.sort((a, b) => a.createdAt - b.createdAt);

    const excess = notifications.length - max;
    const toDelete = notifications.slice(0, excess).map(n => n.id);
    await db.deleteBatch(STORE, toDelete);
  }
};
