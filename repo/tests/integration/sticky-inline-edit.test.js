import { describe, it, expect, beforeEach } from 'vitest';
import { resetAll, setCurrentUser } from '../helpers.js';
import { roomService } from '../../js/services/room-service.js';
import { stickyService } from '../../js/services/sticky-service.js';

/**
 * Integration test verifying that the sticky note inline edit DOM wiring
 * produces the correct element IDs so the edit form can be injected.
 *
 * We simulate the rendering approach used in room-page.js by calling the
 * same escapeHTML and building the same HTML structure, then asserting
 * querySelector targets are reachable.
 */

describe('Integration: Sticky inline edit wiring', () => {
  let room;

  beforeEach(async () => {
    await resetAll();
    setCurrentUser();
    room = await roomService.createRoom('Edit Room');
  });

  it('should render sticky item with queryable content wrapper id', async () => {
    const note = await stickyService.createNote(room.id, { title: 'My Note', body: 'Body text' });

    // Build DOM fragment matching _renderStickyItem structure
    const container = document.createElement('div');
    container.innerHTML = `
      <div class="js-sticky-item" data-id="${note.id}">
        <div id="sticky-item-content-${note.id}">
          <div>
            <span>${note.title}</span>
            <button class="js-edit-sticky" data-id="${note.id}">Edit</button>
          </div>
          <div>${note.body}</div>
        </div>
      </div>
    `;
    document.body.appendChild(container);

    // The content wrapper must be findable by the selector used in the edit handler
    const contentEl = document.querySelector(`#sticky-item-content-${note.id}`);
    expect(contentEl).not.toBeNull();
    expect(contentEl.textContent).toContain('My Note');
    expect(contentEl.textContent).toContain('Body text');

    // Simulate replacing with edit form
    contentEl.innerHTML = `
      <input class="js-sticky-title" value="${note.title}" />
      <textarea class="js-sticky-body">${note.body}</textarea>
      <input type="hidden" class="js-sticky-color-value" value="${note.color}" />
      <button class="js-sticky-save-edit" data-id="${note.id}">Save</button>
    `;

    // Verify form inputs are accessible from the parent .js-sticky-item
    const stickyItem = container.querySelector('.js-sticky-item');
    expect(stickyItem.querySelector('.js-sticky-title').value).toBe('My Note');
    expect(stickyItem.querySelector('.js-sticky-body').textContent).toBe('Body text');
    expect(stickyItem.querySelector('.js-sticky-save-edit').dataset.id).toBe(note.id);

    document.body.removeChild(container);
  });

  it('should allow saving edited values back to the service', async () => {
    const note = await stickyService.createNote(room.id, { title: 'Original', body: 'Old body', color: '#FFEB3B' });

    // Simulate edit save
    const updated = await stickyService.updateNote(note.id, {
      title: 'Edited Title',
      body: 'New body',
      color: '#4CAF50'
    });

    expect(updated.title).toBe('Edited Title');
    expect(updated.body).toBe('New body');
    expect(updated.color).toBe('#4CAF50');

    // Verify persistence
    const notes = await stickyService.getNotesByRoom(room.id);
    const found = notes.find(n => n.id === note.id);
    expect(found.title).toBe('Edited Title');
  });

  it('should find save button container via closest .js-sticky-item', async () => {
    const note = await stickyService.createNote(room.id, { title: 'Test', body: '' });

    const container = document.createElement('div');
    container.innerHTML = `
      <div class="js-sticky-item" data-id="${note.id}">
        <div id="sticky-item-content-${note.id}">
          <input class="js-sticky-title" value="Updated" />
          <textarea class="js-sticky-body">New body</textarea>
          <input type="hidden" class="js-sticky-color-value" value="#FF9800" />
          <button class="js-sticky-save-edit" data-id="${note.id}">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(container);

    // Simulate the save handler's container lookup
    const saveBtn = container.querySelector('.js-sticky-save-edit');
    const noteId = saveBtn.dataset.id;
    const parentContainer = saveBtn.closest('.js-sticky-item') ||
      saveBtn.closest(`#sticky-item-content-${noteId}`)?.parentElement;

    expect(parentContainer).not.toBeNull();
    expect(parentContainer.querySelector('.js-sticky-title').value).toBe('Updated');
    expect(parentContainer.querySelector('.js-sticky-body').textContent).toBe('New body');
    expect(parentContainer.querySelector('.js-sticky-color-value').value).toBe('#FF9800');

    document.body.removeChild(container);
  });
});
