import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MealPlannerPage } from '../../js/ui/pages/meal-planner-page.js';
import { router } from '../../js/core/router.js';
import { store } from '../../js/core/store.js';
import { mealService } from '../../js/services/meal-service.js';
import { db } from '../../js/core/db.js';
import { resetAll, setCurrentUser } from '../helpers.js';

const SEED_FOODS = [
  {
    id: 'rice', name: 'White Rice (cooked)', barcode: '0001',
    servingSize: 200, servingUnit: 'g',
    calories: 260, protein: 5.4, carbs: 56, fat: 0.6,
    fiber: 0.6, sodium: 2, sugar: 0.1, cholesterol: 0,
    vitaminA: 0, vitaminC: 0, calcium: 3, iron: 0.4
  },
  {
    id: 'chicken', name: 'Chicken Breast (grilled)', barcode: '0002',
    servingSize: 150, servingUnit: 'g',
    calories: 248, protein: 46.0, carbs: 0, fat: 5.4,
    fiber: 0, sodium: 104, sugar: 0, cholesterol: 119,
    vitaminA: 9, vitaminC: 0, calcium: 15, iron: 1.1
  }
];

const _mountedPages = [];
function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const page = new MealPlannerPage(container, {});
  page.mount();
  _mountedPages.push(page);
  return { page, container };
}

async function waitFor(pred, ms = 500) {
  for (let i = 0; i < ms / 10; i++) {
    if (pred()) return true;
    await new Promise(r => setTimeout(r, 10));
  }
  return false;
}

