import { Component } from '../../core/component.js';
import { store } from '../../core/store.js';
import { bus } from '../../core/event-bus.js';
import { router } from '../../core/router.js';
import { escapeHTML, formatDateTime, relativeTime, uuid, now, initial, downloadBlob } from '../../core/utils.js';
import { Modal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { confirmDialog } from '../components/confirm-dialog.js';
import { storage, STORAGE_KEYS } from '../../core/storage.js';
import { logout } from '../../services/auth-service.js';
import { bookingService } from '../../services/booking-service.js';

const STATUS_FILTERS = ['all', 'draft', 'pending', 'approved', 'paid-marked', 'completed', 'canceled', 'refunding-marked'];
const STATUS_LABELS = {
  'all': 'All',
  'draft': 'Draft',
  'pending': 'Pending',
  'approved': 'Approved',
  'paid-marked': 'Paid',
  'completed': 'Completed',
  'canceled': 'Canceled',
  'refunding-marked': 'Refunding'
};
const STATUS_BADGE_CLASS = {
  'draft': 'badge--secondary',
  'pending': 'badge--warning',
  'approved': 'badge--info',
  'paid-marked': 'badge--primary',
  'completed': 'badge--success',
  'canceled': 'badge--danger',
  'refunding-marked': 'badge--warning'
};

const TRANSITIONS = {
  'draft': [{ to: 'pending', label: 'Submit', btnClass: 'btn--primary' }],
  'pending': [
    { to: 'approved', label: 'Approve', btnClass: 'btn--primary' },
    { to: 'canceled', label: 'Cancel', btnClass: 'btn--danger' }
  ],
  'approved': [
    { to: 'paid-marked', label: 'Mark Paid', btnClass: 'btn--primary' },
    { to: 'canceled', label: 'Cancel', btnClass: 'btn--danger' }
  ],
  'paid-marked': [
    { to: 'completed', label: 'Complete', btnClass: 'btn--primary' },
    { to: 'refunding-marked', label: 'Request Refund', btnClass: 'btn--warning' }
  ],
  'canceled': [
    { to: 'refunding-marked', label: 'Request Refund', btnClass: 'btn--warning' }
  ],
  'refunding-marked': [
    { to: 'completed', label: 'Complete', btnClass: 'btn--primary' }
  ]
};

export class BookingPage extends Component {
  constructor(container, props) {
    super(container, props);
    const currentUser = store.get('currentUser');
    this.state = {
      role: store.get('role') || storage.get(STORAGE_KEYS.ROLE, 'user'),
      currentUser,
      unreadCount: 0,
      userMenuOpen: false,
      bookings: [],
      statusFilter: 'all',
      loading: true,
      detailBooking: null
    };
    this._modal = null;
  }

  mount() {
    super.mount();
    this._loadBookings();
    this.subscribeTo('booking:created', () => this._loadBookings());
    this.subscribeTo('booking:updated', () => this._loadBookings());
    this.subscribeTo('booking:status-changed', () => this._loadBookings());
    this.subscribeTo('booking:deleted', () => this._loadBookings());
  }

  async _loadBookings() {
    try {
      const opts = {};
      if (this.state.statusFilter !== 'all') opts.status = this.state.statusFilter;
      const bookings = await bookingService.listBookings(opts);
      this.setState({ bookings, loading: false });
    } catch {
      this.setState({ bookings: [], loading: false });
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
    const { bookings, loading, statusFilter, detailBooking } = this.state;

    if (detailBooking) {
      this.container.innerHTML = this._renderAppShell(this._renderDetail(detailBooking));
      this._bindEvents();
      return;
    }

    this.container.innerHTML = this._renderAppShell(`
      <div class="page-header">
        <div>
          <h1 class="page-title">Bookings</h1>
          <p class="page-subtitle">${bookings.length} booking${bookings.length !== 1 ? 's' : ''}</p>
        </div>
        <div style="display: flex; gap: var(--sp-2);">
          <button class="btn btn--secondary btn--sm js-export-csv" type="button">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export CSV
          </button>
          <button class="btn btn--primary js-create-booking" type="button">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Booking
          </button>
        </div>
      </div>

      <div style="display: flex; gap: var(--sp-2); margin-bottom: var(--sp-4); flex-wrap: wrap;">
        ${STATUS_FILTERS.map(s => `
          <button class="btn ${statusFilter === s ? 'btn--primary' : 'btn--secondary'} btn--sm js-status-filter" data-status="${s}" type="button">
            ${escapeHTML(STATUS_LABELS[s] || s)}
          </button>
        `).join('')}
      </div>

      ${loading ? `
        <div class="empty-state">
          <div class="spinner" style="width: 32px; height: 32px; border-width: 3px"></div>
        </div>
      ` : bookings.length === 0 ? `
        <div class="empty-state">
          <div class="empty-state__icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </div>
          <div class="empty-state__title">No bookings</div>
          <p style="color: var(--c-text-muted); font-size: var(--text-sm); margin-bottom: var(--sp-4);">Create your first booking to get started.</p>
          <button class="btn btn--primary js-create-booking" type="button">New Booking</button>
        </div>
      ` : `
        <div style="display: flex; flex-direction: column; gap: var(--sp-3);">
          ${bookings.map(b => this._renderBookingCard(b)).join('')}
        </div>
      `}
    `);

    this._bindEvents();
  }

  _renderBookingCard(b) {
    const badgeClass = STATUS_BADGE_CLASS[b.status] || 'badge--secondary';
    const transitions = TRANSITIONS[b.status] || [];

    return `
      <div class="js-booking-card" data-id="${escapeHTML(b.id)}" style="background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--radius-lg); padding: var(--sp-4); cursor: pointer;" onmouseover="this.style.borderColor='var(--c-primary)'" onmouseout="this.style.borderColor=''">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: var(--sp-2);">
          <div>
            <div style="display: flex; align-items: center; gap: var(--sp-2); margin-bottom: var(--sp-1);">
              <strong style="font-size: var(--text-sm);">${escapeHTML(b.title)}</strong>
              <span class="badge ${badgeClass}" style="font-size: 10px;">${escapeHTML(STATUS_LABELS[b.status] || b.status)}</span>
            </div>
            ${b.description ? `<p style="font-size: var(--text-xs); color: var(--c-text-muted); margin: 0 0 var(--sp-1) 0;">${escapeHTML(b.description.length > 100 ? b.description.slice(0, 100) + '...' : b.description)}</p>` : ''}
          </div>
          <div style="text-align: right; flex-shrink: 0;">
            <div style="font-size: var(--text-sm); font-weight: var(--fw-semibold);">$${(b.totalAmount || 0).toFixed(2)}</div>
            <div style="font-size: var(--text-xs); color: var(--c-text-muted);">${relativeTime(b.updatedAt)}</div>
          </div>
        </div>
        <div style="display: flex; gap: var(--sp-2); flex-wrap: wrap; align-items: center;">
          ${b.scheduledDate ? `<span style="font-size: var(--text-xs); color: var(--c-text-muted);">Scheduled: ${escapeHTML(b.scheduledDate)}</span>` : ''}
          <span style="font-size: var(--text-xs); color: var(--c-text-muted);">${(b.items || []).length} item${(b.items || []).length !== 1 ? 's' : ''}</span>
          ${b.rescheduleCount ? `<span style="font-size: var(--text-xs); color: var(--c-text-muted);">Rescheduled: ${b.rescheduleCount}x</span>` : ''}
          <div style="margin-left: auto; display: flex; gap: var(--sp-1);">
            ${transitions.map(t => `
              <button class="btn ${t.btnClass} btn--sm js-transition" data-id="${escapeHTML(b.id)}" data-to="${escapeHTML(t.to)}" type="button" onclick="event.stopPropagation()">
                ${escapeHTML(t.label)}
              </button>
            `).join('')}
            ${['draft', 'pending', 'approved'].includes(b.status) ? `<button class="btn btn--secondary btn--sm js-reschedule" data-id="${escapeHTML(b.id)}" type="button" onclick="event.stopPropagation()">Reschedule</button>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  _renderDetail(b) {
    const badgeClass = STATUS_BADGE_CLASS[b.status] || 'badge--secondary';
    const transitions = TRANSITIONS[b.status] || [];

    return `
      <div style="margin-bottom: var(--sp-4);">
        <button class="btn btn--ghost btn--sm js-back-to-list" type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
          Back to Bookings
        </button>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: var(--sp-6); flex-wrap: wrap; gap: var(--sp-3);">
        <div>
          <div style="display: flex; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-2);">
            <h2 style="font-size: var(--text-xl); font-weight: var(--fw-bold); margin: 0;">${escapeHTML(b.title)}</h2>
            <span class="badge ${badgeClass}">${escapeHTML(STATUS_LABELS[b.status] || b.status)}</span>
          </div>
          ${b.description ? `<p style="color: var(--c-text-muted); font-size: var(--text-sm); margin: 0;">${escapeHTML(b.description)}</p>` : ''}
          ${b.scheduledDate ? `<p style="font-size: var(--text-sm); margin: var(--sp-1) 0 0 0;">Scheduled: <strong>${escapeHTML(b.scheduledDate)}</strong></p>` : ''}
          <p style="font-size: var(--text-xs); color: var(--c-text-muted); margin: var(--sp-1) 0 0 0;">Created ${formatDateTime(b.createdAt)}</p>
        </div>
        <div style="display: flex; gap: var(--sp-2); flex-wrap: wrap;">
          ${transitions.map(t => `
            <button class="btn ${t.btnClass} btn--sm js-transition" data-id="${escapeHTML(b.id)}" data-to="${escapeHTML(t.to)}" type="button">${escapeHTML(t.label)}</button>
          `).join('')}
          ${['draft', 'pending', 'approved'].includes(b.status) ? `<button class="btn btn--secondary btn--sm js-reschedule" data-id="${escapeHTML(b.id)}" type="button">Reschedule</button>` : ''}
          <button class="btn btn--secondary btn--sm js-print-receipt" data-id="${escapeHTML(b.id)}" type="button">Print Receipt</button>
          ${b.status === 'draft' ? `<button class="btn btn--danger btn--sm js-delete-booking" data-id="${escapeHTML(b.id)}" type="button">Delete</button>` : ''}
        </div>
      </div>

      <!-- Items -->
      <div style="background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--radius-lg); margin-bottom: var(--sp-6); overflow: hidden;">
        <div style="padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--c-border); background: var(--c-surface-alt, var(--c-bg));">
          <strong style="font-size: var(--text-sm);">Items</strong>
        </div>
        ${(b.items || []).length === 0 ? `
          <div style="padding: var(--sp-4); text-align: center; color: var(--c-text-muted); font-size: var(--text-sm);">No items.</div>
        ` : `
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="border-bottom: 1px solid var(--c-border);">
                <th style="text-align: left; padding: var(--sp-2) var(--sp-4); font-size: var(--text-xs); font-weight: var(--fw-semibold);">Item</th>
                <th style="text-align: right; padding: var(--sp-2) var(--sp-4); font-size: var(--text-xs); font-weight: var(--fw-semibold);">Qty</th>
                <th style="text-align: right; padding: var(--sp-2) var(--sp-4); font-size: var(--text-xs); font-weight: var(--fw-semibold);">Price</th>
                <th style="text-align: right; padding: var(--sp-2) var(--sp-4); font-size: var(--text-xs); font-weight: var(--fw-semibold);">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              ${b.items.map(item => `
                <tr style="border-bottom: 1px solid var(--c-border);">
                  <td style="padding: var(--sp-2) var(--sp-4); font-size: var(--text-sm);">${escapeHTML(item.name || item.description || '')}</td>
                  <td style="padding: var(--sp-2) var(--sp-4); font-size: var(--text-sm); text-align: right;">${item.quantity || 1}</td>
                  <td style="padding: var(--sp-2) var(--sp-4); font-size: var(--text-sm); text-align: right;">$${(item.unitPrice || 0).toFixed(2)}</td>
                  <td style="padding: var(--sp-2) var(--sp-4); font-size: var(--text-sm); text-align: right; font-weight: var(--fw-semibold);">$${((item.quantity || 1) * (item.unitPrice || 0)).toFixed(2)}</td>
                </tr>
              `).join('')}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="3" style="padding: var(--sp-2) var(--sp-4); text-align: right; font-weight: var(--fw-bold); font-size: var(--text-sm);">Total:</td>
                <td style="padding: var(--sp-2) var(--sp-4); text-align: right; font-weight: var(--fw-bold); font-size: var(--text-base);">$${(b.totalAmount || 0).toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        `}
      </div>

      <!-- Status History Timeline -->
      <div style="background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--radius-lg); overflow: hidden;">
        <div style="padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--c-border); background: var(--c-surface-alt, var(--c-bg));">
          <strong style="font-size: var(--text-sm);">Status History</strong>
        </div>
        <div style="padding: var(--sp-4);">
          ${(b.statusHistory || []).map((entry, idx) => {
            const isLast = idx === b.statusHistory.length - 1;
            return `
              <div style="display: flex; gap: var(--sp-3); position: relative; padding-bottom: ${isLast ? '0' : 'var(--sp-4)'};">
                <div style="display: flex; flex-direction: column; align-items: center; flex-shrink: 0;">
                  <div style="width: 12px; height: 12px; border-radius: 50%; background: ${isLast ? 'var(--c-primary)' : 'var(--c-border)'}; flex-shrink: 0;"></div>
                  ${!isLast ? `<div style="width: 2px; flex: 1; background: var(--c-border); margin-top: 4px;"></div>` : ''}
                </div>
                <div style="padding-bottom: var(--sp-1);">
                  <div style="font-size: var(--text-sm); font-weight: var(--fw-medium);">${escapeHTML(STATUS_LABELS[entry.status] || entry.status)}</div>
                  <div style="font-size: var(--text-xs); color: var(--c-text-muted);">${formatDateTime(entry.timestamp)}</div>
                  ${entry.note ? `<div style="font-size: var(--text-xs); color: var(--c-text-muted); margin-top: 2px;">${escapeHTML(entry.note)}</div>` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
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
    this.delegate('click', '.js-menu-logout', async () => { await logout(); router.navigate('/login'); });
    document.addEventListener('click', this._handleOutsideClick = (e) => {
      if (this.state.userMenuOpen && !e.target.closest('.user-menu')) {
        this.setState({ userMenuOpen: false });
      }
    });

    // Status filter
    this.delegate('click', '.js-status-filter', (e, target) => {
      const status = target.dataset.status;
      if (status !== this.state.statusFilter) {
        this.state.statusFilter = status;
        this.state.loading = true;
        this.render();
        this._loadBookings();
      }
    });

    // Booking card click -> detail
    this.delegate('click', '.js-booking-card', async (e, target) => {
      const id = target.dataset.id;
      try {
        const booking = await bookingService.getBooking(id);
        if (booking) this.setState({ detailBooking: booking });
      } catch (err) { showToast(err.message, { type: 'error' }); }
    });

    // Back to list
    this.delegate('click', '.js-back-to-list', () => {
      this.setState({ detailBooking: null });
      this._loadBookings();
    });

    // Create booking
    this.delegate('click', '.js-create-booking', () => this._openCreateBookingModal());

    // Transition — enforce policies before cancel/reschedule
    this.delegate('click', '.js-transition', async (e, target) => {
      const id = target.dataset.id;
      const to = target.dataset.to;
      const label = target.textContent.trim();

      // Policy check for cancellation
      if (to === 'canceled') {
        try {
          const policy = await bookingService.checkCancellationPolicy(id);
          if (!policy.allowed) {
            showToast(`Cannot cancel: ${policy.reason}`, { type: 'error', duration: 6000 });
            return;
          }
          const feeMsg = policy.fee > 0 ? ` A cancellation fee of $${policy.fee.toFixed(2)} applies.` : '';
          const ok = await confirmDialog({
            title: 'Cancel Booking',
            message: `${policy.reason}.${feeMsg} Proceed?`,
            danger: true,
            confirmText: 'Cancel Booking'
          });
          if (!ok) return;
        } catch (err) {
          showToast(err.message, { type: 'error' });
          return;
        }
      } else if (to === 'refunding-marked') {
        const ok = await confirmDialog({ title: label, message: `Are you sure you want to request a refund?`, danger: true, confirmText: label });
        if (!ok) return;
      }

      try {
        const updated = await bookingService.transitionStatus(id, to, label);
        showToast(`Booking ${STATUS_LABELS[to] || to}`, { type: 'success' });
        if (this.state.detailBooking?.id === id) {
          this.setState({ detailBooking: updated });
        }
        await this._loadBookings();
      } catch (err) { showToast(err.message, { type: 'error' }); }
    });

    // Reschedule — check reschedule policy then prompt for new date
    this.delegate('click', '.js-reschedule', async (e, target) => {
      const id = target.dataset.id;
      try {
        const policy = await bookingService.checkReschedulePolicy(id);
        if (!policy.allowed) {
          showToast(`Cannot reschedule: ${policy.reason}`, { type: 'error', duration: 6000 });
          return;
        }
        const feeMsg = policy.fee > 0 ? `\nA reschedule fee of $${policy.fee.toFixed(2)} applies.` : '';
        const ok = await confirmDialog({
          title: 'Reschedule Booking',
          message: `${policy.reason}.${feeMsg}\n\nProceed to pick a new date?`,
          confirmText: 'Reschedule'
        });
        if (!ok) return;
        this._openRescheduleModal(id);
      } catch (err) {
        showToast(err.message, { type: 'error' });
      }
    });

    // Print receipt
    this.delegate('click', '.js-print-receipt', async (e, target) => {
      const id = target.dataset.id;
      try {
        const html = await bookingService.generateReceipt(id);
        const win = window.open('', '_blank');
        if (win) {
          win.document.write(html);
          win.document.close();
        } else {
          showToast('Popup blocked. Please allow popups.', { type: 'warning' });
        }
      } catch (err) { showToast(err.message, { type: 'error' }); }
    });

    // Delete booking
    this.delegate('click', '.js-delete-booking', async (e, target) => {
      const id = target.dataset.id;
      const ok = await confirmDialog({ title: 'Delete Booking', message: 'Permanently delete this draft booking?', danger: true, confirmText: 'Delete' });
      if (ok) {
        try {
          await bookingService.deleteBooking(id);
          showToast('Booking deleted', { type: 'success' });
          this.setState({ detailBooking: null });
          await this._loadBookings();
        } catch (err) { showToast(err.message, { type: 'error' }); }
      }
    });

    // Export CSV
    this.delegate('click', '.js-export-csv', async () => {
      try {
        const opts = {};
        if (this.state.statusFilter !== 'all') opts.status = this.state.statusFilter;
        const csv = await bookingService.exportBookingsCSV(opts);
        const blob = new Blob([csv], { type: 'text/csv' });
        downloadBlob(blob, 'bookings.csv');
        showToast('CSV exported', { type: 'success' });
      } catch (err) { showToast(err.message, { type: 'error' }); }
    });
  }

  _openCreateBookingModal() {
    this._modal = new Modal({
      title: 'Create Booking',
      size: 'lg',
      content: `
        <div class="form-group">
          <label class="form-label">Title <span style="color: var(--c-danger)">*</span></label>
          <input class="form-input js-bk-title" type="text" placeholder="Booking title" style="width: 100%;" />
        </div>
        <div class="form-group">
          <label class="form-label">Description</label>
          <textarea class="form-input js-bk-desc" rows="2" placeholder="Optional description" style="width: 100%; resize: vertical;"></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Scheduled Date</label>
          <input class="form-input js-bk-date" type="date" style="width: auto;" />
        </div>
        <div class="form-group">
          <label class="form-label">Items</label>
          <div class="js-bk-items" style="display: flex; flex-direction: column; gap: var(--sp-2); margin-bottom: var(--sp-2);"></div>
          <button class="btn btn--ghost btn--sm js-bk-add-item" type="button">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Item
          </button>
        </div>
      `,
      footer: `
        <button class="btn btn--secondary js-modal-cancel" type="button">Cancel</button>
        <button class="btn btn--primary js-modal-save" type="button">Create</button>
      `,
      closable: true,
      onClose: () => { this._modal = null; }
    });
    this._modal.render();

    const itemsContainer = this._modal.el.querySelector('.js-bk-items');
    let itemCount = 0;

    const addItemRow = () => {
      const row = document.createElement('div');
      row.style.cssText = 'display: flex; gap: var(--sp-2); align-items: center;';
      row.innerHTML = `
        <input class="form-input js-item-name" type="text" placeholder="Item name" style="flex: 2;" />
        <input class="form-input js-item-qty" type="number" min="1" value="1" placeholder="Qty" style="width: 60px;" />
        <input class="form-input js-item-price" type="number" min="0" step="0.01" value="0" placeholder="Price" style="width: 80px;" />
        <button class="btn btn--ghost btn--sm js-remove-item-row" type="button" style="color: var(--c-danger); flex-shrink: 0;">&times;</button>
      `;
      row.querySelector('.js-remove-item-row').addEventListener('click', () => row.remove());
      itemsContainer.appendChild(row);
      itemCount++;
    };

    // Add one initial item row
    addItemRow();

    this._modal.el.querySelector('.js-bk-add-item').addEventListener('click', addItemRow);

    const titleInput = this._modal.el.querySelector('.js-bk-title');
    requestAnimationFrame(() => titleInput?.focus());

    this._modal.el.querySelector('.js-modal-cancel').addEventListener('click', () => this._modal.close());
    this._modal.el.querySelector('.js-modal-save').addEventListener('click', async () => {
      const title = titleInput?.value?.trim();
      if (!title) { showToast('Title is required', { type: 'warning' }); return; }
      const description = this._modal.el.querySelector('.js-bk-desc')?.value?.trim() || '';
      const scheduledDate = this._modal.el.querySelector('.js-bk-date')?.value || null;

      const itemRows = itemsContainer.querySelectorAll('div');
      const items = [];
      let totalAmount = 0;
      itemRows.forEach(row => {
        const name = row.querySelector('.js-item-name')?.value?.trim();
        const quantity = parseFloat(row.querySelector('.js-item-qty')?.value) || 1;
        const unitPrice = parseFloat(row.querySelector('.js-item-price')?.value) || 0;
        if (name) {
          items.push({ name, quantity, unitPrice });
          totalAmount += quantity * unitPrice;
        }
      });

      try {
        const booking = await bookingService.createBooking({
          title,
          description,
          scheduledDate,
          items,
          totalAmount: Math.round(totalAmount * 100) / 100
        });
        showToast('Booking created', { type: 'success' });
        this._modal.close();
        await this._loadBookings();
      } catch (err) { showToast(err.message, { type: 'error' }); }
    });
  }

  _openRescheduleModal(bookingId) {
    this._modal = new Modal({
      title: 'Reschedule Booking',
      content: `
        <div class="form-group" style="margin-bottom: 0;">
          <label class="form-label">New Scheduled Date</label>
          <input class="form-input js-resched-date" type="date" style="width: auto;" />
        </div>
      `,
      footer: `
        <button class="btn btn--secondary js-modal-cancel" type="button">Cancel</button>
        <button class="btn btn--primary js-modal-save" type="button">Reschedule</button>
      `,
      closable: true,
      onClose: () => { this._modal = null; }
    });
    this._modal.render();
    this._modal.el.querySelector('.js-modal-cancel').addEventListener('click', () => this._modal.close());
    this._modal.el.querySelector('.js-modal-save').addEventListener('click', async () => {
      const newDate = this._modal.el.querySelector('.js-resched-date')?.value;
      if (!newDate) { showToast('Please select a date', { type: 'warning' }); return; }
      try {
        const booking = await bookingService.getBooking(bookingId);
        if (!booking) throw new Error('Booking not found');
        // Update scheduledDate and increment rescheduleCount (only works on draft)
        if (booking.status === 'draft') {
          await bookingService.updateBooking(bookingId, {
            scheduledDate: newDate,
            rescheduleCount: (booking.rescheduleCount || 0) + 1
          });
        } else {
          // For non-draft, directly update in DB since updateBooking restricts to draft
          booking.scheduledDate = newDate;
          booking.rescheduleCount = (booking.rescheduleCount || 0) + 1;
          booking.updatedAt = Date.now();
          const { db } = await import('../../core/db.js');
          await db.put('bookings', booking);
        }
        showToast(`Booking rescheduled to ${newDate}`, { type: 'success' });
        this._modal.close();
        if (this.state.detailBooking?.id === bookingId) {
          const updated = await bookingService.getBooking(bookingId);
          this.setState({ detailBooking: updated });
        }
        await this._loadBookings();
      } catch (err) { showToast(err.message, { type: 'error' }); }
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
