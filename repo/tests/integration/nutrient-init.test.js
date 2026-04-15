import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetAll, setCurrentUser } from '../helpers.js';
import { db } from '../../js/core/db.js';
import { mealService } from '../../js/services/meal-service.js';

// Sample nutrient data matching /data/nutrients.json structure
const SAMPLE_NUTRIENTS = [
  {
    id: 'n001', name: 'White Rice (cooked)', barcode: '0001',
    servingSize: 200, servingUnit: 'g',
    calories: 260, protein: 5.4, carbs: 56, fat: 0.6,
    fiber: 0.6, sodium: 2, sugar: 0.1, cholesterol: 0,
    vitaminA: 0, vitaminC: 0, calcium: 3, iron: 0.4
  },
  {
    id: 'n002', name: 'Chicken Breast (grilled)', barcode: '0002',
    servingSize: 150, servingUnit: 'g',
    calories: 248, protein: 46.0, carbs: 0, fat: 5.4,
    fiber: 0, sodium: 104, sugar: 0, cholesterol: 119,
    vitaminA: 9, vitaminC: 0, calcium: 15, iron: 1.1
  }
];

describe('Integration: Nutrient database initialization before food actions', () => {
  beforeEach(async () => {
    await resetAll();
    setCurrentUser();
  });

  it('should initialize nutrient database from fetch on first run', async () => {
    // Mock global fetch to return sample nutrients
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve(SAMPLE_NUTRIENTS)
    });
    globalThis.fetch = fetchMock;

    await mealService.initNutrientDb();

    // Verify data is in IndexedDB
    const count = await db.count('nutrientDb');
    expect(count).toBe(2);

    // Verify food search works
    const results = await mealService.searchFoods('rice');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('White Rice (cooked)');

    // Verify barcode lookup works
    const food = await mealService.lookupBarcode('0002');
    expect(food).toBeTruthy();
    expect(food.name).toBe('Chicken Breast (grilled)');

    delete globalThis.fetch;
  });

  it('should skip initialization if nutrient database already has data', async () => {
    // Pre-seed the database
    await db.putBatch('nutrientDb', SAMPLE_NUTRIENTS);

    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    await mealService.initNutrientDb();

    // fetch should not have been called
    expect(fetchMock).not.toHaveBeenCalled();

    delete globalThis.fetch;
  });

  it('should throw when fetch fails (network error)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('Network error'));
    globalThis.fetch = fetchMock;

    await expect(mealService.initNutrientDb()).rejects.toThrow('Network error');

    // Database should still be empty
    const count = await db.count('nutrientDb');
    expect(count).toBe(0);

    delete globalThis.fetch;
  });

  it('should allow retry after a failed initialization', async () => {
    // First attempt fails
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error('Temporary failure'));
      }
      return Promise.resolve({ json: () => Promise.resolve(SAMPLE_NUTRIENTS) });
    });

    await expect(mealService.initNutrientDb()).rejects.toThrow('Temporary failure');
    expect(await db.count('nutrientDb')).toBe(0);

    // Second attempt succeeds
    await mealService.initNutrientDb();
    expect(await db.count('nutrientDb')).toBe(2);

    delete globalThis.fetch;
  });

  it('should support food search only after initialization', async () => {
    // No nutrient data seeded — search returns empty
    const results = await mealService.searchFoods('rice');
    expect(results).toHaveLength(0);

    // Barcode returns null
    const food = await mealService.lookupBarcode('0001');
    expect(food).toBeNull();

    // Now initialize
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve(SAMPLE_NUTRIENTS)
    });
    await mealService.initNutrientDb();

    // Now search works
    const afterResults = await mealService.searchFoods('rice');
    expect(afterResults).toHaveLength(1);

    const afterBarcode = await mealService.lookupBarcode('0001');
    expect(afterBarcode).toBeTruthy();

    delete globalThis.fetch;
  });

  it('should seed all nutrient fields correctly for accurate calculations', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve(SAMPLE_NUTRIENTS)
    });
    await mealService.initNutrientDb();

    // Create a meal plan and add food to verify calculations work end-to-end
    const plan = await mealService.createMealPlan('2026-04-15');
    await mealService.addMeal(plan.id, 'Lunch');
    const updated = await mealService.addFoodToMeal(plan.id, 0, {
      foodId: 'n001',
      name: 'White Rice (cooked)',
      quantity: 200,
      unit: 'g'
    });

    const item = updated.meals[0].items[0];
    expect(item.nutrients.calories).toBe(260);
    expect(item.nutrients.protein).toBe(5.4);
    expect(item.nutrients.carbs).toBe(56);

    // Half serving
    const half = await mealService.updateFoodQuantity(plan.id, 0, 0, 100);
    expect(half.meals[0].items[0].nutrients.calories).toBe(130);
    expect(half.totals.calories).toBe(130);

    delete globalThis.fetch;
  });
});
