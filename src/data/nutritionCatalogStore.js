import bundledNutritionSummary from "./nutritionPlanSummary.json";
import { dietTypeToRation } from "./profileStore";
import {
  currentUserId,
  readUserScopedCache,
  writeUserScopedCache,
} from "./userScopedCache";

export const NUTRITION_PLAN_CACHE_KEY = "fruitfit.nutrition_plan";
let loadedBundledNutritionData = null;
let bundledNutritionPromise = null;

function cleanText(value) {
  return String(value || "").trim();
}

function nearestTarget(targets = [], preferred = 1800) {
  const normalized = targets.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const value = Number(preferred) || 1800;
  if (!normalized.length) return value;
  return normalized.reduce((best, current) => (
    Math.abs(current - value) < Math.abs(best - value) ? current : best
  ), normalized[0]);
}

export function nutritionSelectionFromProfile(profile = {}, data = bundledNutritionSummary) {
  const assignment = profile.nutritionAssignment || profile.nutrition_assignment || {};
  const availableRations = data?.filters?.rations || bundledNutritionSummary?.filters?.rations || [];
  const preferredRation = cleanText(
    assignment.ration
    || profile.ration
    || dietTypeToRation[assignment.dietType || assignment.diet_type || profile.dietType || profile.diet_type]
  );
  const ration = availableRations.includes(preferredRation)
    ? preferredRation
    : preferredRation || availableRations[0] || "Без ограничений";
  const caloriesTarget = nearestTarget(
    data?.filters?.caloriesTargets || bundledNutritionSummary?.filters?.caloriesTargets || [],
    assignment.caloriesTarget
      || assignment.calories_target
      || profile.recommendedCaloriesTarget
      || profile.recommended_calories_target
      || profile.calculatedCalories
      || profile.calculated_calories
      || 1800
  );
  return { ration, caloriesTarget };
}

export function isValidNutritionData(data) {
  return Boolean(
    data
    && Array.isArray(data.meals)
    && data.meals.length
    && data.filters
    && Array.isArray(data.filters.days)
    && Array.isArray(data.filters.mealTypes)
  );
}

export function nutritionCacheMatches(data, {
  profile = {},
  fullCatalog = false,
  userId = currentUserId(),
} = {}) {
  if (!isValidNutritionData(data)) return false;
  if (cleanText(data.scope?.userId) && cleanText(data.scope.userId) !== cleanText(userId)) return false;
  if (Boolean(data.scope?.fullCatalog) !== Boolean(fullCatalog)) return false;
  if (fullCatalog) return true;
  const expected = nutritionSelectionFromProfile(profile, bundledNutritionSummary);
  return cleanText(data.scope?.ration) === expected.ration
    && Number(data.scope?.caloriesTarget) === Number(expected.caloriesTarget);
}

export function readCachedNutritionData({
  profile = {},
  fullCatalog = false,
  userId = currentUserId(),
} = {}) {
  const cached = readUserScopedCache(NUTRITION_PLAN_CACHE_KEY, userId, null);
  return nutritionCacheMatches(cached, { profile, fullCatalog, userId }) ? cached : null;
}

export function writeCachedNutritionData(data, userId = currentUserId()) {
  if (!isValidNutritionData(data)) return null;
  return writeUserScopedCache(NUTRITION_PLAN_CACHE_KEY, data, userId);
}

export function activeNutritionData(profile = {}, {
  fullCatalog = false,
  userId = currentUserId(),
} = {}) {
  return readCachedNutritionData({ profile, fullCatalog, userId }) || bundledNutritionSummary;
}

export function bundledNutritionCatalog() {
  return bundledNutritionSummary;
}

export async function loadBundledNutritionCatalog() {
  if (loadedBundledNutritionData) return loadedBundledNutritionData;
  if (!bundledNutritionPromise) {
    bundledNutritionPromise = fetch("/data/nutrition.json", {
      method: "GET",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("NUTRITION_BUNDLE_UNAVAILABLE");
        const data = await response.json();
        if (!isValidNutritionData(data)) throw new Error("NUTRITION_BUNDLE_INVALID");
        loadedBundledNutritionData = data;
        return data;
      })
      .finally(() => {
        bundledNutritionPromise = null;
      });
  }
  return bundledNutritionPromise;
}
