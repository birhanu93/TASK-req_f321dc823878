import { Component } from '../../core/component.js';
import { store } from '../../core/store.js';
import { router } from '../../core/router.js';
import { bus } from '../../core/event-bus.js';
import { storage, STORAGE_KEYS } from '../../core/storage.js';
import { escapeHTML, initial, relativeTime, formatBytes } from '../../core/utils.js';
import { roomService } from '../../services/room-service.js';
import { notificationService } from '../../services/notification-service.js';
import { opsService } from '../../services/ops-service.js';
import { stickyService } from '../../services/sticky-service.js';
import { whiteboardService } from '../../services/whiteboard-service.js';
import { logout } from '../../services/auth-service.js';
import { Modal } from '../components/modal.js';
import { showToast } from '../components/toast.js';

export class RoomListPage extends Component {
  constructor(container, props) {
    super(container, props);
    const currentUser = store.get('currentUser');
    this.state = {
      rooms: [],
      loading: true,
      role: store.get('role') || storage.get(STORAGE_KEYS.ROLE, 'user'),
      currentUser: currentUser,
      unreadCount: 0,
      userMenuOpen: false
    };
    this._createModal = null;
  }

  mount() {
    super.mount();
    this._loadRooms();
    this._loadUnreadCount();

    this.subscribeTo('room:created', () => this._loadRooms());
    this.subscribeTo('room:updated', () => this._loadRooms());
    this.subscribeTo('room:deleted', () => this._loadRooms());
    this.subscribeTo('notification:new', () => this._loadUnreadCount());
  }

  async _loadRooms() {
    try {
      const rooms = await roomService.listRooms();
      this.setState({ rooms, loading: false });
    } catch (err) {
      console.error('[RoomListPage] Failed to load rooms:', err);
      this.setState({ rooms: [], loading: false });
      showToast('Failed to load rooms', { type: 'error' });
    }
  }

  async _loadUnreadCount() {
    try {
      const currentUser = store.get('currentUser');
      if (currentUser?.id) {
        const count = await notificationService.getUnreadCount(currentUser.id);
        this.setState({ unreadCount: count });
      }
    } catch {
      // Silently ignore
    }
  }

