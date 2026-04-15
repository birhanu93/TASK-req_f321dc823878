import { Component } from '../../core/component.js';
import { store } from '../../core/store.js';
import { router } from '../../core/router.js';
import { bus } from '../../core/event-bus.js';
import { escapeHTML, initial, relativeTime, formatBytes, debounce, readFileAsText, downloadBlob } from '../../core/utils.js';
import { roomService } from '../../services/room-service.js';
import { activityService } from '../../services/activity-service.js';
import { presenceService } from '../../services/presence-service.js';
import { stickyService } from '../../services/sticky-service.js';
import { chatService } from '../../services/chat-service.js';
import { whiteboardService } from '../../services/whiteboard-service.js';
import { importExportService } from '../../services/import-export-service.js';
import { opsService } from '../../services/ops-service.js';
import { Whiteboard } from '../components/whiteboard.js';
import { Drawer } from '../components/drawer.js';
import { Modal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { confirmDialog } from '../components/confirm-dialog.js';
import { storage, STORAGE_KEYS } from '../../core/storage.js';

const TABS = [
  { id: 'whiteboard', label: 'Whiteboard' },
  { id: 'stickies', label: 'Stickies' },
  { id: 'activity', label: 'Activity' }
];

const STICKY_COLORS = [
  { value: '#FFEB3B', label: 'Yellow' },
  { value: '#FF9800', label: 'Orange' },
  { value: '#F44336', label: 'Red' },
  { value: '#4CAF50', label: 'Green' },
  { value: '#2196F3', label: 'Blue' },
  { value: '#9C27B0', label: 'Purple' }
];

export class RoomPage extends Component {
  constructor(container, props) {
    super(container, props);
    this.state = {
      room: null,
      loading: true,
      error: null,
      activeTab: 'whiteboard',
      presence: [],
      activities: [],
      storageExceeded: false,
      selectedElement: null,
      announcement: null
    };
    this._whiteboard = null;
    this._stickyEditId = null;
    this._stickyCreateOpen = false;
    this._chatMessages = [];
    this._chatDrawer = null;
    this._selectedElementId = null;
    this._notesSaveDebounced = debounce(this._saveElementNotes.bind(this), 600);
  }

  mount() {
    super.mount();
    this._loadRoom();

    this.subscribeTo('room:updated', (room) => {
      if (room.id === this.props.id) {
        this.setState({ room });
      }
    });

    this.subscribeTo('room:deleted', ({ id }) => {
      if (id === this.props.id) {
        showToast('This room has been deleted', { type: 'warning' });
        router.navigate('/rooms');
      }
    });

    this.subscribeTo('presence:enter', () => this._refreshPresence());
    this.subscribeTo('presence:leave', () => this._refreshPresence());
    this.subscribeTo('presence:active', () => this._refreshPresence());
    this.subscribeTo('presence:idle', () => this._refreshPresence());

    this.subscribeTo('activity:logged', (entry) => {
      if (entry.roomId === this.props.id) {
        this._loadActivities();
      }
    });

    this.subscribeTo('snapshot:created', ({ roomId }) => {
      if (roomId === this.props.id) {
        showToast('Snapshot created', { type: 'success' });
      }
    });

    // Sticky events - refresh the list
    this.subscribeTo('sticky:created', (note) => {
      if (note.roomId === this.props.id && this.state.activeTab === 'stickies') {
        this._refreshStickies();
      }
    });
    this.subscribeTo('sticky:updated', (note) => {
      if (note.roomId === this.props.id && this.state.activeTab === 'stickies') {
        this._refreshStickies();
      }
    });
    this.subscribeTo('sticky:deleted', ({ roomId }) => {
      if (roomId === this.props.id && this.state.activeTab === 'stickies') {
        this._refreshStickies();
      }
    });
    this.subscribeTo('sticky:imported', ({ roomId }) => {
      if (roomId === this.props.id && this.state.activeTab === 'stickies') {
        this._refreshStickies();
      }
    });

    // Chat message - auto-append when chat drawer is open
    this.subscribeTo('chat:message', (message) => {
      if (message.roomId === this.props.id && this._chatDrawer) {
        this._appendChatMessage(message);
      }
    });

    // Whiteboard selection changed
    this.subscribeTo('whiteboard:selection-changed', ({ id, roomId }) => {
      if (roomId === this.props.id) {
        this._selectedElementId = id;
        if (this.state.activeTab === 'whiteboard') {
          this._refreshWhiteboardSidebar();
        }
      }
    });

    // Comment added - refresh whiteboard sidebar
    this.subscribeTo('comment:added', (comment) => {
      if (comment.elementId === this._selectedElementId && this.state.activeTab === 'whiteboard') {
        this._refreshWhiteboardSidebar();
      }
    });

    // Cross-tab sync: refresh UI when another tab modifies room data
    this.subscribeTo('sync:whiteboardElements:refresh', ({ roomId }) => {
      if (roomId === this.props.id && this._whiteboard) {
        this._whiteboard.destroy();
        this._mountWhiteboard(this.state.room);
      }
    });
    this.subscribeTo('sync:stickyNotes:refresh', ({ roomId }) => {
      if (roomId === this.props.id && this.state.activeTab === 'stickies') {
        this._refreshStickies();
      }
    });
    this.subscribeTo('sync:comments:refresh', ({ roomId }) => {
      if (roomId === this.props.id && this.state.activeTab === 'whiteboard') {
        this._refreshWhiteboardSidebar();
      }
    });
    this.subscribeTo('room:remote-refresh', ({ roomId, action }) => {
      if (roomId === this.props.id) {
        showToast(`Room ${action === 'import' ? 'imported' : 'rolled back'} from another tab`, { type: 'info' });
        this._loadRoom();
      }
    });

    // Ops announcement events - refresh banner when announcements change
    this.subscribeTo('ops:announcement-created', () => this._loadAnnouncement());
    this.subscribeTo('ops:announcement-updated', () => this._loadAnnouncement());
  }

  async _loadRoom() {
    try {
      const room = await roomService.getRoom(this.props.id);
      if (!room) {
        this.setState({ loading: false, error: 'Room not found' });
        return;
      }

      store.set('currentRoom', room);
      storage.set(STORAGE_KEYS.LAST_ROOM, room.id);

      // Enter presence
      await presenceService.enterRoom(room.id);

      const presence = await presenceService.getRoomPresence(room.id);
      const activities = await activityService.getActivityFeed(room.id, { limit: 30 });

      this.setState({ room, loading: false, presence, activities });

      // Mount whiteboard after render
      this._mountWhiteboard(room);

      // Check storage quota then load announcement (quota check may set storageExceeded)
      await this._checkStorageQuota(room.id);
      await this._loadAnnouncement();
    } catch (err) {
      console.error('[RoomPage] Failed to load room:', err);
      this.setState({ loading: false, error: err.message });
    }
  }

  async _loadAnnouncement() {
    try {
      const announcement = await opsService.getActiveAnnouncement();
      this.state.announcement = announcement;
      this._renderAnnouncementBanner();
    } catch {
      // Silently ignore announcement load failures
    }
  }

  _renderAnnouncementBanner() {
    const banner = this.$('#announcement-banner');
    if (!banner) return;

    // Precedence: storage-exceeded warning takes priority over ops announcement
    if (this.state.storageExceeded) {
      // Storage warning is already rendered by _checkStorageQuota; don't overwrite
      return;
    }

    const announcement = this.state.announcement;
    if (announcement && announcement.active) {
      banner.style.display = 'block';
      banner.innerHTML = `
        <div class="ops-announcement-banner" style="
          background: ${announcement.bgColor || '#1e40af'};
          color: ${announcement.textColor || '#ffffff'};
          padding: var(--sp-3) var(--sp-4);
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: var(--text-sm);
          font-weight: var(--fw-medium);
        ">
          <div>
            <strong>${escapeHTML(announcement.title)}</strong>
            ${announcement.body ? `<span style="margin-left: var(--sp-2)">${escapeHTML(announcement.body)}</span>` : ''}
          </div>
          <button class="btn btn--sm js-dismiss-announcement" type="button" style="
            background: rgba(255,255,255,0.2);
            color: inherit;
            border: none;
            padding: 2px 8px;
            border-radius: var(--radius-md);
            cursor: pointer;
          ">Dismiss</button>
        </div>
      `;
    } else {
      banner.style.display = 'none';
      banner.innerHTML = '';
    }
  }

  _mountWhiteboard(room) {
    const container = this.$('#whiteboard-container');
    if (!container) return;
    if (this._whiteboard) {
      this._whiteboard.destroy();
    }
    this._whiteboard = new Whiteboard(container, { roomId: room.id });
    this._whiteboard.mount();
  }

  async _checkStorageQuota(roomId) {
    try {
      const quota = await roomService.checkStorageQuota(roomId);
      if (quota.exceeded) {
        this.setState({ storageExceeded: true });
        const banner = this.$('#announcement-banner');
        if (banner) {
          banner.style.display = 'block';
          banner.innerHTML = `
            <div style="
              background: var(--c-warning-bg, #fef3cd);
              color: var(--c-warning-text, #856404);
              padding: var(--sp-3) var(--sp-4);
              display: flex;
              align-items: center;
              justify-content: space-between;
              font-size: var(--text-sm);
              font-weight: var(--fw-medium);
            ">
              <span>Storage limit exceeded (${formatBytes(quota.used)} / ${formatBytes(quota.limit)}). Write operations are disabled.</span>
              <button class="btn btn--sm btn--warning js-manage-storage" type="button">Manage Storage</button>
            </div>
          `;
        }
      } else if (quota.nearLimit) {
        showToast(`Storage nearly full: ${formatBytes(quota.used)} / ${formatBytes(quota.limit)}`, {
          type: 'warning',
          duration: 0,
          action: {
            label: 'Manage Storage',
            onClick: () => this._openCleanupModal()
          }
        });
      }
      // If storage is not exceeded, allow announcement banner to show
      if (!quota.exceeded) {
        this._renderAnnouncementBanner();
      }
    } catch (err) {
      console.error('[RoomPage] Failed to check storage quota:', err);
    }
  }

  async _openCleanupModal() {
    const roomId = this.state.room?.id;
    if (!roomId) return;

    let suggestions;
    let quota;
    try {
      suggestions = await roomService.getCleanupSuggestions(roomId);
      quota = await roomService.checkStorageQuota(roomId);
    } catch (err) {
      showToast('Failed to load cleanup suggestions', { type: 'error' });
      return;
    }

    const pct = Math.min(100, Math.round((quota.used / quota.limit) * 100));

    const modal = new Modal({
      title: 'Manage Storage',
      size: 'lg',
      content: this._renderCleanupContent(suggestions, quota, pct),
      footer: '<button class="btn btn--secondary js-close-cleanup" type="button">Close</button>',
      closable: true
    });
    modal.render();

    modal.el.querySelector('.js-close-cleanup').addEventListener('click', () => modal.close());

    // Delete image
    modal.el.addEventListener('click', async (e) => {
      const btn = e.target.closest('.js-delete-image');
      if (btn) {
        const id = btn.dataset.id;
        try {
          await whiteboardService.deleteElement(id);
          showToast('Image deleted', { type: 'success' });
          await this._refreshCleanupModal(modal, roomId);
        } catch (err) {
          showToast(err.message || 'Failed to delete image', { type: 'error' });
        }
      }

      const snapBtn = e.target.closest('.js-delete-snapshot');
      if (snapBtn) {
        const id = snapBtn.dataset.id;
        try {
          await roomService.deleteSnapshot(id);
          showToast('Snapshot deleted', { type: 'success' });
          await this._refreshCleanupModal(modal, roomId);
        } catch (err) {
          showToast(err.message || 'Failed to delete snapshot', { type: 'error' });
        }
      }

      const purgeBtn = e.target.closest('.js-purge-messages');
      if (purgeBtn) {
        const confirmed = await confirmDialog({
          title: 'Purge Old Messages',
          message: 'This will permanently delete the oldest 100 chat messages. Continue?',
          confirmText: 'Purge',
          danger: true
        });
        if (confirmed) {
          try {
            const suggestions2 = await roomService.getCleanupSuggestions(roomId);
            const ids = suggestions2.oldMessages.map(m => m.id);
            if (ids.length > 0) {
              const { db } = await import('../../core/db.js');
              await db.deleteBatch('chatMessages', ids);
              showToast(`Purged ${ids.length} messages`, { type: 'success' });
              await this._refreshCleanupModal(modal, roomId);
            }
          } catch (err) {
            showToast(err.message || 'Failed to purge messages', { type: 'error' });
          }
        }
      }
    });
  }

  _renderCleanupContent(suggestions, quota, pct) {
    const barColor = pct >= 90 ? 'var(--c-danger, #ef4444)' : pct >= 75 ? 'var(--c-warning, #f59e0b)' : 'var(--c-success, #22c55e)';

    return `
      <div style="margin-bottom: var(--sp-4)">
        <div style="display: flex; justify-content: space-between; font-size: var(--text-sm); margin-bottom: var(--sp-2)">
          <span>${formatBytes(quota.used)} used</span>
          <span>${formatBytes(quota.limit)} limit</span>
        </div>
        <div style="width: 100%; height: 12px; background: var(--c-bg); border-radius: var(--radius-full); overflow: hidden">
          <div style="width: ${pct}%; height: 100%; background: ${barColor}; border-radius: var(--radius-full); transition: width 0.3s"></div>
        </div>
        <div style="text-align: center; font-size: var(--text-xs); color: var(--c-text-muted); margin-top: var(--sp-1)">${pct}%</div>
      </div>

      <h3 style="font-size: var(--text-base); font-weight: var(--fw-semibold); margin-bottom: var(--sp-2)">Largest Images</h3>
      ${suggestions.images.length > 0 ? `
        <div style="display: flex; flex-direction: column; gap: var(--sp-2); margin-bottom: var(--sp-4)">
          ${suggestions.images.map(img => `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: var(--sp-2); background: var(--c-bg); border-radius: var(--radius-md); font-size: var(--text-sm)">
              <span>${escapeHTML(img.type)} - ${formatBytes(img.size)}</span>
              <button class="btn btn--ghost btn--sm js-delete-image" data-id="${escapeHTML(img.id)}" type="button" style="color: var(--c-danger, #ef4444)">Delete</button>
            </div>
          `).join('')}
        </div>
      ` : '<p style="font-size: var(--text-sm); color: var(--c-text-muted); margin-bottom: var(--sp-4)">No images found.</p>'}

      <h3 style="font-size: var(--text-base); font-weight: var(--fw-semibold); margin-bottom: var(--sp-2)">Oldest Snapshots</h3>
      ${suggestions.oldestSnapshots.length > 0 ? `
        <div style="display: flex; flex-direction: column; gap: var(--sp-2); margin-bottom: var(--sp-4)">
          ${suggestions.oldestSnapshots.map(snap => `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: var(--sp-2); background: var(--c-bg); border-radius: var(--radius-md); font-size: var(--text-sm)">
              <span>${escapeHTML(snap.label || 'Unnamed')} - ${formatBytes(snap.size)} - ${relativeTime(snap.createdAt)}</span>
              <button class="btn btn--ghost btn--sm js-delete-snapshot" data-id="${escapeHTML(snap.id)}" type="button" style="color: var(--c-danger, #ef4444)">Delete</button>
            </div>
          `).join('')}
        </div>
      ` : '<p style="font-size: var(--text-sm); color: var(--c-text-muted); margin-bottom: var(--sp-4)">No snapshots found.</p>'}

      <h3 style="font-size: var(--text-base); font-weight: var(--fw-semibold); margin-bottom: var(--sp-2)">Old Messages</h3>
      ${suggestions.oldMessages.length > 0 ? `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: var(--sp-2); background: var(--c-bg); border-radius: var(--radius-md); font-size: var(--text-sm); margin-bottom: var(--sp-4)">
          <span>${suggestions.oldMessages.length} oldest messages</span>
          <button class="btn btn--ghost btn--sm js-purge-messages" type="button" style="color: var(--c-danger, #ef4444)">Purge</button>
        </div>
      ` : '<p style="font-size: var(--text-sm); color: var(--c-text-muted); margin-bottom: var(--sp-4)">No old messages to purge.</p>'}
    `;
  }

  async _refreshCleanupModal(modal, roomId) {
    try {
      const suggestions = await roomService.getCleanupSuggestions(roomId);
      const quota = await roomService.checkStorageQuota(roomId);
      const pct = Math.min(100, Math.round((quota.used / quota.limit) * 100));
      modal.setContent(this._renderCleanupContent(suggestions, quota, pct));

      // Refresh storage state in page
      if (quota.exceeded) {
        this.setState({ storageExceeded: true });
      } else {
        this.setState({ storageExceeded: false });
        // Re-render announcement banner (ops announcement may now show)
        this._renderAnnouncementBanner();
      }
    } catch (err) {
      console.error('[RoomPage] Failed to refresh cleanup modal:', err);
    }
  }

  async _refreshPresence() {
    if (!this.state.room) return;
    try {
      const presence = await presenceService.getRoomPresence(this.state.room.id);
      this.setState({ presence });
    } catch {
      // Silently ignore
    }
  }

  async _loadActivities() {
    if (!this.state.room) return;
    try {
      const activities = await activityService.getActivityFeed(this.state.room.id, { limit: 30 });
      this.setState({ activities });
    } catch {
      // Silently ignore
    }
  }

  render() {
    const { room, loading, error, activeTab, presence, activities } = this.state;

    if (loading) {
      this.container.innerHTML = `
        <div class="app-shell">
          <div style="display: flex; align-items: center; justify-content: center; flex: 1">
            <div class="spinner" style="width: 32px; height: 32px; border-width: 3px"></div>
          </div>
        </div>
      `;
      return;
    }

    if (error || !room) {
      this.container.innerHTML = `
        <div class="app-shell">
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; gap: var(--sp-4)">
            <div class="empty-state__title">${escapeHTML(error || 'Room not found')}</div>
            <button class="btn btn--primary js-back-to-rooms" type="button">Back to Rooms</button>
          </div>
        </div>
      `;
      this._bindEvents();
      return;
    }

    this.container.innerHTML = `
      <div class="app-shell">
        <div class="announcement-banner" id="announcement-banner" style="display: none"></div>

        <div class="room-header">
          <div class="room-header__left">
            <button class="room-header__back js-back-to-rooms" type="button" title="Back to Rooms">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div class="room-header__info">
              <div class="room-header__name">${escapeHTML(room.name)}</div>
              <div class="room-header__status">${room.description ? escapeHTML(room.description.length > 60 ? room.description.slice(0, 60) + '...' : room.description) : 'No description'}</div>
            </div>
          </div>

          <div class="room-header__right">
            ${this._renderPresenceAvatars(presence)}

            <button class="btn btn--ghost btn--sm js-open-chat tooltip" data-tooltip="Open Chat" type="button">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              Chat
            </button>
            <button class="btn btn--ghost btn--sm js-snapshot tooltip" data-tooltip="Create Snapshot" type="button">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
              Snapshot
            </button>
            <button class="btn btn--ghost btn--sm js-import tooltip" data-tooltip="Import Room" type="button">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Import
            </button>
            <button class="btn btn--ghost btn--sm js-export tooltip" data-tooltip="Export Room" type="button">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Export
            </button>
            <button class="btn btn--ghost btn--sm js-room-settings tooltip" data-tooltip="Room Settings" type="button">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
          </div>
        </div>

        <div class="room-layout">
          <div class="room-canvas-area">
            <div class="room-canvas-toolbar" id="canvas-toolbar" style="
              position: absolute;
              top: var(--sp-3);
              left: 50%;
              transform: translateX(-50%);
              display: flex;
              gap: var(--sp-1);
              padding: var(--sp-2);
              background: var(--c-surface);
              border: 1px solid var(--c-border);
              border-radius: var(--radius-lg);
              box-shadow: var(--shadow-md);
              z-index: 5;
            ">
              <!-- Toolbar will be populated by whiteboard component -->
            </div>
            <div id="whiteboard-container" style="width: 100%; height: 100%;"></div>
          </div>

          <div class="room-sidebar">
            <div class="room-sidebar__tabs">
              ${TABS.map(tab => `
                <button
                  class="room-sidebar__tab ${activeTab === tab.id ? 'room-sidebar__tab--active' : ''} js-tab"
                  data-tab="${tab.id}"
                  type="button"
                >
                  ${tab.label}
                </button>
              `).join('')}
            </div>
            <div class="room-sidebar__content" id="sidebar-content">
              ${this._renderTabContent(activeTab, activities)}
            </div>
          </div>
        </div>
      </div>
    `;

    this._bindEvents();

    // If chat tab is active on render, load messages
    if (activeTab === 'chat') {
      this._loadChatMessages();
    }
    // If stickies tab is active on render, load notes
    if (activeTab === 'stickies') {
      this._refreshStickies();
    }
  }

  _renderPresenceAvatars(presence) {
    if (!presence || presence.length === 0) {
      return '<div class="room-header__presence"><span style="font-size: var(--text-xs); color: var(--c-text-muted)">Only you</span></div>';
    }

    const activeCount = presence.filter(p => p.status === 'active').length;
    const idleCount = presence.filter(p => p.status === 'idle').length;

    const maxVisible = 5;
    const visible = presence.slice(0, maxVisible);
    const overflow = presence.length - maxVisible;

    const avatars = visible.map(p => {
      const isActive = p.status === 'active';
      const statusClass = isActive ? 'avatar--active' : 'avatar--idle';
      const statusLabel = isActive
        ? '<span class="presence-label presence-label--active" style="font-size:9px;color:var(--c-success, #22c55e);font-weight:var(--fw-semibold);margin-left:2px">Active</span>'
        : '<span class="presence-label presence-label--idle" style="font-size:9px;color:var(--c-warning);font-weight:var(--fw-semibold);margin-left:2px">Idle</span>';
      return `<span style="display:inline-flex;align-items:center;gap:1px"><span class="avatar avatar--sm ${statusClass}">${escapeHTML(initial(p.profileId || '?'))}</span>${statusLabel}</span>`;
    }).join('');

    const summaryParts = [];
    if (activeCount > 0) summaryParts.push(`${activeCount} active`);
    if (idleCount > 0) summaryParts.push(`${idleCount} idle`);

    return `
      <div class="room-header__presence">
        <div class="room-header__presence-avatars">
          ${avatars}
        </div>
        ${overflow > 0 ? `<span class="room-header__presence-count">+${overflow}</span>` : ''}
        <span class="room-header__presence-count">${summaryParts.join(', ')}</span>
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Tab Content Rendering
  // ---------------------------------------------------------------------------

  _renderTabContent(tabId, activities) {
    switch (tabId) {
      case 'whiteboard':
        return this._renderWhiteboardTab();
      case 'stickies':
        return this._renderStickiesTab();
      case 'activity':
        return this._renderActivityTab(activities);
      default:
        return '';
    }
  }

  // ---------------------------------------------------------------------------
  // Whiteboard Sidebar Tab
  // ---------------------------------------------------------------------------

  _renderWhiteboardTab() {
    if (!this._selectedElementId) {
      return `
        <div id="whiteboard-sidebar-content" style="padding: var(--sp-2)">
          <div class="empty-state" style="padding: var(--sp-8)">
            <div class="empty-state__icon">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
            </div>
            <div class="empty-state__title">Select an element</div>
            <p style="font-size: var(--text-sm); color: var(--c-text-muted)">Select an element on the canvas to view its properties and comments.</p>
          </div>
        </div>
      `;
    }

    // Placeholder for element details -- will be populated async
    return `
      <div id="whiteboard-sidebar-content" style="padding: var(--sp-2)">
        <div style="display: flex; align-items: center; justify-content: center; padding: var(--sp-8)">
          <div class="spinner" style="width: 20px; height: 20px; border-width: 2px"></div>
        </div>
      </div>
    `;
  }

  async _refreshWhiteboardSidebar() {
    const contentEl = this.$('#whiteboard-sidebar-content');
    if (!contentEl) return;

    if (!this._selectedElementId) {
      contentEl.innerHTML = `
        <div class="empty-state" style="padding: var(--sp-8)">
          <div class="empty-state__icon">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
          </div>
          <div class="empty-state__title">Select an element</div>
          <p style="font-size: var(--text-sm); color: var(--c-text-muted)">Select an element on the canvas to view its properties and comments.</p>
        </div>
      `;
      return;
    }

    const elementId = this._selectedElementId;

    try {
      const comments = await whiteboardService.getComments(elementId);

      // Try to get element info from the whiteboard's internal map
      let elementInfo = null;
      if (this._whiteboard && this._whiteboard._elements) {
        elementInfo = this._whiteboard._elements.get(elementId);
      }

      contentEl.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: var(--sp-3)">
          <div style="padding: var(--sp-2); background: var(--c-bg); border-radius: var(--radius-md); font-size: var(--text-sm)">
            <div style="font-weight: var(--fw-semibold)">Element: ${escapeHTML(elementInfo?.type || 'unknown')}</div>
            <div style="color: var(--c-text-muted); font-size: var(--text-xs)">ID: ${escapeHTML(elementId)}</div>
          </div>

          <div>
            <label style="display: block; font-size: var(--text-sm); font-weight: var(--fw-medium); margin-bottom: var(--sp-1)">Notes</label>
            <textarea
              id="wb-element-notes"
              class="form-input"
              style="width: 100%; resize: vertical; min-height: 80px; font-size: var(--text-sm)"
              maxlength="20000"
              placeholder="Add notes about this element..."
              data-element-id="${escapeHTML(elementId)}"
            >${escapeHTML(elementInfo?.notes || '')}</textarea>
            <div style="text-align: right; font-size: var(--text-xs); color: var(--c-text-muted); margin-top: var(--sp-1)">
              <span id="wb-notes-count">${(elementInfo?.notes || '').length}</span> / 20,000
            </div>
          </div>

          <div>
            <div style="font-size: var(--text-sm); font-weight: var(--fw-semibold); margin-bottom: var(--sp-2)">Comments</div>
            <div id="wb-comments-list">
              ${this._renderCommentThread(comments)}
            </div>
            <div style="margin-top: var(--sp-2)">
              <textarea
                id="wb-new-comment"
                class="form-input"
                style="width: 100%; resize: vertical; min-height: 60px; font-size: var(--text-sm)"
                placeholder="Add a comment..."
              ></textarea>
              <button class="btn btn--primary btn--sm js-add-comment" data-element-id="${escapeHTML(elementId)}" type="button" style="margin-top: var(--sp-1)">
                Add Comment
              </button>
            </div>
          </div>
        </div>
      `;
    } catch (err) {
      console.error('[RoomPage] Failed to load whiteboard sidebar:', err);
      contentEl.innerHTML = `<div style="padding: var(--sp-4); color: var(--c-text-muted); font-size: var(--text-sm)">Failed to load element details.</div>`;
    }
  }

  _renderCommentThread(comments, depth = 0) {
    if (!comments || comments.length === 0) {
      if (depth === 0) {
        return '<div style="font-size: var(--text-sm); color: var(--c-text-muted); padding: var(--sp-2)">No comments yet.</div>';
      }
      return '';
    }

    return comments.map(c => `
      <div style="margin-left: ${depth * 16}px; padding: var(--sp-2); border-left: ${depth > 0 ? '2px solid var(--c-border)' : 'none'}; margin-bottom: var(--sp-2)">
        <div style="display: flex; align-items: center; gap: var(--sp-2); margin-bottom: var(--sp-1)">
          <span class="avatar avatar--sm" style="width: 24px; height: 24px; font-size: 11px">${escapeHTML(initial(c.authorId || '?'))}</span>
          <span style="font-size: var(--text-xs); color: var(--c-text-muted)">${relativeTime(c.createdAt)}</span>
        </div>
        <div style="font-size: var(--text-sm); color: var(--c-text)">${escapeHTML(c.body)}</div>
        <button class="btn btn--ghost btn--sm js-reply-comment" data-comment-id="${escapeHTML(c.id)}" data-element-id="${escapeHTML(c.elementId)}" type="button" style="font-size: var(--text-xs); padding: 2px 6px; margin-top: var(--sp-1)">Reply</button>
        <div class="js-reply-form-container" data-comment-id="${escapeHTML(c.id)}" style="display: none; margin-top: var(--sp-1)">
          <textarea class="form-input js-reply-textarea" style="width: 100%; resize: vertical; min-height: 50px; font-size: var(--text-sm)" placeholder="Write a reply..."></textarea>
          <div style="display: flex; gap: var(--sp-1); margin-top: var(--sp-1)">
            <button class="btn btn--primary btn--sm js-submit-reply" data-parent-id="${escapeHTML(c.id)}" data-element-id="${escapeHTML(c.elementId)}" type="button">Reply</button>
            <button class="btn btn--ghost btn--sm js-cancel-reply" data-comment-id="${escapeHTML(c.id)}" type="button">Cancel</button>
          </div>
        </div>
        ${c.replies && c.replies.length > 0 ? this._renderCommentThread(c.replies, depth + 1) : ''}
      </div>
    `).join('');
  }

  async _saveElementNotes(elementId, notes) {
    try {
      await whiteboardService.updateNotes(elementId, notes);
    } catch (err) {
      showToast('Failed to save notes: ' + (err.message || 'Unknown error'), { type: 'error' });
    }
  }

  // ---------------------------------------------------------------------------
  // Stickies Tab
  // ---------------------------------------------------------------------------

  _renderStickiesTab() {
    return `
      <div id="stickies-sidebar-content" style="padding: var(--sp-2); display: flex; flex-direction: column; height: 100%">
        <div style="display: flex; gap: var(--sp-2); margin-bottom: var(--sp-3); flex-wrap: wrap">
          <button class="btn btn--primary btn--sm js-create-sticky" type="button">Create Note</button>
          <button class="btn btn--secondary btn--sm js-import-csv" type="button">Import CSV</button>
          <button class="btn btn--ghost btn--sm js-create-group" type="button">+ Group</button>
          <input type="file" accept=".csv" class="js-csv-file-input" style="display: none" />
        </div>
        <div id="sticky-create-form" style="display: none; margin-bottom: var(--sp-3)">
          ${this._renderStickyForm()}
        </div>
        <div id="stickies-list" style="flex: 1; overflow-y: auto">
          <div style="display: flex; align-items: center; justify-content: center; padding: var(--sp-4)">
            <div class="spinner" style="width: 20px; height: 20px; border-width: 2px"></div>
          </div>
        </div>
      </div>
    `;
  }

  _renderStickyForm(note = null) {
    const isEdit = !!note;
    const title = note ? escapeHTML(note.title) : '';
    const body = note ? escapeHTML(note.body) : '';
    const selectedColor = note ? note.color : STICKY_COLORS[0].value;

    return `
      <div style="
        padding: var(--sp-3);
        background: var(--c-bg);
        border-radius: var(--radius-md);
        border: 1px solid var(--c-border);
      ">
        <div class="form-group" style="margin-bottom: var(--sp-2)">
          <input
            class="form-input js-sticky-title"
            type="text"
            placeholder="Title"
            value="${title}"
            maxlength="200"
            style="width: 100%; font-size: var(--text-sm)"
          />
        </div>
        <div class="form-group" style="margin-bottom: var(--sp-2)">
          <textarea
            class="form-input js-sticky-body"
            placeholder="Body"
            rows="3"
            maxlength="5000"
            style="width: 100%; resize: vertical; font-size: var(--text-sm)"
          >${isEdit ? body : ''}</textarea>
        </div>
        <div style="display: flex; gap: var(--sp-2); align-items: center; margin-bottom: var(--sp-2)">
          <span style="font-size: var(--text-xs); color: var(--c-text-muted)">Color:</span>
          ${STICKY_COLORS.map(c => `
            <button
              class="js-sticky-color-pick"
              data-color="${c.value}"
              type="button"
              title="${c.label}"
              style="
                width: 22px; height: 22px; border-radius: 50%;
                background: ${c.value};
                border: 2px solid ${c.value === selectedColor ? 'var(--c-text)' : 'transparent'};
                cursor: pointer;
              "
            ></button>
          `).join('')}
          <input type="hidden" class="js-sticky-color-value" value="${selectedColor}" />
        </div>
        <div style="display: flex; gap: var(--sp-2)">
          ${isEdit ? `
            <button class="btn btn--primary btn--sm js-sticky-save-edit" data-id="${escapeHTML(note.id)}" type="button">Save</button>
            <button class="btn btn--ghost btn--sm js-sticky-cancel-edit" type="button">Cancel</button>
          ` : `
            <button class="btn btn--primary btn--sm js-sticky-save-new" type="button">Create</button>
            <button class="btn btn--ghost btn--sm js-sticky-cancel-new" type="button">Cancel</button>
          `}
        </div>
      </div>
    `;
  }

  async _refreshStickies() {
    const listEl = this.$('#stickies-list');
    if (!listEl || !this.state.room) return;

    try {
      const notes = await stickyService.getNotesByRoom(this.state.room.id);
      const groups = await stickyService.getGroups(this.state.room.id);
      const groupMap = {};
      for (const g of groups) groupMap[g.id] = g;

      if (notes.length === 0 && groups.length === 0) {
        listEl.innerHTML = `
          <div class="empty-state" style="padding: var(--sp-6)">
            <div class="empty-state__icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3z"/><polyline points="14 3 14 8 19 8"/></svg>
            </div>
            <div class="empty-state__title">No Sticky Notes</div>
            <p style="font-size: var(--text-sm); color: var(--c-text-muted)">Create a note or import from CSV to get started.</p>
          </div>
        `;
        return;
      }

      // Partition notes by group
      const ungrouped = notes.filter(n => !n.groupId);
      const byGroup = {};
      for (const g of groups) byGroup[g.id] = [];
      for (const n of notes) {
        if (n.groupId && byGroup[n.groupId]) byGroup[n.groupId].push(n);
      }

      let html = '<div style="display: flex; flex-direction: column; gap: var(--sp-3)">';

      // Render each group as a drop zone
      for (const g of groups) {
        const groupNotes = byGroup[g.id] || [];
        html += `
          <div class="js-group-zone" data-group-id="${escapeHTML(g.id)}"
               style="padding: var(--sp-2); border: 2px dashed var(--c-border); border-radius: var(--radius-md); min-height: 40px; transition: border-color 0.15s, background 0.15s">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--sp-2)">
              <span style="font-size: var(--text-xs); font-weight: var(--fw-semibold); text-transform: uppercase; letter-spacing: 0.05em; color: var(--c-text-muted)">
                <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${g.color};margin-right:4px"></span>
                ${escapeHTML(g.name)} (${groupNotes.length})
              </span>
              <button class="btn btn--ghost btn--sm js-delete-group" data-id="${escapeHTML(g.id)}" type="button" style="padding:1px 4px;font-size:10px;color:var(--c-danger)">x</button>
            </div>
            <div style="display: flex; flex-direction: column; gap: var(--sp-1)">
              ${groupNotes.map(n => this._renderStickyItem(n, groupMap)).join('')}
              ${groupNotes.length === 0 ? '<div style="font-size:var(--text-xs);color:var(--c-text-muted);padding:var(--sp-2);text-align:center">Drop notes here</div>' : ''}
            </div>
          </div>`;
      }

      // Ungrouped drop zone
      html += `
        <div class="js-group-zone" data-group-id=""
             style="padding: var(--sp-2); border: 2px dashed transparent; border-radius: var(--radius-md); min-height: 20px">
          <div style="font-size: var(--text-xs); font-weight: var(--fw-semibold); text-transform: uppercase; letter-spacing: 0.05em; color: var(--c-text-muted); margin-bottom: var(--sp-2)">
            Ungrouped (${ungrouped.length})
          </div>
          <div style="display: flex; flex-direction: column; gap: var(--sp-1)">
            ${ungrouped.map(n => this._renderStickyItem(n, groupMap)).join('')}
          </div>
        </div>`;

      html += '</div>';
      listEl.innerHTML = html;
      this._initStickyDragDrop(listEl);
    } catch (err) {
      console.error('[RoomPage] Failed to load stickies:', err);
      listEl.innerHTML = `<div style="padding: var(--sp-4); color: var(--c-text-muted); font-size: var(--text-sm)">Failed to load sticky notes.</div>`;
    }
  }

  _renderStickyItem(note, groupMap) {
    const bodyPreview = note.body ? (note.body.length > 80 ? note.body.slice(0, 80) + '...' : note.body) : '';
    return `
      <div class="js-sticky-item" draggable="true" data-id="${escapeHTML(note.id)}" style="
        padding: var(--sp-2) var(--sp-3);
        background: var(--c-surface);
        border-radius: var(--radius-md);
        border: 1px solid var(--c-border);
        border-left: 4px solid ${note.color || '#FFEB3B'};
        cursor: grab;
      ">
        <div id="sticky-item-content-${escapeHTML(note.id)}">
          <div style="display: flex; align-items: center; gap: var(--sp-2); margin-bottom: var(--sp-1)">
            <span style="color: var(--c-text-muted); cursor: grab; font-size: 12px" title="Drag to group">&#x2630;</span>
            <span style="font-weight: var(--fw-medium); font-size: var(--text-sm); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${escapeHTML(note.title || 'Untitled')}
            </span>
            <div style="display: flex; gap: var(--sp-1); flex-shrink: 0">
              <button class="btn btn--ghost btn--sm js-edit-sticky" data-id="${escapeHTML(note.id)}" type="button" style="padding:2px 6px;font-size:var(--text-xs)">Edit</button>
              <button class="btn btn--ghost btn--sm js-delete-sticky" data-id="${escapeHTML(note.id)}" type="button" style="padding:2px 6px;font-size:var(--text-xs);color:var(--c-danger)">Del</button>
            </div>
          </div>
          ${bodyPreview ? `<div style="font-size: var(--text-xs); color: var(--c-text-secondary)">${escapeHTML(bodyPreview)}</div>` : ''}
        </div>
      </div>
    `;
  }

  _initStickyDragDrop(container) {
    container.addEventListener('dragstart', (e) => {
      const item = e.target.closest('.js-sticky-item');
      if (!item) return;
      e.dataTransfer.setData('text/plain', item.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
      item.style.opacity = '0.4';
    });

    container.addEventListener('dragend', (e) => {
      const item = e.target.closest('.js-sticky-item');
      if (item) item.style.opacity = '1';
    });

    const zones = container.querySelectorAll('.js-group-zone');
    for (const zone of zones) {
      zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        zone.style.borderColor = 'var(--c-primary)';
        zone.style.background = 'var(--c-primary-light)';
      });
      zone.addEventListener('dragleave', () => {
        zone.style.borderColor = zone.dataset.groupId ? 'var(--c-border)' : 'transparent';
        zone.style.background = '';
      });
      zone.addEventListener('drop', async (e) => {
        e.preventDefault();
        zone.style.borderColor = zone.dataset.groupId ? 'var(--c-border)' : 'transparent';
        zone.style.background = '';
        const noteId = e.dataTransfer.getData('text/plain');
        if (!noteId) return;
        const targetGroupId = zone.dataset.groupId || null;
        try {
          await stickyService.assignToGroup(noteId, targetGroupId);
          showToast(targetGroupId ? 'Note grouped' : 'Note ungrouped', { type: 'success', duration: 2000 });
        } catch (err) {
          showToast(err.message, { type: 'error' });
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Chat Tab
  // ---------------------------------------------------------------------------

  _renderChatContent() {
    return `
      <div id="chat-sidebar-content" style="padding: 0; display: flex; flex-direction: column; height: 100%">
        <div id="chat-messages" style="flex: 1; overflow-y: auto; padding: var(--sp-2); display: flex; flex-direction: column; gap: var(--sp-2)">
          <div style="display: flex; align-items: center; justify-content: center; padding: var(--sp-4)">
            <div class="spinner" style="width: 20px; height: 20px; border-width: 2px"></div>
          </div>
        </div>
        <div style="padding: var(--sp-2); border-top: 1px solid var(--c-border); flex-shrink: 0">
          <div style="position: relative">
            <textarea
              id="chat-input"
              class="form-input"
              style="width: 100%; resize: none; min-height: 60px; font-size: var(--text-sm); padding-bottom: 24px"
              placeholder="Type a message..."
              maxlength="500"
            ></textarea>
            <div style="display: flex; align-items: center; justify-content: space-between; margin-top: var(--sp-1)">
              <span id="chat-char-count" style="font-size: var(--text-xs); color: var(--c-text-muted)">0 / 500</span>
              <button class="btn btn--primary btn--sm js-send-chat" type="button">Send</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _openChatDrawer() {
    // If drawer already open, do nothing
    if (this._chatDrawer) return;

    this._chatDrawer = new Drawer({
      title: 'Chat',
      side: 'right',
      width: '380px',
      content: this._renderChatContent(),
      onClose: () => {
        this._chatDrawer = null;
      }
    });

    this._chatDrawer.render();

    const drawerBody = this._chatDrawer.getBody();
    if (!drawerBody) return;

    // Bind chat events within drawer
    const sendBtn = drawerBody.querySelector('.js-send-chat');
    if (sendBtn) {
      sendBtn.addEventListener('click', () => this._sendChatMessage());
    }

    const chatInput = drawerBody.querySelector('#chat-input');
    if (chatInput) {
      chatInput.addEventListener('input', () => {
        const count = chatInput.value.length;
        const counter = drawerBody.querySelector('#chat-char-count');
        if (counter) {
          counter.textContent = `${count} / 500`;
          counter.style.color = count >= 450 ? 'var(--c-danger, #ef4444)' : 'var(--c-text-muted)';
        }
      });
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this._sendChatMessage();
        }
      });
    }

    // Load messages into drawer
    this._loadChatMessages();
  }

  _getChatEl(selector) {
    // Chat lives in the drawer, so look there first, then fallback to container
    if (this._chatDrawer) {
      const drawerBody = this._chatDrawer.getBody();
      if (drawerBody) {
        const el = drawerBody.querySelector(selector);
        if (el) return el;
      }
    }
    return this.$(selector);
  }

  async _loadChatMessages() {
    const messagesEl = this._getChatEl('#chat-messages');
    if (!messagesEl || !this.state.room) return;

    try {
      const messages = await chatService.getMessages(this.state.room.id);
      // Comes in desc order, reverse for chronological display
      this._chatMessages = messages.reverse();

      if (this._chatMessages.length === 0) {
        messagesEl.innerHTML = `
          <div class="empty-state" style="padding: var(--sp-6); margin: auto">
            <div class="empty-state__icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </div>
            <div class="empty-state__title">No Messages</div>
            <p style="font-size: var(--text-sm); color: var(--c-text-muted)">Start the conversation.</p>
          </div>
        `;
        return;
      }

      messagesEl.innerHTML = this._chatMessages.map(m => this._renderChatMessage(m)).join('');
      messagesEl.scrollTop = messagesEl.scrollHeight;
    } catch (err) {
      console.error('[RoomPage] Failed to load chat messages:', err);
      messagesEl.innerHTML = `<div style="padding: var(--sp-4); color: var(--c-text-muted); font-size: var(--text-sm)">Failed to load messages.</div>`;
    }
  }

  _renderChatMessage(msg) {
    if (msg.deleted) {
      return `
        <div style="display: flex; gap: var(--sp-2); padding: var(--sp-2); align-items: flex-start" data-msg-id="${escapeHTML(msg.id)}">
          <span class="avatar avatar--sm" style="width: 28px; height: 28px; font-size: 12px; flex-shrink: 0; opacity: 0.5">${escapeHTML(initial(msg.authorId || '?'))}</span>
          <div style="min-width: 0; flex: 1">
            <div style="font-size: var(--text-sm); color: var(--c-text-muted); font-style: italic">[deleted]</div>
            <div style="font-size: var(--text-xs); color: var(--c-text-muted)">${relativeTime(msg.createdAt)}</div>
          </div>
        </div>
      `;
    }

    return `
      <div style="display: flex; gap: var(--sp-2); padding: var(--sp-2); align-items: flex-start" data-msg-id="${escapeHTML(msg.id)}">
        <span class="avatar avatar--sm" style="width: 28px; height: 28px; font-size: 12px; flex-shrink: 0">${escapeHTML(initial(msg.authorId || '?'))}</span>
        <div style="min-width: 0; flex: 1">
          <div style="font-size: var(--text-sm); color: var(--c-text); word-break: break-word">${escapeHTML(msg.body)}</div>
          <div style="font-size: var(--text-xs); color: var(--c-text-muted)">${relativeTime(msg.createdAt)}</div>
        </div>
      </div>
    `;
  }

  _appendChatMessage(message) {
    const messagesEl = this._getChatEl('#chat-messages');
    if (!messagesEl) return;

    // If the empty state is showing, clear it
    const emptyState = messagesEl.querySelector('.empty-state');
    if (emptyState) {
      messagesEl.innerHTML = '';
    }

    // Don't duplicate if already displayed
    if (messagesEl.querySelector(`[data-msg-id="${message.id}"]`)) return;

    const html = this._renderChatMessage(message);
    messagesEl.insertAdjacentHTML('beforeend', html);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ---------------------------------------------------------------------------
  // Activity Tab
  // ---------------------------------------------------------------------------

  _renderActivityTab(activities) {
    return `
      <div id="activity-sidebar-content" style="padding: var(--sp-2)">
        ${activities && activities.length > 0 ? `
          <div style="display: flex; flex-direction: column; gap: var(--sp-3)">
            ${activities.map(a => `
              <div style="
                display: flex;
                gap: var(--sp-3);
                padding: var(--sp-2);
                border-radius: var(--radius-md);
                font-size: var(--text-sm);
              ">
                <div style="flex-shrink: 0; margin-top: 2px">
                  <span class="avatar avatar--sm">${escapeHTML(initial(a.actorId || '?'))}</span>
                </div>
                <div style="min-width: 0; flex: 1">
                  <div style="color: var(--c-text)">${escapeHTML(a.summary || a.action)}</div>
                  <div style="color: var(--c-text-muted); font-size: var(--text-xs); margin-top: var(--sp-1)">${relativeTime(a.createdAt)}</div>
                </div>
              </div>
            `).join('')}
          </div>
        ` : `
          <div class="empty-state" style="padding: var(--sp-8)">
            <div class="empty-state__icon">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            </div>
            <div class="empty-state__title">Activity Feed</div>
            <p style="font-size: var(--text-sm); color: var(--c-text-muted)">Actions in this room will be logged here.</p>
          </div>
        `}
      </div>
    `;
  }

  // ---------------------------------------------------------------------------
  // Event Binding
  // ---------------------------------------------------------------------------

  _bindEvents() {
    // Back to rooms
    this.delegate('click', '.js-back-to-rooms', () => {
      router.navigate('/rooms');
    });

    // Tab switching
    this.delegate('click', '.js-tab', (e, target) => {
      const tab = target.dataset.tab;
      if (tab && tab !== this.state.activeTab) {
        this.state.activeTab = tab;

        // Update tab active states without full re-render
        this.$$('.room-sidebar__tab').forEach(el => {
          el.classList.toggle('room-sidebar__tab--active', el.dataset.tab === tab);
        });

        // Update content
        const contentEl = this.$('#sidebar-content');
        if (contentEl) {
          contentEl.innerHTML = this._renderTabContent(tab, this.state.activities);
        }

        // Load data for new tab
        if (tab === 'chat') {
          this._loadChatMessages();
        } else if (tab === 'stickies') {
          this._refreshStickies();
        } else if (tab === 'whiteboard') {
          this._refreshWhiteboardSidebar();
        }
      }
    });

    // Snapshot
    this.delegate('click', '.js-snapshot', async () => {
      if (!this.state.room) return;
      try {
        const label = prompt('Snapshot label (optional):');
        if (label === null) return; // User cancelled
        await roomService.createSnapshot(this.state.room.id, label || '');
      } catch (err) {
        showToast(err.message || 'Failed to create snapshot', { type: 'error' });
      }
    });

    // Export
    this.delegate('click', '.js-export', async () => {
      if (!this.state.room) return;
      try {
        const result = await importExportService.exportRoom(this.state.room.id);
        if (result.success) {
          showToast(`Exported "${result.filename}" (${formatBytes(result.sizeBytes)})`, { type: 'success' });
        } else {
          showToast(result.error || 'Export failed', { type: 'error' });
        }
      } catch (err) {
        showToast(err.message || 'Export failed', { type: 'error' });
      }
    });

    // Import room JSON
    this.delegate('click', '.js-import', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.style.display = 'none';
      document.body.appendChild(input);

      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        document.body.removeChild(input);
        if (!file) return;

        try {
          const result = await importExportService.importRoom(file);
          this._showImportResultsModal(result);
        } catch (err) {
          showToast(err.message || 'Import failed', { type: 'error' });
        }
      });

      input.click();
    });

    // Dismiss ops announcement banner
    this.delegate('click', '.js-dismiss-announcement', () => {
      const banner = this.$('#announcement-banner');
      if (banner) {
        banner.style.display = 'none';
        banner.innerHTML = '';
      }
    });

    // Manage storage from banner
    this.delegate('click', '.js-manage-storage', () => {
      this._openCleanupModal();
    });

    // Open chat drawer
    this.delegate('click', '.js-open-chat', () => {
      this._openChatDrawer();
    });

    // Room settings
    this.delegate('click', '.js-room-settings', () => {
      this._openSettingsModal();
    });

    // --- Stickies events ---

    // Create sticky - toggle form
    this.delegate('click', '.js-create-sticky', () => {
      if (this.state.storageExceeded) {
        showToast('Storage limit exceeded. Delete some data first.', { type: 'warning' });
        return;
      }
      const form = this.$('#sticky-create-form');
      if (form) {
        form.style.display = form.style.display === 'none' ? 'block' : 'none';
      }
    });

    // Cancel new sticky
    this.delegate('click', '.js-sticky-cancel-new', () => {
      const form = this.$('#sticky-create-form');
      if (form) form.style.display = 'none';
    });

    // Save new sticky
    this.delegate('click', '.js-sticky-save-new', async () => {
      if (this.state.storageExceeded) {
        showToast('Storage limit exceeded.', { type: 'warning' });
        return;
      }
      const form = this.$('#sticky-create-form');
      if (!form) return;

      const title = form.querySelector('.js-sticky-title')?.value.trim();
      const body = form.querySelector('.js-sticky-body')?.value.trim();
      const color = form.querySelector('.js-sticky-color-value')?.value || STICKY_COLORS[0].value;

      if (!title) {
        showToast('Title is required', { type: 'warning' });
        return;
      }

      try {
        await stickyService.createNote(this.state.room.id, { title, body, color });
        form.style.display = 'none';
        showToast('Note created', { type: 'success' });
      } catch (err) {
        showToast(err.message || 'Failed to create note', { type: 'error' });
      }
    });

    // Color picker for stickies
    this.delegate('click', '.js-sticky-color-pick', (e, target) => {
      const color = target.dataset.color;
      const container = target.closest('#sticky-create-form') || target.closest('.js-sticky-item');
      if (!container) return;

      const hidden = container.querySelector('.js-sticky-color-value');
      if (hidden) hidden.value = color;

      // Update visual selection
      const allPicks = container.querySelectorAll('.js-sticky-color-pick');
      allPicks.forEach(btn => {
        btn.style.border = btn.dataset.color === color ? '2px solid var(--c-text)' : '2px solid transparent';
      });
    });

    // Import CSV
    this.delegate('click', '.js-import-csv', () => {
      if (this.state.storageExceeded) {
        showToast('Storage limit exceeded.', { type: 'warning' });
        return;
      }
      const fileInput = this.$('.js-csv-file-input');
      if (fileInput) {
        fileInput.value = '';
        fileInput.click();
      }
    });

    // CSV file selected
    this.delegate('change', '.js-csv-file-input', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const csvText = await readFileAsText(file);
        const result = await stickyService.importCSV(this.state.room.id, csvText);
        this._showCSVImportResultsModal(result);
      } catch (err) {
        showToast(err.message || 'Failed to import CSV', { type: 'error' });
      }
    });

    // Edit sticky - inline
    this.delegate('click', '.js-edit-sticky', async (e, target) => {
      const noteId = target.dataset.id;
      if (!noteId) return;

      try {
        const notes = await stickyService.getNotesByRoom(this.state.room.id);
        const note = notes.find(n => n.id === noteId);
        if (!note) {
          showToast('Note not found', { type: 'error' });
          return;
        }

        const itemContentEl = this.$(`#sticky-item-content-${noteId}`);
        if (itemContentEl) {
          itemContentEl.innerHTML = this._renderStickyForm(note);
        }
      } catch (err) {
        showToast(err.message || 'Failed to load note', { type: 'error' });
      }
    });

    // Save edit sticky
    this.delegate('click', '.js-sticky-save-edit', async (e, target) => {
      if (this.state.storageExceeded) {
        showToast('Storage limit exceeded.', { type: 'warning' });
        return;
      }
      const noteId = target.dataset.id;
      const container = target.closest('.js-sticky-item') || target.closest('#sticky-item-content-' + noteId)?.parentElement;
      if (!container) return;

      const title = container.querySelector('.js-sticky-title')?.value.trim();
      const body = container.querySelector('.js-sticky-body')?.value.trim();
      const color = container.querySelector('.js-sticky-color-value')?.value;

      if (!title) {
        showToast('Title is required', { type: 'warning' });
        return;
      }

      try {
        await stickyService.updateNote(noteId, { title, body, color });
        showToast('Note updated', { type: 'success' });
      } catch (err) {
        showToast(err.message || 'Failed to update note', { type: 'error' });
      }
    });

    // Cancel edit sticky
    this.delegate('click', '.js-sticky-cancel-edit', () => {
      this._refreshStickies();
    });

    // Delete sticky
    this.delegate('click', '.js-delete-sticky', async (e, target) => {
      const noteId = target.dataset.id;
      if (!noteId) return;

      const confirmed = await confirmDialog({
        title: 'Delete Note',
        message: 'Are you sure you want to delete this sticky note?',
        confirmText: 'Delete',
        danger: true
      });

      if (confirmed) {
        try {
          await stickyService.deleteNote(noteId);
          showToast('Note deleted', { type: 'success' });
        } catch (err) {
          showToast(err.message || 'Failed to delete note', { type: 'error' });
        }
      }
    });

    // Create group
    this.delegate('click', '.js-create-group', async () => {
      const name = prompt('Group name:');
      if (!name || !name.trim()) return;
      const colors = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#F44336', '#00BCD4'];
      const color = colors[Math.floor(Math.random() * colors.length)];
      try {
        await stickyService.createGroup(this.state.room.id, name.trim(), color);
        showToast('Group created', { type: 'success', duration: 2000 });
        this._refreshStickies();
      } catch (err) {
        showToast(err.message, { type: 'error' });
      }
    });

    // Delete group
    this.delegate('click', '.js-delete-group', async (e, target) => {
      const groupId = target.dataset.id;
      if (!groupId) return;
      const confirmed = await confirmDialog({
        title: 'Delete Group',
        message: 'Delete this group? Notes will be ungrouped but not deleted.',
        confirmText: 'Delete',
        danger: true
      });
      if (confirmed) {
        try {
          await stickyService.deleteGroup(groupId);
          showToast('Group deleted', { type: 'success', duration: 2000 });
          this._refreshStickies();
        } catch (err) {
          showToast(err.message, { type: 'error' });
        }
      }
    });

    // --- Whiteboard sidebar events ---

    // Notes textarea change (debounced save)
    this.delegate('input', '#wb-element-notes', (e) => {
      const textarea = e.target;
      const elementId = textarea.dataset.elementId;
      const notes = textarea.value;
      const countEl = this.$('#wb-notes-count');
      if (countEl) countEl.textContent = notes.length;
      if (elementId) {
        this._notesSaveDebounced(elementId, notes);
      }
    });

    // Add comment
    this.delegate('click', '.js-add-comment', async (e, target) => {
      if (this.state.storageExceeded) {
        showToast('Storage limit exceeded.', { type: 'warning' });
        return;
      }
      const elementId = target.dataset.elementId;
      const textarea = this.$('#wb-new-comment');
      if (!textarea || !elementId) return;

      const body = textarea.value.trim();
      if (!body) {
        showToast('Comment cannot be empty', { type: 'warning' });
        return;
      }

      try {
        const result = await whiteboardService.addComment(elementId, body);
        textarea.value = '';
        if (result.warnings && result.warnings.length > 0) {
          showToast('Comment posted with content warnings', { type: 'warning' });
        }
      } catch (err) {
        showToast(err.message || 'Failed to add comment', { type: 'error' });
      }
    });

    // Reply button - show reply form
    this.delegate('click', '.js-reply-comment', (e, target) => {
      const commentId = target.dataset.commentId;
      const formContainer = this.container.querySelector(`.js-reply-form-container[data-comment-id="${commentId}"]`);
      if (formContainer) {
        formContainer.style.display = formContainer.style.display === 'none' ? 'block' : 'none';
        const textarea = formContainer.querySelector('.js-reply-textarea');
        if (textarea) textarea.focus();
      }
    });

    // Cancel reply
    this.delegate('click', '.js-cancel-reply', (e, target) => {
      const commentId = target.dataset.commentId;
      const formContainer = this.container.querySelector(`.js-reply-form-container[data-comment-id="${commentId}"]`);
      if (formContainer) {
        formContainer.style.display = 'none';
        const textarea = formContainer.querySelector('.js-reply-textarea');
        if (textarea) textarea.value = '';
      }
    });

    // Submit reply
    this.delegate('click', '.js-submit-reply', async (e, target) => {
      if (this.state.storageExceeded) {
        showToast('Storage limit exceeded.', { type: 'warning' });
        return;
      }
      const parentId = target.dataset.parentId;
      const elementId = target.dataset.elementId;
      const formContainer = this.container.querySelector(`.js-reply-form-container[data-comment-id="${parentId}"]`);
      if (!formContainer || !elementId) return;

      const textarea = formContainer.querySelector('.js-reply-textarea');
      const body = textarea?.value.trim();
      if (!body) {
        showToast('Reply cannot be empty', { type: 'warning' });
        return;
      }

      try {
        const result = await whiteboardService.addComment(elementId, body, parentId);
        textarea.value = '';
        formContainer.style.display = 'none';
        if (result.warnings && result.warnings.length > 0) {
          showToast('Reply posted with content warnings', { type: 'warning' });
        }
      } catch (err) {
        showToast(err.message || 'Failed to post reply', { type: 'error' });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Chat Send
  // ---------------------------------------------------------------------------

  async _sendChatMessage() {
    if (this._chatSending) return;
    if (this.state.storageExceeded) {
      showToast('Storage limit exceeded. Delete some data first.', { type: 'warning' });
      return;
    }

    const textarea = this._getChatEl('#chat-input');
    if (!textarea || !this.state.room) return;

    const body = textarea.value.trim();
    if (!body) return;

    this._chatSending = true;
    try {
      const result = await chatService.sendMessage(this.state.room.id, body);
      textarea.value = '';
      const counter = this._getChatEl('#chat-char-count');
      if (counter) counter.textContent = '0 / 500';

      if (result.warnings && result.warnings.length > 0) {
        showToast('Message sent with content warnings', { type: 'warning' });
      }
    } catch (err) {
      if (err.message && err.message.includes('Rate limit')) {
        showToast('Slow down! You are sending messages too quickly.', { type: 'warning' });
      } else {
        showToast(err.message || 'Failed to send message', { type: 'error' });
      }
    } finally {
      this._chatSending = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Import Results Modals
  // ---------------------------------------------------------------------------

  _showImportResultsModal(result) {
    const hasErrors = result.errors && result.errors.length > 0;
    const hasConflicts = result.conflicts > 0;

    const modal = new Modal({
      title: 'Import Results',
      size: 'md',
      content: `
        <div style="display: flex; flex-direction: column; gap: var(--sp-3)">
          <div style="display: flex; gap: var(--sp-4); padding: var(--sp-3); background: var(--c-bg); border-radius: var(--radius-md)">
            <div style="text-align: center">
              <div style="font-size: var(--text-xl); font-weight: var(--fw-bold); color: var(--c-success, #22c55e)">${result.imported}</div>
              <div style="font-size: var(--text-xs); color: var(--c-text-muted)">Imported</div>
            </div>
            <div style="text-align: center">
              <div style="font-size: var(--text-xl); font-weight: var(--fw-bold); color: var(--c-primary)">${result.updated}</div>
              <div style="font-size: var(--text-xs); color: var(--c-text-muted)">Updated</div>
            </div>
            <div style="text-align: center">
              <div style="font-size: var(--text-xl); font-weight: var(--fw-bold); color: ${hasConflicts ? 'var(--c-warning, #f59e0b)' : 'var(--c-text-muted)'}">${result.conflicts}</div>
              <div style="font-size: var(--text-xs); color: var(--c-text-muted)">Conflicts</div>
            </div>
          </div>

          ${hasConflicts ? `
            <div style="padding: var(--sp-3); background: var(--c-warning-bg, #fef3cd); color: var(--c-warning-text, #856404); border-radius: var(--radius-md); font-size: var(--text-sm)">
              <strong>Warning:</strong> ${result.conflicts} conflict(s) were detected. Duplicate records were created to preserve both versions. Review your data to resolve these conflicts.
            </div>
          ` : ''}

          ${hasErrors ? `
            <div>
              <div style="font-size: var(--text-sm); font-weight: var(--fw-semibold); margin-bottom: var(--sp-2); color: var(--c-danger, #ef4444)">Errors:</div>
              <ul style="font-size: var(--text-sm); color: var(--c-text-secondary); padding-left: var(--sp-4); margin: 0">
                ${result.errors.map(err => `<li style="margin-bottom: var(--sp-1)">${escapeHTML(err)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
        </div>
      `,
      footer: '<button class="btn btn--primary js-close-import-modal" type="button">Close</button>',
      closable: true
    });

    modal.render();
    modal.el.querySelector('.js-close-import-modal').addEventListener('click', () => modal.close());
  }

  _showCSVImportResultsModal(result) {
    const hasErrors = result.errors && result.errors.length > 0;

    const modal = new Modal({
      title: 'CSV Import Results',
      size: 'md',
      content: `
        <div style="display: flex; flex-direction: column; gap: var(--sp-3)">
          <div style="padding: var(--sp-3); background: var(--c-bg); border-radius: var(--radius-md); text-align: center">
            <div style="font-size: var(--text-xl); font-weight: var(--fw-bold); color: var(--c-success, #22c55e)">${result.imported}</div>
            <div style="font-size: var(--text-sm); color: var(--c-text-muted)">notes imported</div>
          </div>

          ${hasErrors ? `
            <div>
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--sp-2)">
                <span style="font-size: var(--text-sm); font-weight: var(--fw-semibold); color: var(--c-danger, #ef4444)">${result.errors.length} error(s)</span>
                <button class="btn btn--ghost btn--sm js-download-error-csv" type="button">Download Errors CSV</button>
              </div>
              <div style="max-height: 200px; overflow-y: auto; border: 1px solid var(--c-border); border-radius: var(--radius-md)">
                <table style="width: 100%; border-collapse: collapse; font-size: var(--text-xs)">
                  <thead>
                    <tr style="background: var(--c-bg)">
                      <th style="padding: var(--sp-1) var(--sp-2); text-align: left; border-bottom: 1px solid var(--c-border)">Row</th>
                      <th style="padding: var(--sp-1) var(--sp-2); text-align: left; border-bottom: 1px solid var(--c-border)">Column</th>
                      <th style="padding: var(--sp-1) var(--sp-2); text-align: left; border-bottom: 1px solid var(--c-border)">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${result.errors.map(err => `
                      <tr>
                        <td style="padding: var(--sp-1) var(--sp-2); border-bottom: 1px solid var(--c-border)">${err.row}</td>
                        <td style="padding: var(--sp-1) var(--sp-2); border-bottom: 1px solid var(--c-border)">${escapeHTML(err.column)}</td>
                        <td style="padding: var(--sp-1) var(--sp-2); border-bottom: 1px solid var(--c-border)">${escapeHTML(err.message)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          ` : ''}
        </div>
      `,
      footer: '<button class="btn btn--primary js-close-csv-modal" type="button">Close</button>',
      closable: true
    });

    modal.render();

    modal.el.querySelector('.js-close-csv-modal').addEventListener('click', () => modal.close());

    if (hasErrors) {
      const downloadBtn = modal.el.querySelector('.js-download-error-csv');
      if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
          const csvText = stickyService.exportErrorCSV(result.errors);
          const blob = new Blob([csvText], { type: 'text/csv' });
          downloadBlob(blob, 'import-errors.csv');
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Settings Modal (unchanged from original)
  // ---------------------------------------------------------------------------

  _openSettingsModal() {
    const room = this.state.room;
    if (!room) return;

    const modal = new Modal({
      title: 'Room Settings',
      content: `
        <form id="room-settings-form" autocomplete="off">
          <div class="form-group">
            <label class="form-label" for="settings-room-name">Room Name</label>
            <input
              id="settings-room-name"
              class="form-input"
              type="text"
              value="${escapeHTML(room.name)}"
              required
              maxlength="100"
              style="width: 100%"
            />
          </div>
          <div class="form-group">
            <label class="form-label" for="settings-room-desc">Description</label>
            <textarea
              id="settings-room-desc"
              class="form-input"
              maxlength="500"
              rows="3"
              style="width: 100%; resize: vertical"
            >${escapeHTML(room.description || '')}</textarea>
          </div>
          <div style="
            padding: var(--sp-3);
            background: var(--c-bg);
            border-radius: var(--radius-md);
            font-size: var(--text-sm);
            color: var(--c-text-secondary);
          ">
            <div style="margin-bottom: var(--sp-2)"><strong>Storage:</strong> ${formatBytes(room.storageBytesUsed || 0)}</div>
            <div style="margin-bottom: var(--sp-2)"><strong>Snapshots:</strong> ${room.snapshotCount || 0}</div>
            <div><strong>Created:</strong> ${room.createdAt ? relativeTime(room.createdAt) : 'Unknown'}</div>
          </div>
        </form>
      `,
      footer: `
        <button class="btn btn--danger btn--sm js-delete-room" type="button" style="margin-right: auto">Delete Room</button>
        <button class="btn btn--secondary js-cancel-settings" type="button">Cancel</button>
        <button class="btn btn--primary js-save-settings" type="button">Save</button>
      `,
      closable: true
    });

    modal.render();

    // Save
    modal.el.querySelector('.js-save-settings').addEventListener('click', async () => {
      const name = modal.el.querySelector('#settings-room-name').value.trim();
      const description = modal.el.querySelector('#settings-room-desc').value.trim();

      if (!name) {
        modal.el.querySelector('#settings-room-name').classList.add('form-input--error');
        return;
      }

      try {
        const updated = await roomService.updateRoom(room.id, { name, description });
        store.set('currentRoom', updated);
        this.setState({ room: updated });
        modal.close();
        showToast('Room updated', { type: 'success' });
      } catch (err) {
        showToast(err.message || 'Failed to update room', { type: 'error' });
      }
    });

    // Cancel
    modal.el.querySelector('.js-cancel-settings').addEventListener('click', () => {
      modal.close();
    });

    // Delete
    modal.el.querySelector('.js-delete-room').addEventListener('click', async () => {
      modal.close();
      const confirmed = await confirmDialog({
        title: 'Delete Room',
        message: `Are you sure you want to delete "${escapeHTML(room.name)}"? This will permanently remove all content in this room including whiteboard elements, sticky notes, chat messages, and snapshots. This action cannot be undone.`,
        confirmText: 'Delete Room',
        danger: true
      });

      if (confirmed) {
        try {
          await roomService.deleteRoom(room.id);
          showToast('Room deleted', { type: 'success' });
          router.navigate('/rooms');
        } catch (err) {
          showToast(err.message || 'Failed to delete room', { type: 'error' });
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Destroy
  // ---------------------------------------------------------------------------

  destroy() {
    // Destroy whiteboard component
    if (this._whiteboard) {
      this._whiteboard.destroy();
      this._whiteboard = null;
    }

    // Close chat drawer if open
    if (this._chatDrawer) {
      this._chatDrawer.close();
      this._chatDrawer = null;
    }

    // Leave presence on room exit
    presenceService.leaveRoom();
    store.delete('currentRoom');
    super.destroy();
  }
}
