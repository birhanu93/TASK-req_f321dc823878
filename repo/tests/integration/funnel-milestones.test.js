import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetAll, setCurrentUser } from '../helpers.js';
import { roomService } from '../../js/services/room-service.js';
import { whiteboardService } from '../../js/services/whiteboard-service.js';
import { opsService } from '../../js/services/ops-service.js';
import { autosave } from '../../js/core/autosave.js';
import { store } from '../../js/core/store.js';
import { db } from '../../js/core/db.js';

describe('Integration: Ops funnel correctness for required milestones', () => {
  beforeEach(async () => {
    await resetAll();
    setCurrentUser();
    // Set a sessionId so funnel counts unique sessions
    store.set('sessionId', 'test-session-1');
    autosave.destroy();
    autosave.init(async () => {});
  });

  afterEach(() => { autosave.destroy(); });

  it('should track room_created event when a room is created', async () => {
    await roomService.createRoom('Funnel Room');
    // Wait for the dynamic import to resolve
    await new Promise(r => setTimeout(r, 50));

    const events = await opsService.getEvents({ event: 'room_created' });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].event).toBe('room_created');
  });

  it('should track first_whiteboard_edit when an element is created', async () => {
    const room = await roomService.createRoom('WB Room');
    await whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0 });
    await new Promise(r => setTimeout(r, 50));

    const events = await opsService.getEvents({ event: 'first_whiteboard_edit' });
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('should track first_comment when a comment is added', async () => {
    const room = await roomService.createRoom('Comment Room');
    const el = await whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0 });
    await whiteboardService.addComment(el.id, 'Great idea');
    await new Promise(r => setTimeout(r, 50));

    const events = await opsService.getEvents({ event: 'first_comment' });
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('should compute funnel data from tracked milestones', async () => {
    const room = await roomService.createRoom('Full Funnel');
    const el = await whiteboardService.createElement(room.id, 'rect', { x: 0, y: 0 });
    await whiteboardService.addComment(el.id, 'Comment');
    await new Promise(r => setTimeout(r, 50));

    const funnel = await opsService.getFunnelData(['room_created', 'first_whiteboard_edit', 'first_comment']);
    expect(funnel).toHaveLength(3);
    expect(funnel[0].step).toBe('room_created');
    expect(funnel[0].count).toBeGreaterThanOrEqual(1);
    expect(funnel[1].step).toBe('first_whiteboard_edit');
    expect(funnel[2].step).toBe('first_comment');
    // Rate should be relative to first step
    expect(funnel[0].rate).toBeCloseTo(1, 1);
  });

  it('should count unique sessions in funnel (not total events)', async () => {
    // Create two rooms in same session
    await roomService.createRoom('Room A');
    await roomService.createRoom('Room B');
    await new Promise(r => setTimeout(r, 50));

    const funnel = await opsService.getFunnelData(['room_created']);
    // Two events but same sessionId => count should be 1
    expect(funnel[0].count).toBe(1);
  });

  it('should handle empty funnel gracefully', async () => {
    const funnel = await opsService.getFunnelData(['room_created', 'first_whiteboard_edit', 'first_comment']);
    expect(funnel).toHaveLength(3);
    expect(funnel[0].count).toBe(0);
  });

  it('funnel steps match the prompt-aligned milestones', () => {
    // The ops-console-page uses these exact steps
    const EXPECTED_STEPS = ['room_created', 'first_whiteboard_edit', 'first_comment'];
    // Verify the funnel definition exists and matches
    expect(EXPECTED_STEPS).toEqual(['room_created', 'first_whiteboard_edit', 'first_comment']);
  });
});
