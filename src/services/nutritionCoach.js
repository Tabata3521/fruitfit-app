import { appInfo, normalizeApiUrl } from "./appInfo";
import { postJson } from "./nativeHttp";

const API_BASE_URL = normalizeApiUrl(import.meta.env.VITE_FRUITFIT_API_URL || appInfo.api.productionApi);
const NUTRITION_CALC_ENDPOINT = `${API_BASE_URL}/api/nutrition/calc`;

const NUTRITION_INTENT_RE = /(кбжу|бжу|калори|ккал|калорийност|белк|жир|углевод)/i;
const GRAMS_UNIT_RE = "(?:г|гр|г\\.|грамм|грамма|граммов)";
const ITEM_BOUNDARY_RE = "(?=\\s*(?:[,;+]|\\s+(?:и|плюс)\\s+\\d|$))";

const CASE_REPLACEMENTS = [
  [/скумбрии\b/gi, "скумбрия"],
  [/курицы\b/gi, "курица"],
  [/индейки\b/gi, "индейка"],
  [/гречки\b/gi, "гречка"],
  [/овсянки\b/gi, "овсянка"],
  [/перловки\b/gi, "перловка"],
  [/говядины\b/gi, "говядина"],
  [/свинины\b/gi, "свинина"],
  [/трески\b/gi, "треска"],
  [/семги\b/gi, "семга"],
  [/сёмги\b/gi, "семга"],
  [/форели\b/gi, "форель"],
  [/печени\b/gi, "печень"],
];

export async function answerDirectNutritionQuestion(message = "") {
  const items = parseDirectNutritionItems(message);
  if (!items.length) return null;

  try {
    const response = await postJson(NUTRITION_CALC_ENDPOINT, { items }, { cache: "no-store" });
    if (!response.ok) {
      return "Не смог сейчас посчитать КБЖУ продукта. Попробуй ещё раз через минуту.";
    }
    return buildDirectNutritionAnswer(response.data, message);
  } catch (error) {
    console.error("[FruitFit Coach UI] Direct nutrition calculation failed", {
      endpoint: NUTRITION_CALC_ENDPOINT,
      message: error?.message || "nutrition calculation failed",
    });
    return "Не смог сейчас посчитать КБЖУ продукта. Попробуй ещё раз через минуту.";
  }
}

export function parseDirectNutritionItems(message = "") {
  const text = normalizeText(message);
  if (!NUTRITION_INTENT_RE.test(text)) return [];
  if (!new RegExp(`\\d+(?:[,.]\\d+)?\\s*${GRAMS_UNIT_RE}`, "iu").test(text)) return [];

  const items = [];
  collectMatches(items, text, new RegExp(`(?:^|\\s|в\\s|во\\s)(?<grams>\\d+(?:[,.]\\d+)?)\\s*${GRAMS_UNIT_RE}\\s+(?<name>.+?)${ITEM_BOUNDARY_RE}`, "giu"));
  collectMatches(items, text, new RegExp(`(?<name>.+?)\\s+(?<grams>\\d+(?:[,.]\\d+)?)\\s*${GRAMS_UNIT_RE}${ITEM_BOUNDARY_RE}`, "giu"));

  return mergeDirectNutritionItems(items);
}

function collectMatches(items, text, regex) {
  for (const match of text.matchAll(regex)) {
    const grams = parseAmount(match.groups?.grams);
    const name = normalizeFoodName(match.groups?.name);
    if (name && grams) items.push({ name, grams });
  }
}

function normalizeText(value = "") {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFoodName(value = "") {
  let name = normalizeText(value)
    .toLowerCase()
    .replace(/[?!.,;:]+$/g, "")
    .replace(/^(?:user question|вопрос пользователя)\s*:\s*/i, "")
    .replace(/^(?:сколько|посчитай|рассчитай|примерно|сколько примерно)\s+/i, "")
    .replace(/^(?:калорий|калории|ккал|калорийность|кбжу|бжу|белков|белка|жиров|жира|углеводов|углевода)\s+/i, "")
    .replace(/^(?:в|во|на|будет|содержится|содержит)\s+/i, "")
    .replace(/^(?:калорий|калории|ккал|калорийность)\s+(?:в|во|на)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();

  for (const [pattern, replacement] of CASE_REPLACEMENTS) {
    name = name.replace(pattern, replacement);
  }

  const parts = name.split(" ");
  if (parts.length) parts[0] = normalizeFirstWordCase(parts[0]);
  return parts.join(" ").trim();
}

function normalizeFirstWordCase(word = "") {
  if (word.endsWith("ии") && word.length > 4) return `${word.slice(0, -2)}ия`;
  if (word.endsWith("ицы") && word.length > 5) return `${word.slice(0, -3)}ица`;
  if (word.endsWith("ки") && word.length > 4) return `${word.slice(0, -2)}ка`;
  if (word.endsWith("ны") && word.length > 4) return `${word.slice(0, -2)}на`;
  if (word.endsWith("ги") && word.length > 4) return `${word.slice(0, -2)}га`;
  return word;
}

function parseAmount(value) {
  const number = Number(String(value || "").replace(",", "."));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function mergeDirectNutritionItems(items = []) {
  const byName = new Map();
  for (const item of items) {
    const key = item.name.toLowerCase();
    const existing = byName.get(key);
    if (existing) existing.grams += item.grams;
    else byName.set(key, { ...item });
  }
  return [...byName.values()].slice(0, 6);
}

function buildDirectNutritionAnswer(data = {}, originalMessage = "") {
  const items = Array.isArray(data.items) ? data.items : [];
  const reliableItems = items.filter((item) => !isLowConfidenceEstimate(item));

  if (!reliableItems.length) {
    const warning = Array.isArray(data.warnings) ? data.warnings.find((item) => item?.inputName) : null;
    const product = warning?.inputName ? ` "${warning.inputName}"` : "";
    return `Не нашёл точный продукт${product} в базе. Напиши проще: например, "300 г скумбрия".`;
  }

  const lines = reliableItems.map((item) => {
    const prefix = reliableItems.length > 1 ? `${item.matchedProduct}, ${formatNumber(item.grams)} г: ` : "";
    return `${prefix}${formatKcal(item.kcal)}, Б ${formatNumber(item.protein)} г, Ж ${formatNumber(item.fat)} г, У ${formatNumber(item.carbs)} г`;
  });

  const total = data.total || {};
  const answer = reliableItems.length === 1
    ? `В ${formatNumber(reliableItems[0].grams)} г ${reliableItems[0].matchedProduct}: ${lines[0]}.`
    : `${lines.join("; ")}. Итого: ${formatKcal(total.kcal)}, Б ${formatNumber(total.protein)} г, Ж ${formatNumber(total.fat)} г, У ${formatNumber(total.carbs)} г.`;

  return shouldMentionNutritionTab(originalMessage)
    ? `${answer} Если собираешь день целиком, удобнее свериться во вкладке "Питание".`
    : answer;
}

function isLowConfidenceEstimate(item = {}) {
  const confidence = Number(item.confidence || 0);
  return Boolean((item.isEstimated || item.approximate || item.matchedBy === "fallback_estimate") && confidence < 0.5);
}

function formatKcal(value) {
  return `${Math.round(Number(value || 0)).toLocaleString("ru-RU")} ккал`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(Number(value || 0));
}

function shouldMentionNutritionTab(message = "") {
  return /(день|сегодня|рацион|меню|прием пищи|приём пищи|добрать|осталось)/i.test(message);
}
