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
import { mealService } from '../../services/meal-service.js';

function toDateStr(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().split('T')[0];
}

function formatDateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

const DEFAULT_MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
const DAILY_TARGETS = { calories: 2000, protein: 50, carbs: 250, fat: 65 };

export class MealPlannerPage extends Component {
  constructor(container, props) {
    super(container, props);
    const currentUser = store.get('currentUser');
    this.state = {
      role: store.get('role') || storage.get(STORAGE_KEYS.ROLE, 'user'),
      currentUser,
      unreadCount: 0,
      userMenuOpen: false,
      currentDate: toDateStr(new Date()),
      plan: null,
      loading: true,
      nutrientError: null,
      nutrientReady: false
    };
    this._modal = null;
  }

  mount() {
    super.mount();
    this._ensureNutrientDb();
    this._loadPlan();
    this.subscribeTo('meal:plan-created', () => this._loadPlan());
    this.subscribeTo('meal:food-added', () => this._loadPlan());
    this.subscribeTo('meal:food-removed', () => this._loadPlan());
    this.subscribeTo('meal:food-updated', () => this._loadPlan());
    this.subscribeTo('meal:meal-added', () => this._loadPlan());
  }

  async _ensureNutrientDb() {
    try {
      await mealService.initNutrientDb();
      this.setState({ nutrientReady: true, nutrientError: null });
    } catch (err) {
      this.setState({ nutrientError: err.message || 'Failed to load nutrient database. Food search and barcode scanning will not work.' });
    }
  }

