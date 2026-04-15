import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetAll, setCurrentUser } from '../helpers.js';
import { db } from '../../js/core/db.js';
import { bus } from '../../js/core/event-bus.js';
import { notificationService } from '../../js/services/notification-service.js';

beforeEach(async () => {
  await resetAll();
  setCurrentUser();
});

describe('notification-service', () => {
  // ---------------------------------------------------------------
  // createNotification
  // ---------------------------------------------------------------
  describe('createNotification', () => {
    it('should create a notification with correct fields', async () => {
      const notif = await notificationService.createNotification(
        'p1', 'mention', 'You were mentioned', 'In room chat', '/room/r1'
      );
      expect(notif).toHaveProperty('id');
      expect(notif.profileId).toBe('p1');
      expect(notif.type).toBe('mention');
      expect(notif.title).toBe('You were mentioned');
      expect(notif.body).toBe('In room chat');
      expect(notif.linkTo).toBe('/room/r1');
      expect(notif.read).toBe(false);
      expect(notif).toHaveProperty('createdAt');
    });

    it('should persist the notification in the database', async () => {
      const notif = await notificationService.createNotification(
        'p1', 'reply', 'New reply', 'Someone replied', null
      );
      const stored = await db.get('notifications', notif.id);
      expect(stored).toBeTruthy();
      expect(stored.type).toBe('reply');
    });

    it('should default linkTo to null when not provided', async () => {
      const notif = await notificationService.createNotification(
        'p1', 'invite', 'Invite', 'Join room'
      );
      expect(notif.linkTo).toBeNull();
    });

    it('should emit notification:new event', async () => {
      const handler = vi.fn();
      bus.on('notification:new', handler);
      const notif = await notificationService.createNotification(
        'p1', 'mention', 'Title', 'Body'
      );
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].id).toBe(notif.id);
    });
  });

  // ---------------------------------------------------------------
  // getNotifications
  // ---------------------------------------------------------------
  describe('getNotifications', () => {
    it('should return notifications sorted by createdAt descending', async () => {
      await notificationService.createNotification('p1', 'a', 'First', 'body1');
      await notificationService.createNotification('p1', 'b', 'Second', 'body2');
      await notificationService.createNotification('p1', 'c', 'Third', 'body3');

      const list = await notificationService.getNotifications('p1');
      expect(list).toHaveLength(3);
      expect(list[0].createdAt).toBeGreaterThanOrEqual(list[1].createdAt);
      expect(list[1].createdAt).toBeGreaterThanOrEqual(list[2].createdAt);
    });

    it('should filter by unreadOnly', async () => {
      const n1 = await notificationService.createNotification('p1', 'a', 'Unread', 'body');
      const n2 = await notificationService.createNotification('p1', 'b', 'Read', 'body');
      await notificationService.markRead(n2.id);

      const unread = await notificationService.getNotifications('p1', { unreadOnly: true });
      expect(unread).toHaveLength(1);
      expect(unread[0].id).toBe(n1.id);
    });

    it('should respect limit', async () => {
      for (let i = 0; i < 10; i++) {
        await notificationService.createNotification('p1', 'x', `N${i}`, 'body');
      }
      const list = await notificationService.getNotifications('p1', { limit: 3 });
      expect(list).toHaveLength(3);
    });

    it('should only return notifications for the specified profile', async () => {
      await notificationService.createNotification('p1', 'a', 'For P1', 'body');
      await notificationService.createNotification('p2', 'b', 'For P2', 'body');

      const list = await notificationService.getNotifications('p1');
      expect(list).toHaveLength(1);
      expect(list[0].profileId).toBe('p1');
    });

    it('should return empty array for profile with no notifications', async () => {
      const list = await notificationService.getNotifications('no-one');
      expect(list).toEqual([]);
    });
  });

  // ---------------------------------------------------------------
  // markRead
  // ---------------------------------------------------------------
  describe('markRead', () => {
    it('should set read to true', async () => {
      const notif = await notificationService.createNotification('p1', 'a', 'Title', 'Body');
      expect(notif.read).toBe(false);

      await notificationService.markRead(notif.id);

      const stored = await db.get('notifications', notif.id);
      expect(stored.read).toBe(true);
    });

    it('should throw for non-existent notification', async () => {
      await expect(notificationService.markRead('nonexistent'))
        .rejects.toThrow('Notification not found');
    });
  });

  // ---------------------------------------------------------------
  // markAllRead
  // ---------------------------------------------------------------
  describe('markAllRead', () => {
    it('should mark all unread notifications as read for profile', async () => {
      await notificationService.createNotification('p1', 'a', 'N1', 'body');
      await notificationService.createNotification('p1', 'b', 'N2', 'body');
      await notificationService.createNotification('p1', 'c', 'N3', 'body');

      await notificationService.markAllRead('p1');

      const list = await notificationService.getNotifications('p1', { unreadOnly: true });
      expect(list).toHaveLength(0);

      const all = await notificationService.getNotifications('p1');
      expect(all.every(n => n.read === true)).toBe(true);
    });

    it('should not affect notifications for other profiles', async () => {
      await notificationService.createNotification('p1', 'a', 'P1', 'body');
      await notificationService.createNotification('p2', 'b', 'P2', 'body');

      await notificationService.markAllRead('p1');

      const p2List = await notificationService.getNotifications('p2', { unreadOnly: true });
      expect(p2List).toHaveLength(1);
    });

    it('should handle case when all are already read', async () => {
      const n = await notificationService.createNotification('p1', 'a', 'N', 'body');
      await notificationService.markRead(n.id);
      // Should not throw
      await notificationService.markAllRead('p1');
      const all = await notificationService.getNotifications('p1');
      expect(all).toHaveLength(1);
      expect(all[0].read).toBe(true);
    });
  });

  // ---------------------------------------------------------------
  // deleteNotification
  // ---------------------------------------------------------------
  describe('deleteNotification', () => {
    it('should remove the notification from the database', async () => {
      const notif = await notificationService.createNotification('p1', 'a', 'Del', 'body');
      await notificationService.deleteNotification(notif.id);
      const stored = await db.get('notifications', notif.id);
      expect(stored).toBeUndefined();
    });

    it('should not throw when deleting non-existent notification', async () => {
      // db.delete on a missing key does not throw in IndexedDB
      await notificationService.deleteNotification('nonexistent');
    });
  });

  // ---------------------------------------------------------------
  // getUnreadCount
  // ---------------------------------------------------------------
  describe('getUnreadCount', () => {
    it('should count unread notifications', async () => {
      await notificationService.createNotification('p1', 'a', 'N1', 'body');
      await notificationService.createNotification('p1', 'b', 'N2', 'body');
      const n3 = await notificationService.createNotification('p1', 'c', 'N3', 'body');
      await notificationService.markRead(n3.id);

      const count = await notificationService.getUnreadCount('p1');
      expect(count).toBe(2);
    });

    it('should return 0 when all are read', async () => {
      const n = await notificationService.createNotification('p1', 'a', 'N', 'body');
      await notificationService.markRead(n.id);
      const count = await notificationService.getUnreadCount('p1');
      expect(count).toBe(0);
    });

    it('should return 0 for profile with no notifications', async () => {
      const count = await notificationService.getUnreadCount('nobody');
      expect(count).toBe(0);
    });
  });

  // ---------------------------------------------------------------
  // 200 cap enforcement
  // ---------------------------------------------------------------
  describe('200 cap enforcement', () => {
    it('should keep only 200 notifications when 201 are created', async () => {
      // Create 201 notifications for the same profile
      for (let i = 0; i < 201; i++) {
        await notificationService.createNotification('p1', 'info', `N${i}`, `body ${i}`);
      }

      const all = await notificationService.getNotifications('p1');
      expect(all.length).toBe(200);
    });

    it('should keep exactly 200 after multiple exceeding inserts', async () => {
      // Create 205 notifications — cap enforcement runs on each insert
      for (let i = 0; i < 205; i++) {
        await notificationService.createNotification('p1', 'info', `N${i}`, 'body');
      }

      const all = await notificationService.getNotifications('p1');
      expect(all.length).toBe(200);

      // The most recent notification should still exist
      const titles = all.map(n => n.title);
      expect(titles).toContain('N204');
    });
  });
});