  render() {
    const { rooms, loading, role, currentUser, unreadCount, userMenuOpen } = this.state;
    const currentPath = router.getCurrentPath();
    const displayName = currentUser?.displayName || currentUser?.username || 'User';
    const avatarLetter = initial(displayName);

    this.container.innerHTML = `
      <div class="app-shell">
        <header class="app-header">
          <div class="app-header__left">
            <span class="app-header__logo">AlignSpace</span>
          </div>
          <div class="app-header__right">
            <div class="role-toggle tooltip" data-tooltip="${role === 'ops' ? 'Switch to User' : 'Switch to Ops'}">
              <button class="btn btn--ghost btn--sm js-role-toggle" type="button">
                ${role === 'ops' ? 'Ops' : 'User'}
              </button>
            </div>
            <button class="btn btn--ghost btn--icon js-notifications-btn tooltip" data-tooltip="Notifications" type="button" style="position: relative">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              ${unreadCount > 0 ? `<span class="badge badge--sm" style="position: absolute; top: 2px; right: 2px">${unreadCount > 99 ? '99+' : unreadCount}</span>` : ''}
            </button>
            <div class="user-menu" style="position: relative">
              <button class="avatar js-user-avatar" type="button" title="${escapeHTML(displayName)}">
                ${escapeHTML(avatarLetter)}
              </button>
              ${userMenuOpen ? `
                <div class="user-menu__dropdown" style="
                  position: absolute;
                  top: calc(100% + var(--sp-2));
                  right: 0;
                  background: var(--c-surface);
                  border: 1px solid var(--c-border);
                  border-radius: var(--radius-lg);
                  box-shadow: var(--shadow-lg);
                  min-width: 180px;
                  z-index: var(--z-dropdown);
                  padding: var(--sp-2);
                ">
                  <div style="padding: var(--sp-2) var(--sp-3); border-bottom: 1px solid var(--c-border); margin-bottom: var(--sp-2)">
                    <div style="font-size: var(--text-sm); font-weight: var(--fw-semibold)">${escapeHTML(displayName)}</div>
                    <div style="font-size: var(--text-xs); color: var(--c-text-muted)">@${escapeHTML(currentUser?.username || '')}</div>
                  </div>
                  <button class="sidebar__item js-menu-profile" type="button" style="width: 100%">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    Profile
                  </button>
                  <button class="sidebar__item js-menu-switch-user" type="button" style="width: 100%">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></svg>
                    Switch User
                  </button>
                  <div class="divider" style="margin: var(--sp-2) 0"></div>
                  <button class="sidebar__item js-menu-logout" type="button" style="width: 100%; color: var(--c-danger)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                    Logout
                  </button>
                </div>
              ` : ''}
            </div>
          </div>
        </header>

        <div class="app-body">
          <nav class="sidebar">
            <div class="sidebar__nav">
              <button class="sidebar__item ${currentPath === '/rooms' ? 'sidebar__item--active' : ''} js-nav" data-route="/rooms" type="button">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                Rooms
              </button>
              <button class="sidebar__item ${currentPath === '/relationships' ? 'sidebar__item--active' : ''} js-nav" data-route="/relationships" type="button">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                Relationships
              </button>
              <button class="sidebar__item ${currentPath === '/meals' ? 'sidebar__item--active' : ''} js-nav" data-route="/meals" type="button">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>
                Meal Planner
              </button>
              <button class="sidebar__item ${currentPath === '/bookings' ? 'sidebar__item--active' : ''} js-nav" data-route="/bookings" type="button">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                Bookings
              </button>
              <button class="sidebar__item ${currentPath === '/notifications' ? 'sidebar__item--active' : ''} js-nav" data-route="/notifications" type="button">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                Notifications
                ${unreadCount > 0 ? `<span class="badge badge--sm" style="margin-left: auto">${unreadCount > 99 ? '99+' : unreadCount}</span>` : ''}
              </button>

              ${role === 'ops' ? `
                <div class="sidebar__section-title">Administration</div>
                <button class="sidebar__item ${currentPath.startsWith('/ops') ? 'sidebar__item--active' : ''} js-nav" data-route="/ops" type="button">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                  Ops Console
                </button>
              ` : ''}
            </div>
          </nav>

          <main class="main-content">
            <div class="page-header">
              <div>
                <h1 class="page-title">Rooms</h1>
                <p class="page-subtitle">${rooms.length} room${rooms.length !== 1 ? 's' : ''}</p>
              </div>
              <button class="btn btn--primary js-create-room" type="button">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Create Room
              </button>
            </div>

            ${loading ? `
              <div class="empty-state">
                <div class="spinner" style="width: 32px; height: 32px; border-width: 3px"></div>
              </div>
            ` : rooms.length === 0 ? `
              <div class="empty-state">
                <div class="empty-state__icon">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                </div>
                <div class="empty-state__title">No rooms yet</div>
                <p style="color: var(--c-text-muted); font-size: var(--text-sm); margin-bottom: var(--sp-4)">Create your first room to start collaborating.</p>
                <button class="btn btn--primary js-create-room" type="button">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Create Room
                </button>
              </div>
            ` : `
              <div class="room-grid">
                ${rooms.map(room => this._renderRoomCard(room)).join('')}
              </div>
            `}
          </main>
        </div>
      </div>
    `;

    this._bindEvents();
  }

  _renderRoomCard(room) {
    const description = room.description
      ? escapeHTML(room.description.length > 100 ? room.description.slice(0, 100) + '...' : room.description)
      : '<span style="color: var(--c-text-muted); font-style: italic">No description</span>';
    const updatedLabel = room.updatedAt ? relativeTime(room.updatedAt) : 'Unknown';
    const storageUsed = room.storageBytesUsed ? formatBytes(room.storageBytesUsed) : '0 B';

    return `
      <div class="room-card js-room-card" data-room-id="${escapeHTML(room.id)}">
        <div class="room-card__header">
          <div class="room-card__icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
          </div>
        </div>
        <div class="room-card__name">${escapeHTML(room.name)}</div>
        <div class="room-card__description">${description}</div>
        <div class="room-card__footer">
          <div class="room-card__members">
            <span class="room-card__members-count">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px; margin-right: 2px"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
              ${storageUsed}
            </span>
          </div>
          <span class="room-card__timestamp">${escapeHTML(updatedLabel)}</span>
        </div>
      </div>
    `;
  }

