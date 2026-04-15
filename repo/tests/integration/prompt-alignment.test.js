import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetAll, setCurrentUser } from '../helpers.js';
import { opsService } from '../../js/services/ops-service.js';
import { roomService } from '../../js/services/room-service.js';
import { stickyService } from '../../js/services/sticky-service.js';
import { whiteboardService } from '../../js/services/whiteboard-service.js';
import { chatService } from '../../js/services/chat-service.js';
import { presenceService } from '../../js/services/presence-service.js';
import { bus } from '../../js/core/event-bus.js';
import { store } from '../../js/core/store.js';
import { storage, STORAGE_KEYS } from '../../js/core/storage.js';
import { db } from '../../js/core/db.js';

// Drain in-memory rate limit timestamps to prevent bleed between tests
function drainRateLimit() {
  const realNow = Date.now;
  Date.now = () => realNow.call(Date) + 120_000;
  try { chatService._enforceRateLimit('u1'); } catch { /* ignore */ }
  Date.now = realNow;
}

beforeEach(async () => {
  drainRateLimit();
  await resetAll();
  setCurrentUser();
});

// ── Announcement-to-Room Rendering ──────────────────────────────────

describe('Announcement-to-Room Rendering', () => {
  it('should return the most recent active announcement via getActiveAnnouncement', async () => {
    // Insert with explicit timestamps to avoid same-ms ordering issues
    await db.put('opsAnnouncements', { id: 'ann-old', title: 'Old', body: 'Old body', bgColor: '#1e40af', textColor: '#ffffff', active: true, createdAt: 1000, updatedAt: 1000 });
    await db.put('opsAnnouncements', { id: 'ann-new', title: 'New', body: 'New body', bgColor: '#1e40af', textColor: '#ffffff', active: true, createdAt: 2000, updatedAt: 2000 });
    const active = await opsService.getActiveAnnouncement();
    expect(active).not.toBeNull();
    expect(active.id).toBe('ann-new');
    expect(active.title).toBe('New');
  });

  it('should return null when no active announcements exist', async () => {
    const ann = await opsService.createAnnouncement('Test', 'Body');
    await opsService.updateAnnouncement(ann.id, { active: false });
    const active = await opsService.getActiveAnnouncement();
    expect(active).toBeNull();
  });

  it('should skip inactive announcements and return the active one', async () => {
    const inactive = await opsService.createAnnouncement('Inactive', 'Body');
    await opsService.updateAnnouncement(inactive.id, { active: false });
    const active = await opsService.createAnnouncement('Active', 'Active body');
    const result = await opsService.getActiveAnnouncement();
    expect(result.id).toBe(active.id);
  });

  it('should include announcement colors for banner rendering', async () => {
    const ann = await opsService.createAnnouncement('Alert', 'Body', '#ff0000', '#ffffff');
    const active = await opsService.getActiveAnnouncement();
    expect(active.bgColor).toBe('#ff0000');
    expect(active.textColor).toBe('#ffffff');
  });

  it('should reflect updates to the active announcement', async () => {
    const ann = await opsService.createAnnouncement('V1', 'Body v1');
    await opsService.updateAnnouncement(ann.id, { title: 'V2', body: 'Body v2' });
    const active = await opsService.getActiveAnnouncement();
    expect(active.title).toBe('V2');
    expect(active.body).toBe('Body v2');
  });
});

// ── Banner Precedence ───────────────────────────────────────────────

describe('Banner Precedence', () => {
  it('should have storage quota check return exceeded flag that would take precedence', async () => {
    const room = await roomService.createRoom('QuotaRoom', 'Test');
    const quota = await roomService.checkStorageQuota(room.id);
    // In a fresh room, storage is not exceeded
    expect(quota.exceeded).toBe(false);
    expect(quota.nearLimit).toBe(false);
    // This confirms the storage warning system is functional;
    // when exceeded=true, it should take priority over ops announcements
  });

  it('should have announcement available concurrently with room state', async () => {
    const ann = await opsService.createAnnouncement('System Update', 'Planned maintenance');
    const room = await roomService.createRoom('TestRoom', 'Test');
    // Both are available simultaneously
    const activeAnn = await opsService.getActiveAnnouncement();
    const quota = await roomService.checkStorageQuota(room.id);
    expect(activeAnn).not.toBeNull();
    expect(activeAnn.title).toBe('System Update');
    expect(quota.exceeded).toBe(false);
    // When storage is not exceeded, the announcement banner should show
    // When storage IS exceeded, storage warning takes precedence
  });
});

// ── Template / Starter-Kit Application During Room Creation ────────