  async _loadPlan() {
    try {
      let plan = await mealService.getMealPlan(this.state.currentDate);
      this.setState({ plan, loading: false });
    } catch {
      this.setState({ plan: null, loading: false });
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
    const { currentDate, plan, loading, nutrientError } = this.state;
    const totals = plan?.totals || { calories: 0, protein: 0, carbs: 0, fat: 0 };

    this.container.innerHTML = this._renderAppShell(`
      ${nutrientError ? `
        <div class="js-nutrient-error" style="padding: var(--sp-3) var(--sp-4); border-radius: var(--radius-md); margin-bottom: var(--sp-4); background: var(--c-danger-bg, #fef2f2); color: var(--c-danger); font-size: var(--text-sm); border: 1px solid var(--c-danger); display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3);">
          <span>Nutrient database failed to load. Food search and barcode scanning are unavailable.</span>
          <button class="btn btn--danger btn--sm js-retry-nutrient" type="button">Retry</button>
        </div>
      ` : ''}
      <div class="page-header">
        <div>
          <h1 class="page-title">Meal Planner</h1>
          <p class="page-subtitle">${escapeHTML(formatDateLabel(currentDate))}</p>
        </div>
        <button class="btn btn--primary js-add-meal" type="button">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Meal
        </button>
      </div>

      <!-- Date Navigator -->
      <div style="display: flex; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-6);">
        <button class="btn btn--ghost btn--sm js-prev-day" type="button">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <input class="form-input js-date-picker" type="date" value="${escapeHTML(currentDate)}" style="width: auto;" />
        <button class="btn btn--ghost btn--sm js-next-day" type="button">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <button class="btn btn--ghost btn--sm js-today" type="button">Today</button>
      </div>

      <!-- Daily Totals -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: var(--sp-3); margin-bottom: var(--sp-6);">
        ${this._renderNutrientBar('Calories', totals.calories, DAILY_TARGETS.calories, 'kcal', 'var(--c-warning)')}
        ${this._renderNutrientBar('Protein', totals.protein, DAILY_TARGETS.protein, 'g', 'var(--c-info)')}
        ${this._renderNutrientBar('Carbs', totals.carbs, DAILY_TARGETS.carbs, 'g', 'var(--c-success)')}
        ${this._renderNutrientBar('Fat', totals.fat, DAILY_TARGETS.fat, 'g', 'var(--c-danger)')}
      </div>

      ${loading ? `
        <div class="empty-state">
          <div class="spinner" style="width: 32px; height: 32px; border-width: 3px"></div>
        </div>
      ` : !plan ? `
        <div class="empty-state">
          <div class="empty-state__icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>
          </div>
          <div class="empty-state__title">No meal plan for this day</div>
          <p style="color: var(--c-text-muted); font-size: var(--text-sm); margin-bottom: var(--sp-4);">Start planning your meals for the day.</p>
          <button class="btn btn--primary js-create-plan" type="button">Create Meal Plan</button>
        </div>
      ` : `
        <div style="display: flex; flex-direction: column; gap: var(--sp-4);">
          ${plan.meals.map((meal, mi) => this._renderMealSection(meal, mi)).join('')}
        </div>
      `}
    `);

    this._bindEvents();
  }

  _renderNutrientBar(label, current, target, unit, color) {
    const pct = Math.min(Math.round((current / target) * 100), 100);
    return `
      <div style="background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--radius-lg); padding: var(--sp-3);">
        <div style="display: flex; justify-content: space-between; margin-bottom: var(--sp-1);">
          <span style="font-size: var(--text-xs); font-weight: var(--fw-semibold);">${label}</span>
          <span style="font-size: var(--text-xs); color: var(--c-text-muted);">${Math.round(current)}/${target}${unit}</span>
        </div>
        <div style="height: 8px; background: var(--c-border); border-radius: 4px; overflow: hidden;">
          <div style="height: 100%; width: ${pct}%; background: ${color}; border-radius: 4px; transition: width 0.3s;"></div>
        </div>
        <div style="text-align: right; font-size: 10px; color: var(--c-text-muted); margin-top: 2px;">${pct}%</div>
      </div>
    `;
  }

  _renderMealSection(meal, mealIndex) {
    const items = meal.items || [];
    const mealCals = items.reduce((s, i) => s + (i.nutrients?.calories || 0), 0);

    return `
      <div style="background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--radius-lg); overflow: hidden;">
        <div style="display: flex; justify-content: space-between; align-items: center; padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--c-border); background: var(--c-surface-alt, var(--c-bg));">
          <div style="display: flex; align-items: center; gap: var(--sp-2);">
            <strong style="font-size: var(--text-sm);">${escapeHTML(meal.name)}</strong>
            <span style="font-size: var(--text-xs); color: var(--c-text-muted);">${Math.round(mealCals)} kcal</span>
          </div>
          <button class="btn btn--ghost btn--sm js-add-food" data-meal-index="${mealIndex}" type="button">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Food
          </button>
        </div>
        ${items.length === 0 ? `
          <div style="padding: var(--sp-4); text-align: center; color: var(--c-text-muted); font-size: var(--text-sm);">
            No food items yet. Click "Add Food" to start.
          </div>
        ` : `
          <div>
            ${items.map((item, ii) => `
              <div style="display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-2) var(--sp-4); border-bottom: 1px solid var(--c-border);" data-meal-index="${mealIndex}" data-item-index="${ii}">
                <div style="flex: 1; min-width: 0;">
                  <div style="font-size: var(--text-sm); font-weight: var(--fw-medium);">${escapeHTML(item.name)}</div>
                  <div style="font-size: var(--text-xs); color: var(--c-text-muted);">
                    ${Math.round(item.nutrients?.calories || 0)} kcal |
                    P: ${Math.round(item.nutrients?.protein || 0)}g |
                    C: ${Math.round(item.nutrients?.carbs || 0)}g |
                    F: ${Math.round(item.nutrients?.fat || 0)}g
                  </div>
                </div>
                <div style="display: flex; align-items: center; gap: var(--sp-2); flex-shrink: 0;">
                  <input class="form-input js-qty-input" type="number" min="0.1" step="0.5" value="${item.quantity}" data-meal-index="${mealIndex}" data-item-index="${ii}" style="width: 60px; text-align: center; font-size: var(--text-sm);" />
                  <span style="font-size: var(--text-xs); color: var(--c-text-muted);">${escapeHTML(item.unit || 'serving')}</span>
                  <button class="btn btn--ghost btn--sm js-remove-food" data-meal-index="${mealIndex}" data-item-index="${ii}" type="button" style="color: var(--c-danger);">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        `}
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

    // Nutrient DB retry
    this.delegate('click', '.js-retry-nutrient', () => {
      this.setState({ nutrientError: null });
      this._ensureNutrientDb();
    });

    // Date navigation
    this.delegate('click', '.js-prev-day', () => {
      const d = new Date(this.state.currentDate + 'T00:00:00');
      d.setDate(d.getDate() - 1);
      this.state.currentDate = toDateStr(d);
      this.state.loading = true;
      this.render();
      this._loadPlan();
    });
    this.delegate('click', '.js-next-day', () => {
      const d = new Date(this.state.currentDate + 'T00:00:00');
      d.setDate(d.getDate() + 1);
      this.state.currentDate = toDateStr(d);
      this.state.loading = true;
      this.render();
      this._loadPlan();
    });
    this.delegate('click', '.js-today', () => {
      this.state.currentDate = toDateStr(new Date());
      this.state.loading = true;
      this.render();
      this._loadPlan();
    });
    this.delegate('change', '.js-date-picker', (e, target) => {
      if (target.value) {
        this.state.currentDate = target.value;
        this.state.loading = true;
        this.render();
        this._loadPlan();
      }
    });

    // Create plan
    this.delegate('click', '.js-create-plan', async () => {
      try {
        const plan = await mealService.createMealPlan(this.state.currentDate);
        // Add default meal sections
        for (const name of DEFAULT_MEALS) {
          await mealService.addMeal(plan.id, name);
        }
        await this._loadPlan();
        showToast('Meal plan created', { type: 'success' });
      } catch (err) { showToast(err.message, { type: 'error' }); }
    });

    // Add meal section
    this.delegate('click', '.js-add-meal', async () => {
      if (!this.state.plan) {
        // Create plan first
        try {
          const plan = await mealService.createMealPlan(this.state.currentDate);
          this.state.plan = plan;
        } catch (err) { showToast(err.message, { type: 'error' }); return; }
      }
      this._modal = new Modal({
        title: 'Add Meal Section',
        content: `
          <div class="form-group" style="margin-bottom: 0;">
            <label class="form-label">Meal Name</label>
            <input class="form-input js-modal-meal-name" type="text" placeholder="e.g. Morning Snack, Pre-workout" style="width: 100%;" />
          </div>
        `,
        footer: `
          <button class="btn btn--secondary js-modal-cancel" type="button">Cancel</button>
          <button class="btn btn--primary js-modal-save" type="button">Add</button>
        `,
        closable: true,
        onClose: () => { this._modal = null; }
      });
      this._modal.render();
      const input = this._modal.el.querySelector('.js-modal-meal-name');
      requestAnimationFrame(() => input?.focus());
      this._modal.el.querySelector('.js-modal-cancel').addEventListener('click', () => this._modal.close());
      this._modal.el.querySelector('.js-modal-save').addEventListener('click', async () => {
        const name = input?.value?.trim();
        if (!name) { showToast('Name is required', { type: 'warning' }); return; }
        try {
          await mealService.addMeal(this.state.plan.id, name);
          this._modal.close();
          await this._loadPlan();
          showToast(`Added "${name}"`, { type: 'success' });
        } catch (err) { showToast(err.message, { type: 'error' }); }
      });
    });

    // Add food to meal
    this.delegate('click', '.js-add-food', (e, target) => {
      const mealIndex = parseInt(target.dataset.mealIndex, 10);
      this._openFoodSearchModal(mealIndex);
    });

    // Remove food
    this.delegate('click', '.js-remove-food', async (e, target) => {
      const mi = parseInt(target.dataset.mealIndex, 10);
      const ii = parseInt(target.dataset.itemIndex, 10);
      if (!this.state.plan) return;
      try {
        await mealService.removeFoodFromMeal(this.state.plan.id, mi, ii);
        await this._loadPlan();
      } catch (err) { showToast(err.message, { type: 'error' }); }
    });

    // Quantity change
    this.delegate('change', '.js-qty-input', async (e, target) => {
      const mi = parseInt(target.dataset.mealIndex, 10);
      const ii = parseInt(target.dataset.itemIndex, 10);
      const qty = parseFloat(target.value);
      if (!this.state.plan || isNaN(qty) || qty <= 0) return;
      try {
        await mealService.updateFoodQuantity(this.state.plan.id, mi, ii, qty);
        await this._loadPlan();
      } catch (err) { showToast(err.message, { type: 'error' }); }
    });
  }

  _hasBarcodeScanner() {
    return typeof globalThis.BarcodeDetector !== 'undefined';
  }

  async _startBarcodeScanner(barcodeInput, doSearch) {
    const container = this._modal?.el?.querySelector('.js-scanner-container');
    if (!container) return;

    // Stop any existing scanner
    this._stopBarcodeScanner();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      this._scannerStream = stream;

      container.innerHTML = `
        <div style="position: relative; margin-bottom: var(--sp-3); border-radius: var(--radius-md); overflow: hidden; background: #000;">
          <video class="js-scanner-video" autoplay playsinline muted style="width: 100%; display: block;"></video>
          <div style="position: absolute; top: 50%; left: 10%; right: 10%; height: 2px; background: var(--c-danger); opacity: 0.7; transform: translateY(-50%);"></div>
          <button class="btn btn--ghost btn--sm js-scanner-stop" type="button" style="position: absolute; top: var(--sp-2); right: var(--sp-2); background: rgba(0,0,0,0.5); color: #fff;">Stop</button>
        </div>
      `;

      const video = container.querySelector('.js-scanner-video');
      video.srcObject = stream;
      await video.play();

      container.querySelector('.js-scanner-stop').addEventListener('click', () => {
        this._stopBarcodeScanner();
      });

      const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'] });
      this._scannerActive = true;

      const scan = async () => {
        if (!this._scannerActive || video.readyState < 2) {
          if (this._scannerActive) this._scannerRaf = requestAnimationFrame(scan);
          return;
        }
        try {
          const barcodes = await detector.detect(video);
          if (barcodes.length > 0) {
            const code = barcodes[0].rawValue;
            barcodeInput.value = code;
            this._stopBarcodeScanner();
            doSearch();
            return;
          }
        } catch { /* detection frame error, continue */ }
        if (this._scannerActive) {
          this._scannerRaf = requestAnimationFrame(scan);
        }
      };
      this._scannerRaf = requestAnimationFrame(scan);
    } catch (err) {
      container.innerHTML = `<p style="color: var(--c-danger); font-size: var(--text-sm); text-align: center;">Camera access denied or unavailable.</p>`;
    }
  }

  _stopBarcodeScanner() {
    this._scannerActive = false;
    if (this._scannerRaf) {
      cancelAnimationFrame(this._scannerRaf);
      this._scannerRaf = null;
    }
    if (this._scannerStream) {
      for (const track of this._scannerStream.getTracks()) {
        track.stop();
      }
      this._scannerStream = null;
    }
    const container = this._modal?.el?.querySelector('.js-scanner-container');
    if (container) container.innerHTML = '';
  }

  _openFoodSearchModal(mealIndex) {
    const hasScannerApi = this._hasBarcodeScanner();

    this._modal = new Modal({
      title: 'Add Food',
      size: 'lg',
      content: `
        <div style="display: flex; gap: var(--sp-2); margin-bottom: var(--sp-4);">
          <div class="form-group" style="flex: 1; margin: 0;">
            <input class="form-input js-food-search" type="text" placeholder="Search food by name..." style="width: 100%;" />
          </div>
          <div class="form-group" style="width: 150px; margin: 0;">
            <input class="form-input js-barcode-input" type="text" placeholder="Barcode" style="width: 100%;" />
          </div>
          ${hasScannerApi ? `<button class="btn btn--secondary btn--sm js-barcode-scan-btn" type="button" title="Scan barcode with camera">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          </button>` : ''}
          <button class="btn btn--secondary btn--sm js-food-search-btn" type="button">Search</button>
        </div>
        <div class="js-scanner-container"></div>
        <div class="js-food-results" style="max-height: 300px; overflow-y: auto;">
          <p style="color: var(--c-text-muted); font-size: var(--text-sm); text-align: center;">Type a food name or barcode and click Search.</p>
        </div>
      `,
      closable: true,
      onClose: () => {
        this._stopBarcodeScanner();
        this._modal = null;
      }
    });
    this._modal.render();

    const searchInput = this._modal.el.querySelector('.js-food-search');
    const barcodeInput = this._modal.el.querySelector('.js-barcode-input');
    const resultsDiv = this._modal.el.querySelector('.js-food-results');
    requestAnimationFrame(() => searchInput?.focus());

    const doSearch = async () => {
      const query = searchInput?.value?.trim();
      const barcode = barcodeInput?.value?.trim();
      let results = [];

      try {
        if (barcode) {
          const food = await mealService.lookupBarcode(barcode);
          if (food) results = [food];
        } else if (query) {
          results = await mealService.searchFoods(query);
        }
      } catch { /* ignore */ }

      if (results.length === 0) {
        resultsDiv.innerHTML = '<p style="color: var(--c-text-muted); font-size: var(--text-sm); text-align: center;">No results found.</p>';
        return;
      }

      resultsDiv.innerHTML = results.map(f => `
        <div class="js-food-item" data-food-id="${escapeHTML(f.id)}" style="display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-md); cursor: pointer; border: 1px solid var(--c-border); margin-bottom: var(--sp-2);" onmouseover="this.style.background='var(--c-surface-alt, var(--c-bg))'" onmouseout="this.style.background=''">
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: var(--text-sm); font-weight: var(--fw-medium);">${escapeHTML(f.name)}</div>
            <div style="font-size: var(--text-xs); color: var(--c-text-muted);">
              Serving: ${f.servingSize || 1} ${escapeHTML(f.servingUnit || 'serving')} | ${Math.round(f.calories || 0)} kcal
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: var(--sp-2); flex-shrink: 0;">
            <input class="form-input js-food-qty" type="number" min="0.1" step="0.5" value="1" style="width: 55px; text-align: center; font-size: var(--text-sm);" onclick="event.stopPropagation()" />
            <button class="btn btn--primary btn--sm js-food-select" data-food-id="${escapeHTML(f.id)}" data-food-name="${escapeHTML(f.name)}" data-barcode="${escapeHTML(f.barcode || '')}" type="button" onclick="event.stopPropagation()">Add</button>
          </div>
        </div>
      `).join('');

      // Bind add buttons
      resultsDiv.querySelectorAll('.js-food-select').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const foodId = btn.dataset.foodId;
          const foodName = btn.dataset.foodName;
          const barcode = btn.dataset.barcode || null;
          const qtyInput = btn.closest('.js-food-item').querySelector('.js-food-qty');
          const quantity = parseFloat(qtyInput?.value) || 1;

          try {
            await mealService.addFoodToMeal(this.state.plan.id, mealIndex, {
              foodId,
              name: foodName,
              quantity,
              barcode
            });
            showToast(`Added ${foodName}`, { type: 'success' });
            this._modal.close();
            await this._loadPlan();
          } catch (err) { showToast(err.message, { type: 'error' }); }
        });
      });
    };

    this._modal.el.querySelector('.js-food-search-btn').addEventListener('click', doSearch);
    searchInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
    barcodeInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

    const scanBtn = this._modal.el.querySelector('.js-barcode-scan-btn');
    if (scanBtn) {
      scanBtn.addEventListener('click', () => {
        this._startBarcodeScanner(barcodeInput, doSearch);
      });
    }
  }

  destroy() {
    this._stopBarcodeScanner();
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