  _bindEvents() {
    // Sidebar navigation
    this.delegate('click', '.js-nav', (e, target) => {
      const route = target.dataset.route;
      if (route) router.navigate(route);
    });

    // Room card click
    this.delegate('click', '.js-room-card', (e, target) => {
      const roomId = target.dataset.roomId;
      if (roomId) router.navigate(`/rooms/${roomId}`);
    });

    // Create room button
    this.delegate('click', '.js-create-room', () => {
      this._openCreateModal();
    });

    // Role toggle
    this.delegate('click', '.js-role-toggle', () => {
      const newRole = this.state.role === 'ops' ? 'user' : 'ops';
      store.set('role', newRole);
      storage.set(STORAGE_KEYS.ROLE, newRole);
      this.setState({ role: newRole });
    });

    // Notifications button
    this.delegate('click', '.js-notifications-btn', () => {
      router.navigate('/notifications');
    });

    // User avatar menu toggle
    this.delegate('click', '.js-user-avatar', () => {
      this.setState({ userMenuOpen: !this.state.userMenuOpen });
    });

    // User menu actions
    this.delegate('click', '.js-menu-profile', () => {
      this.setState({ userMenuOpen: false });
      showToast('Profile settings coming soon', { type: 'info' });
    });

    this.delegate('click', '.js-menu-switch-user', async () => {
      this.setState({ userMenuOpen: false });
      await logout();
      router.navigate('/login');
    });

    this.delegate('click', '.js-menu-logout', async () => {
      this.setState({ userMenuOpen: false });
      await logout();
      router.navigate('/login');
    });

    // Close user menu on outside click
    document.addEventListener('click', this._handleOutsideClick = (e) => {
      if (this.state.userMenuOpen && !e.target.closest('.user-menu')) {
        this.setState({ userMenuOpen: false });
      }
    });
  }

