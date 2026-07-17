import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

process.env.NUTRITION_PLAN_PATH ||= new URL("../data/nutrition.json", import.meta.url).pathname;

const {
  buildNutritionPlanResponse,
  calculateRecommendedNutritionTarget,
  isNutritionCatalogPrivileged,
} = await import("../src/nutritionPlan.js");

const catalog = JSON.parse(await fs.readFile(new URL("../data/nutrition.json", import.meta.url), "utf8"));

test("mass-gain target rounds upward for the verified woman profile", () => {
  const result = calculateRecommendedNutritionTarget({
    gender: "female",
    age: 34,
    height: 169,
    weight: 55,
    trainingFrequency: "3",
    goal: "Набор мышечной массы",
  });
  assert.equal(result.activityMultiplier, 1.55);
  assert.equal(result.recommendedCaloriesTarget, 2200);
});

test("scoped plan only exposes the current user's ration and calorie target", () => {
  const response = buildNutritionPlanResponse(catalog, {
    userId: "user-a",
    profile: {
      dietType: "Без ограничений",
      recommendedCaloriesTarget: 2200,
    },
  });
  assert.deepEqual(response.filters.rations, ["Без ограничений"]);
  assert.deepEqual(response.filters.caloriesTargets, [2200]);
  assert.equal(response.scope.userId, "user-a");
  assert.equal(response.scope.fullCatalog, false);
  assert.equal(Object.keys(response.plans).length, 7);
  assert.ok(response.meals.length > 0);
  assert.ok(response.meals.every((meal) => (
    meal.rations.includes("Без ограничений")
    && meal.caloriesTargets.includes(2200)
  )));
  const mealIds = new Set(response.meals.map((meal) => String(meal.id)));
  for (const plan of Object.values(response.plans)) {
    assert.ok(plan.mealIds.every((id) => mealIds.has(String(id))));
  }
});

test("combined gluten and lactose restriction keeps its own mapping", () => {
  const response = buildNutritionPlanResponse(catalog, {
    userId: "user-b",
    profile: {
      dietType: "Без глютена и без лактозы",
      recommendedCaloriesTarget: 2000,
    },
  });
  assert.deepEqual(response.filters.rations, ["Без глютена и без лактозы"]);
});

test("full catalog is reserved for privileged roles", () => {
  assert.equal(isNutritionCatalogPrivileged({ role: "user" }, { status: "paid" }), false);
  assert.equal(isNutritionCatalogPrivileged({ role: "admin" }, {}), true);
  assert.equal(isNutritionCatalogPrivileged({}, { isTrainer: true }), true);
  const response = buildNutritionPlanResponse(catalog, {
    userId: "admin-a",
    profile: {},
    fullCatalog: true,
  });
  assert.equal(response.scope.fullCatalog, true);
  assert.equal(response.meals.length, catalog.meals.length);
});
