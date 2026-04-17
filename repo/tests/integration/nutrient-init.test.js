import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetAll, setCurrentUser } from '../helpers.js';
import { db } from '../../js/core/db.js';
import { mealService } from '../../js/services/meal-service.js';

/**
 * Reduced boundary mocking:
 *  - The real `/data/nutrients.json` file is loaded from disk via `fs` and served by a
 *    lightweight, hand-rolled fetch implementation (not `vi.fn()`). This exercises the
 *    real response → `.json()` → `db.putBatch` pipeline for the actual production payload
 *    instead of a synthetic 2-item fixture.
 *  - A single "transient failure then success" test uses a small stateful closure —
 *    still no vitest spies.
 */

const REAL_NUTRIENTS_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../data/nutrients.json'
);
const REAL_NUTRIENTS = JSON.parse(readFileSync(REAL_NUTRIENTS_PATH, 'utf8'));

function staticFetch(map) {
  // Real async fetch-like: returns the same Response-shaped value for a given URL,
  // throws for unknown URLs (matches browser network-error semantics).
  return async (url) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    if (!(urlStr in map)) throw new Error(`Unexpected fetch: ${urlStr}`);
    const payload = map[urlStr];
    return {
      ok: true,
      status: 200,
      async json() { return payload; },
      async text() { return JSON.stringify(payload); }
    };
  };
}

function failingFetchOnce(successBody) {
  let calls = 0;
  return async () => {
    calls += 1;
    if (calls === 1) throw new Error('Temporary failure');
    return { ok: true, status: 200, async json() { return successBody; } };
  };
}

describe('Integration: Nutrient database initialization (real /data/nutrients.json)', () => {
  beforeEach(async () => {
    await resetAll();
    setCurrentUser();
  });
  afterEach(() => {
    delete globalThis.fetch;
  });

  it('seeds the full production nutrient catalog from the real /data/nutrients.json file', async () => {
    // Sanity: the on-disk fixture is the real catalog (50 foods per README)
    expect(Array.isArray(REAL_NUTRIENTS)).toBe(true);
    expect(REAL_NUTRIENTS.length).toBeGreaterThanOrEqual(50);

    globalThis.fetch = staticFetch({ '/data/nutrients.json': REAL_NUTRIENTS });

    await mealService.initNutrientDb();

    const count = await db.count('nutrientDb');
    expect(count).toBe(REAL_NUTRIENTS.length);

    // Every seed record is reachable by id (round-trip evidence)
    for (const food of REAL_NUTRIENTS.slice(0, 5)) {
      const row = await db.get('nutrientDb', food.id);
      expect(row).toBeTruthy();
      expect(row.name).toBe(food.name);
      expect(row.calories).toBe(food.calories);
    }

    // Substring search ("rice") matches the real catalog's rice entries
    const rice = await mealService.searchFoods('rice');
    expect(rice.length).toBeGreaterThanOrEqual(1);
    expect(rice.some(r => /rice/i.test(r.name))).toBe(true);

    // Barcode index works against real data
    const byBarcode = await mealService.lookupBarcode('0001');
    expect(byBarcode).toBeTruthy();
    expect(byBarcode.id).toBe('n001');
  });

  it('skips initialization when the nutrientDb already has data (no fetch issued)', async () => {
    await db.putBatch('nutrientDb', REAL_NUTRIENTS.slice(0, 3));

    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      throw new Error('should not be called');
    };

    await mealService.initNutrientDb();
    expect(fetchCalled).toBe(false);
    expect(await db.count('nutrientDb')).toBe(3);
  });

  it('propagates a fetch rejection and leaves the DB empty', async () => {
    globalThis.fetch = async () => { throw new Error('Network error'); };

    await expect(mealService.initNutrientDb()).rejects.toThrow('Network error');
    expect(await db.count('nutrientDb')).toBe(0);
  });

  it('supports retry after a transient failure (no spies — real stateful closure)', async () => {
    globalThis.fetch = failingFetchOnce(REAL_NUTRIENTS);

    await expect(mealService.initNutrientDb()).rejects.toThrow('Temporary failure');
    expect(await db.count('nutrientDb')).toBe(0);

    // Second attempt: same closure, now succeeds and seeds the full catalog
    await mealService.initNutrientDb();
    expect(await db.count('nutrientDb')).toBe(REAL_NUTRIENTS.length);
  });

  it('food search returns empty and barcode returns null before initialization, then work after', async () => {
    expect(await mealService.searchFoods('rice')).toEqual([]);
    expect(await mealService.lookupBarcode('0001')).toBeNull();

    globalThis.fetch = staticFetch({ '/data/nutrients.json': REAL_NUTRIENTS });
    await mealService.initNutrientDb();

    expect((await mealService.searchFoods('rice')).length).toBeGreaterThan(0);
    expect(await mealService.lookupBarcode('0001')).toBeTruthy();
  });

  it('end-to-end nutrient scaling uses real catalog numbers for a real meal plan', async () => {
    globalThis.fetch = staticFetch({ '/data/nutrients.json': REAL_NUTRIENTS });
    await mealService.initNutrientDb();

    // White Rice (cooked): servingSize 200g, calories 260
    const plan = await mealService.createMealPlan('2026-04-15');
    await mealService.addMeal(plan.id, 'Lunch');
    const full = await mealService.addFoodToMeal(plan.id, 0, {
      foodId: 'n001', name: 'White Rice (cooked)', quantity: 200, unit: 'g'
    });
    expect(full.meals[0].items[0].nutrients.calories).toBe(260);

    // Half serving → 130 kcal exactly
    const half = await mealService.updateFoodQuantity(plan.id, 0, 0, 100);
    expect(half.meals[0].items[0].nutrients.calories).toBe(130);
    expect(half.totals.calories).toBe(130);
  });
});
