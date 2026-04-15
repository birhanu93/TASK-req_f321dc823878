import { Component } from '../../core/component.js';
import { store } from '../../core/store.js';
import { bus } from '../../core/event-bus.js';
import { router } from '../../core/router.js';
import { escapeHTML, formatDateTime, relativeTime, uuid, now, initial, formatBytes, downloadBlob } from '../../core/utils.js';
import { Modal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { confirmDialog } from '../components/confirm-dialog.js';
import { storage, STORAGE_KEYS } from '../../core/storage.js';
import { logout } from '../../services/auth-service.js';
import { notificationService } from '../../services/notification-service.js';

const TYPE_ICONS = {
  'mention': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/></svg>',
  'reply': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>',
  'invite': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>',
  'friend-request': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  'booking': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  'system': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
};
const DEFAULT_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';

export class NotificationsPage extends Component {
  constructor(container, props) {
    super(container, props);
    const currentUser = store.get('currentUser');
    this.state = {
      role: store.get('role') || storage.get(STORAGE_KEYS.ROLE, 'user'),
      currentUser,
      unreadCount: 0,
      userMenuOpen: false,
      notifications: [],
      loading: true
    };
  }

  mount() {
    super.mount();
    this._loadNotifications();
    this.subscribeTo('notification:new', () => this._loadNotifications());
  }

  async _loadNotifications() {
    const userId = this.state.currentUser?.id;
    if (!userId) {
      this.setState({ notifications: [], loading: false, unreadCount: 0 });
      return;
    }
    try {
      const [notifications, unreadCount] = await Promise.all([
        notificationService.getNotifications(userId),
        notificationService.getUnreadCount(userId)
      ]);
      this.setState({ notifications, unreadCount, loading: false });
    } catch {
      this.setState({ notifications: [], unreadCount: 0, loading: false });
    }
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
    const { notifications, loading, unreadCount } = this.state;

    this.container.innerHTML = this._renderAppShell(`
      <div class="page-header">
        <div>
          <h1 class="page-title">Notifications</h1>
          <p class="page-subtitle">${unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}</p>
        </div>
        ${unreadCount > 0 ? `
          <button class="btn btn--secondary btn--sm js-mark-all-read" type="button">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            Mark All Read
          </button>
        ` : ''}
      </div>

      ${loading ? `
        <div class="empty-state">
          <div class="spinner" style="width: 32px; height: 32px; border-width: 3px"></div>
        </div>
      ` : notifications.length === 0 ? `
        <div class="empty-state">
          <div class="empty-state__icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          </div>
          <div class="empty-state__title">No notifications</div>
          <p style="color: var(--c-text-muted); font-size: var(--text-sm);">You are all caught up. Notifications will appear here.</p>
        </div>
      ` : `
        <div style="display: flex; flex-direction: column; gap: var(--sp-2);">
          ${notifications.map(n => this._renderNotificationItem(n)).join('')}
        </div>
      `}
    `);

    this._bindEvents();
  }

  _renderNotificationItem(n) {
    const icon = TYPE_ICONS[n.type] || DEFAULT_ICON;
    const isUnread = !n.read;
    const bodyPreview = n.body
      ? (n.body.length > 120 ? n.body.slice(0, 120) + '...' : n.body)
      : '';

    return `
      <div class="js-notification-item" data-id="${escapeHTML(n.id)}" data-link="${escapeHTML(n.linkTo || '')}" style="
        display: flex;
        align-items: flex-start;
        gap: var(--sp-3);
        padding: var(--sp-3) var(--sp-4);
        background: ${isUnread ? 'var(--c-surface-alt, rgba(59,130,246,0.04))' : 'var(--c-surface)'};
        border: 1px solid ${isUnread ? 'var(--c-primary-light, var(--c-border))' : 'var(--c-border)'};
        border-radius: var(--radius-lg);
        cursor: pointer;
        transition: border-color 0.15s;
      " onmouseover="this.style.borderColor='var(--c-primary)'" onmouseout="this.style.borderColor=''">
        <div style="flex-shrink: 0; color: ${isUnread ? 'var(--c-primary)' : 'var(--c-text-muted)'}; margin-top: 2px;">
          ${icon}
        </div>
        <div style="flex: 1; min-width: 0;">
          <div style="display: flex; align-items: center; gap: var(--sp-2); margin-bottom: 2px;">
            ${isUnread ? `<span style="width: 8px; height: 8px; border-radius: 50%; background: var(--c-primary); flex-shrink: 0;"></span>` : ''}
            <strong style="font-size: var(--text-sm); ${isUnread ? 'font-weight: var(--fw-semibold)' : 'font-weight: var(--fw-medium)'}">${escapeHTML(n.title)}</strong>
            <span style="font-size: var(--text-xs); color: var(--c-text-muted); margin-left: auto; flex-shrink: 0;">${relativeTime(n.createdAt)}</span>
          </div>
          ${bodyPreview ? `<p style="font-size: var(--text-xs); color: var(--c-text-muted); margin: 0; line-height: 1.4;">${escapeHTML(bodyPreview)}</p>` : ''}
        </div>
        <button class="btn btn--ghost btn--sm js-delete-notification" data-id="${escapeHTML(n.id)}" type="button" style="flex-shrink: 0; color: var(--c-text-muted); padding: var(--sp-1);" title="Delete" onclick="event.stopPropagation()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
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
    this.delegate('click', '.js-notifications-btn', () => {
      // Already on notifications page, just reload
      this._loadNotifications();
    });
    this.delegate('click', '.js-user-avatar', () => this.setState({ userMenuOpen: !this.state.userMenuOpen }));
    this.delegate('click', '.js-menu-logout', async () => { await logout(); router.navigate('/login'); });
    document.addEventListener('click', this._handleOutsideClick = (e) => {
      if (this.state.userMenuOpen && !e.target.closest('.user-menu')) {
        this.setState({ userMenuOpen: false });
      }
    });

    // Mark all read
    this.delegate('click', '.js-mark-all-read', async () => {
      const userId = this.state.currentUser?.id;
      if (!userId) return;
      try {
        await notificationService.markAllRead(userId);
        showToast('All notifications marked as read', { type: 'success' });
        await this._loadNotifications();
      } catch (err) { showToast(err.message, { type: 'error' }); }
    });

    // Click notification -> mark read + navigate
    this.delegate('click', '.js-notification-item', async (e, target) => {
      const id = target.dataset.id;
      const linkTo = target.dataset.link;
      try {
        await notificationService.markRead(id);
      } catch { /* ignore */ }

      if (linkTo) {
        router.navigate(linkTo);
      } else {
        await this._loadNotifications();
      }
    });

    // Delete notification
    this.delegate('click', '.js-delete-notification', async (e, target) => {
      const id = target.dataset.id;
      try {
        await notificationService.deleteNotification(id);
        showToast('Notification deleted', { type: 'success' });
        await this._loadNotifications();
      } catch (err) { showToast(err.message, { type: 'error' }); }
    });
  }

  destroy() {
    if (this._handleOutsideClick) {
      document.removeEventListener('click', this._handleOutsideClick);
    }
    super.destroy();
  }
}
