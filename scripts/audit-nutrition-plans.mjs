import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = process.argv[2] || path.join(projectRoot, "public", "data", "nutrition.json");
const outputPath = process.argv[3] || path.join(projectRoot, "reports", "nutrition-audit-latest.json");
const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const requiredMealTypes = ["Завтрак", "Обед", "Ужин", "Перекус"];
const amountPattern = /[—–-]\s*(\d+(?:[.,]\d+)?)\s*(?:г|мл)(?:\s|$)/i;
const portionRules = [
  ["oil", /масл/i, 20],
  ["nuts", /(?:орех|миндал|фисташ|кешью|арахис|фундук)/i, 40],
  ["tofu", /тофу/i, 250],
  ["fish", /(?:скумбр|лосос|с[её]мг|тунец|дорад|треск|хек|минтай|рыб|морепродукт|кревет|кальмар|мидии)/i, 250],
  ["meat", /(?:курин|индейк|говядин|теляти|свинин)/i, 250],
  ["corn_cereal", /кукурузн.*круп/i, 120],
  ["vegetable", /(?:морков|картоф|перец|помидор|огур|кабач|баклаж|брокколи|капуст|тыкв|св[её]кл|лук|овощ)/i, 400],
];

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function firstMealsForPlan({ ration, caloriesTarget, day }) {
  const key = `${ration}|${Number(caloriesTarget)}|${day}`;
  const plannedIds = data?.plans?.[key]?.mealIds || [];
  if (plannedIds.length) {
    const mealById = new Map((data.meals || []).map((meal) => [String(meal.id), meal]));
    return plannedIds.map((id) => mealById.get(String(id))).filter(Boolean);
  }
  const seen = new Set();
  return data.meals.filter((meal) => {
    if (!meal.rations?.includes(ration)) return false;
    if (!meal.caloriesTargets?.includes(Number(caloriesTarget))) return false;
    if (meal.day !== day || seen.has(meal.mealType)) return false;
    seen.add(meal.mealType);
    return true;
  });
}

const formulaMismatches = [];
const portionIssues = [];
const suspiciousTinyProteinPortions = [];
const missingRecipes = [];
const remotePhotos = [];
for (const meal of data.meals || []) {
  const macroCalories = Number(meal.protein || 0) * 4 + Number(meal.fat || 0) * 9 + Number(meal.carbs || 0) * 4;
  const formulaDiffPercent = Number(meal.calories)
    ? Math.abs(macroCalories - Number(meal.calories)) / Number(meal.calories) * 100
    : 100;
  if (formulaDiffPercent > 10) {
    formulaMismatches.push({ id: meal.id, title: meal.title, formulaDiffPercent: round(formulaDiffPercent) });
  }
  if (!String(meal.recipe || "").trim()) {
    missingRecipes.push({ id: meal.id, title: meal.title });
  }
  if (/^https?:\/\//i.test(String(meal.photo || ""))) {
    remotePhotos.push({ id: meal.id, title: meal.title, photo: meal.photo });
  }
  for (const ingredient of meal.ingredients || []) {
    const amount = ingredient.match(amountPattern);
    if (!amount) continue;
    const grams = Number(amount[1].replace(",", "."));
    for (const [type, pattern, limit] of portionRules) {
      if (pattern.test(ingredient) && grams > limit) {
        portionIssues.push({ id: meal.id, title: meal.title, ingredient, type, grams, limit });
        break;
      }
    }
    if (grams < 10 && /(?:курин|индейк|говядин|свинин|рыб|скумбр|лосос|тунец|треск|тофу)/i.test(ingredient)) {
      suspiciousTinyProteinPortions.push({ id: meal.id, title: meal.title, ingredient, grams });
    }
  }
}

const dailyPlans = [];
for (const ration of data.filters?.rations || []) {
  for (const caloriesTarget of data.filters?.caloriesTargets || []) {
    for (const day of data.filters?.days || []) {
      const meals = firstMealsForPlan({ ration, caloriesTarget, day });
      const totals = meals.reduce((acc, meal) => ({
        calories: acc.calories + Number(meal.calories || 0),
        protein: acc.protein + Number(meal.protein || 0),
        fat: acc.fat + Number(meal.fat || 0),
        carbs: acc.carbs + Number(meal.carbs || 0),
      }), { calories: 0, protein: 0, fat: 0, carbs: 0 });
      const mealTypes = meals.map((meal) => meal.mealType);
      const missingMealTypes = requiredMealTypes.filter((type) => !mealTypes.includes(type));
      const calorieDiffPercent = Number(caloriesTarget)
        ? Math.abs(totals.calories - Number(caloriesTarget)) / Number(caloriesTarget) * 100
        : 100;
      const fatPercent = totals.calories ? totals.fat * 9 / totals.calories * 100 : 0;
      dailyPlans.push({
        ration,
        caloriesTarget: Number(caloriesTarget),
        day,
        mealIds: meals.map((meal) => meal.id),
        mealTypes,
        missingMealTypes,
        totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, round(value)])),
        calorieDiffPercent: round(calorieDiffPercent),
        fatPercent: round(fatPercent),
      });
    }
  }
}

const casePlans = dailyPlans.filter((plan) => plan.ration === "Без ограничений" && plan.caloriesTarget === 2200);
const summary = {
  contentVersion: data.contentVersion || null,
  meals: data.meals?.length || 0,
  planCombinations: dailyPlans.length,
  formulaMismatchOver10: formulaMismatches.length,
  missingRecipes: missingRecipes.length,
  remotePhotos: remotePhotos.length,
  portionIssues: portionIssues.length,
  suspiciousTinyProteinPortions: suspiciousTinyProteinPortions.length,
  incompleteMeals: dailyPlans.filter((plan) => plan.missingMealTypes.length).length,
  caloriesDeviationOver10: dailyPlans.filter((plan) => plan.calorieDiffPercent > 10).length,
  fatBelow25: dailyPlans.filter((plan) => plan.fatPercent < 25).length,
  fatAbove35: dailyPlans.filter((plan) => plan.fatPercent > 35).length,
  fatAbove40: dailyPlans.filter((plan) => plan.fatPercent > 40).length,
  woman34Height169Weight55ThreeWorkoutsGain: {
    target: 2200,
    maxProteinGrams: 121,
    daysOverProteinLimit: casePlans.filter((plan) => plan.totals.protein > 121).length,
    days: casePlans,
  },
};

const report = {
  generatedAt: new Date().toISOString(),
  inputPath,
  summary,
  formulaMismatches,
  missingRecipes,
  remotePhotos,
  portionIssues,
  suspiciousTinyProteinPortions,
  dailyWarnings: dailyPlans.filter((plan) => (
    plan.missingMealTypes.length
    || plan.calorieDiffPercent > 10
    || plan.fatPercent < 25
    || plan.fatPercent > 35
  )),
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));

const criticalCount = summary.formulaMismatchOver10
  + summary.missingRecipes
  + summary.remotePhotos
  + summary.portionIssues
  + summary.suspiciousTinyProteinPortions
  + summary.incompleteMeals
  + summary.caloriesDeviationOver10
  + summary.fatBelow25
  + summary.fatAbove35
  + summary.woman34Height169Weight55ThreeWorkoutsGain.daysOverProteinLimit;
if (criticalCount > 0) process.exitCode = 1;
