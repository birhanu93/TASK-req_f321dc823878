import { Component } from '../../core/component.js';
import { store } from '../../core/store.js';
import { bus } from '../../core/event-bus.js';
import { router } from '../../core/router.js';
import { escapeHTML, formatDateTime, relativeTime, uuid, now, downloadBlob } from '../../core/utils.js';
import { Modal } from '../components/modal.js';
import { showToast } from '../components/toast.js';
import { confirmDialog } from '../components/confirm-dialog.js';
import { storage, STORAGE_KEYS } from '../../core/storage.js';
import { logout } from '../../services/auth-service.js';
import { opsService } from '../../services/ops-service.js';
import { sensitiveWordService } from '../../services/sensitive-word-service.js';
import { bookingService } from '../../services/booking-service.js';

const SECTIONS = ['announcements', 'templates', 'sensitive-words', 'rules', 'analytics', 'canary-flags', 'booking-policies'];
const SECTION_LABELS = {
  'announcements': 'Announcements',
  'templates': 'Templates',
  'sensitive-words': 'Sensitive Words',
  'rules': 'Rules',
  'analytics': 'Analytics',
  'canary-flags': 'Canary Flags',
  'booking-policies': 'Booking Policies'
};

export class OpsConsolePage extends Component {
  constructor(container, props) {
    super(container, props);
    const currentUser = store.get('currentUser');
    this.state = {
      role: store.get('role') || storage.get(STORAGE_KEYS.ROLE, 'user'),
      currentUser,
      section: props.section || 'announcements',
      unreadCount: 0,
      userMenuOpen: false,
      // Announcements
      announcements: [],
      announcementForm: null,
      // Templates
      templates: [],
      templateCategory: '',
      draggedTemplateId: null,
      // Sensitive Words
      words: [],
      newWord: '',
      newWordSeverity: 'warn',
      // Rules
      rules: [],
      // Analytics
      events: [],
      funnelData: [],
      analyticsDateFrom: '',
      analyticsDateTo: '',
      // Canary Flags
      flags: [],
      newFlagKey: '',
      newFlagDescription: '',
      // Booking Policies
      cancellationPolicy: null,
      reschedulePolicy: null,
      policyMessage: null
    };
    this._modal = null;
  }

  mount() {
    super.mount();
    this._loadSectionData();
    this.subscribeTo('ops:announcement-created', () => this._loadAnnouncements());
    this.subscribeTo('ops:announcement-updated', () => this._loadAnnouncements());
  }

  async _loadSectionData() {
    const section = this.state.section;
    if (section === 'announcements') await this._loadAnnouncements();
    else if (section === 'templates') await this._loadTemplates();
    else if (section === 'sensitive-words') await this._loadWords();
    else if (section === 'rules') await this._loadRules();
    else if (section === 'analytics') await this._loadAnalytics();
    else if (section === 'canary-flags') await this._loadFlags();
    else if (section === 'booking-policies') await this._loadPolicies();
  }

  async _loadAnnouncements() {
    try {
      const announcements = await opsService.listAnnouncements();
      this.setState({ announcements });
    } catch { this.setState({ announcements: [] }); }
  }

  async _loadTemplates() {
    try {
      const cat = this.state.templateCategory || undefined;
      const templates = await opsService.listTemplates(cat);
      this.setState({ templates });
    } catch { this.setState({ templates: [] }); }
  }

  async _loadWords() {
    try {
      const words = await sensitiveWordService.getWords();
      this.setState({ words });
    } catch { this.setState({ words: [] }); }
  }

  async _loadRules() {
    try {
      const rules = await opsService.listRules(null, true);
      this.setState({ rules });
    } catch { this.setState({ rules: [] }); }
  }

  async _loadAnalytics() {
    try {
      const opts = {};
      if (this.state.analyticsDateFrom) opts.since = new Date(this.state.analyticsDateFrom).getTime();
      if (this.state.analyticsDateTo) opts.until = new Date(this.state.analyticsDateTo).getTime() + 86400000;
      const events = await opsService.getEvents(opts);
      const funnelSteps = ['room_created', 'first_whiteboard_edit', 'first_comment'];
      const funnelData = await opsService.getFunnelData(funnelSteps);
      this.setState({ events, funnelData });
    } catch { this.setState({ events: [], funnelData: [] }); }
  }

  async _loadFlags() {
    try {
      const flags = await opsService.listFlags();
      this.setState({ flags });
    } catch { this.setState({ flags: [] }); }
  }

  async _loadPolicies() {
    try {
      const cancellationPolicy = await bookingService.getPolicy('cancellation');
      const reschedulePolicy = await bookingService.getPolicy('reschedule');
      this.setState({ cancellationPolicy: cancellationPolicy || null, reschedulePolicy: reschedulePolicy || null, policyMessage: null });
    } catch {
      this.setState({ cancellationPolicy: null, reschedulePolicy: null, policyMessage: null });
    }
  }

  _renderAppShell(mainContent) {
    const { role, currentUser, unreadCount, userMenuOpen, section } = this.state;
    const currentPath = router.getCurrentPath();
    const displayName = currentUser?.displayName || currentUser?.username || 'User';
    const avatarLetter = displayName.charAt(0).toUpperCase();

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
    const { role, section } = this.state;

    if (role !== 'ops') {
      this.container.innerHTML = this._renderAppShell(`
        <div class="empty-state">
          <div class="empty-state__icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          </div>
          <div class="empty-state__title">Ops Console</div>
          <p style="color: var(--c-text-muted); font-size: var(--text-sm); margin-bottom: var(--sp-4)">Switch to the Ops role to access the administration console.</p>
          <button class="btn btn--primary js-role-toggle" type="button">Switch to Ops</button>
        </div>
      `);
      this._bindEvents();
      return;
    }

    const sectionContent = this._renderSection(section);

    this.container.innerHTML = this._renderAppShell(`
      <div class="page-header">
        <div>
          <h1 class="page-title">Ops Console</h1>
          <p class="page-subtitle">${escapeHTML(SECTION_LABELS[section] || 'Announcements')}</p>
        </div>
      </div>
      <div style="display: flex; gap: var(--sp-2); margin-bottom: var(--sp-6); flex-wrap: wrap;">
        ${SECTIONS.map(s => `
          <button class="btn ${section === s ? 'btn--primary' : 'btn--secondary'} btn--sm js-section-tab" data-section="${s}" type="button">
            ${escapeHTML(SECTION_LABELS[s])}
          </button>
        `).join('')}
      </div>
      <div class="ops-section-content">
        ${sectionContent}
      </div>
    `);

    this._bindEvents();
  }

