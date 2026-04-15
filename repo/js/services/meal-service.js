import { db } from '../core/db.js';
import { bus } from '../core/event-bus.js';
import { store } from '../core/store.js';
import { sync } from '../core/sync.js';
import { uuid, now } from '../core/utils.js';

const NUTRIENT_KEYS = [
  'calories', 'protein', 'carbs', 'fat', 'fiber', 'sodium',
  'sugar', 'cholesterol', 'vitaminA', 'vitaminC', 'calcium', 'iron'
];

function emptyTotals() {
  const totals = {};
  for (const key of NUTRIENT_KEYS) {
    totals[key] = 0;
  }
  return totals;
}

function scaleNutrients(food, quantity) {
  const servingSize = food.servingSize || 1;
  const factor = quantity / servingSize;
  const scaled = {};
  for (const key of NUTRIENT_KEYS) {
    scaled[key] = Math.round(((food[key] || 0) * factor) * 100) / 100;
  }
  return scaled;
}

function recalculateTotals(plan) {
  const totals = emptyTotals();
  for (const meal of plan.meals) {
    for (const item of meal.items) {
      for (const key of NUTRIENT_KEYS) {
        totals[key] += item.nutrients?.[key] || 0;
      }
    }
  }
  // Round totals to two decimal places
  for (const key of NUTRIENT_KEYS) {
    totals[key] = Math.round(totals[key] * 100) / 100;
  }
  return totals;
}

export const mealService = {
  async initNutrientDb() {
    const count = await db.count('nutrientDb');
    if (count > 0) return;

    const response = await fetch('/data/nutrients.json');
    const foods = await response.json();
    await db.putBatch('nutrientDb', foods);
  },

  async searchFoods(query, limit = 20) {
    const all = await db.getAll('nutrientDb');
    const lower = query.toLowerCase();
    const matches = [];
    for (const food of all) {
      if (food.name && food.name.toLowerCase().includes(lower)) {
        matches.push(food);
        if (matches.length >= limit) break;
      }
    }
    return matches;
  },

  async lookupBarcode(barcode) {
    const food = await db.getByIndex('nutrientDb', 'barcode', barcode);
    return food || null;
  },

  async createMealPlan(date) {
    const currentUser = store.get('currentUser');
    const plan = {
      id: uuid(),
      profileId: currentUser?.id || null,
      date,
      meals: [],
      totals: emptyTotals(),
      createdAt: now(),
      updatedAt: now()
    };
    await db.put('mealPlans', plan);
    bus.emit('meal:plan-created', plan);
    sync.broadcast({ type: 'db-change', store: 'mealPlans', key: plan.id, data: plan });
    return plan;
  },

  async getMealPlan(date) {
    const currentUser = store.get('currentUser');
    const profileId = currentUser?.id || null;
    const plans = await db.getAllByIndex('mealPlans', 'profileId_date', [profileId, date]);
    return plans[0] || null;
  },

  async getMealPlans(startDate, endDate) {
    const currentUser = store.get('currentUser');
    const profileId = currentUser?.id || null;
    const all = await db.getAllByIndex('mealPlans', 'profileId', profileId);
    return all.filter(p => p.date >= startDate && p.date <= endDate)
      .sort((a, b) => a.date.localeCompare(b.date));
  },

  async addMeal(planId, mealName) {
    const plan = await db.get('mealPlans', planId);
    if (!plan) throw new Error('Meal plan not found');

    const meal = {
      name: mealName,
      items: []
    };
    plan.meals.push(meal);
    plan.updatedAt = now();
    await db.put('mealPlans', plan);
    bus.emit('meal:meal-added', { planId, mealName });
    sync.broadcast({ type: 'db-change', store: 'mealPlans', key: plan.id, data: plan });
    return plan;
  },

  async addFoodToMeal(planId, mealIndex, food) {
    const plan = await db.get('mealPlans', planId);
    if (!plan) throw new Error('Meal plan not found');
    if (!plan.meals[mealIndex]) throw new Error('Meal not found');

    // Look up full nutrient data from nutrientDb
    let nutrientData = null;
    if (food.foodId) {
      nutrientData = await db.get('nutrientDb', food.foodId);
    }
    if (!nutrientData && food.barcode) {
      nutrientData = await db.getByIndex('nutrientDb', 'barcode', food.barcode);
    }

    const quantity = food.quantity || 1;
    const nutrients = nutrientData ? scaleNutrients(nutrientData, quantity) : emptyTotals();

    const item = {
      foodId: food.foodId,
      name: food.name,
      quantity,
      unit: food.unit || 'serving',
      barcode: food.barcode || null,
      nutrients
    };

    plan.meals[mealIndex].items.push(item);
    plan.totals = recalculateTotals(plan);
    plan.updatedAt = now();
    await db.put('mealPlans', plan);
    bus.emit('meal:food-added', { planId, mealIndex, item });
    sync.broadcast({ type: 'db-change', store: 'mealPlans', key: plan.id, data: plan });
    return plan;
  },

  async removeFoodFromMeal(planId, mealIndex, itemIndex) {
    const plan = await db.get('mealPlans', planId);
    if (!plan) throw new Error('Meal plan not found');
    if (!plan.meals[mealIndex]) throw new Error('Meal not found');
    if (!plan.meals[mealIndex].items[itemIndex]) throw new Error('Food item not found');

    plan.meals[mealIndex].items.splice(itemIndex, 1);
    plan.totals = recalculateTotals(plan);
    plan.updatedAt = now();
    await db.put('mealPlans', plan);
    bus.emit('meal:food-removed', { planId, mealIndex, itemIndex });
    sync.broadcast({ type: 'db-change', store: 'mealPlans', key: plan.id, data: plan });
    return plan;
  },

  async updateFoodQuantity(planId, mealIndex, itemIndex, quantity) {
    const plan = await db.get('mealPlans', planId);
    if (!plan) throw new Error('Meal plan not found');
    if (!plan.meals[mealIndex]) throw new Error('Meal not found');

    const item = plan.meals[mealIndex].items[itemIndex];
    if (!item) throw new Error('Food item not found');

    item.quantity = quantity;

    // Re-look up nutrient data and recalculate for this item
    let nutrientData = null;
    if (item.foodId) {
      nutrientData = await db.get('nutrientDb', item.foodId);
    }
    if (!nutrientData && item.barcode) {
      nutrientData = await db.getByIndex('nutrientDb', 'barcode', item.barcode);
    }

    item.nutrients = nutrientData ? scaleNutrients(nutrientData, quantity) : emptyTotals();

    plan.totals = recalculateTotals(plan);
    plan.updatedAt = now();
    await db.put('mealPlans', plan);
    bus.emit('meal:food-updated', { planId, mealIndex, itemIndex, quantity });
    sync.broadcast({ type: 'db-change', store: 'mealPlans', key: plan.id, data: plan });
    return plan;
  },

  calculateTotals(plan) {
    return recalculateTotals(plan);
  },

  async deleteMealPlan(planId) {
    await db.delete('mealPlans', planId);
    bus.emit('meal:plan-deleted', { planId });
    sync.broadcast({ type: 'db-change', store: 'mealPlans', key: planId, action: 'delete' });
  }
};
