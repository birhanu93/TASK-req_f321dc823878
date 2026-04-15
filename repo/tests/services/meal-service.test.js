import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetAll, setCurrentUser } from '../helpers.js';
import { db } from '../../js/core/db.js';
import { bus } from '../../js/core/event-bus.js';
import { mealService } from '../../js/services/meal-service.js';

beforeEach(async () => {
  await resetAll();
  setCurrentUser();

  // Seed nutrient database with test foods
  await db.putBatch('nutrientDb', [
    {
      id: 'f1', name: 'Chicken Breast', barcode: '001',
      servingSize: 150, servingUnit: 'g',
      calories: 248, protein: 46, carbs: 0, fat: 5.4,
      fiber: 0, sodium: 104, sugar: 0, cholesterol: 119,
      vitaminA: 9, vitaminC: 0, calcium: 15, iron: 1.1
    },
    {
      id: 'f2', name: 'White Rice', barcode: '002',
      servingSize: 200, servingUnit: 'g',
      calories: 260, protein: 5.4, carbs: 56, fat: 0.6,
      fiber: 0.6, sodium: 2, sugar: 0.1, cholesterol: 0,
      vitaminA: 0, vitaminC: 0, calcium: 3, iron: 0.4
    }
  ]);
});

describe('mealService', () => {
  // ─── searchFoods ──────────────────────────────────────────────────
  describe('searchFoods', () => {
    it('should find foods by substring match', async () => {
      const results = await mealService.searchFoods('chicken');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Chicken Breast');
    });

    it('should be case-insensitive', async () => {
      const results = await mealService.searchFoods('WHITE RICE');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('White Rice');
    });

    it('should return multiple matches', async () => {
      // Both foods contain common letter patterns
      const results = await mealService.searchFoods('e');
      // "Chicken Breast" contains 'e', "White Rice" contains 'e'
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('should respect the limit parameter', async () => {
      const results = await mealService.searchFoods('e', 1);
      expect(results).toHaveLength(1);
    });

    it('should return empty array when no match found', async () => {
      const results = await mealService.searchFoods('pizza');
      expect(results).toHaveLength(0);
    });
  });

  // ─── lookupBarcode ────────────────────────────────────────────────
  describe('lookupBarcode', () => {
    it('should find a food by barcode', async () => {
      const food = await mealService.lookupBarcode('001');
      expect(food).toBeTruthy();
      expect(food.name).toBe('Chicken Breast');
    });

    it('should return null for unknown barcode', async () => {
      const food = await mealService.lookupBarcode('999');
      expect(food).toBeNull();
    });
  });

  // ─── createMealPlan ───────────────────────────────────────────────
  describe('createMealPlan', () => {
    it('should create a meal plan with the given date and empty meals', async () => {
      const plan = await mealService.createMealPlan('2026-04-14');
      expect(plan).toHaveProperty('id');
      expect(plan.date).toBe('2026-04-14');
      expect(plan.profileId).toBe('u1');
      expect(plan.meals).toEqual([]);
      expect(plan.totals).toEqual(expect.objectContaining({ calories: 0, protein: 0, carbs: 0, fat: 0 }));
      expect(plan).toHaveProperty('createdAt');
      expect(plan).toHaveProperty('updatedAt');
    });

    it('should persist the plan in the database', async () => {
      const plan = await mealService.createMealPlan('2026-04-14');
      const stored = await db.get('mealPlans', plan.id);
      expect(stored).toBeTruthy();
      expect(stored.date).toBe('2026-04-14');
    });

    it('should emit meal:plan-created event', async () => {
      const handler = vi.fn();
      bus.on('meal:plan-created', handler);
      await mealService.createMealPlan('2026-04-14');
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].date).toBe('2026-04-14');
    });
  });

  // ─── getMealPlan ──────────────────────────────────────────────────
  describe('getMealPlan', () => {
    it('should return the plan for the current user and date', async () => {
      await mealService.createMealPlan('2026-04-14');
      const plan = await mealService.getMealPlan('2026-04-14');
      expect(plan).toBeTruthy();
      expect(plan.date).toBe('2026-04-14');
      expect(plan.profileId).toBe('u1');
    });

    it('should return null if no plan exists for the date', async () => {
      const plan = await mealService.getMealPlan('2099-01-01');
      expect(plan).toBeNull();
    });

    it('should not return plans belonging to other users', async () => {
      await mealService.createMealPlan('2026-04-14');
      // Switch to a different user
      setCurrentUser({ id: 'u2', username: 'other', displayName: 'Other', sessionId: 's2' });
      const plan = await mealService.getMealPlan('2026-04-14');
      expect(plan).toBeNull();
    });
  });

  // ─── addMeal ──────────────────────────────────────────────────────
  describe('addMeal', () => {
    it('should add a meal section to the plan', async () => {
      const plan = await mealService.createMealPlan('2026-04-14');
      const updated = await mealService.addMeal(plan.id, 'Breakfast');
      expect(updated.meals).toHaveLength(1);
      expect(updated.meals[0].name).toBe('Breakfast');
      expect(updated.meals[0].items).toEqual([]);
    });

    it('should allow adding multiple meals', async () => {
      const plan = await mealService.createMealPlan('2026-04-14');
      await mealService.addMeal(plan.id, 'Breakfast');
      const updated = await mealService.addMeal(plan.id, 'Lunch');
      expect(updated.meals).toHaveLength(2);
      expect(updated.meals[1].name).toBe('Lunch');
    });

    it('should emit meal:meal-added event', async () => {
      const plan = await mealService.createMealPlan('2026-04-14');
      const handler = vi.fn();
      bus.on('meal:meal-added', handler);
      await mealService.addMeal(plan.id, 'Dinner');
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toEqual({ planId: plan.id, mealName: 'Dinner' });
    });

    it('should throw for non-existent plan', async () => {
      await expect(mealService.addMeal('nonexistent', 'Breakfast'))
        .rejects.toThrow('Meal plan not found');
    });
  });

  // ─── addFoodToMeal ────────────────────────────────────────────────
  describe('addFoodToMeal', () => {
    it('should add a food item with scaled nutrients', async () => {
      const plan = await mealService.createMealPlan('2026-04-14');
      await mealService.addMeal(plan.id, 'Lunch');

      const updated = await mealService.addFoodToMeal(plan.id, 0, {
        foodId: 'f1',
        name: 'Chicken Breast',
        quantity: 150,
        unit: 'g'
      });

      const item = updated.meals[0].items[0];
      expect(item.name).toBe('Chicken Breast');
      expect(item.quantity).toBe(150);
      // At quantity=150, servingSize=150, factor=1 so nutrients are 1:1
      expect(item.nutrients.calories).toBe(248);
      expect(item.nutrients.protein).toBe(46);
    });

    it('should scale nutrients based on quantity vs serving size', async () => {
      const plan = await mealService.createMealPlan('2026-04-14');
      await mealService.addMeal(plan.id, 'Lunch');

      // Half serving of chicken (75g of 150g serving)
      const updated = await mealService.addFoodToMeal(plan.id, 0, {
        foodId: 'f1',
        name: 'Chicken Breast',
        quantity: 75,
        unit: 'g'
      });

      const item = updated.meals[0].items[0];
      expect(item.nutrients.calories).toBe(124);
      expect(item.nutrients.protein).toBe(23);
    });

    it('should recalculate totals after adding food', async () => {
      const plan = await mealService.createMealPlan('2026-04-14');
      await mealService.addMeal(plan.id, 'Lunch');

      const updated = await mealService.addFoodToMeal(plan.id, 0, {
        foodId: 'f1',
        name: 'Chicken Breast',
        quantity: 150,
        unit: 'g'
      });

      expect(updated.totals.calories).toBe(248);
      expect(updated.totals.protein).toBe(46);
    });

    it('should look up food by barcode when foodId is absent', async () => {
      const plan = await mealService.createMealPlan('2026-04-14');
      await mealService.addMeal(plan.id, 'Lunch');

      const updated = await mealService.addFoodToMeal(plan.id, 0, {
        name: 'White Rice',
        barcode: '002',
        quantity: 200,
        unit: 'g'
      });

      const item = updated.meals[0].items[0];
      expect(item.nutrients.calories).toBe(260);
      expect(item.nutrients.carbs).toBe(56);
    });

    it('should throw for non-existent meal index', async () => {
      const plan = await mealService.createMealPlan('2026-04-14');
      await expect(mealService.addFoodToMeal(plan.id, 5, {
        foodId: 'f1', name: 'Chicken', quantity: 100
      })).rejects.toThrow('Meal not found');
    });

    it('should emit meal:food-added event', async () => {
      const plan = await mealService.createMealPlan('2026-04-14');
      await mealService.addMeal(plan.id, 'Lunch');
      const handler = vi.fn();
      bus.on('meal:food-added', handler);

      await mealService.addFoodToMeal(plan.id, 0, {
        foodId: 'f1', name: 'Chicken Breast', quantity: 150
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].planId).toBe(plan.id);
      expect(handler.mock.calls[0][0].mealIndex).toBe(0);
    });
  });

  // ─── removeFoodFromMeal ───────────────────────────────────────────
  describe('removeFoodFromMeal', () => {
    it('should remove an item and recalculate totals', async () => {
      const plan = await mealService.createMealPlan('2026-04-14');
      await mealService.addMeal(plan.id, 'Lunch');
      await mealService.addFoodToMeal(plan.id, 0, {
        foodId: 'f1', name: 'Chicken Breast', quantity: 150, unit: 'g'
      });
      await mealService.addFoodToMeal(plan.id, 0, {
        foodId: 'f2', name: 'White Rice', quantity: 200, unit: 'g'
      });

      // Remove the first item (chicken)
      const updated = await mealService.removeFoodFromMeal(plan.id, 0, 0);
      expect(updated.meals[0].items).toHaveLength(1);
      expect(updated.meals[0].items[0].name).toBe('White Rice');
      // Totals should reflect only rice
      expect(updated.totals.calories).toBe(260);
      expect(updated.totals.protein).toBe(5.4);
    });

    it('should emit meal:food-removed event', async () => {
      const plan = await mealService.createMealPlan('2026-04-14');
      await mealService.addMeal(plan.id, 'Lunch');
      await mealService.addFoodToMeal(plan.id, 0, {
        foodId: 'f1', name: 'Chicken', quantity: 150
      });

      const handler = vi.fn();
      bus.on('meal:food-removed', handler);
      await mealService.removeFoodFromMeal(plan.id, 0, 0);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should throw for invalid item index', async () => {
      const plan = await mealService.createMealPlan('2026-04-14');
      await mealService.addMeal(plan.id, 'Lunch');
      await expect(mealService.removeFoodFromMeal(plan.id, 0, 99))
        .rejects.toThrow('Food item not found');
    });

    it('should set totals to zero when all items are removed', async () => {
      const plan = await mealService.createMealPlan('2026-04-14');
      await mealService.addMeal(plan.id, 'Lunch');
      await mealService.addFoodToMeal(plan.id, 0, {
        foodId: 'f1', name: 'Chicken', quantity: 150
      });
      const updated = await mealService.removeFoodFromMeal(plan.id, 0, 0);
      expect(updated.totals.calories).toBe(0);
      expect(updated.totals.protein).toBe(0);
    });
  });

  // ─── updateFoodQuantity ───────────────────────────────────────────
  describe('updateFoodQuantity', () => {
    it('should update quantity and recalculate nutrients', async () => {
      const plan = await mealService.createMealPlan('2026-04-14');
      await mealService.addMeal(plan.id, 'Lunch');
      await mealService.addFoodToMeal(plan.id, 0, {
        foodId: 'f1', name: 'Chicken Breast', quantity: 150, unit: 'g'
      });

      // Double the quantity
      const updated = await mealService.updateFoodQuantity(plan.id, 0, 0, 300);
      const item = updated.meals[0].items[0];
      expect(item.quantity).toBe(300);
      // factor = 300/150 = 2 so nutrients should be doubled
      expect(item.nutrients.calories).toBe(496);
      expect(item.nutrients.protein).toBe(92);
      expect(updated.totals.calories).toBe(496);
    });

    it('should emit meal:food-updated event', async () => {
      const plan = await mealService.createMealPlan('2026-04-14');
      await mealService.addMeal(plan.id, 'Lunch');
      await mealService.addFoodToMeal(plan.id, 0, {
        foodId: 'f1', name: 'Chicken', quantity: 150
      });

      const handler = vi.fn();
      bus.on('meal:food-updated', handler);
      await mealService.updateFoodQuantity(plan.id, 0, 0, 300);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].quantity).toBe(300);
    });

    it('should throw for non-existent food item', async () => {
      const plan = await mealService.createMealPlan('2026-04-14');
      await mealService.addMeal(plan.id, 'Lunch');
      await expect(mealService.updateFoodQuantity(plan.id, 0, 99, 200))
        .rejects.toThrow('Food item not found');
    });
  });

  // ─── calculateTotals ─────────────────────────────────────────────
  describe('calculateTotals', () => {
    it('should sum nutrients across all meals', () => {
      const plan = {
        meals: [
          {
            name: 'Breakfast',
            items: [
              { nutrients: { calories: 100, protein: 10, carbs: 20, fat: 5, fiber: 2, sodium: 50, sugar: 3, cholesterol: 10, vitaminA: 1, vitaminC: 2, calcium: 5, iron: 0.5 } }
            ]
          },
          {
            name: 'Lunch',
            items: [
              { nutrients: { calories: 200, protein: 20, carbs: 30, fat: 10, fiber: 3, sodium: 100, sugar: 5, cholesterol: 20, vitaminA: 2, vitaminC: 3, calcium: 10, iron: 1 } }
            ]
          }
        ]
      };

      const totals = mealService.calculateTotals(plan);
      expect(totals.calories).toBe(300);
      expect(totals.protein).toBe(30);
      expect(totals.carbs).toBe(50);
      expect(totals.fat).toBe(15);
    });

    it('should return zeroes for empty plan', () => {
      const plan = { meals: [] };
      const totals = mealService.calculateTotals(plan);
      expect(totals.calories).toBe(0);
      expect(totals.protein).toBe(0);
    });
  });

  // ─── deleteMealPlan ───────────────────────────────────────────────
  describe('deleteMealPlan', () => {
    it('should remove the plan from the database', async () => {
      const plan = await mealService.createMealPlan('2026-04-14');
      await mealService.deleteMealPlan(plan.id);
      const stored = await db.get('mealPlans', plan.id);
      expect(stored).toBeUndefined();
    });

    it('should emit meal:plan-deleted event', async () => {
      const plan = await mealService.createMealPlan('2026-04-14');
      const handler = vi.fn();
      bus.on('meal:plan-deleted', handler);
      await mealService.deleteMealPlan(plan.id);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toEqual({ planId: plan.id });
    });
  });
});