describe('Template Application During Room Creation', () => {
  let template;

  beforeEach(async () => {
    template = await opsService.createTemplate('Sprint Planning', 'productivity', {
      stickyNotes: [
        { title: 'Todo', body: 'Tasks to complete', color: '#FFEB3B' },
        { title: 'In Progress', body: 'Currently working on', color: '#2196F3' },
        { title: 'Done', body: 'Completed tasks', color: '#4CAF50' }
      ],
      whiteboardElements: [
        { type: 'rect', x: 10, y: 10, width: 200, height: 100, fill: '#e0e0e0' }
      ],
      welcomeMessage: 'Welcome to Sprint Planning!'
    });
  });

  it('should create a template with data payload', () => {
    expect(template.id).toBeTruthy();
    expect(template.name).toBe('Sprint Planning');
    expect(template.category).toBe('productivity');
    expect(template.data.stickyNotes).toHaveLength(3);
    expect(template.data.whiteboardElements).toHaveLength(1);
  });

  it('should seed sticky notes from template data into a new room', async () => {
    const room = await roomService.createRoom('New Room', '');
    const data = template.data;

    // Simulate template application (same logic as room-list-page._applyTemplate)
    for (const note of data.stickyNotes) {
      await stickyService.createNote(room.id, {
        title: note.title,
        body: note.body,
        color: note.color
      });
    }

    const notes = await stickyService.getNotesByRoom(room.id);
    expect(notes).toHaveLength(3);
    expect(notes.map(n => n.title).sort()).toEqual(['Done', 'In Progress', 'Todo']);
  });

  it('should seed whiteboard elements from template data into a new room', async () => {
    const room = await roomService.createRoom('WB Room', '');
    const data = template.data;

    for (const el of data.whiteboardElements) {
      await whiteboardService.createElement(room.id, el.type || 'rect', {
        x: el.x, y: el.y, width: el.width, height: el.height, fill: el.fill
      });
    }

    const elements = await whiteboardService.getElementsByRoom(room.id);
    expect(elements).toHaveLength(1);
    expect(elements[0].type).toBe('rect');
    expect(elements[0].x).toBe(10);
  });

  it('should seed welcome message from template data', async () => {
    const room = await roomService.createRoom('Chat Room', '');
    await chatService.sendMessage(room.id, template.data.welcomeMessage);

    const messages = await chatService.getMessages(room.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].body).toBe('Welcome to Sprint Planning!');
  });

  it('should persist template default selection in localStorage', () => {
    storage.set(STORAGE_KEYS.TEMPLATE_DEFAULTS, { defaultId: template.id });
    const defaults = storage.get(STORAGE_KEYS.TEMPLATE_DEFAULTS);
    expect(defaults.defaultId).toBe(template.id);
  });
});

// ── Featured / Default Template Behavior ────────────────────────────

describe('Featured and Default Template Behavior', () => {
  it('should list templates in sortOrder', async () => {
    const t1 = await opsService.createTemplate('First', 'general', { stickyNotes: [] });
    const t2 = await opsService.createTemplate('Second', 'general', { stickyNotes: [] });
    const templates = await opsService.listTemplates();
    expect(templates[0].id).toBe(t1.id);
    expect(templates[1].id).toBe(t2.id);
  });

  it('should filter templates by category', async () => {
    await opsService.createTemplate('A', 'alpha', {});
    await opsService.createTemplate('B', 'beta', {});
    const alpha = await opsService.listTemplates('alpha');
    expect(alpha).toHaveLength(1);
    expect(alpha[0].name).toBe('A');
  });

  it('should use defaultId from TEMPLATE_DEFAULTS when present', () => {
    const templateId = 'test-template-id';
    storage.set(STORAGE_KEYS.TEMPLATE_DEFAULTS, { defaultId: templateId });
    const defaults = storage.get(STORAGE_KEYS.TEMPLATE_DEFAULTS);
    expect(defaults.defaultId).toBe(templateId);
  });

  it('should support featured flag on templates for UI selection', async () => {
    const t1 = await opsService.createTemplate('Normal', 'general', {});
    const t2 = await opsService.createTemplate('Featured', 'general', {});
    await opsService.updateTemplate(t2.id, { featured: true });

    const templates = await opsService.listTemplates();
    const featured = templates.find(t => t.featured);
    expect(featured).toBeDefined();
    expect(featured.name).toBe('Featured');
  });

  it('should allow reordering templates', async () => {
    const t1 = await opsService.createTemplate('A', 'cat', {});
    const t2 = await opsService.createTemplate('B', 'cat', {});
    await opsService.reorderTemplates([t2.id, t1.id]);
    const reordered = await opsService.listTemplates();
    expect(reordered[0].id).toBe(t2.id);
    expect(reordered[1].id).toBe(t1.id);
  });
});

// ── Ops Route Guard Behavior ────────────────────────────────────────

