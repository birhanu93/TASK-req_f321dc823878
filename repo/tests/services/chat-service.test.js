import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetAll, setCurrentUser } from '../helpers.js';
import { chatService } from '../../js/services/chat-service.js';
import { db } from '../../js/core/db.js';
import { bus } from '../../js/core/event-bus.js';

// The chat service keeps a per-user in-memory map of send timestamps for rate limiting.
// Between tests we need to ensure old timestamps are pruned. We do this by
// temporarily advancing Date.now far enough that _enforceRateLimit prunes all
// entries, then restore the real Date.now.

function drainRateLimit() {
  const realNow = Date.now;
  // Make Date.now() return a value 2 minutes in the future so all old timestamps
  // are pruned on the next _enforceRateLimit call.
  Date.now = () => realNow.call(Date) + 120_000;
  try {
    chatService._enforceRateLimit('u1');
  } catch { /* ignore */ }
  try {
    chatService._enforceRateLimit('u2');
  } catch { /* ignore */ }
  Date.now = realNow;
}

beforeEach(async () => {
  drainRateLimit();
  await resetAll();
});

describe('chatService', () => {
  // ── sendMessage ────────────────────────────────────────────────────

  describe('sendMessage', () => {
    it('should create a message with correct fields', async () => {
      setCurrentUser();
      const result = await chatService.sendMessage('room1', 'Hello world');
      const msg = result.message;

      expect(msg).toBeDefined();
      expect(msg.id).toBeTruthy();
      expect(msg.roomId).toBe('room1');
      expect(msg.authorId).toBe('u1');
      expect(msg.body).toBe('Hello world');
      expect(msg.deleted).toBe(false);
      expect(msg.createdAt).toBeTypeOf('number');
    });

    it('should persist message to the database', async () => {
      setCurrentUser();
      const result = await chatService.sendMessage('room1', 'Persisted');
      const stored = await db.get('chatMessages', result.message.id);
      expect(stored).toBeDefined();
      expect(stored.body).toBe('Persisted');
    });

    it('should return result without warnings when no sensitive words', async () => {
      setCurrentUser();
      const result = await chatService.sendMessage('room1', 'Clean text');
      expect(result.warnings).toBeUndefined();
    });

    it('should throw for empty body', async () => {
      setCurrentUser();
      await expect(chatService.sendMessage('room1', '')).rejects.toThrow('Message body cannot be empty');
    });

    it('should throw for null/undefined body', async () => {
      setCurrentUser();
      await expect(chatService.sendMessage('room1', null)).rejects.toThrow('Message body cannot be empty');
    });

    it('should throw for body exceeding 500 characters', async () => {
      setCurrentUser();
      const longBody = 'a'.repeat(501);
      await expect(chatService.sendMessage('room1', longBody)).rejects.toThrow('exceeds 500 characters');
    });

    it('should allow body exactly 500 characters', async () => {
      setCurrentUser();
      const body = 'a'.repeat(500);
      const result = await chatService.sendMessage('room1', body);
      expect(result.message.body.length).toBe(500);
    });

    it('should throw when no user is logged in', async () => {
      // No setCurrentUser() call
      await expect(chatService.sendMessage('room1', 'Hello')).rejects.toThrow('Must be logged in');
    });

    it('should emit chat:message event', async () => {
      setCurrentUser();
      const handler = vi.fn();
      bus.on('chat:message', handler);

      await chatService.sendMessage('room1', 'Event test');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].body).toBe('Event test');
      expect(handler.mock.calls[0][0].roomId).toBe('room1');
    });

    it('should return the message object', async () => {
      setCurrentUser();
      const result = await chatService.sendMessage('room1', 'Return check');
      expect(result).toHaveProperty('message');
      expect(result.message.body).toBe('Return check');
    });
  });

  // ── getMessages ────────────────────────────────────────────────────

  describe('getMessages', () => {
    it('should return messages sorted by createdAt descending', async () => {
      setCurrentUser();
      // Insert directly with known createdAt values to ensure ordering
      await db.put('chatMessages', { id: 'm1', roomId: 'room1', authorId: 'u1', body: 'First', deleted: false, createdAt: 1000 });
      await db.put('chatMessages', { id: 'm2', roomId: 'room1', authorId: 'u1', body: 'Second', deleted: false, createdAt: 2000 });
      await db.put('chatMessages', { id: 'm3', roomId: 'room1', authorId: 'u1', body: 'Third', deleted: false, createdAt: 3000 });

      const messages = await chatService.getMessages('room1');
      expect(messages.length).toBe(3);
      // Most recent first
      expect(messages[0].body).toBe('Third');
      expect(messages[1].body).toBe('Second');
      expect(messages[2].body).toBe('First');
    });

    it('should respect limit parameter', async () => {
      setCurrentUser();
      for (let i = 0; i < 5; i++) {
        await db.put('chatMessages', { id: `m${i}`, roomId: 'room1', authorId: 'u1', body: `Msg ${i}`, deleted: false, createdAt: 1000 + i });
      }

      const messages = await chatService.getMessages('room1', 3);
      expect(messages.length).toBe(3);
    });

    it('should return empty array for a room with no messages', async () => {
      const messages = await chatService.getMessages('emptyroom');
      expect(messages).toEqual([]);
    });

    it('should only return messages for the specified room', async () => {
      setCurrentUser();
      await chatService.sendMessage('room1', 'In room1');
      await chatService.sendMessage('room2', 'In room2');

      const messages = await chatService.getMessages('room1');
      expect(messages.length).toBe(1);
      expect(messages[0].body).toBe('In room1');
    });
  });

  // ── deleteMessage ──────────────────────────────────────────────────

  describe('deleteMessage', () => {
    it('should set deleted to true', async () => {
      setCurrentUser();
      const result = await chatService.sendMessage('room1', 'To delete');
      await chatService.deleteMessage(result.message.id);

      const stored = await db.get('chatMessages', result.message.id);
      expect(stored.deleted).toBe(true);
    });

    it('should throw for non-existent message', async () => {
      await expect(chatService.deleteMessage('nonexistent')).rejects.toThrow('Message not found');
    });

    it('should emit chat:message:deleted event', async () => {
      setCurrentUser();
      const handler = vi.fn();
      bus.on('chat:message:deleted', handler);

      const result = await chatService.sendMessage('room1', 'To delete');
      await chatService.deleteMessage(result.message.id);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].id).toBe(result.message.id);
    });
  });

  // ── Rate Limiting ──────────────────────────────────────────────────

  describe('rate limiting', () => {
    it('should allow up to 10 messages', async () => {
      setCurrentUser();
      for (let i = 0; i < 10; i++) {
        await chatService.sendMessage('room1', `Msg ${i}`);
      }
      const messages = await chatService.getMessages('room1');
      expect(messages.length).toBe(10);
    });

    it('should throw on the 11th message within 60 seconds', async () => {
      setCurrentUser();
      for (let i = 0; i < 10; i++) {
        await chatService.sendMessage('room1', `Msg ${i}`);
      }
      await expect(chatService.sendMessage('room1', 'Msg 10')).rejects.toThrow('Rate limit exceeded');
    });

    it('should block concurrent rapid sends that exceed the limit', async () => {
      setCurrentUser();
      // Fire 12 sends concurrently — the rate limiter should record timestamps
      // synchronously before any async work, so at most 10 should succeed
      const promises = [];
      for (let i = 0; i < 12; i++) {
        promises.push(chatService.sendMessage('room1', `Rapid ${i}`).catch(err => err));
      }
      const results = await Promise.all(promises);
      const successes = results.filter(r => !(r instanceof Error));
      const failures = results.filter(r => r instanceof Error);
      expect(successes.length).toBe(10);
      expect(failures.length).toBe(2);
      expect(failures[0].message).toContain('Rate limit exceeded');
    });

    it('should enforce rate limits independently per user', async () => {
      // User 1 sends 10 messages (hitting their limit)
      setCurrentUser({ id: 'u1', username: 'user1', displayName: 'User 1', sessionId: 's1' });
      for (let i = 0; i < 10; i++) {
        await chatService.sendMessage('room1', `User1 msg ${i}`);
      }

      // User 1 should be rate-limited
      await expect(chatService.sendMessage('room1', 'User1 over limit')).rejects.toThrow('Rate limit exceeded');

      // User 2 should still be able to send (independent bucket)
      setCurrentUser({ id: 'u2', username: 'user2', displayName: 'User 2', sessionId: 's2' });
      const result = await chatService.sendMessage('room1', 'User2 first msg');
      expect(result.message.body).toBe('User2 first msg');
      expect(result.message.authorId).toBe('u2');
    });

    it('should allow a second user full quota after first user is exhausted', async () => {
      // Exhaust user 1's quota
      setCurrentUser({ id: 'u1', username: 'user1', displayName: 'User 1', sessionId: 's1' });
      for (let i = 0; i < 10; i++) {
        await chatService.sendMessage('room1', `U1 ${i}`);
      }

      // User 2 should get their own full 10-message quota
      setCurrentUser({ id: 'u2', username: 'user2', displayName: 'User 2', sessionId: 's2' });
      for (let i = 0; i < 10; i++) {
        await chatService.sendMessage('room1', `U2 ${i}`);
      }
      // User 2 should now also be rate-limited
      await expect(chatService.sendMessage('room1', 'U2 over limit')).rejects.toThrow('Rate limit exceeded');
    });
  });

  // ── Cap Enforcement ────────────────────────────────────────────────

  describe('cap enforcement', () => {
    it('should delete oldest messages when cap is exceeded', async () => {
      setCurrentUser();

      // Directly insert 502 messages into the DB to avoid rate limiting
      const roomId = 'caproom';
      for (let i = 0; i < 502; i++) {
        await db.put('chatMessages', {
          id: `msg-${i}`,
          roomId,
          authorId: 'u1',
          body: `Message ${i}`,
          deleted: false,
          createdAt: 1000 + i
        });
      }

      // Enforce cap
      await chatService._enforceCap(roomId, 500);

      const remaining = await chatService.getMessages(roomId);
      expect(remaining.length).toBe(500);

      // The two oldest (msg-0, msg-1) should have been deleted
      const oldest = await db.get('chatMessages', 'msg-0');
      expect(oldest).toBeUndefined();
      const secondOldest = await db.get('chatMessages', 'msg-1');
      expect(secondOldest).toBeUndefined();

      // Newest should still exist
      const newest = await db.get('chatMessages', 'msg-501');
      expect(newest).toBeDefined();
    });

    it('should not delete anything when under cap', async () => {
      setCurrentUser();
      const roomId = 'smallroom';
      for (let i = 0; i < 5; i++) {
        await db.put('chatMessages', {
          id: `msg-${i}`,
          roomId,
          authorId: 'u1',
          body: `Message ${i}`,
          deleted: false,
          createdAt: 1000 + i
        });
      }

      await chatService._enforceCap(roomId, 500);

      const remaining = await chatService.getMessages(roomId);
      expect(remaining.length).toBe(5);
    });
  });
});
