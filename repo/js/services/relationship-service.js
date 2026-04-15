import { db } from '../core/db.js';
import { bus } from '../core/event-bus.js';
import { store } from '../core/store.js';
import { sync } from '../core/sync.js';
import { uuid, now } from '../core/utils.js';
import { notificationService } from './notification-service.js';

const STORE = 'relationships';

function currentUserId() {
  return store.get('currentUser')?.id || null;
}

export const relationshipService = {
  async sendFriendRequest(toId) {
    const fromId = currentUserId();
    if (!fromId) throw new Error('Not logged in');
    if (fromId === toId) throw new Error('Cannot send friend request to yourself');

    // Check not already exists
    const existing = await this._findRelationship(fromId, toId);
    if (existing) {
      throw new Error(`Relationship already exists (status: ${existing.status})`);
    }

    // Check reverse direction too
    const reverse = await this._findRelationship(toId, fromId);
    if (reverse) {
      throw new Error(`Relationship already exists (status: ${reverse.status})`);
    }

    const relationship = {
      id: uuid(),
      fromId,
      toId,
      type: 'friend',
      status: 'pending',
      groupLabel: null,
      personalNote: null,
      createdAt: now(),
      updatedAt: now()
    };

    await db.put(STORE, relationship);
    bus.emit('relationship:request-sent', relationship);
    sync.broadcast({ type: 'db-change', store: STORE, key: relationship.id, data: relationship });

    // Create notification for the target user
    await notificationService.createNotification(
      toId,
      'friend-request',
      'New Friend Request',
      'You have a new friend request.',
      null
    );

    return relationship;
  },

  async acceptRequest(id) {
    const relationship = await db.get(STORE, id);
    if (!relationship) throw new Error('Relationship not found');

    relationship.status = 'accepted';
    relationship.updatedAt = now();
    await db.put(STORE, relationship);

    bus.emit('relationship:accepted', relationship);
    sync.broadcast({ type: 'db-change', store: STORE, key: id, data: relationship });
    return relationship;
  },

  async rejectRequest(id) {
    const relationship = await db.get(STORE, id);
    if (!relationship) throw new Error('Relationship not found');

    relationship.status = 'rejected';
    relationship.updatedAt = now();
    await db.put(STORE, relationship);

    bus.emit('relationship:rejected', relationship);
    sync.broadcast({ type: 'db-change', store: STORE, key: id, data: relationship });
    return relationship;
  },

  async withdrawRequest(id) {
    const relationship = await db.get(STORE, id);
    if (!relationship) throw new Error('Relationship not found');

    relationship.status = 'withdrawn';
    relationship.updatedAt = now();
    await db.put(STORE, relationship);

    bus.emit('relationship:withdrawn', relationship);
    sync.broadcast({ type: 'db-change', store: STORE, key: id, data: relationship });
    return relationship;
  },

  async blockUser(targetId) {
    const fromId = currentUserId();
    if (!fromId) throw new Error('Not logged in');

    // Auto-reject any pending requests between these users
    const allRelationships = await db.getAll(STORE);
    const pending = allRelationships.filter(r =>
      r.status === 'pending' &&
      ((r.fromId === fromId && r.toId === targetId) ||
       (r.fromId === targetId && r.toId === fromId))
    );

    for (const rel of pending) {
      rel.status = 'rejected';
      rel.updatedAt = now();
      await db.put(STORE, rel);
    }

    // Check for existing block relationship
    const existing = allRelationships.find(r =>
      r.fromId === fromId && r.toId === targetId && r.type === 'blocked'
    );

    if (existing) {
      return existing;
    }

    const relationship = {
      id: uuid(),
      fromId,
      toId: targetId,
      type: 'blocked',
      status: 'active',
      groupLabel: null,
      personalNote: null,
      createdAt: now(),
      updatedAt: now()
    };

    await db.put(STORE, relationship);
    bus.emit('relationship:blocked', relationship);
    sync.broadcast({ type: 'db-change', store: STORE, key: relationship.id, data: relationship });
    return relationship;
  },

  async unblockUser(targetId) {
    const fromId = currentUserId();
    if (!fromId) throw new Error('Not logged in');

    const allRelationships = await db.getAllByIndex(STORE, 'fromId', fromId);
    const blocked = allRelationships.find(r =>
      r.toId === targetId && r.type === 'blocked'
    );

    if (blocked) {
      await db.delete(STORE, blocked.id);
      bus.emit('relationship:unblocked', { fromId, targetId });
      sync.broadcast({ type: 'db-change', store: STORE, key: blocked.id, action: 'delete' });
    }
  },

  async getFriends(profileId) {
    const all = await db.getAll(STORE);
    return all.filter(r =>
      r.type === 'friend' &&
      r.status === 'accepted' &&
      (r.fromId === profileId || r.toId === profileId)
    );
  },

  async getPendingRequests(profileId) {
    const incoming = await db.getAllByIndex(STORE, 'toId', profileId);
    return incoming.filter(r => r.type === 'friend' && r.status === 'pending');
  },

  async getSentRequests(profileId) {
    const outgoing = await db.getAllByIndex(STORE, 'fromId', profileId);
    return outgoing.filter(r => r.type === 'friend' && r.status === 'pending');
  },

  async getBlockedUsers(profileId) {
    const outgoing = await db.getAllByIndex(STORE, 'fromId', profileId);
    return outgoing.filter(r => r.type === 'blocked');
  },

  async isBlocked(profileId, targetId) {
    const all = await db.getAll(STORE);
    return all.some(r =>
      r.type === 'blocked' &&
      ((r.fromId === profileId && r.toId === targetId) ||
       (r.fromId === targetId && r.toId === profileId))
    );
  },

  async setGroup(relationshipId, groupLabel) {
    const relationship = await db.get(STORE, relationshipId);
    if (!relationship) throw new Error('Relationship not found');

    relationship.groupLabel = groupLabel;
    relationship.updatedAt = now();
    await db.put(STORE, relationship);
    return relationship;
  },

  async setPersonalNote(relationshipId, note) {
    const relationship = await db.get(STORE, relationshipId);
    if (!relationship) throw new Error('Relationship not found');

    relationship.personalNote = note;
    relationship.updatedAt = now();
    await db.put(STORE, relationship);
    return relationship;
  },

  async getGroups(profileId) {
    const all = await db.getAll(STORE);
    const labels = all
      .filter(r =>
        (r.fromId === profileId || r.toId === profileId) &&
        r.groupLabel
      )
      .map(r => r.groupLabel);
    return [...new Set(labels)];
  },

  // ── Internal helpers ───────────────────────────────────────────────

  async _findRelationship(fromId, toId) {
    const fromRelationships = await db.getAllByIndex(STORE, 'fromId', fromId);
    return fromRelationships.find(r => r.toId === toId && r.type === 'friend') || null;
  }
};