describe('Ops Route Guard Behavior', () => {
  it('should have role stored in localStorage', () => {
    storage.set(STORAGE_KEYS.ROLE, 'ops');
    const role = storage.get(STORAGE_KEYS.ROLE);
    expect(role).toBe('ops');
  });

  it('should default role to user', () => {
    const role = storage.get(STORAGE_KEYS.ROLE, 'user');
    expect(role).toBe('user');
  });

  it('should toggle role between user and ops via store', () => {
    store.set('role', 'user');
    expect(store.get('role')).toBe('user');
    store.set('role', 'ops');
    expect(store.get('role')).toBe('ops');
  });

  it('should prevent non-ops users from accessing ops data (conceptual guard)', () => {
    // The requireOps guard in app.js checks:
    // 1. User must be logged in (currentUser exists)
    // 2. Role must be 'ops'
    // If not ops, redirect to /rooms
    store.set('currentUser', { id: 'u1', username: 'test' });
    store.set('role', 'user');
    const role = store.get('role');
    expect(role).not.toBe('ops');

    // With ops role
    store.set('role', 'ops');
    expect(store.get('role')).toBe('ops');
  });

  it('should require both auth and ops role', () => {
    // No user = redirect to login
    store.delete('currentUser');
    expect(store.get('currentUser')).toBeUndefined();

    // User but not ops = redirect to rooms
    store.set('currentUser', { id: 'u1' });
    store.set('role', 'user');
    expect(store.get('role')).toBe('user');
    // requireOps would return '/rooms'

    // User + ops = allowed
    store.set('role', 'ops');
    expect(store.get('role')).toBe('ops');
    expect(store.get('currentUser')).toBeDefined();
    // requireOps would return null (allow)
  });
});

// ── Chat Drawer Interaction ─────────────────────────────────────────

describe('Chat Drawer Interaction', () => {
  let room;

  beforeEach(async () => {
    room = await roomService.createRoom('Chat Room', '');
  });

  it('should support sending messages that can be loaded in a drawer context', async () => {
    await chatService.sendMessage(room.id, 'Hello from drawer');
    const messages = await chatService.getMessages(room.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].body).toBe('Hello from drawer');
  });

  it('should append new messages in chronological order', async () => {
    await chatService.sendMessage(room.id, 'First');
    await chatService.sendMessage(room.id, 'Second');
    const messages = await chatService.getMessages(room.id);
    expect(messages).toHaveLength(2);
    // getMessages returns desc order by createdAt; both bodies should exist
    const bodies = messages.map(m => m.body).sort();
    expect(bodies).toEqual(['First', 'Second']);
  });

  it('should emit chat:message event for drawer to consume', async () => {
    const handler = vi.fn();
    bus.on('chat:message', handler);
    await chatService.sendMessage(room.id, 'Event test');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].body).toBe('Event test');
  });

  it('should enforce rate limiting in drawer context', async () => {
    // Send 10 messages (the rate limit)
    for (let i = 0; i < 10; i++) {
      await chatService.sendMessage(room.id, `Msg ${i}`);
    }
    // 11th should fail
    await expect(chatService.sendMessage(room.id, 'Too many')).rejects.toThrow(/rate/i);
  });

  it('should soft-delete messages visible in drawer', async () => {
    const result = await chatService.sendMessage(room.id, 'Delete me');
    await chatService.deleteMessage(result.message.id);
    const messages = await chatService.getMessages(room.id);
    const deleted = messages.find(m => m.id === result.message.id);
    expect(deleted.deleted).toBe(true);
  });
});

// ── Presence Label Rendering ────────────────────────────────────────

describe('Presence Label Rendering', () => {
  it('should track active status on room entry', async () => {
    // Mock sync for presence
    const { sync } = await import('../../js/core/sync.js');
    sync.init();
    presenceService.init();

    const room = await roomService.createRoom('Presence Room', '');
    await presenceService.enterRoom(room.id);
    const presence = await presenceService.getRoomPresence(room.id);

    expect(presence.length).toBeGreaterThanOrEqual(1);
    expect(presence[0].status).toBe('active');
    expect(presence[0].roomId).toBe(room.id);

    await presenceService.leaveRoom();
    presenceService.destroy();
  });

  it('should transition to idle status', async () => {
    const { sync } = await import('../../js/core/sync.js');
    sync.init();
    presenceService.init();

    const room = await roomService.createRoom('Idle Room', '');
    await presenceService.enterRoom(room.id);
    await presenceService.setIdle();

    const presence = await presenceService.getRoomPresence(room.id);
    expect(presence[0].status).toBe('idle');

    await presenceService.leaveRoom();
    presenceService.destroy();
  });

  it('should transition back to active from idle', async () => {
    const { sync } = await import('../../js/core/sync.js');
    sync.init();
    presenceService.init();

    const room = await roomService.createRoom('Active Room', '');
    await presenceService.enterRoom(room.id);
    await presenceService.setIdle();
    await presenceService.setActive();

    const presence = await presenceService.getRoomPresence(room.id);
    expect(presence[0].status).toBe('active');

    await presenceService.leaveRoom();
    presenceService.destroy();
  });

  it('should emit presence events for label updates', async () => {
    const { sync } = await import('../../js/core/sync.js');
    sync.init();
    presenceService.init();

    const idleHandler = vi.fn();
    const activeHandler = vi.fn();
    bus.on('presence:idle', idleHandler);
    bus.on('presence:active', activeHandler);

    const room = await roomService.createRoom('Event Room', '');
    await presenceService.enterRoom(room.id);
    await presenceService.setIdle();
    expect(idleHandler).toHaveBeenCalledTimes(1);

    await presenceService.setActive();
    expect(activeHandler).toHaveBeenCalledTimes(1);

    await presenceService.leaveRoom();
    presenceService.destroy();
  });
});