  async _openCreateModal() {
    // Load templates for the starter-kit selector
    let templates = [];
    try {
      templates = await opsService.listTemplates();
    } catch {
      // Templates are optional; proceed without them
    }

    // Get default template preference from LocalStorage
    const templateDefaults = storage.get(STORAGE_KEYS.TEMPLATE_DEFAULTS, {});
    const defaultTemplateId = templateDefaults.defaultId || null;
    // Featured template: first template marked featured, or first template overall
    const featuredTemplate = templates.find(t => t.featured) || templates[0] || null;

    const templateOptions = templates.length > 0 ? `
      <div class="form-group">
        <label class="form-label" for="room-template">Starter Kit / Template</label>
        <select id="room-template" class="form-input" style="width: 100%">
          <option value="">Blank Room (no template)</option>
          ${templates.map(t => {
            const isDefault = t.id === defaultTemplateId;
            const isFeatured = t === featuredTemplate && !defaultTemplateId;
            const selected = isDefault || isFeatured ? 'selected' : '';
            const badge = t.featured ? ' [Featured]' : '';
            return `<option value="${escapeHTML(t.id)}" ${selected}>${escapeHTML(t.name)}${badge}${t.category ? ` (${escapeHTML(t.category)})` : ''}</option>`;
          }).join('')}
        </select>
        <span class="form-hint">Select a template to pre-populate the room with starter content.</span>
      </div>
    ` : '';

    this._createModal = new Modal({
      title: 'Create Room',
      content: `
        <form id="create-room-form" autocomplete="off">
          <div class="form-group">
            <label class="form-label" for="room-name">Room Name <span style="color: var(--c-danger)">*</span></label>
            <input
              id="room-name"
              class="form-input"
              type="text"
              placeholder="e.g., Sprint Planning, Design Review"
              required
              maxlength="100"
              style="width: 100%"
            />
          </div>
          <div class="form-group">
            <label class="form-label" for="room-description">Description</label>
            <textarea
              id="room-description"
              class="form-input"
              placeholder="What is this room for?"
              maxlength="500"
              rows="3"
              style="width: 100%; resize: vertical"
            ></textarea>
            <span class="form-hint">Optional. Describe the purpose of this room.</span>
          </div>
          ${templateOptions}
        </form>
      `,
      footer: `
        <button class="btn btn--secondary js-cancel-create" type="button">Cancel</button>
        <button class="btn btn--primary js-confirm-create" type="button">Create Room</button>
      `,
      closable: true,
      onClose: () => { this._createModal = null; }
    });

    this._createModal.render();

    const body = this._createModal.getBody();
    const nameInput = body.querySelector('#room-name');
    const descInput = body.querySelector('#room-description');
    const templateSelect = body.querySelector('#room-template');

    // Focus the name input
    requestAnimationFrame(() => nameInput.focus());

    // Cancel
    this._createModal.el.querySelector('.js-cancel-create').addEventListener('click', () => {
      this._createModal.close();
    });

    // Submit on Enter key in name field
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._submitCreateRoom(nameInput, descInput, templateSelect, templates);
      }
    });

    // Confirm
    this._createModal.el.querySelector('.js-confirm-create').addEventListener('click', () => {
      this._submitCreateRoom(nameInput, descInput, templateSelect, templates);
    });
  }

  async _submitCreateRoom(nameInput, descInput, templateSelect, templates) {
    const name = nameInput.value.trim();
    const description = descInput.value.trim();

    if (!name) {
      nameInput.classList.add('form-input--error');
      nameInput.focus();
      return;
    }

    const confirmBtn = this._createModal.el.querySelector('.js-confirm-create');
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<span class="spinner" style="width: 14px; height: 14px; border-width: 2px"></span> Creating...';

    try {
      const room = await roomService.createRoom(name, description);

      // Apply template if selected
      const selectedTemplateId = templateSelect ? templateSelect.value : '';
      if (selectedTemplateId) {
        const template = templates.find(t => t.id === selectedTemplateId);
        if (template && template.data) {
          await this._applyTemplate(room.id, template);
        }
        // Persist the default template selection
        storage.set(STORAGE_KEYS.TEMPLATE_DEFAULTS, { defaultId: selectedTemplateId });
      }

      this._createModal.close();
      showToast(`Room "${escapeHTML(name)}" created`, { type: 'success' });
      router.navigate(`/rooms/${room.id}`);
    } catch (err) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Create Room';
      showToast(err.message || 'Failed to create room', { type: 'error' });
    }
  }

  async _applyTemplate(roomId, template) {
    const data = template.data;
    if (!data) return;

    // Seed sticky notes from template
    if (data.stickyNotes && Array.isArray(data.stickyNotes)) {
      for (const note of data.stickyNotes) {
        await stickyService.createNote(roomId, {
          title: note.title || 'Untitled',
          body: note.body || '',
          color: note.color || '#FFEB3B'
        });
      }
    }

    // Seed whiteboard elements from template
    if (data.whiteboardElements && Array.isArray(data.whiteboardElements)) {
      for (const el of data.whiteboardElements) {
        await whiteboardService.createElement(roomId, el.type || 'rectangle', {
          x: el.x || 0,
          y: el.y || 0,
          width: el.width || 100,
          height: el.height || 100,
          fill: el.fill,
          stroke: el.stroke,
          text: el.text
        });
      }
    }

    // Seed chat welcome message from template rules
    if (data.welcomeMessage) {
      const { chatService } = await import('../../services/chat-service.js');
      try {
        await chatService.sendMessage(roomId, data.welcomeMessage);
      } catch {
        // Non-critical, ignore
      }
    }
  }

  destroy() {
    if (this._handleOutsideClick) {
      document.removeEventListener('click', this._handleOutsideClick);
    }
    if (this._createModal) {
      this._createModal.close();
      this._createModal = null;
    }
    super.destroy();
  }
}