  _renderSection(section) {
    switch (section) {
      case 'announcements': return this._renderAnnouncements();
      case 'templates': return this._renderTemplates();
      case 'sensitive-words': return this._renderSensitiveWords();
      case 'rules': return this._renderRules();
      case 'analytics': return this._renderAnalytics();
      case 'canary-flags': return this._renderCanaryFlags();
      case 'booking-policies': return this._renderBookingPolicies();
      default: return this._renderAnnouncements();
    }
  }

  // ── Announcements ──────────────────────────────────────────────

  _renderAnnouncements() {
    const { announcements, announcementForm } = this.state;

    const formHTML = announcementForm ? `
      <div style="background: var(--c-surface-alt, var(--c-bg)); border: 1px solid var(--c-border); border-radius: var(--radius-lg); padding: var(--sp-4); margin-bottom: var(--sp-4);">
        <h3 style="margin-bottom: var(--sp-3); font-size: var(--text-base); font-weight: var(--fw-semibold);">${announcementForm.id ? 'Edit' : 'Create'} Announcement</h3>
        <div class="form-group">
          <label class="form-label">Title</label>
          <input class="form-input js-ann-title" type="text" value="${escapeHTML(announcementForm.title || '')}" placeholder="Announcement title" style="width: 100%" />
        </div>
        <div class="form-group">
          <label class="form-label">Body</label>
          <textarea class="form-input js-ann-body" rows="3" placeholder="Announcement body" style="width: 100%; resize: vertical">${escapeHTML(announcementForm.body || '')}</textarea>
        </div>
        <div style="display: flex; gap: var(--sp-3); flex-wrap: wrap;">
          <div class="form-group" style="flex: 1; min-width: 120px">
            <label class="form-label">Background Color</label>
            <input class="form-input js-ann-bg" type="color" value="${announcementForm.bgColor || '#1e40af'}" />
          </div>
          <div class="form-group" style="flex: 1; min-width: 120px">
            <label class="form-label">Text Color</label>
            <input class="form-input js-ann-text-color" type="color" value="${announcementForm.textColor || '#ffffff'}" />
          </div>
          <div class="form-group" style="flex: 1; min-width: 120px">
            <label class="form-label">Active</label>
            <label style="display: flex; align-items: center; gap: var(--sp-2); cursor: pointer;">
              <input type="checkbox" class="js-ann-active" ${announcementForm.active !== false ? 'checked' : ''} />
              <span>Show banner</span>
            </label>
          </div>
        </div>
        <div style="margin-bottom: var(--sp-3);">
          <label class="form-label">Preview</label>
          <div class="js-ann-preview" style="padding: var(--sp-3) var(--sp-4); border-radius: var(--radius-md); background: ${escapeHTML(announcementForm.bgColor || '#1e40af')}; color: ${escapeHTML(announcementForm.textColor || '#ffffff')};">
            <strong>${escapeHTML(announcementForm.title || 'Title')}</strong>
            <span style="margin-left: var(--sp-2)">${escapeHTML(announcementForm.body || 'Body text')}</span>
          </div>
        </div>
        <div style="display: flex; gap: var(--sp-2); justify-content: flex-end;">
          <button class="btn btn--secondary btn--sm js-ann-cancel" type="button">Cancel</button>
          <button class="btn btn--primary btn--sm js-ann-save" type="button">${announcementForm.id ? 'Update' : 'Create'}</button>
        </div>
      </div>
    ` : '';

    return `
      <div style="display: flex; justify-content: flex-end; margin-bottom: var(--sp-4);">
        <button class="btn btn--primary btn--sm js-ann-new" type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Announcement
        </button>
      </div>
      ${formHTML}
      ${announcements.length === 0 ? `
        <div class="empty-state">
          <div class="empty-state__title">No announcements</div>
          <p style="color: var(--c-text-muted); font-size: var(--text-sm)">Create your first announcement to display a banner.</p>
        </div>
      ` : `
        <div style="display: flex; flex-direction: column; gap: var(--sp-3);">
          ${announcements.map(a => `
            <div style="background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--radius-lg); padding: var(--sp-4); display: flex; align-items: flex-start; gap: var(--sp-3);" data-id="${escapeHTML(a.id)}">
              <div style="width: 24px; height: 24px; border-radius: var(--radius-sm); background: ${escapeHTML(a.bgColor)}; flex-shrink: 0; border: 1px solid var(--c-border);"></div>
              <div style="flex: 1; min-width: 0;">
                <div style="display: flex; align-items: center; gap: var(--sp-2); margin-bottom: var(--sp-1);">
                  <strong style="font-size: var(--text-sm);">${escapeHTML(a.title)}</strong>
                  <span class="badge ${a.active ? 'badge--success' : 'badge--secondary'}" style="font-size: 10px;">${a.active ? 'Active' : 'Inactive'}</span>
                </div>
                <p style="font-size: var(--text-sm); color: var(--c-text-muted); margin: 0;">${escapeHTML(a.body || '')}</p>
                <span style="font-size: var(--text-xs); color: var(--c-text-muted);">${relativeTime(a.createdAt)}</span>
              </div>
              <div style="display: flex; gap: var(--sp-1); flex-shrink: 0;">
                <button class="btn btn--ghost btn--sm js-ann-edit" data-id="${escapeHTML(a.id)}" type="button">Edit</button>
                <button class="btn btn--ghost btn--sm js-ann-delete" data-id="${escapeHTML(a.id)}" type="button" style="color: var(--c-danger)">Delete</button>
              </div>
            </div>
          `).join('')}
        </div>
      `}
    `;
  }

