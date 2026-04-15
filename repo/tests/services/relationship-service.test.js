import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetAll, setCurrentUser } from '../helpers.js';
import { db } from '../../js/core/db.js';
import { bus } from '../../js/core/event-bus.js';
import { store } from '../../js/core/store.js';
import { relationshipService } from '../../js/services/relationship-service.js';

beforeEach(async () => {
  await resetAll();
  setCurrentUser();
});

describe('relationshipService', () => {
  // ─── sendFriendRequest ────────────────────────────────────────────
  describe('sendFriendRequest', () => {
    it('should create a pending friend relationship', async () => {
      const rel = await relationshipService.sendFriendRequest('u2');
      expect(rel).toHaveProperty('id');
      expect(rel.fromId).toBe('u1');
      expect(rel.toId).toBe('u2');
      expect(rel.type).toBe('friend');
      expect(rel.status).toBe('pending');
      expect(rel).toHaveProperty('createdAt');
      expect(rel).toHaveProperty('updatedAt');
    });

    it('should persist the relationship in the database', async () => {
      const rel = await relationshipService.sendFriendRequest('u2');
      const stored = await db.get('relationships', rel.id);
      expect(stored).toBeTruthy();
      expect(stored.status).toBe('pending');
    });

    it('should create a notification for the target user', async () => {
      await relationshipService.sendFriendRequest('u2');
      const notifications = await db.getAllByIndex('notifications', 'profileId', 'u2');
      expect(notifications.length).toBeGreaterThanOrEqual(1);
      expect(notifications[0].type).toBe('friend-request');
    });

    it('should emit relationship:request-sent event', async () => {
      const handler = vi.fn();
      bus.on('relationship:request-sent', handler);
      await relationshipService.sendFriendRequest('u2');
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].toId).toBe('u2');
    });

    it('should throw when sending request to yourself', async () => {
      await expect(relationshipService.sendFriendRequest('u1'))
        .rejects.toThrow('Cannot send friend request to yourself');
    });

    it('should throw for duplicate request (same direction)', async () => {
      await relationshipService.sendFriendRequest('u2');
      await expect(relationshipService.sendFriendRequest('u2'))
        .rejects.toThrow(/Relationship already exists/);
    });

    it('should throw for duplicate request (reverse direction)', async () => {
      await relationshipService.sendFriendRequest('u2');

      // Switch to u2 and try to send request back to u1
      setCurrentUser({ id: 'u2', username: 'user2', displayName: 'User Two', sessionId: 's2' });
      await expect(relationshipService.sendFriendRequest('u1'))
        .rejects.toThrow(/Relationship already exists/);
    });

    it('should throw when not logged in', async () => {
      store.delete('currentUser');
      await expect(relationshipService.sendFriendRequest('u2'))
        .rejects.toThrow('Not logged in');
    });
  });

  // ─── acceptRequest ────────────────────────────────────────────────
  describe('acceptRequest', () => {
    it('should set status to accepted', async () => {
      const rel = await relationshipService.sendFriendRequest('u2');
      const accepted = await relationshipService.acceptRequest(rel.id);
      expect(accepted.status).toBe('accepted');
      expect(accepted.updatedAt).toBeGreaterThanOrEqual(rel.updatedAt);
    });

    it('should persist accepted status in database', async () => {
      const rel = await relationshipService.sendFriendRequest('u2');
      await relationshipService.acceptRequest(rel.id);
      const stored = await db.get('relationships', rel.id);
      expect(stored.status).toBe('accepted');
    });

    it('should emit relationship:accepted event', async () => {
      const rel = await relationshipService.sendFriendRequest('u2');
      const handler = vi.fn();
      bus.on('relationship:accepted', handler);
      await relationshipService.acceptRequest(rel.id);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should throw for non-existent relationship', async () => {
      await expect(relationshipService.acceptRequest('nonexistent'))
        .rejects.toThrow('Relationship not found');
    });
  });

  // ─── rejectRequest ────────────────────────────────────────────────
  describe('rejectRequest', () => {
    it('should set status to rejected', async () => {
      const rel = await relationshipService.sendFriendRequest('u2');
      const rejected = await relationshipService.rejectRequest(rel.id);
      expect(rejected.status).toBe('rejected');
    });

    it('should emit relationship:rejected event', async () => {
      const rel = await relationshipService.sendFriendRequest('u2');
      const handler = vi.fn();
      bus.on('relationship:rejected', handler);
      await relationshipService.rejectRequest(rel.id);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should throw for non-existent relationship', async () => {
      await expect(relationshipService.rejectRequest('nonexistent'))
        .rejects.toThrow('Relationship not found');
    });
  });

  // ─── withdrawRequest ──────────────────────────────────────────────
  describe('withdrawRequest', () => {
    it('should set status to withdrawn', async () => {
      const rel = await relationshipService.sendFriendRequest('u2');
      const withdrawn = await relationshipService.withdrawRequest(rel.id);
      expect(withdrawn.status).toBe('withdrawn');
    });

    it('should emit relationship:withdrawn event', async () => {
      const rel = await relationshipService.sendFriendRequest('u2');
      const handler = vi.fn();
      bus.on('relationship:withdrawn', handler);
      await relationshipService.withdrawRequest(rel.id);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should throw for non-existent relationship', async () => {
      await expect(relationshipService.withdrawRequest('nonexistent'))
        .rejects.toThrow('Relationship not found');
    });
  });

  // ─── blockUser ────────────────────────────────────────────────────
  describe('blockUser', () => {
    it('should create a blocked relationship', async () => {
      const rel = await relationshipService.blockUser('u2');
      expect(rel.type).toBe('blocked');
      expect(rel.status).toBe('active');
      expect(rel.fromId).toBe('u1');
      expect(rel.toId).toBe('u2');
    });

    it('should auto-reject pending requests between the users', async () => {
      // Send a friend request first
      const friendReq = await relationshipService.sendFriendRequest('u2');
      expect(friendReq.status).toBe('pending');

      // Now block u2
      await relationshipService.blockUser('u2');

      // The pending friend request should have been rejected
      const stored = await db.get('relationships', friendReq.id);
      expect(stored.status).toBe('rejected');
    });

    it('should auto-reject pending requests from the target too', async () => {
      // u2 sends friend request to u1
      setCurrentUser({ id: 'u2', username: 'user2', displayName: 'User Two', sessionId: 's2' });
      const friendReq = await relationshipService.sendFriendRequest('u1');

      // Switch back to u1 and block u2
      setCurrentUser();
      await relationshipService.blockUser('u2');

      const stored = await db.get('relationships', friendReq.id);
      expect(stored.status).toBe('rejected');
    });

    it('should return existing block if already blocked', async () => {
      const first = await relationshipService.blockUser('u2');
      const second = await relationshipService.blockUser('u2');
      expect(second.id).toBe(first.id);
    });

    it('should emit relationship:blocked event', async () => {
      const handler = vi.fn();
      bus.on('relationship:blocked', handler);
      await relationshipService.blockUser('u2');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should throw when not logged in', async () => {
      store.delete('currentUser');
      await expect(relationshipService.blockUser('u2'))
        .rejects.toThrow('Not logged in');
    });
  });

  // ─── unblockUser ──────────────────────────────────────────────────
  describe('unblockUser', () => {
    it('should delete the blocked relationship', async () => {
      const blocked = await relationshipService.blockUser('u2');
      await relationshipService.unblockUser('u2');
      const stored = await db.get('relationships', blocked.id);
      expect(stored).toBeUndefined();
    });

    it('should emit relationship:unblocked event', async () => {
      await relationshipService.blockUser('u2');
      const handler = vi.fn();
      bus.on('relationship:unblocked', handler);
      await relationshipService.unblockUser('u2');
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toEqual({ fromId: 'u1', targetId: 'u2' });
    });

    it('should be a no-op if user is not blocked', async () => {
      // Should not throw
      await relationshipService.unblockUser('u2');
    });

    it('should throw when not logged in', async () => {
      store.delete('currentUser');
      await expect(relationshipService.unblockUser('u2'))
        .rejects.toThrow('Not logged in');
    });
  });

  // ─── getFriends ───────────────────────────────────────────────────
  describe('getFriends', () => {
    it('should return accepted friends in both directions', async () => {
      // u1 -> u2 accepted
      const rel1 = await relationshipService.sendFriendRequest('u2');
      await relationshipService.acceptRequest(rel1.id);

      // u3 -> u1 accepted (switch to u3 to create, then accept)
      setCurrentUser({ id: 'u3', username: 'user3', displayName: 'User Three', sessionId: 's3' });
      const rel2 = await relationshipService.sendFriendRequest('u1');
      await relationshipService.acceptRequest(rel2.id);

      const friends = await relationshipService.getFriends('u1');
      expect(friends).toHaveLength(2);
    });

    it('should not return pending requests', async () => {
      await relationshipService.sendFriendRequest('u2');
      const friends = await relationshipService.getFriends('u1');
      expect(friends).toHaveLength(0);
    });

    it('should not return blocked relationships', async () => {
      await relationshipService.blockUser('u2');
      const friends = await relationshipService.getFriends('u1');
      expect(friends).toHaveLength(0);
    });
  });

  // ─── getPendingRequests ───────────────────────────────────────────
  describe('getPendingRequests', () => {
    it('should return pending requests where toId matches', async () => {
      await relationshipService.sendFriendRequest('u2');
      const pending = await relationshipService.getPendingRequests('u2');
      expect(pending).toHaveLength(1);
      expect(pending[0].fromId).toBe('u1');
      expect(pending[0].status).toBe('pending');
    });

    it('should not return accepted requests', async () => {
      const rel = await relationshipService.sendFriendRequest('u2');
      await relationshipService.acceptRequest(rel.id);
      const pending = await relationshipService.getPendingRequests('u2');
      expect(pending).toHaveLength(0);
    });

    it('should not return requests sent by the profile', async () => {
      await relationshipService.sendFriendRequest('u2');
      // u1 sent the request, so u1's pending incoming should be empty
      const pending = await relationshipService.getPendingRequests('u1');
      expect(pending).toHaveLength(0);
    });
  });

  // ─── getSentRequests ──────────────────────────────────────────────
  describe('getSentRequests', () => {
    it('should return pending requests where fromId matches', async () => {
      await relationshipService.sendFriendRequest('u2');
      const sent = await relationshipService.getSentRequests('u1');
      expect(sent).toHaveLength(1);
      expect(sent[0].toId).toBe('u2');
      expect(sent[0].status).toBe('pending');
    });

    it('should not include accepted requests', async () => {
      const rel = await relationshipService.sendFriendRequest('u2');
      await relationshipService.acceptRequest(rel.id);
      const sent = await relationshipService.getSentRequests('u1');
      expect(sent).toHaveLength(0);
    });
  });

  // ─── getBlockedUsers ──────────────────────────────────────────────
  describe('getBlockedUsers', () => {
    it('should return blocked relationships from the profile', async () => {
      await relationshipService.blockUser('u2');
      await relationshipService.blockUser('u3');
      const blocked = await relationshipService.getBlockedUsers('u1');
      expect(blocked).toHaveLength(2);
      expect(blocked.every(r => r.type === 'blocked')).toBe(true);
    });

    it('should not return friend relationships', async () => {
      const rel = await relationshipService.sendFriendRequest('u2');
      await relationshipService.acceptRequest(rel.id);
      const blocked = await relationshipService.getBlockedUsers('u1');
      expect(blocked).toHaveLength(0);
    });
  });

  // ─── isBlocked ────────────────────────────────────────────────────
  describe('isBlocked', () => {
    it('should return true when profileId blocked targetId', async () => {
      await relationshipService.blockUser('u2');
      const result = await relationshipService.isBlocked('u1', 'u2');
      expect(result).toBe(true);
    });

    it('should check both directions', async () => {
      await relationshipService.blockUser('u2');
      // u2 should also show as blocked from u2's perspective
      const result = await relationshipService.isBlocked('u2', 'u1');
      expect(result).toBe(true);
    });

    it('should return false when no block exists', async () => {
      const result = await relationshipService.isBlocked('u1', 'u2');
      expect(result).toBe(false);
    });

    it('should return false for friend relationships', async () => {
      const rel = await relationshipService.sendFriendRequest('u2');
      await relationshipService.acceptRequest(rel.id);
      const result = await relationshipService.isBlocked('u1', 'u2');
      expect(result).toBe(false);
    });
  });

  // ─── setGroup ─────────────────────────────────────────────────────
  describe('setGroup', () => {
    it('should update the group label on a relationship', async () => {
      const rel = await relationshipService.sendFriendRequest('u2');
      await relationshipService.acceptRequest(rel.id);

      const updated = await relationshipService.setGroup(rel.id, 'Colleagues');
      expect(updated.groupLabel).toBe('Colleagues');
    });

    it('should persist the group label in the database', async () => {
      const rel = await relationshipService.sendFriendRequest('u2');
      await relationshipService.setGroup(rel.id, 'Family');
      const stored = await db.get('relationships', rel.id);
      expect(stored.groupLabel).toBe('Family');
    });

    it('should throw for non-existent relationship', async () => {
      await expect(relationshipService.setGroup('nonexistent', 'Test'))
        .rejects.toThrow('Relationship not found');
    });
  });

  // ─── setPersonalNote ──────────────────────────────────────────────
  describe('setPersonalNote', () => {
    it('should update the personal note on a relationship', async () => {
      const rel = await relationshipService.sendFriendRequest('u2');
      const updated = await relationshipService.setPersonalNote(rel.id, 'Met at conference');
      expect(updated.personalNote).toBe('Met at conference');
    });

    it('should persist the note in the database', async () => {
      const rel = await relationshipService.sendFriendRequest('u2');
      await relationshipService.setPersonalNote(rel.id, 'Good person');
      const stored = await db.get('relationships', rel.id);
      expect(stored.personalNote).toBe('Good person');
    });

    it('should throw for non-existent relationship', async () => {
      await expect(relationshipService.setPersonalNote('nonexistent', 'note'))
        .rejects.toThrow('Relationship not found');
    });
  });

  // ─── getGroups ────────────────────────────────────────────────────
  describe('getGroups', () => {
    it('should return distinct group labels for a profile', async () => {
      const rel1 = await relationshipService.sendFriendRequest('u2');
      await relationshipService.setGroup(rel1.id, 'Work');

      setCurrentUser({ id: 'u3', username: 'user3', displayName: 'User Three', sessionId: 's3' });
      const rel2 = await relationshipService.sendFriendRequest('u1');
      await relationshipService.setGroup(rel2.id, 'Family');

      const groups = await relationshipService.getGroups('u1');
      expect(groups).toContain('Work');
      expect(groups).toContain('Family');
      expect(groups).toHaveLength(2);
    });

    it('should deduplicate group labels', async () => {
      const rel1 = await relationshipService.sendFriendRequest('u2');
      await relationshipService.setGroup(rel1.id, 'Work');

      setCurrentUser({ id: 'u3', username: 'user3', displayName: 'User Three', sessionId: 's3' });
      const rel2 = await relationshipService.sendFriendRequest('u1');
      await relationshipService.setGroup(rel2.id, 'Work');

      setCurrentUser();
      const groups = await relationshipService.getGroups('u1');
      expect(groups).toHaveLength(1);
      expect(groups[0]).toBe('Work');
    });

    it('should not include null group labels', async () => {
      await relationshipService.sendFriendRequest('u2');
      const groups = await relationshipService.getGroups('u1');
      expect(groups).toHaveLength(0);
    });
  });
});
