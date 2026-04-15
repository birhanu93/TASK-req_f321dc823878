import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetAll, setCurrentUser } from '../helpers.js';
import { store } from '../../js/core/store.js';

// We test the MealPlannerPage's barcode scanning logic by exercising its
// _hasBarcodeScanner method and verifying the modal content adapts to
// BarcodeDetector availability. Since the page renders into a DOM container
// and relies on the Component base class, we test at the component level.

describe('Barcode Scanner capability detection and fallback', () => {
  let originalBarcodeDetector;

  beforeEach(async () => {
    await resetAll();
    setCurrentUser();
    originalBarcodeDetector = globalThis.BarcodeDetector;
  });

  afterEach(() => {
    // Restore original state
    if (originalBarcodeDetector !== undefined) {
      globalThis.BarcodeDetector = originalBarcodeDetector;
    } else {
      delete globalThis.BarcodeDetector;
    }
  });

  it('should detect BarcodeDetector when available', async () => {
    globalThis.BarcodeDetector = class MockBarcodeDetector {
      constructor() {}
      async detect() { return []; }
    };

    // Dynamically import to pick up the global
    const { MealPlannerPage } = await import('../../js/ui/pages/meal-planner-page.js');
    const container = document.createElement('div');
    const page = new MealPlannerPage(container, {});

    expect(page._hasBarcodeScanner()).toBe(true);
  });

  it('should detect BarcodeDetector as unavailable when not defined', async () => {
    delete globalThis.BarcodeDetector;

    const { MealPlannerPage } = await import('../../js/ui/pages/meal-planner-page.js');
    const container = document.createElement('div');
    const page = new MealPlannerPage(container, {});

    expect(page._hasBarcodeScanner()).toBe(false);
  });

  it('should render scan button only when BarcodeDetector is available', async () => {
    globalThis.BarcodeDetector = class MockBarcodeDetector {
      constructor() {}
      async detect() { return []; }
    };

    const { MealPlannerPage } = await import('../../js/ui/pages/meal-planner-page.js');
    const container = document.createElement('div');
    store.set('currentUser', { id: 'u1', username: 'test', displayName: 'Test', sessionId: 's1' });

    const page = new MealPlannerPage(container, {});
    page.state.plan = { id: 'p1', meals: [{ name: 'Lunch', items: [] }], totals: { calories: 0, protein: 0, carbs: 0, fat: 0 } };
    page.render();

    // Open food search modal for meal index 0
    page._openFoodSearchModal(0);

    const scanBtn = page._modal.el.querySelector('.js-barcode-scan-btn');
    expect(scanBtn).toBeTruthy();

    // Manual barcode input should still exist
    const barcodeInput = page._modal.el.querySelector('.js-barcode-input');
    expect(barcodeInput).toBeTruthy();

    page._modal.close();
  });

  it('should not render scan button when BarcodeDetector is unavailable', async () => {
    delete globalThis.BarcodeDetector;

    const { MealPlannerPage } = await import('../../js/ui/pages/meal-planner-page.js');
    const container = document.createElement('div');
    store.set('currentUser', { id: 'u1', username: 'test', displayName: 'Test', sessionId: 's1' });

    const page = new MealPlannerPage(container, {});
    page.state.plan = { id: 'p1', meals: [{ name: 'Lunch', items: [] }], totals: { calories: 0, protein: 0, carbs: 0, fat: 0 } };
    page.render();

    page._openFoodSearchModal(0);

    const scanBtn = page._modal.el.querySelector('.js-barcode-scan-btn');
    expect(scanBtn).toBeNull();

    // Manual barcode input should still be present as fallback
    const barcodeInput = page._modal.el.querySelector('.js-barcode-input');
    expect(barcodeInput).toBeTruthy();

    // Search button should still work
    const searchBtn = page._modal.el.querySelector('.js-food-search-btn');
    expect(searchBtn).toBeTruthy();

    page._modal.close();
  });

  it('should always preserve manual barcode text input regardless of scanner availability', async () => {
    // Test with scanner available
    globalThis.BarcodeDetector = class { async detect() { return []; } };

    const { MealPlannerPage } = await import('../../js/ui/pages/meal-planner-page.js');
    const container = document.createElement('div');
    store.set('currentUser', { id: 'u1', username: 'test', displayName: 'Test', sessionId: 's1' });

    const page = new MealPlannerPage(container, {});
    page.state.plan = { id: 'p1', meals: [{ name: 'Lunch', items: [] }], totals: { calories: 0, protein: 0, carbs: 0, fat: 0 } };
    page.render();

    page._openFoodSearchModal(0);
    const barcodeInput = page._modal.el.querySelector('.js-barcode-input');
    expect(barcodeInput).toBeTruthy();
    expect(barcodeInput.type).toBe('text');
    expect(barcodeInput.placeholder).toContain('Barcode');

    page._modal.close();
  });

  it('should stop scanner when _stopBarcodeScanner is called', async () => {
    globalThis.BarcodeDetector = class { async detect() { return []; } };

    const { MealPlannerPage } = await import('../../js/ui/pages/meal-planner-page.js');
    const container = document.createElement('div');
    store.set('currentUser', { id: 'u1', username: 'test', displayName: 'Test', sessionId: 's1' });

    const page = new MealPlannerPage(container, {});
    page.state.plan = { id: 'p1', meals: [{ name: 'Lunch', items: [] }], totals: { calories: 0, protein: 0, carbs: 0, fat: 0 } };
    page.render();

    // Simulate that scanner was started
    const stopFn = vi.fn();
    page._scannerActive = true;
    page._scannerStream = {
      getTracks: () => [{ stop: stopFn }]
    };
    page._scannerRaf = 123;

    page._stopBarcodeScanner();

    expect(page._scannerActive).toBe(false);
    expect(page._scannerStream).toBeNull();
    expect(page._scannerRaf).toBeNull();
    expect(stopFn).toHaveBeenCalled();
  });

  it('should clean up scanner on page destroy', async () => {
    globalThis.BarcodeDetector = class { async detect() { return []; } };

    const { MealPlannerPage } = await import('../../js/ui/pages/meal-planner-page.js');
    const container = document.createElement('div');
    store.set('currentUser', { id: 'u1', username: 'test', displayName: 'Test', sessionId: 's1' });

    const page = new MealPlannerPage(container, {});
    page.state.plan = { id: 'p1', meals: [{ name: 'Lunch', items: [] }], totals: { calories: 0, protein: 0, carbs: 0, fat: 0 } };
    page.render();

    // Simulate active scanner state
    const stopFn = vi.fn();
    page._scannerActive = true;
    page._scannerStream = { getTracks: () => [{ stop: stopFn }] };

    page.destroy();

    expect(page._scannerActive).toBe(false);
    expect(stopFn).toHaveBeenCalled();
  });
});