  // ── Templates ──────────────────────────────────────────────────

  _renderTemplates() {
    const { templates, templateCategory } = this.state;
    const categories = [...new Set(templates.map(t => t.category).filter(Boolean))];

    return `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--sp-4); flex-wrap: wrap; gap: var(--sp-2);">
        <div style="display: flex; gap: var(--sp-2); align-items: center;">
          <label class="form-label" style="margin: 0;">Category:</label>
          <select class="form-input js-tpl-category" style="width: auto; min-width: 140px;">
            <option value="">All</option>
            ${categories.map(c => `<option value="${escapeHTML(c)}" ${templateCategory === c ? 'selected' : ''}>${escapeHTML(c)}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn--primary btn--sm js-tpl-new" type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Template
        </button>
      </div>
      ${templates.length === 0 ? `
        <div class="empty-state">
          <div class="empty-state__title">No templates</div>
          <p style="color: var(--c-text-muted); font-size: var(--text-sm)">Create templates for common board layouts.</p>
        </div>
      ` : `
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: var(--sp-4);">
          ${templates.map(t => `
            <div class="room-card js-tpl-card" draggable="true" data-id="${escapeHTML(t.id)}" style="cursor: grab;">
              <div style="height: 80px; background: var(--c-surface-alt, var(--c-bg)); border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center; margin-bottom: var(--sp-2); overflow: hidden;">
                ${t.thumbnail
                  ? `<img src="${escapeHTML(t.thumbnail)}" alt="" style="width: 100%; height: 100%; object-fit: cover;" />`
                  : `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--c-text-muted)" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>`
                }
              </div>
              <div style="font-size: var(--text-sm); font-weight: var(--fw-semibold); margin-bottom: var(--sp-1);">${escapeHTML(t.name)}</div>
              <div style="font-size: var(--text-xs); color: var(--c-text-muted); margin-bottom: var(--sp-2);">${escapeHTML(t.category || 'Uncategorized')}</div>
              <div style="display: flex; gap: var(--sp-1);">
                <button class="btn btn--ghost btn--sm js-tpl-edit" data-id="${escapeHTML(t.id)}" type="button">Edit</button>
                <button class="btn btn--ghost btn--sm js-tpl-delete" data-id="${escapeHTML(t.id)}" type="button" style="color: var(--c-danger)">Delete</button>
              </div>
            </div>
          `).join('')}
        </div>
      `}
    `;
  }

  // ── Sensitive Words ────────────────────────────────────────────

  _renderSensitiveWords() {
    const { words, newWord, newWordSeverity } = this.state;

    return `
      <div style="background: var(--c-surface-alt, var(--c-bg)); border: 1px solid var(--c-border); border-radius: var(--radius-lg); padding: var(--sp-4); margin-bottom: var(--sp-4);">
        <h3 style="margin-bottom: var(--sp-3); font-size: var(--text-sm); font-weight: var(--fw-semibold);">Add Sensitive Word</h3>
        <div style="display: flex; gap: var(--sp-2); align-items: flex-end; flex-wrap: wrap;">
          <div class="form-group" style="flex: 1; min-width: 150px; margin: 0;">
            <label class="form-label">Word</label>
            <input class="form-input js-sw-word" type="text" value="${escapeHTML(newWord)}" placeholder="Enter word or phrase" style="width: 100%;" />
          </div>
          <div class="form-group" style="min-width: 100px; margin: 0;">
            <label class="form-label">Severity</label>
            <select class="form-input js-sw-severity" style="width: auto;">
              <option value="warn" ${newWordSeverity === 'warn' ? 'selected' : ''}>Warn</option>
              <option value="block" ${newWordSeverity === 'block' ? 'selected' : ''}>Block</option>
            </select>
          </div>
          <button class="btn btn--primary btn--sm js-sw-add" type="button">Add</button>
        </div>
      </div>
      ${words.length === 0 ? `
        <div class="empty-state">
          <div class="empty-state__title">No sensitive words configured</div>
          <p style="color: var(--c-text-muted); font-size: var(--text-sm)">Add words to filter from messages.</p>
        </div>
      ` : `
        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="border-bottom: 2px solid var(--c-border);">
                <th style="text-align: left; padding: var(--sp-2) var(--sp-3); font-size: var(--text-sm); font-weight: var(--fw-semibold);">Word</th>
                <th style="text-align: left; padding: var(--sp-2) var(--sp-3); font-size: var(--text-sm); font-weight: var(--fw-semibold);">Severity</th>
                <th style="text-align: left; padding: var(--sp-2) var(--sp-3); font-size: var(--text-sm); font-weight: var(--fw-semibold);">Added</th>
                <th style="text-align: right; padding: var(--sp-2) var(--sp-3); font-size: var(--text-sm); font-weight: var(--fw-semibold);">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${words.map(w => `
                <tr style="border-bottom: 1px solid var(--c-border);" data-id="${escapeHTML(w.id)}">
                  <td style="padding: var(--sp-2) var(--sp-3); font-size: var(--text-sm);">${escapeHTML(w.word)}</td>
                  <td style="padding: var(--sp-2) var(--sp-3);">
                    <span class="badge ${w.severity === 'block' ? 'badge--danger' : 'badge--warning'}" style="font-size: 10px;">${escapeHTML(w.severity || 'warn')}</span>
                  </td>
                  <td style="padding: var(--sp-2) var(--sp-3); font-size: var(--text-xs); color: var(--c-text-muted);">${w.createdAt ? relativeTime(w.createdAt) : '-'}</td>
                  <td style="padding: var(--sp-2) var(--sp-3); text-align: right;">
                    <button class="btn btn--ghost btn--sm js-sw-delete" data-id="${escapeHTML(w.id)}" type="button" style="color: var(--c-danger);">Delete</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    `;
  }

  // ── Rules ──────────────────────────────────────────────────────

  _renderRules() {
    const { rules } = this.state;

    return `
      <div style="display: flex; justify-content: flex-end; margin-bottom: var(--sp-4);">
        <button class="btn btn--primary btn--sm js-rule-new" type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Rule
        </button>
      </div>
      ${rules.length === 0 ? `
        <div class="empty-state">
          <div class="empty-state__title">No rules configured</div>
          <p style="color: var(--c-text-muted); font-size: var(--text-sm)">Create rules to govern room behavior.</p>
        </div>
      ` : `
        <div style="display: flex; flex-direction: column; gap: var(--sp-3);">
          ${rules.map(r => `
            <div style="background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--radius-lg); padding: var(--sp-4); display: flex; align-items: flex-start; gap: var(--sp-3);">
              <label style="flex-shrink: 0; cursor: pointer; margin-top: 2px;">
                <input type="checkbox" class="js-rule-toggle" data-id="${escapeHTML(r.id)}" ${r.active ? 'checked' : ''} />
              </label>
              <div style="flex: 1; min-width: 0;">
                <div style="display: flex; align-items: center; gap: var(--sp-2); margin-bottom: var(--sp-1);">
                  <strong style="font-size: var(--text-sm);">${escapeHTML(r.title)}</strong>
                  ${r.category ? `<span class="badge badge--secondary" style="font-size: 10px;">${escapeHTML(r.category)}</span>` : ''}
                </div>
                <p style="font-size: var(--text-sm); color: var(--c-text-muted); margin: 0;">${escapeHTML(r.body || '')}</p>
                <span style="font-size: var(--text-xs); color: var(--c-text-muted);">${relativeTime(r.createdAt)}</span>
              </div>
              <div style="display: flex; gap: var(--sp-1); flex-shrink: 0;">
                <button class="btn btn--ghost btn--sm js-rule-edit" data-id="${escapeHTML(r.id)}" type="button">Edit</button>
                <button class="btn btn--ghost btn--sm js-rule-delete" data-id="${escapeHTML(r.id)}" type="button" style="color: var(--c-danger)">Delete</button>
              </div>
            </div>
          `).join('')}
        </div>
      `}
    `;
  }

  // ── Analytics ──────────────────────────────────────────────────

  _renderAnalytics() {
    const { events, funnelData, analyticsDateFrom, analyticsDateTo } = this.state;
    const maxCount = funnelData.reduce((m, f) => Math.max(m, f.count), 1);

    return `
      <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: var(--sp-4); flex-wrap: wrap; gap: var(--sp-2);">
        <div style="display: flex; gap: var(--sp-2); align-items: flex-end; flex-wrap: wrap;">
          <div class="form-group" style="margin: 0;">
            <label class="form-label">From</label>
            <input class="form-input js-analytics-from" type="date" value="${escapeHTML(analyticsDateFrom)}" style="width: auto;" />
          </div>
          <div class="form-group" style="margin: 0;">
            <label class="form-label">To</label>
            <input class="form-input js-analytics-to" type="date" value="${escapeHTML(analyticsDateTo)}" style="width: auto;" />
          </div>
          <button class="btn btn--secondary btn--sm js-analytics-filter" type="button">Filter</button>
        </div>
        <button class="btn btn--secondary btn--sm js-analytics-export" type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export
        </button>
      </div>

      <div style="background: var(--c-surface-alt, var(--c-bg)); border: 1px solid var(--c-border); border-radius: var(--radius-lg); padding: var(--sp-4); margin-bottom: var(--sp-6);">
        <h3 style="font-size: var(--text-sm); font-weight: var(--fw-semibold); margin-bottom: var(--sp-3);">Conversion Funnel</h3>
        ${funnelData.length === 0 ? `<p style="color: var(--c-text-muted); font-size: var(--text-sm);">No funnel data available.</p>` : `
          <div style="display: flex; flex-direction: column; gap: var(--sp-3);">
            ${funnelData.map(f => {
              const pct = maxCount > 0 ? Math.round((f.count / maxCount) * 100) : 0;
              const rate = Math.round(f.rate * 100);
              return `
                <div>
                  <div style="display: flex; justify-content: space-between; margin-bottom: var(--sp-1);">
                    <span style="font-size: var(--text-sm); font-weight: var(--fw-medium);">${escapeHTML(f.step)}</span>
                    <span style="font-size: var(--text-xs); color: var(--c-text-muted);">${f.count} (${rate}%)</span>
                  </div>
                  <div style="height: 20px; background: var(--c-border); border-radius: var(--radius-sm); overflow: hidden;">
                    <div style="height: 100%; width: ${pct}%; background: var(--c-primary); border-radius: var(--radius-sm); transition: width 0.3s;"></div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>

      <h3 style="font-size: var(--text-sm); font-weight: var(--fw-semibold); margin-bottom: var(--sp-3);">Event Log (${events.length})</h3>
      ${events.length === 0 ? `
        <p style="color: var(--c-text-muted); font-size: var(--text-sm);">No events recorded.</p>
      ` : `
        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="border-bottom: 2px solid var(--c-border);">
                <th style="text-align: left; padding: var(--sp-2) var(--sp-3); font-size: var(--text-sm); font-weight: var(--fw-semibold);">Event</th>
                <th style="text-align: left; padding: var(--sp-2) var(--sp-3); font-size: var(--text-sm); font-weight: var(--fw-semibold);">Session</th>
                <th style="text-align: left; padding: var(--sp-2) var(--sp-3); font-size: var(--text-sm); font-weight: var(--fw-semibold);">Properties</th>
                <th style="text-align: left; padding: var(--sp-2) var(--sp-3); font-size: var(--text-sm); font-weight: var(--fw-semibold);">Time</th>
              </tr>
            </thead>
            <tbody>
              ${events.slice(0, 100).map(e => `
                <tr style="border-bottom: 1px solid var(--c-border);">
                  <td style="padding: var(--sp-2) var(--sp-3); font-size: var(--text-sm);">${escapeHTML(e.event)}</td>
                  <td style="padding: var(--sp-2) var(--sp-3); font-size: var(--text-xs); color: var(--c-text-muted); font-family: monospace;">${escapeHTML((e.sessionId || '').slice(0, 8))}</td>
                  <td style="padding: var(--sp-2) var(--sp-3); font-size: var(--text-xs); color: var(--c-text-muted); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(JSON.stringify(e.properties || {}))}</td>
                  <td style="padding: var(--sp-2) var(--sp-3); font-size: var(--text-xs); color: var(--c-text-muted);">${formatDateTime(e.timestamp)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${events.length > 100 ? `<p style="font-size: var(--text-xs); color: var(--c-text-muted); margin-top: var(--sp-2);">Showing first 100 of ${events.length} events.</p>` : ''}
      `}
    `;
  }

  // ── Canary Flags ───────────────────────────────────────────────

  _renderCanaryFlags() {
    const { flags, newFlagKey, newFlagDescription } = this.state;

    return `
      <div style="background: var(--c-surface-alt, var(--c-bg)); border: 1px solid var(--c-border); border-radius: var(--radius-lg); padding: var(--sp-4); margin-bottom: var(--sp-4);">
        <h3 style="margin-bottom: var(--sp-3); font-size: var(--text-sm); font-weight: var(--fw-semibold);">Add Feature Flag</h3>
        <div style="display: flex; gap: var(--sp-2); align-items: flex-end; flex-wrap: wrap;">
          <div class="form-group" style="flex: 1; min-width: 150px; margin: 0;">
            <label class="form-label">Key</label>
            <input class="form-input js-flag-key" type="text" value="${escapeHTML(newFlagKey)}" placeholder="e.g. new_dashboard" style="width: 100%;" />
          </div>
          <div class="form-group" style="flex: 2; min-width: 200px; margin: 0;">
            <label class="form-label">Description</label>
            <input class="form-input js-flag-desc" type="text" value="${escapeHTML(newFlagDescription)}" placeholder="What does this flag control?" style="width: 100%;" />
          </div>
          <button class="btn btn--primary btn--sm js-flag-add" type="button">Add</button>
        </div>
      </div>
      ${flags.length === 0 ? `
        <div class="empty-state">
          <div class="empty-state__title">No feature flags</div>
          <p style="color: var(--c-text-muted); font-size: var(--text-sm)">Add canary flags to toggle features on and off.</p>
        </div>
      ` : `
        <div style="display: flex; flex-direction: column; gap: var(--sp-3);">
          ${flags.map(f => `
            <div style="background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--radius-lg); padding: var(--sp-3) var(--sp-4); display: flex; align-items: center; gap: var(--sp-3);">
              <label style="position: relative; display: inline-block; width: 40px; height: 22px; flex-shrink: 0; cursor: pointer;">
                <input type="checkbox" class="js-flag-toggle" data-key="${escapeHTML(f.key)}" ${f.enabled ? 'checked' : ''} style="opacity: 0; width: 0; height: 0;" />
                <span style="position: absolute; inset: 0; background: ${f.enabled ? 'var(--c-success)' : 'var(--c-border)'}; border-radius: 22px; transition: background 0.2s;"></span>
                <span style="position: absolute; top: 2px; left: ${f.enabled ? '20px' : '2px'}; width: 18px; height: 18px; background: white; border-radius: 50%; transition: left 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.2);"></span>
              </label>
              <div style="flex: 1; min-width: 0;">
                <div style="font-size: var(--text-sm); font-weight: var(--fw-semibold); font-family: monospace;">${escapeHTML(f.key)}</div>
                <div style="font-size: var(--text-xs); color: var(--c-text-muted);">${escapeHTML(f.description || 'No description')}</div>
              </div>
              <span class="badge ${f.enabled ? 'badge--success' : 'badge--secondary'}" style="font-size: 10px; flex-shrink: 0;">
                ${f.enabled ? 'ON' : 'OFF'}
              </span>
            </div>
          `).join('')}
        </div>
      `}
    `;
  }

  // ── Booking Policies ────────────────────────────────────────────

  _renderBookingPolicies() {
    const { cancellationPolicy, reschedulePolicy, policyMessage } = this.state;
    const cr = cancellationPolicy?.rules || {};
    const rr = reschedulePolicy?.rules || {};

    return `
      ${policyMessage ? `
        <div style="padding: var(--sp-3) var(--sp-4); border-radius: var(--radius-md); margin-bottom: var(--sp-4); background: ${policyMessage.type === 'error' ? 'var(--c-danger-bg, #fef2f2)' : 'var(--c-success-bg, #f0fdf4)'}; color: ${policyMessage.type === 'error' ? 'var(--c-danger)' : 'var(--c-success, #16a34a)'}; font-size: var(--text-sm); border: 1px solid currentColor;">
          ${escapeHTML(policyMessage.text)}
        </div>
      ` : ''}

      <!-- Cancellation Policy -->
      <div style="background: var(--c-surface-alt, var(--c-bg)); border: 1px solid var(--c-border); border-radius: var(--radius-lg); padding: var(--sp-4); margin-bottom: var(--sp-6);">
        <h3 style="margin-bottom: var(--sp-3); font-size: var(--text-base); font-weight: var(--fw-semibold);">Cancellation Policy</h3>
        <p style="font-size: var(--text-xs); color: var(--c-text-muted); margin-bottom: var(--sp-4);">Rules applied when a user attempts to cancel a booking.</p>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: var(--sp-3);">
          <div class="form-group" style="margin: 0;">
            <label class="form-label">Standard Fee ($)</label>
            <input class="form-input js-cancel-fee" type="number" min="0" step="0.01" value="${cr.fee || 0}" style="width: 100%;" />
          </div>
          <div class="form-group" style="margin: 0;">
            <label class="form-label">Deadline (hours before)</label>
            <input class="form-input js-cancel-deadline" type="number" min="0" step="1" value="${cr.deadlineHours || 0}" style="width: 100%;" />
          </div>
          <div class="form-group" style="margin: 0;">
            <label class="form-label">Late Fee ($)</label>
            <input class="form-input js-cancel-late-fee" type="number" min="0" step="0.01" value="${cr.lateFee || 0}" style="width: 100%;" />
          </div>
          <div class="form-group" style="margin: 0;">
            <label class="form-label">Block Late</label>
            <label style="display: flex; align-items: center; gap: var(--sp-2); cursor: pointer; margin-top: var(--sp-1);">
              <input type="checkbox" class="js-cancel-block-late" ${cr.blockLate ? 'checked' : ''} />
              <span style="font-size: var(--text-sm);">Prevent cancellation within deadline</span>
            </label>
          </div>
        </div>
        <div style="display: flex; justify-content: flex-end; margin-top: var(--sp-4);">
          <button class="btn btn--primary btn--sm js-save-cancel-policy" type="button">Save Cancellation Policy</button>
        </div>
      </div>

      <!-- Reschedule Policy -->
      <div style="background: var(--c-surface-alt, var(--c-bg)); border: 1px solid var(--c-border); border-radius: var(--radius-lg); padding: var(--sp-4);">
        <h3 style="margin-bottom: var(--sp-3); font-size: var(--text-base); font-weight: var(--fw-semibold);">Reschedule Policy</h3>
        <p style="font-size: var(--text-xs); color: var(--c-text-muted); margin-bottom: var(--sp-4);">Rules applied when a user attempts to reschedule a booking.</p>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: var(--sp-3);">
          <div class="form-group" style="margin: 0;">
            <label class="form-label">Standard Fee ($)</label>
            <input class="form-input js-resched-fee" type="number" min="0" step="0.01" value="${rr.fee || 0}" style="width: 100%;" />
          </div>
          <div class="form-group" style="margin: 0;">
            <label class="form-label">Deadline (hours before)</label>
            <input class="form-input js-resched-deadline" type="number" min="0" step="1" value="${rr.deadlineHours || 0}" style="width: 100%;" />
          </div>
          <div class="form-group" style="margin: 0;">
            <label class="form-label">Late Fee ($)</label>
            <input class="form-input js-resched-late-fee" type="number" min="0" step="0.01" value="${rr.lateFee || 0}" style="width: 100%;" />
          </div>
          <div class="form-group" style="margin: 0;">
            <label class="form-label">Block Late</label>
            <label style="display: flex; align-items: center; gap: var(--sp-2); cursor: pointer; margin-top: var(--sp-1);">
              <input type="checkbox" class="js-resched-block-late" ${rr.blockLate ? 'checked' : ''} />
              <span style="font-size: var(--text-sm);">Prevent reschedule within deadline</span>
            </label>
          </div>
          <div class="form-group" style="margin: 0;">
            <label class="form-label">Max Reschedules</label>
            <input class="form-input js-resched-max" type="number" min="0" step="1" value="${rr.maxReschedules != null ? rr.maxReschedules : ''}" placeholder="Unlimited" style="width: 100%;" />
          </div>
        </div>
        <div style="display: flex; justify-content: flex-end; margin-top: var(--sp-4);">
          <button class="btn btn--primary btn--sm js-save-resched-policy" type="button">Save Reschedule Policy</button>
        </div>
      </div>
    `;
  }

  // ── Event Binding ──────────────────────────────────────────────

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
      this._loadSectionData();
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

    // Section tabs
    this.delegate('click', '.js-section-tab', (e, target) => {
      const sec = target.dataset.section;
      if (sec && sec !== this.state.section) {
        this.state.section = sec;
        this._loadSectionData();
      }
    });

    // ── Announcement events
    this.delegate('click', '.js-ann-new', () => {
      this.setState({ announcementForm: { title: '', body: '', bgColor: '#1e40af', textColor: '#ffffff', active: true } });
    });
    this.delegate('click', '.js-ann-cancel', () => {
      this.setState({ announcementForm: null });
    });
    this.delegate('click', '.js-ann-edit', async (e, target) => {
      const id = target.dataset.id;
      const a = this.state.announcements.find(x => x.id === id);
      if (a) this.setState({ announcementForm: { ...a } });
    });
    this.delegate('click', '.js-ann-delete', async (e, target) => {
      const id = target.dataset.id;
      const ok = await confirmDialog({ title: 'Delete Announcement', message: 'Are you sure you want to delete this announcement?', danger: true, confirmText: 'Delete' });
      if (ok) {
        try {
          await opsService.deleteAnnouncement(id);
          showToast('Announcement deleted', { type: 'success' });
          await this._loadAnnouncements();
        } catch (err) { showToast(err.message, { type: 'error' }); }
      }
    });
    this.delegate('click', '.js-ann-save', async () => {
      const form = this.state.announcementForm;
      if (!form) return;
      const title = this.$('.js-ann-title')?.value?.trim();
      const body = this.$('.js-ann-body')?.value?.trim();
      const bgColor = this.$('.js-ann-bg')?.value || '#1e40af';
      const textColor = this.$('.js-ann-text-color')?.value || '#ffffff';
      const active = this.$('.js-ann-active')?.checked ?? true;
      if (!title) { showToast('Title is required', { type: 'warning' }); return; }
      try {
        if (form.id) {
          await opsService.updateAnnouncement(form.id, { title, body, bgColor, textColor, active });
          showToast('Announcement updated', { type: 'success' });
        } else {
          const ann = await opsService.createAnnouncement(title, body, bgColor, textColor);
          if (!active) await opsService.updateAnnouncement(ann.id, { active });
          showToast('Announcement created', { type: 'success' });
        }
        this.state.announcementForm = null;
        await this._loadAnnouncements();
      } catch (err) { showToast(err.message, { type: 'error' }); }
    });

    // ── Template events
    this.delegate('change', '.js-tpl-category', (e, target) => {
      this.state.templateCategory = target.value;
      this._loadTemplates();
    });
    this.delegate('click', '.js-tpl-new', () => this._openTemplateModal());
    this.delegate('click', '.js-tpl-edit', (e, target) => {
      const id = target.dataset.id;
      const t = this.state.templates.find(x => x.id === id);
      if (t) this._openTemplateModal(t);
    });
    this.delegate('click', '.js-tpl-delete', async (e, target) => {
      const id = target.dataset.id;
      const ok = await confirmDialog({ title: 'Delete Template', message: 'Delete this template?', danger: true, confirmText: 'Delete' });
      if (ok) {
        try {
          await opsService.deleteTemplate(id);
          showToast('Template deleted', { type: 'success' });
          await this._loadTemplates();
        } catch (err) { showToast(err.message, { type: 'error' }); }
      }
    });
    // Drag reorder for templates
    this.delegate('dragstart', '.js-tpl-card', (e, target) => {
      this.state.draggedTemplateId = target.dataset.id;
      target.style.opacity = '0.5';
      e.dataTransfer.effectAllowed = 'move';
    });
    this.delegate('dragend', '.js-tpl-card', (e, target) => {
      target.style.opacity = '1';
      this.state.draggedTemplateId = null;
    });
    this.delegate('dragover', '.js-tpl-card', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    this.delegate('drop', '.js-tpl-card', async (e, target) => {
      e.preventDefault();
      const draggedId = this.state.draggedTemplateId;
      const droppedId = target.dataset.id;
      if (!draggedId || draggedId === droppedId) return;
      const ids = this.state.templates.map(t => t.id);
      const fromIdx = ids.indexOf(draggedId);
      const toIdx = ids.indexOf(droppedId);
      if (fromIdx < 0 || toIdx < 0) return;
      ids.splice(fromIdx, 1);
      ids.splice(toIdx, 0, draggedId);
      try {
        await opsService.reorderTemplates(ids);
        await this._loadTemplates();
      } catch (err) { showToast(err.message, { type: 'error' }); }
    });

    // ── Sensitive word events
    this.delegate('click', '.js-sw-add', async () => {
      const wordEl = this.$('.js-sw-word');
      const sevEl = this.$('.js-sw-severity');
      const word = wordEl?.value?.trim();
      const severity = sevEl?.value || 'warn';
      if (!word) { showToast('Enter a word', { type: 'warning' }); return; }
      try {
        await sensitiveWordService.addWord(word, severity);
        showToast('Word added', { type: 'success' });
        this.state.newWord = '';
        await this._loadWords();
      } catch (err) { showToast(err.message, { type: 'error' }); }
    });
    this.delegate('click', '.js-sw-delete', async (e, target) => {
      const id = target.dataset.id;
      try {
        await sensitiveWordService.removeWord(id);
        showToast('Word removed', { type: 'success' });
        await this._loadWords();
      } catch (err) { showToast(err.message, { type: 'error' }); }
    });

    // ── Rule events
    this.delegate('click', '.js-rule-new', () => this._openRuleModal());
    this.delegate('click', '.js-rule-edit', (e, target) => {
      const id = target.dataset.id;
      const r = this.state.rules.find(x => x.id === id);
      if (r) this._openRuleModal(r);
    });
    this.delegate('click', '.js-rule-delete', async (e, target) => {
      const id = target.dataset.id;
      const ok = await confirmDialog({ title: 'Delete Rule', message: 'Delete this rule?', danger: true, confirmText: 'Delete' });
      if (ok) {
        try {
          await opsService.deleteRule(id);
          showToast('Rule deleted', { type: 'success' });
          await this._loadRules();
        } catch (err) { showToast(err.message, { type: 'error' }); }
      }
    });
    this.delegate('change', '.js-rule-toggle', async (e, target) => {
      const id = target.dataset.id;
      try {
        await opsService.updateRule(id, { active: target.checked });
        await this._loadRules();
      } catch (err) { showToast(err.message, { type: 'error' }); }
    });

    // ── Analytics events
    this.delegate('click', '.js-analytics-filter', () => {
      const from = this.$('.js-analytics-from')?.value || '';
      const to = this.$('.js-analytics-to')?.value || '';
      this.state.analyticsDateFrom = from;
      this.state.analyticsDateTo = to;
      this._loadAnalytics();
    });
    this.delegate('click', '.js-analytics-export', async () => {
      try {
        const evts = this.state.events;
        const header = 'Event,Session,Properties,Timestamp\n';
        const rows = evts.map(e =>
          `"${e.event}","${e.sessionId || ''}","${JSON.stringify(e.properties || {}).replace(/"/g, '""')}","${formatDateTime(e.timestamp)}"`
        ).join('\n');
        const csv = header + rows;
        const blob = new Blob([csv], { type: 'text/csv' });
        downloadBlob(blob, 'analytics-events.csv');
        showToast('Exported events', { type: 'success' });
      } catch (err) { showToast(err.message, { type: 'error' }); }
    });

    // ── Canary flag events
    this.delegate('click', '.js-flag-add', async () => {
      const keyEl = this.$('.js-flag-key');
      const descEl = this.$('.js-flag-desc');
      const key = keyEl?.value?.trim();
      const desc = descEl?.value?.trim() || '';
      if (!key) { showToast('Key is required', { type: 'warning' }); return; }
      try {
        await opsService.setFlag(key, false, desc);
        showToast('Flag added', { type: 'success' });
        this.state.newFlagKey = '';
        this.state.newFlagDescription = '';
        await this._loadFlags();
      } catch (err) { showToast(err.message, { type: 'error' }); }
    });
    this.delegate('change', '.js-flag-toggle', async (e, target) => {
      const key = target.dataset.key;
      try {
        await opsService.setFlag(key, target.checked);
        await this._loadFlags();
      } catch (err) { showToast(err.message, { type: 'error' }); }
    });

    // ── Booking Policy events
    this.delegate('click', '.js-save-cancel-policy', async () => {
      const fee = parseFloat(this.$('.js-cancel-fee')?.value) || 0;
      const deadlineHours = parseInt(this.$('.js-cancel-deadline')?.value, 10) || 0;
      const lateFee = parseFloat(this.$('.js-cancel-late-fee')?.value) || 0;
      const blockLate = this.$('.js-cancel-block-late')?.checked || false;
      try {
        await bookingService.createPolicy('cancellation', { fee, deadlineHours, lateFee, blockLate });
        showToast('Cancellation policy saved', { type: 'success' });
        this.setState({ policyMessage: { type: 'success', text: 'Cancellation policy saved successfully.' } });
        await this._loadPolicies();
      } catch (err) {
        showToast(err.message, { type: 'error' });
        this.setState({ policyMessage: { type: 'error', text: `Failed to save: ${err.message}` } });
      }
    });
    this.delegate('click', '.js-save-resched-policy', async () => {
      const fee = parseFloat(this.$('.js-resched-fee')?.value) || 0;
      const deadlineHours = parseInt(this.$('.js-resched-deadline')?.value, 10) || 0;
      const lateFee = parseFloat(this.$('.js-resched-late-fee')?.value) || 0;
      const blockLate = this.$('.js-resched-block-late')?.checked || false;
      const maxVal = this.$('.js-resched-max')?.value;
      const maxReschedules = maxVal !== '' && maxVal != null ? parseInt(maxVal, 10) : null;
      try {
        const rules = { fee, deadlineHours, lateFee, blockLate };
        if (maxReschedules !== null && !isNaN(maxReschedules)) rules.maxReschedules = maxReschedules;
        await bookingService.createPolicy('reschedule', rules);
        showToast('Reschedule policy saved', { type: 'success' });
        this.setState({ policyMessage: { type: 'success', text: 'Reschedule policy saved successfully.' } });
        await this._loadPolicies();
      } catch (err) {
        showToast(err.message, { type: 'error' });
        this.setState({ policyMessage: { type: 'error', text: `Failed to save: ${err.message}` } });
      }
    });
  }

  _openTemplateModal(existing) {
    this._modal = new Modal({
      title: existing ? 'Edit Template' : 'Create Template',
      content: `
        <div class="form-group">
          <label class="form-label">Name</label>
          <input class="form-input js-modal-tpl-name" type="text" value="${escapeHTML(existing?.name || '')}" placeholder="Template name" style="width: 100%;" />
        </div>
        <div class="form-group">
          <label class="form-label">Category</label>
          <input class="form-input js-modal-tpl-cat" type="text" value="${escapeHTML(existing?.category || '')}" placeholder="e.g. Planning, Design" style="width: 100%;" />
        </div>
        <div class="form-group" style="margin-bottom: 0;">
          <label class="form-label">Data (JSON)</label>
          <textarea class="form-input js-modal-tpl-data" rows="4" placeholder='{"elements": []}' style="width: 100%; resize: vertical; font-family: monospace;">${escapeHTML(existing?.data ? JSON.stringify(existing.data) : '')}</textarea>
        </div>
      `,
      footer: `
        <button class="btn btn--secondary js-modal-cancel" type="button">Cancel</button>
        <button class="btn btn--primary js-modal-save" type="button">${existing ? 'Update' : 'Create'}</button>
      `,
      closable: true,
      onClose: () => { this._modal = null; }
    });
    this._modal.render();

    this._modal.el.querySelector('.js-modal-cancel').addEventListener('click', () => this._modal.close());
    this._modal.el.querySelector('.js-modal-save').addEventListener('click', async () => {
      const name = this._modal.el.querySelector('.js-modal-tpl-name')?.value?.trim();
      const category = this._modal.el.querySelector('.js-modal-tpl-cat')?.value?.trim() || '';
      const dataStr = this._modal.el.querySelector('.js-modal-tpl-data')?.value?.trim() || '{}';
      if (!name) { showToast('Name is required', { type: 'warning' }); return; }
      let data;
      try { data = JSON.parse(dataStr); } catch { showToast('Invalid JSON data', { type: 'error' }); return; }
      try {
        if (existing) {
          await opsService.updateTemplate(existing.id, { name, category, data });
          showToast('Template updated', { type: 'success' });
        } else {
          await opsService.createTemplate(name, category, data);
          showToast('Template created', { type: 'success' });
        }
        this._modal.close();
        await this._loadTemplates();
      } catch (err) { showToast(err.message, { type: 'error' }); }
    });
  }

  _openRuleModal(existing) {
    this._modal = new Modal({
      title: existing ? 'Edit Rule' : 'Create Rule',
      content: `
        <div class="form-group">
          <label class="form-label">Title</label>
          <input class="form-input js-modal-rule-title" type="text" value="${escapeHTML(existing?.title || '')}" placeholder="Rule title" style="width: 100%;" />
        </div>
        <div class="form-group">
          <label class="form-label">Body</label>
          <textarea class="form-input js-modal-rule-body" rows="3" placeholder="Describe the rule" style="width: 100%; resize: vertical;">${escapeHTML(existing?.body || '')}</textarea>
        </div>
        <div class="form-group" style="margin-bottom: 0;">
          <label class="form-label">Category</label>
          <input class="form-input js-modal-rule-cat" type="text" value="${escapeHTML(existing?.category || '')}" placeholder="e.g. moderation, content" style="width: 100%;" />
        </div>
      `,
      footer: `
        <button class="btn btn--secondary js-modal-cancel" type="button">Cancel</button>
        <button class="btn btn--primary js-modal-save" type="button">${existing ? 'Update' : 'Create'}</button>
      `,
      closable: true,
      onClose: () => { this._modal = null; }
    });
    this._modal.render();

    this._modal.el.querySelector('.js-modal-cancel').addEventListener('click', () => this._modal.close());
    this._modal.el.querySelector('.js-modal-save').addEventListener('click', async () => {
      const title = this._modal.el.querySelector('.js-modal-rule-title')?.value?.trim();
      const body = this._modal.el.querySelector('.js-modal-rule-body')?.value?.trim() || '';
      const category = this._modal.el.querySelector('.js-modal-rule-cat')?.value?.trim() || '';
      if (!title) { showToast('Title is required', { type: 'warning' }); return; }
      try {
        if (existing) {
          await opsService.updateRule(existing.id, { title, body, category });
          showToast('Rule updated', { type: 'success' });
        } else {
          await opsService.createRule(title, body, category);
          showToast('Rule created', { type: 'success' });
        }
        this._modal.close();
        await this._loadRules();
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
