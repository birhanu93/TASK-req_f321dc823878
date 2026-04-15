import { Component } from '../../core/component.js';
import { store } from '../../core/store.js';
import { bus } from '../../core/event-bus.js';
import { router } from '../../core/router.js';
import { escapeHTML, formatDateTime, relativeTime, uuid, now, initial } from '../../core/utils.js';
import { Modal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { confirmDialog } from '../components/confirm-dialog.js';
import { storage, STORAGE_KEYS } from '../../core/storage.js';
import { logout } from '../../services/auth-service.js';
import { getProfile } from '../../services/auth-service.js';
import { relationshipService } from '../../services/relationship-service.js';
import { db } from '../../core/db.js';

export class RelationshipsPage extends Component {
  constructor(container, props) {
    super(container, props);
    const currentUser = store.get('currentUser');
    this.state = {
      role: store.get('role') || storage.get(STORAGE_KEYS.ROLE, 'user'),
      currentUser,
      unreadCount: 0,
      userMenuOpen: false,
      tab: 'friends',
      friends: [],
      pending: [],
      sent: [],
      blocked: [],
      friendProfiles: {},
      searchQuery: '',
      loading: true
    };
    this._modal = null;
  }

  mount() {
    super.mount();
    this._loadData();
    this.subscribeTo('relationship:request-sent', () => this._loadData());
    this.subscribeTo('relationship:accepted', () => this._loadData());
    this.subscribeTo('relationship:rejected', () => this._loadData());
    this.subscribeTo('relationship:withdrawn', () => this._loadData());
    this.subscribeTo('relationship:blocked', () => this._loadData());
    this.subscribeTo('relationship:unblocked', () => this._loadData());
  }

  async _loadData() {
    const userId = this.state.currentUser?.id;
    if (!userId) {
      this.setState({ loading: false });
      return;
    }
    try {
      const [friends, pending, sent, blocked] = await Promise.all([
        relationshipService.getFriends(userId),
        relationshipService.getPendingRequests(userId),
        relationshipService.getSentRequests(userId),
        relationshipService.getBlockedUsers(userId)
      ]);

      // Resolve profiles for all related users
      const profileIds = new Set();
      friends.forEach(r => { profileIds.add(r.fromId); profileIds.add(r.toId); });
      pending.forEach(r => profileIds.add(r.fromId));
      sent.forEach(r => profileIds.add(r.toId));
      blocked.forEach(r => profileIds.add(r.toId));
      profileIds.delete(userId);

      const profiles = {};
      await Promise.all([...profileIds].map(async (id) => {
        const p = await getProfile(id);
        if (p) profiles[id] = p;
      }));

      this.setState({ friends, pending, sent, blocked, friendProfiles: profiles, loading: false });
    } catch (err) {
      console.error('[RelationshipsPage] load error:', err);
      this.setState({ loading: false });
    }
  }

  _getFriendId(rel) {
    const userId = this.state.currentUser?.id;
    return rel.fromId === userId ? rel.toId : rel.fromId;
  }

  _getProfile(id) {
    return this.state.friendProfiles[id] || { displayName: 'Unknown', username: 'unknown' };
  }

  _renderAppShell(mainContent) {
    const { role, currentUser, unreadCount, userMenuOpen } = this.state;
    const currentPath = router.getCurrentPath();
    const displayName = currentUser?.displayName || currentUser?.username || 'User';
    const avatarLetter = initial(displayName);

    return `
      <div class="app-shell">
        <header class="app-header">
          <div class="app-header__left">
            <span class="app-header__logo">AlignSpace</span>
          </div>
          <div class="app-header__right">
            <div class="role-toggle tooltip" data-tooltip="${role === 'ops' ? 'Switch to User' : 'Switch to Ops'}">
              <button class="btn btn--ghost btn--sm js-role-toggle" type="button">${role === 'ops' ? 'Ops' : 'User'}</button>
            </div>
            <button class="btn btn--ghost btn--icon js-notifications-btn tooltip" data-tooltip="Notifications" type="button" style="position: relative">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
              ${unreadCount > 0 ? `<span class="badge badge--sm" style="position: absolute; top: 2px; right: 2px">${unreadCount > 99 ? '99+' : unreadCount}</span>` : ''}
            </button>
            <div class="user-menu" style="position: relative">
              <button class="avatar js-user-avatar" type="button" title="${escapeHTML(displayName)}">${escapeHTML(avatarLetter)}</button>
              ${userMenuOpen ? `
                <div class="user-menu__dropdown" style="position: absolute; top: calc(100% + var(--sp-2)); right: 0; background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); min-width: 180px; z-index: var(--z-dropdown); padding: var(--sp-2);">
                  <div style="padding: var(--sp-2) var(--sp-3); border-bottom: 1px solid var(--c-border); margin-bottom: var(--sp-2)">
                    <div style="font-size: var(--text-sm); font-weight: var(--fw-semibold)">${escapeHTML(displayName)}</div>
                    <div style="font-size: var(--text-xs); color: var(--c-text-muted)">@${escapeHTML(currentUser?.username || '')}</div>
                  </div>
                  <button class="sidebar__item js-menu-logout" type="button" style="width: 100%; color: var(--c-danger)">Logout</button>
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
            ${mainContent}
          </main>
        </div>
      </div>
    `;
  }

  render() {
    const { tab, loading, friends, pending, sent, blocked, searchQuery } = this.state;
    const pendingCount = pending.length + sent.length;

    const tabContent = this._renderTabContent();

    this.container.innerHTML = this._renderAppShell(`
      <div class="page-header">
        <div>
          <h1 class="page-title">Relationships</h1>
          <p class="page-subtitle">${friends.length} friend${friends.length !== 1 ? 's' : ''}</p>
        </div>
        <button class="btn btn--primary js-add-friend" type="button">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
          Add Friend
        </button>
      </div>

      <div style="display: flex; gap: var(--sp-2); margin-bottom: var(--sp-4);">
        <button class="btn ${tab === 'friends' ? 'btn--primary' : 'btn--secondary'} btn--sm js-tab" data-tab="friends" type="button">
          Friends (${friends.length})
        </button>
        <button class="btn ${tab === 'pending' ? 'btn--primary' : 'btn--secondary'} btn--sm js-tab" data-tab="pending" type="button">
          Pending ${pendingCount > 0 ? `(${pendingCount})` : ''}
        </button>
        <button class="btn ${tab === 'blocked' ? 'btn--primary' : 'btn--secondary'} btn--sm js-tab" data-tab="blocked" type="button">
          Blocked (${blocked.length})
        </button>
      </div>

      ${loading ? `
        <div class="empty-state">
          <div class="spinner" style="width: 32px; height: 32px; border-width: 3px"></div>
        </div>
      ` : tabContent}
    `);

    this._bindEvents();
  }

  _renderTabContent() {
    switch (this.state.tab) {
      case 'friends': return this._renderFriends();
      case 'pending': return this._renderPending();
      case 'blocked': return this._renderBlocked();
      default: return this._renderFriends();
    }
  }

  _renderFriends() {
    const { friends, searchQuery } = this.state;
    let filtered = friends;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = friends.filter(r => {
        const fId = this._getFriendId(r);
        const p = this._getProfile(fId);
        return p.displayName.toLowerCase().includes(q) || p.username.toLowerCase().includes(q);
      });
    }

    return `
      <div style="margin-bottom: var(--sp-4);">
        <input class="form-input js-friend-search" type="text" placeholder="Search friends..." value="${escapeHTML(searchQuery)}" style="width: 100%; max-width: 300px;" />
      </div>
      ${filtered.length === 0 ? `
        <div class="empty-state">
          <div class="empty-state__icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
          <div class="empty-state__title">${searchQuery ? 'No matches found' : 'No friends yet'}</div>
          <p style="color: var(--c-text-muted); font-size: var(--text-sm);">${searchQuery ? 'Try a different search term.' : 'Add friends to start connecting.'}</p>
        </div>
      ` : `
        <div style="display: flex; flex-direction: column; gap: var(--sp-3);">
          ${filtered.map(r => {
            const fId = this._getFriendId(r);
            const p = this._getProfile(fId);
            const av = initial(p.displayName);
            return `
              <div style="background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--radius-lg); padding: var(--sp-3) var(--sp-4); display: flex; align-items: center; gap: var(--sp-3);" data-rel-id="${escapeHTML(r.id)}" data-friend-id="${escapeHTML(fId)}">
                <div class="avatar" style="width: 36px; height: 36px; font-size: var(--text-sm); flex-shrink: 0;">${escapeHTML(av)}</div>
                <div style="flex: 1; min-width: 0;">
                  <div style="display: flex; align-items: center; gap: var(--sp-2);">
                    <strong style="font-size: var(--text-sm);">${escapeHTML(p.displayName)}</strong>
                    <span style="font-size: var(--text-xs); color: var(--c-text-muted);">@${escapeHTML(p.username)}</span>
                    ${r.groupLabel ? `<span class="badge badge--secondary" style="font-size: 10px;">${escapeHTML(r.groupLabel)}</span>` : ''}
                  </div>
                  ${r.personalNote ? `<p style="font-size: var(--text-xs); color: var(--c-text-muted); margin: var(--sp-1) 0 0 0;">${escapeHTML(r.personalNote)}</p>` : ''}
                </div>
                <div style="display: flex; gap: var(--sp-1); flex-shrink: 0;">
                  <button class="btn btn--ghost btn--sm js-set-group" data-rel-id="${escapeHTML(r.id)}" type="button" title="Set group">Group</button>
                  <button class="btn btn--ghost btn--sm js-add-note" data-rel-id="${escapeHTML(r.id)}" type="button" title="Add note">Note</button>
                  <button class="btn btn--ghost btn--sm js-remove-friend" data-rel-id="${escapeHTML(r.id)}" data-friend-id="${escapeHTML(fId)}" type="button" style="color: var(--c-danger);" title="Remove">Remove</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `}
    `;
  }

  _renderPending() {
    const { pending, sent } = this.state;

    return `
      ${pending.length > 0 ? `
        <h3 style="font-size: var(--text-sm); font-weight: var(--fw-semibold); margin-bottom: var(--sp-3);">Incoming Requests (${pending.length})</h3>
        <div style="display: flex; flex-direction: column; gap: var(--sp-3); margin-bottom: var(--sp-6);">
          ${pending.map(r => {
            const p = this._getProfile(r.fromId);
            const av = initial(p.displayName);
            return `
              <div style="background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--radius-lg); padding: var(--sp-3) var(--sp-4); display: flex; align-items: center; gap: var(--sp-3);">
                <div class="avatar" style="width: 36px; height: 36px; font-size: var(--text-sm); flex-shrink: 0;">${escapeHTML(av)}</div>
                <div style="flex: 1; min-width: 0;">
                  <strong style="font-size: var(--text-sm);">${escapeHTML(p.displayName)}</strong>
                  <span style="font-size: var(--text-xs); color: var(--c-text-muted); margin-left: var(--sp-1);">@${escapeHTML(p.username)}</span>
                  <div style="font-size: var(--text-xs); color: var(--c-text-muted);">${relativeTime(r.createdAt)}</div>
                </div>
                <div style="display: flex; gap: var(--sp-2); flex-shrink: 0;">
                  <button class="btn btn--primary btn--sm js-accept-request" data-id="${escapeHTML(r.id)}" type="button">Accept</button>
                  <button class="btn btn--secondary btn--sm js-reject-request" data-id="${escapeHTML(r.id)}" type="button">Reject</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      ` : ''}

      ${sent.length > 0 ? `
        <h3 style="font-size: var(--text-sm); font-weight: var(--fw-semibold); margin-bottom: var(--sp-3);">Sent Requests (${sent.length})</h3>
        <div style="display: flex; flex-direction: column; gap: var(--sp-3);">
          ${sent.map(r => {
            const p = this._getProfile(r.toId);
            const av = initial(p.displayName);
            return `
              <div style="background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--radius-lg); padding: var(--sp-3) var(--sp-4); display: flex; align-items: center; gap: var(--sp-3);">
                <div class="avatar" style="width: 36px; height: 36px; font-size: var(--text-sm); flex-shrink: 0;">${escapeHTML(av)}</div>
                <div style="flex: 1; min-width: 0;">
                  <strong style="font-size: var(--text-sm);">${escapeHTML(p.displayName)}</strong>
                  <span style="font-size: var(--text-xs); color: var(--c-text-muted); margin-left: var(--sp-1);">@${escapeHTML(p.username)}</span>
                  <div style="font-size: var(--text-xs); color: var(--c-text-muted);">Sent ${relativeTime(r.createdAt)}</div>
                </div>
                <button class="btn btn--secondary btn--sm js-withdraw-request" data-id="${escapeHTML(r.id)}" type="button">Withdraw</button>
              </div>
            `;
          }).join('')}
        </div>
      ` : ''}

      ${pending.length === 0 && sent.length === 0 ? `
        <div class="empty-state">
          <div class="empty-state__title">No pending requests</div>
          <p style="color: var(--c-text-muted); font-size: var(--text-sm);">All caught up.</p>
        </div>
      ` : ''}
    `;
  }

  _renderBlocked() {
    const { blocked } = this.state;

    if (blocked.length === 0) {
      return `
        <div class="empty-state">
          <div class="empty-state__title">No blocked users</div>
          <p style="color: var(--c-text-muted); font-size: var(--text-sm);">You have not blocked anyone.</p>
        </div>
      `;
    }

    return `
      <div style="display: flex; flex-direction: column; gap: var(--sp-3);">
        ${blocked.map(r => {
          const p = this._getProfile(r.toId);
          const av = initial(p.displayName);
          return `
            <div style="background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--radius-lg); padding: var(--sp-3) var(--sp-4); display: flex; align-items: center; gap: var(--sp-3);">
              <div class="avatar" style="width: 36px; height: 36px; font-size: var(--text-sm); flex-shrink: 0;">${escapeHTML(av)}</div>
              <div style="flex: 1; min-width: 0;">
                <strong style="font-size: var(--text-sm);">${escapeHTML(p.displayName)}</strong>
                <span style="font-size: var(--text-xs); color: var(--c-text-muted); margin-left: var(--sp-1);">@${escapeHTML(p.username)}</span>
              </div>
              <button class="btn btn--secondary btn--sm js-unblock" data-target-id="${escapeHTML(r.toId)}" type="button">Unblock</button>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  _bindEvents() {
    // Global nav
    this.delegate('click', '.js-nav', (e, target) => {
      const route = target.dataset.route;
      if (route) router.navigate(route);
    });
    this.delegate('click', '.js-role-toggle', () => {
      const newRole = this.state.role === 'ops' ? 'user' : 'ops';
      store.set('role', newRole);
      storage.set(STORAGE_KEYS.ROLE, newRole);
      this.setState({ role: newRole });
    });
    this.delegate('click', '.js-notifications-btn', () => router.navigate('/notifications'));
    this.delegate('click', '.js-user-avatar', () => this.setState({ userMenuOpen: !this.state.userMenuOpen }));
    this.delegate('click', '.js-menu-logout', async () => {
      await logout();
      router.navigate('/login');
    });
    document.addEventListener('click', this._handleOutsideClick = (e) => {
      if (this.state.userMenuOpen && !e.target.closest('.user-menu')) {
        this.setState({ userMenuOpen: false });
      }
    });

    // Tabs
    this.delegate('click', '.js-tab', (e, target) => {
      const t = target.dataset.tab;
      if (t && t !== this.state.tab) this.setState({ tab: t });
    });

    // Search
    this.delegate('input', '.js-friend-search', (e, target) => {
      this.state.searchQuery = target.value;
      // Re-render tab content only
      const content = this.$('.main-content');
      if (content) this.render();
    });

    // Friend actions
    this.delegate('click', '.js-remove-friend', async (e, target) => {
      const friendId = target.dataset.friendId;
      const p = this._getProfile(friendId);
      const ok = await confirmDialog({ title: 'Remove Friend', message: `Remove ${p.displayName} from friends?`, danger: true, confirmText: 'Remove' });
      if (ok) {
        try {
          // Block and unblock to remove the relationship
          await relationshipService.blockUser(friendId);
          await relationshipService.unblockUser(friendId);
          showToast('Friend removed', { type: 'success' });
          await this._loadData();
        } catch (err) { showToast(err.message, { type: 'error' }); }
      }
    });

    this.delegate('click', '.js-set-group', async (e, target) => {
      const relId = target.dataset.relId;
      this._modal = new Modal({
        title: 'Set Group',
        content: `
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label">Group Label</label>
            <input class="form-input js-modal-group" type="text" placeholder="e.g. Work, Family, Gaming" style="width: 100%;" />
          </div>
        `,
        footer: `
          <button class="btn btn--secondary js-modal-cancel" type="button">Cancel</button>
          <button class="btn btn--primary js-modal-save" type="button">Save</button>
        `,
        closable: true,
        onClose: () => { this._modal = null; }
      });
      this._modal.render();
      const input = this._modal.el.querySelector('.js-modal-group');
      requestAnimationFrame(() => input.focus());
      this._modal.el.querySelector('.js-modal-cancel').addEventListener('click', () => this._modal.close());
      this._modal.el.querySelector('.js-modal-save').addEventListener('click', async () => {
        const label = input.value.trim() || null;
        try {
          await relationshipService.setGroup(relId, label);
          showToast(label ? `Group set to "${label}"` : 'Group cleared', { type: 'success' });
          this._modal.close();
          await this._loadData();
        } catch (err) { showToast(err.message, { type: 'error' }); }
      });
    });

    this.delegate('click', '.js-add-note', async (e, target) => {
      const relId = target.dataset.relId;
      const rel = this.state.friends.find(r => r.id === relId);
      this._modal = new Modal({
        title: 'Personal Note',
        content: `
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label">Note</label>
            <textarea class="form-input js-modal-note" rows="3" placeholder="Add a personal note..." style="width: 100%; resize: vertical;">${escapeHTML(rel?.personalNote || '')}</textarea>
          </div>
        `,
        footer: `
          <button class="btn btn--secondary js-modal-cancel" type="button">Cancel</button>
          <button class="btn btn--primary js-modal-save" type="button">Save</button>
        `,
        closable: true,
        onClose: () => { this._modal = null; }
      });
      this._modal.render();
      this._modal.el.querySelector('.js-modal-cancel').addEventListener('click', () => this._modal.close());
      this._modal.el.querySelector('.js-modal-save').addEventListener('click', async () => {
        const note = this._modal.el.querySelector('.js-modal-note')?.value?.trim() || null;
        try {
          await relationshipService.setPersonalNote(relId, note);
          showToast('Note saved', { type: 'success' });
          this._modal.close();
          await this._loadData();
        } catch (err) { showToast(err.message, { type: 'error' }); }
      });
    });

    // Pending actions
    this.delegate('click', '.js-accept-request', async (e, target) => {
      try {
        await relationshipService.acceptRequest(target.dataset.id);
        showToast('Friend request accepted', { type: 'success' });
        await this._loadData();
      } catch (err) { showToast(err.message, { type: 'error' }); }
    });
    this.delegate('click', '.js-reject-request', async (e, target) => {
      try {
        await relationshipService.rejectRequest(target.dataset.id);
        showToast('Request rejected', { type: 'success' });
        await this._loadData();
      } catch (err) { showToast(err.message, { type: 'error' }); }
    });
    this.delegate('click', '.js-withdraw-request', async (e, target) => {
      try {
        await relationshipService.withdrawRequest(target.dataset.id);
        showToast('Request withdrawn', { type: 'success' });
        await this._loadData();
      } catch (err) { showToast(err.message, { type: 'error' }); }
    });

    // Blocked actions
    this.delegate('click', '.js-unblock', async (e, target) => {
      try {
        await relationshipService.unblockUser(target.dataset.targetId);
        showToast('User unblocked', { type: 'success' });
        await this._loadData();
      } catch (err) { showToast(err.message, { type: 'error' }); }
    });

    // Add friend
    this.delegate('click', '.js-add-friend', () => this._openAddFriendModal());
  }

  async _openAddFriendModal() {
    let allProfiles = [];
    try {
      allProfiles = await db.getAll('profiles');
    } catch { /* ignore */ }

    const userId = this.state.currentUser?.id;
    // Filter out self and already related profiles
    const relatedIds = new Set();
    this.state.friends.forEach(r => { relatedIds.add(r.fromId); relatedIds.add(r.toId); });
    this.state.pending.forEach(r => relatedIds.add(r.fromId));
    this.state.sent.forEach(r => relatedIds.add(r.toId));
    this.state.blocked.forEach(r => relatedIds.add(r.toId));
    relatedIds.add(userId);

    const available = allProfiles
      .filter(p => !relatedIds.has(p.id))
      .map(p => ({ id: p.id, username: p.username, displayName: p.displayName }));

    this._modal = new Modal({
      title: 'Add Friend',
      content: `
        <div class="form-group">
          <label class="form-label">Search by username</label>
          <input class="form-input js-modal-search" type="text" placeholder="Type a username..." style="width: 100%;" />
        </div>
        <div class="js-modal-results" style="max-height: 250px; overflow-y: auto;">
          ${available.length === 0
            ? '<p style="color: var(--c-text-muted); font-size: var(--text-sm);">No other users found.</p>'
            : available.map(p => `
              <div class="js-modal-user" data-id="${escapeHTML(p.id)}" style="display: flex; align-items: center; gap: var(--sp-2); padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-md); cursor: pointer; border: 1px solid transparent; margin-bottom: var(--sp-1);" onmouseover="this.style.background='var(--c-surface-alt, var(--c-bg))'" onmouseout="this.style.background=''">
                <div class="avatar" style="width: 28px; height: 28px; font-size: 12px; flex-shrink: 0;">${escapeHTML(initial(p.displayName))}</div>
                <div>
                  <div style="font-size: var(--text-sm); font-weight: var(--fw-medium);">${escapeHTML(p.displayName)}</div>
                  <div style="font-size: var(--text-xs); color: var(--c-text-muted);">@${escapeHTML(p.username)}</div>
                </div>
              </div>
            `).join('')
          }
        </div>
      `,
      closable: true,
      onClose: () => { this._modal = null; }
    });
    this._modal.render();
    const searchInput = this._modal.el.querySelector('.js-modal-search');
    requestAnimationFrame(() => searchInput?.focus());

    // Filter on input
    searchInput?.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase().trim();
      const items = this._modal.el.querySelectorAll('.js-modal-user');
      items.forEach(el => {
        const text = el.textContent.toLowerCase();
        el.style.display = q && !text.includes(q) ? 'none' : '';
      });
    });

    // Click to send request
    this._modal.el.querySelectorAll('.js-modal-user').forEach(el => {
      el.addEventListener('click', async () => {
        const id = el.dataset.id;
        try {
          await relationshipService.sendFriendRequest(id);
          showToast('Friend request sent', { type: 'success' });
          this._modal.close();
          await this._loadData();
        } catch (err) {
          showToast(err.message, { type: 'error' });
        }
      });
    });
  }

  destroy() {
    if (this._handleOutsideClick) {
      document.removeEventListener('click', this._handleOutsideClick);
    }
    if (this._modal) {
      this._modal.close();
      this._modal = null;
    }
    super.destroy();
  }
}