describe('MealPlannerPage (real meal-service, real db, no service mocks)', () => {
  let navSpy;
  beforeEach(async () => {
    await resetAll();
    setCurrentUser();
    document.body.innerHTML = '';
    navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => {});
    // Seed the nutrient DB directly (bypasses fetch so the page's initNutrientDb
    // early-returns — this is the normal happy-path after the first boot).
    await db.putBatch('nutrientDb', SEED_FOODS);
  });
  afterEach(async () => {
    // Tear down every page mounted during the test so document listeners and
    // bus subscriptions do not leak into the next test (the meal-planner page
    // re-binds delegates on every render).
    while (_mountedPages.length) {
      const p = _mountedPages.pop();
      try { p.destroy(); } catch { /* ignore */ }
    }
    // Drain any in-flight handlers (e.g. logout → router.navigate) BEFORE restoring
    // the router spy, so stray real navigate() calls can't crash an uninitialized router.
    await new Promise(r => setTimeout(r, 20));
    navSpy.mockRestore();
    document.body.innerHTML = '';
  });

  describe('render: app shell + empty plan', () => {
    it('renders the page title, today\'s date, the Add Meal button, and the "No meal plan" empty state', async () => {
      const { container, page } = mount();
      await waitFor(() => !page.state.loading);

      expect(container.querySelector('.page-title').textContent).toBe('Meal Planner');
      const today = new Date().toISOString().split('T')[0];
      expect(page.state.currentDate).toBe(today);
      expect(container.querySelector('.js-date-picker').value).toBe(today);
      expect(container.querySelector('.js-add-meal')).toBeTruthy();
      expect(container.querySelector('.empty-state__title').textContent).toBe('No meal plan for this day');
      expect(container.querySelector('.js-create-plan')).toBeTruthy();
    });

    it('renders all four daily-target nutrient bars at 0% when no plan exists', async () => {
      const { container, page } = mount();
      await waitFor(() => !page.state.loading);

      const bars = container.textContent;
      expect(bars).toMatch(/Calories[\s\S]*0\/2000/);
      expect(bars).toMatch(/Protein[\s\S]*0\/50/);
      expect(bars).toMatch(/Carbs[\s\S]*0\/250/);
      expect(bars).toMatch(/Fat[\s\S]*0\/65/);
    });
  });

  describe('nutrient-db error + retry', () => {
    it('shows the nutrient-error banner when initNutrientDb throws, then clears it on Retry success', async () => {
      // Start a test with an EMPTY nutrient DB and a failing fetch
      await resetAll();
      setCurrentUser();
      const failingFetch = vi.fn().mockRejectedValueOnce(new Error('Network down'))
        .mockResolvedValueOnce({ json: () => Promise.resolve(SEED_FOODS) });
      globalThis.fetch = failingFetch;

      const { container, page } = mount();
      await waitFor(() => page.state.nutrientError !== null);

      expect(container.querySelector('.js-nutrient-error')).toBeTruthy();
      expect(container.textContent).toContain('Nutrient database failed to load');
      expect(container.querySelector('.js-retry-nutrient')).toBeTruthy();

      // Click Retry — second fetch succeeds, banner clears
      container.querySelector('.js-retry-nutrient').click();
      await waitFor(() => page.state.nutrientReady === true);
      expect(page.state.nutrientError).toBeNull();
      expect(container.querySelector('.js-nutrient-error')).toBeNull();
      expect(failingFetch).toHaveBeenCalledTimes(2);

      delete globalThis.fetch;
    });
  });

  describe('date navigation: state transitions', () => {
    it('prev-day click changes currentDate (moves it to an earlier ISO string)', async () => {
      const { container, page } = mount();
      await waitFor(() => !page.state.loading);

      // Use a known-fixed start date so the component's Date math runs in a stable timezone context.
      const startPicker = container.querySelector('.js-date-picker');
      startPicker.value = '2026-06-15';
      startPicker.dispatchEvent(new Event('change', { bubbles: true }));
      expect(page.state.currentDate).toBe('2026-06-15');

      const btn = container.querySelector('.js-prev-day');
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      // state.currentDate is now an earlier ISO date string — at minimum lexicographically less.
      expect(page.state.currentDate).not.toBe('2026-06-15');
      expect(page.state.currentDate < '2026-06-15').toBe(true);
    });

    it('navigation trio (prev/today/next) is rendered together under the date-navigator row', async () => {
      const { container, page } = mount();
      await waitFor(() => !page.state.loading);

      const nextBtn = container.querySelector('.js-next-day');
      const prevBtn = container.querySelector('.js-prev-day');
      const todayBtn = container.querySelector('.js-today');

      expect(nextBtn).toBeTruthy();
      expect(prevBtn).toBeTruthy();
      expect(todayBtn).toBeTruthy();
      // All three buttons share the same parent (the date-navigator block).
      expect(nextBtn.parentElement).toBe(prevBtn.parentElement);
      expect(nextBtn.parentElement).toBe(todayBtn.parentElement);
    });

    it('"Today" button resets currentDate to today even after navigating', async () => {
      const { container, page } = mount();
      await waitFor(() => !page.state.loading);

      container.querySelector('.js-prev-day').click();
      container.querySelector('.js-prev-day').click();
      const today = new Date().toISOString().split('T')[0];
      expect(page.state.currentDate).not.toBe(today);

      container.querySelector('.js-today').click();
      expect(page.state.currentDate).toBe(today);
    });

    it('date picker change updates currentDate and reloads the plan for that day', async () => {
      const { container, page } = mount();
      await waitFor(() => !page.state.loading);

      const picker = container.querySelector('.js-date-picker');
      picker.value = '2026-01-15';
      picker.dispatchEvent(new Event('change', { bubbles: true }));

      expect(page.state.currentDate).toBe('2026-01-15');
      await waitFor(() => !page.state.loading);
    });
  });

  describe('create plan + add food flow (real service end-to-end)', () => {
    it('create-plan seeds Breakfast/Lunch/Dinner/Snack sections into the DB and renders 4 meal sections', async () => {
      const { container, page } = mount();
      await waitFor(() => !page.state.loading);

      container.querySelector('.js-create-plan').click();
      await waitFor(() => page.state.plan !== null && page.state.plan.meals.length === 4);

      const names = page.state.plan.meals.map(m => m.name);
      expect(names).toEqual(['Breakfast', 'Lunch', 'Dinner', 'Snack']);

      // Sections rendered
      expect(container.textContent).toContain('Breakfast');
      expect(container.textContent).toContain('Lunch');
      expect(container.textContent).toContain('Dinner');
      expect(container.textContent).toContain('Snack');
      expect(container.querySelectorAll('.js-add-food').length).toBe(4);
    });

    it('adding food to a meal updates plan.totals, renders the item row, and reflects in the nutrient bars', async () => {
      const { container, page } = mount();
      await waitFor(() => !page.state.loading);

      container.querySelector('.js-create-plan').click();
      await waitFor(() => page.state.plan?.meals?.length === 4);

      // Bypass the search modal; call the same service the UI's Add button calls
      await mealService.addFoodToMeal(page.state.plan.id, 1 /* Lunch */, {
        foodId: 'rice', name: 'White Rice (cooked)', quantity: 200, unit: 'g'
      });
      await page._loadPlan();

      // State: totals scaled for a full serving (quantity=200 == servingSize=200 => 1x)
      expect(page.state.plan.totals.calories).toBe(260);
      expect(page.state.plan.totals.protein).toBe(5.4);
      expect(page.state.plan.totals.carbs).toBe(56);

      // Render: the item row appears inside Lunch with the food name and kcal
      expect(container.textContent).toContain('White Rice (cooked)');
      // Nutrient bar now shows 260/2000
      expect(container.textContent).toMatch(/Calories[\s\S]*260\/2000/);
    });

    it('changing the quantity input re-scales nutrients via the real service and updates totals', async () => {
      const { container, page } = mount();
      await waitFor(() => !page.state.loading);

      container.querySelector('.js-create-plan').click();
      await waitFor(() => page.state.plan?.meals?.length === 4);

      await mealService.addFoodToMeal(page.state.plan.id, 0, {
        foodId: 'rice', name: 'White Rice (cooked)', quantity: 200, unit: 'g'
      });
      await page._loadPlan();
      expect(page.state.plan.totals.calories).toBe(260);

      // Halve the quantity via the UI's qty input → change event
      const qtyInput = container.querySelector('.js-qty-input');
      qtyInput.value = '100';
      qtyInput.dispatchEvent(new Event('change', { bubbles: true }));

      await waitFor(() => page.state.plan.totals.calories === 130);
      expect(page.state.plan.meals[0].items[0].quantity).toBe(100);
      expect(page.state.plan.totals.calories).toBe(130);
      expect(page.state.plan.totals.protein).toBe(2.7);
    });

    it('remove-food deletes the item row and drops totals back to zero', async () => {
      const { container, page } = mount();
      await waitFor(() => !page.state.loading);

      container.querySelector('.js-create-plan').click();
      await waitFor(() => page.state.plan?.meals?.length === 4);

      await mealService.addFoodToMeal(page.state.plan.id, 0, {
        foodId: 'chicken', name: 'Chicken Breast (grilled)', quantity: 150, unit: 'g'
      });
      await page._loadPlan();
      expect(page.state.plan.totals.calories).toBe(248);

      container.querySelector('.js-remove-food').click();
      await waitFor(() => page.state.plan.meals[0].items.length === 0);

      expect(page.state.plan.meals[0].items).toEqual([]);
      expect(page.state.plan.totals.calories).toBe(0);
      expect(page.state.plan.totals.protein).toBe(0);
    });
  });

  describe('global shell actions', () => {
    it('role toggle flips user ↔ ops and surfaces the Administration section', async () => {
      const { container, page } = mount();
      await waitFor(() => !page.state.loading);

      expect(container.textContent).not.toContain('Administration');
      container.querySelector('.js-role-toggle').click();
      expect(page.state.role).toBe('ops');
      expect(container.textContent).toContain('Administration');
    });

    it('notifications header button navigates to /notifications', async () => {
      const { container, page } = mount();
      await waitFor(() => !page.state.loading);
      container.querySelector('.js-notifications-btn').click();
      expect(navSpy).toHaveBeenCalledWith('/notifications');
    });

    it('Logout from the avatar menu logs out and routes to /login', async () => {
      const { container, page } = mount();
      await waitFor(() => !page.state.loading);

      container.querySelector('.js-user-avatar').click();
      expect(container.querySelector('.js-menu-logout')).toBeTruthy();
      container.querySelector('.js-menu-logout').click();

      await waitFor(() => navSpy.mock.calls.some(c => c[0] === '/login'));
      expect(navSpy).toHaveBeenCalledWith('/login');
      expect(store.get('currentUser')).toBeFalsy();
    });
  });
});
