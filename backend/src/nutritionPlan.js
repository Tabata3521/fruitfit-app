import fs from "node:fs/promises";
import { config } from "./config.js";

let cachedCatalog = null;
let cachedModifiedAtMs = -1;
const DEFAULT_CALORIE_TARGETS = [1200, 1400, 1600, 1800, 2000, 2200, 2400, 2600, 2800, 3000];

function cleanText(value) {
  return String(value || "").trim();
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nearestTarget(targets = [], preferred = 1800) {
  const normalized = targets.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const value = numberOrNull(preferred) || 1800;
  if (!normalized.length) return value;
  return normalized.reduce((best, current) => (
    Math.abs(current - value) < Math.abs(best - value) ? current : best
  ), normalized[0]);
}

export function calculateRecommendedNutritionTarget(profile = {}, targets = DEFAULT_CALORIE_TARGETS) {
  const gender = profile.gender === "male" ? "male" : "female";
  const age = Math.max(1, numberOrNull(profile.age) || 30);
  const height = Math.max(1, numberOrNull(profile.height || profile.heightCm || profile.height_cm) || 170);
  const weight = Math.max(1, numberOrNull(profile.weight || profile.weightKg || profile.weight_kg) || 70);
  const frequency = cleanText(profile.trainingFrequency || profile.training_frequency || profile.frequency);
  const workoutsPerWeek = frequency.startsWith("3") ? 3 : 2;
  const activityMultiplier = workoutsPerWeek >= 3 ? 1.55 : 1.35;
  const goal = cleanText(profile.goal || profile.trainingGoal || profile.training_goal).toLowerCase();
  const isMuscleGain = goal.includes("масс") || goal.includes("набор");
  const goalOffset = goal.includes("похуд") ? -300 : isMuscleGain ? 200 : 0;
  const bmr = 10 * weight + 6.25 * height - 5 * age + (gender === "male" ? 5 : -161);
  const calculatedCalories = Math.min(Math.max(1200, Math.round(bmr * activityMultiplier + goalOffset)), 3000);
  const normalizedTargets = targets.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const recommendedCaloriesTarget = isMuscleGain
    ? normalizedTargets.find((target) => target >= calculatedCalories) || normalizedTargets.at(-1) || calculatedCalories
    : nearestTarget(normalizedTargets, calculatedCalories);
  return {
    bmr: Math.round(bmr),
    workoutsPerWeek,
    activityMultiplier,
    calculatedCalories,
    recommendedCaloriesTarget,
    isMuscleGain,
  };
}

function rationFromProfile(profile = {}, available = []) {
  const assignment = profile.nutritionAssignment || profile.nutrition_assignment || {};
  const direct = cleanText(assignment.ration || profile.ration);
  if (direct && available.includes(direct)) return direct;

  const dietType = cleanText(
    assignment.dietType
    || assignment.diet_type
    || profile.dietType
    || profile.diet_type
    || profile.nutritionType
    || profile.nutrition_type
  ).toLowerCase();
  let ration = "Без ограничений";
  if (dietType.includes("мяс")) ration = "Мясоеды";
  else if (dietType.includes("рыб")) ration = "Рыбоеды";
  else if (dietType.includes("вегет")) ration = "Вегетарианство";
  else if (dietType.includes("лакт") && dietType.includes("глют")) ration = "Без глютена и без лактозы";
  else if (dietType.includes("лакт")) ration = "Без лактозы";
  else if (dietType.includes("глют")) ration = "Без глютена";
  return available.includes(ration) ? ration : available[0] || ration;
}

function caloriesFromProfile(profile = {}, targets = []) {
  const assignment = profile.nutritionAssignment || profile.nutrition_assignment || {};
  const storedTarget = (
    assignment.caloriesTarget
    || assignment.calories_target
    || profile.recommendedCaloriesTarget
    || profile.recommended_calories_target
    || profile.calculatedCalories
    || profile.calculated_calories
  );
  return storedTarget
    ? nearestTarget(targets, storedTarget)
    : calculateRecommendedNutritionTarget(profile, targets).recommendedCaloriesTarget;
}

export async function loadNutritionCatalog() {
  const stat = await fs.stat(config.nutritionPlanPath);
  if (cachedCatalog && cachedModifiedAtMs === stat.mtimeMs) return cachedCatalog;
  const parsed = JSON.parse(await fs.readFile(config.nutritionPlanPath, "utf8"));
  if (!Array.isArray(parsed?.meals) || !parsed?.filters || typeof parsed.filters !== "object") {
    throw new Error("NUTRITION_PLAN_INVALID");
  }
  cachedCatalog = parsed;
  cachedModifiedAtMs = stat.mtimeMs;
  return cachedCatalog;
}

export function buildNutritionPlanResponse(catalog, {
  profile = {},
  userId = "",
  fullCatalog = false,
} = {}) {
  const filters = catalog?.filters || {};
  const ration = rationFromProfile(profile, filters.rations || []);
  const caloriesTarget = caloriesFromProfile(profile, filters.caloriesTargets || []);
  const plans = fullCatalog
    ? { ...(catalog.plans || {}) }
    : Object.fromEntries(Object.entries(catalog.plans || {}).filter(([, plan]) => (
      plan?.ration === ration && Number(plan?.caloriesTarget) === Number(caloriesTarget)
    )));
  const meals = fullCatalog
    ? [...(catalog.meals || [])]
    : (catalog.meals || []).filter((meal) => (
      meal?.rations?.includes(ration)
      && meal?.caloriesTargets?.includes(Number(caloriesTarget))
    ));

  return {
    contentVersion: catalog.contentVersion || null,
    importedAt: catalog.importedAt || null,
    source: "server",
    scope: {
      userId: cleanText(userId) || null,
      ration: fullCatalog ? null : ration,
      caloriesTarget: fullCatalog ? null : caloriesTarget,
      fullCatalog: Boolean(fullCatalog),
    },
    meals,
    plans,
    filters: fullCatalog
      ? filters
      : {
        rations: ration ? [ration] : [],
        caloriesTargets: Number.isFinite(Number(caloriesTarget)) ? [Number(caloriesTarget)] : [],
        days: filters.days || [],
        mealTypes: filters.mealTypes || [],
      },
    imageSource: catalog.imageSource || null,
  };
}

export function isNutritionCatalogPrivileged(user = {}, access = {}) {
  const role = cleanText(access.role || user.role).toLowerCase();
  const status = cleanText(access.status).toLowerCase();
  return Boolean(
    access.isAdmin
    || access.isTrainer
    || access.isTest
    || ["admin", "trainer", "test"].includes(role)
    || ["admin", "trainer", "test"].includes(status)
  );
}

export function resetNutritionCatalogCacheForTests() {
  cachedCatalog = null;
  cachedModifiedAtMs = -1;
}