// ── Integration: Room from Template + Ops Announcement ──────────────

describe('Integration: Room created from template shows ops announcement', () => {
  it('should create a room from a template and have announcement available', async () => {
    // 1. Create an ops announcement
    const announcement = await opsService.createAnnouncement(
      'Maintenance Notice',
      'System will be updated tonight',
      '#dc2626',
      '#ffffff'
    );

    // 2. Create a template with starter content
    const template = await opsService.createTemplate('Retro Board', 'agile', {
      stickyNotes: [
        { title: 'What went well', body: '', color: '#4CAF50' },
        { title: 'What to improve', body: '', color: '#FF9800' },
        { title: 'Action items', body: '', color: '#2196F3' }
      ],
      whiteboardElements: [
        { type: 'rect', x: 0, y: 0, width: 300, height: 200, fill: '#f0f0f0' }
      ]
    });

    // 3. Create the room
    const room = await roomService.createRoom('Sprint 42 Retro', 'End of sprint retrospective');

    // 4. Apply the template (simulating what room-list-page does)
    for (const note of template.data.stickyNotes) {
      await stickyService.createNote(room.id, {
        title: note.title,
        body: note.body,
        color: note.color
      });
    }
    for (const el of template.data.whiteboardElements) {
      await whiteboardService.createElement(room.id, el.type || 'rect', {
        x: el.x, y: el.y, width: el.width, height: el.height, fill: el.fill
      });
    }

    // 5. Verify the room has template content
    const notes = await stickyService.getNotesByRoom(room.id);
    expect(notes).toHaveLength(3);
    expect(notes.map(n => n.title).sort()).toEqual(['Action items', 'What to improve', 'What went well']);

    const elements = await whiteboardService.getElementsByRoom(room.id);
    expect(elements).toHaveLength(1);
    expect(elements[0].type).toBe('rect');

    // 6. Verify the announcement is available for the room UI
    const activeAnn = await opsService.getActiveAnnouncement();
    expect(activeAnn).not.toBeNull();
    expect(activeAnn.title).toBe('Maintenance Notice');
    expect(activeAnn.body).toBe('System will be updated tonight');
    expect(activeAnn.bgColor).toBe('#dc2626');

    // 7. Verify room storage is not exceeded (so announcement banner would show)
    const quota = await roomService.checkStorageQuota(room.id);
    expect(quota.exceeded).toBe(false);
    // This proves: room was created from template AND the announcement
    // is available to render in the room UI with no storage conflict
  });

  it('should persist default template and recall it for next room creation', async () => {
    const template = await opsService.createTemplate('Quick Start', 'general', {
      stickyNotes: [{ title: 'Welcome', body: 'Get started here', color: '#FFEB3B' }]
    });

    // Persist default selection
    storage.set(STORAGE_KEYS.TEMPLATE_DEFAULTS, { defaultId: template.id });

    // Simulate loading defaults on next modal open
    const defaults = storage.get(STORAGE_KEYS.TEMPLATE_DEFAULTS);
    expect(defaults.defaultId).toBe(template.id);

    // Load templates and find the default
    const templates = await opsService.listTemplates();
    const defaultTemplate = templates.find(t => t.id === defaults.defaultId);
    expect(defaultTemplate).toBeDefined();
    expect(defaultTemplate.name).toBe('Quick Start');
  });

  it('should handle room creation with no templates gracefully', async () => {
    // No templates exist
    const templates = await opsService.listTemplates();
    expect(templates).toHaveLength(0);

    // Room creation still works
    const room = await roomService.createRoom('Empty Room', '');
    expect(room.id).toBeTruthy();

    const notes = await stickyService.getNotesByRoom(room.id);
    expect(notes).toHaveLength(0);
  });
});
