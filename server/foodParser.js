import { findProduct } from "./nutritionDb.js";

const FOOD_INTENT_RE =
  /(кбжу|калори|калорийн|посчитай|рассчитай|что я съел|что съел|еда|прием пищи|приём пищи|белк|жир|углевод)/i;

const GRAMS_RE = "(?:г|гр|грамм|грамма|граммов)";
const COUNT_UNIT_RE =
  "(?:шт|штук|штуки|штука|яйцо|яйца|яиц|банан|банана|бананов|яблоко|яблока|яблок|кусок|куска|кусочка|ломтик|ломтика|ложк(?:а|и|ек)?|ст\\.?\\s*л\\.?|столов(?:ая|ые|ых)?\\s+ложк(?:а|и|ек)?|ч\\.?\\s*л\\.?|чайн(?:ая|ые|ых)?\\s+ложк(?:а|и|ек)?|пачк(?:а|и)?|банк(?:а|и)?)";

const STOP_WORDS_RE =
  /^(посчитай|рассчитай|сколько|примерно|мне|пожалуйста|калории|калорийность|кбжу|бжу|я съел|я сьел|съел|сьел|сегодня|и|плюс|по|за|на)\s+/i;

const COOKING_WORDS_RE =
  /(в\s+аэрогриле|аэрогриль|запеченн(?:ая|ый|ое|ые)|запечен(?:ная|ный|ное|ные)|жаренн(?:ая|ый|ое|ые)|жарен(?:ая|ый|ое|ые)|варенн(?:ая|ый|ое|ые)|варен(?:ая|ый|ое|ые)|отварн(?:ая|ый|ое|ые)|тушен(?:ая|ый|ое|ые)|тушенн(?:ая|ый|ое|ые)|гриль|на\s+пару)/gi;

const UNIT_GRAMS = [
  { re: /яйц|яйцо/i, grams: 55 },
  { re: /банан/i, grams: 120 },
  { re: /яблок/i, grams: 150 },
  { re: /кус|ломтик/i, grams: 30 },
  { re: /ложк|ст\.?\s*л|столов/i, grams: 15 },
  { re: /ч\.?\s*л|чайн/i, grams: 5 },
  { re: /пачк/i, grams: 180 },
  { re: /банк/i, grams: 240 },
  { re: /шт|штук|штуки|штука/i, grams: null },
];

const PIECE_GRAMS_BY_NAME = [
  { re: /яйц|яйцо/i, grams: 55 },
  { re: /банан/i, grams: 120 },
  { re: /яблок/i, grams: 150 },
  { re: /хлеб/i, grams: 30 },
  { re: /сыр/i, grams: 20 },
];

export function isNutritionIntent(message = "", options = {}) {
  const text = String(message || "");
  if (FOOD_INTENT_RE.test(text)) return true;

  const parsedItems = parseFoodItemsFromMessage(text);
  if (!parsedItems.length) return false;

  try {
    return parsedItems.some((item) => {
      const matched = findProduct(item.name, { ...options, externalFallback: false });
      return matched && matched.matched !== false && matched.confidence >= 0.68;
    });
  } catch (_) {
    return false;
  }
}

export function parseFoodItemsFromMessage(message = "") {
  const text = String(message || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return [];

  const items = [];

  const parts = text
    .split(/[,;+]|\s+\+\s+|\s+и\s+/iu)
    .map((part) => cleanFoodName(part))
    .filter(Boolean);

  for (const part of parts) {
    let match = part.match(new RegExp(`^(?<grams>\\d+(?:[,.]\\d+)?)\\s*${GRAMS_RE}\\s+(?<name>.+)$`, "iu"));
    if (match) {
      addItem(items, match.groups.name, parseNumber(match.groups.grams), 1);
      continue;
    }

    match = part.match(new RegExp(`^(?<name>.+?)\\s+(?<grams>\\d+(?:[,.]\\d+)?)\\s*${GRAMS_RE}$`, "iu"));
    if (match) {
      addItem(items, match.groups.name, parseNumber(match.groups.grams), 1);
      continue;
    }

    match = part.match(new RegExp(`^(?:(?<count>\\d+(?:[,.]\\d+)?)\\s*)?(?<unit>${COUNT_UNIT_RE})(?:\\s+(?<name>.+))?$`, "iu"));
    if (match) {
      const unit = match.groups.unit;
      const rawName = match.groups.name || unit;
      const count = parseNumber(match.groups.count || "1");
      addItem(items, rawName, gramsFromUnit(unit, rawName, count), count);
      continue;
    }

    match = part.match(new RegExp(`^(?<name>.+?)\\s+(?<count>\\d+(?:[,.]\\d+)?)\\s*(?<unit>${COUNT_UNIT_RE})$`, "iu"));
    if (match) {
      const rawName = match.groups.name;
      addItem(items, rawName, gramsFromUnit(match.groups.unit, rawName, parseNumber(match.groups.count)), parseNumber(match.groups.count));
      continue;
    }

    // Pattern: "2 бургера" or "3 банана" — count + name without unit
    match = part.match(/^(?<count>\d+(?:[,.]\d+)?)\s+(?<name>.+)$/iu);
    if (match) {
      addItem(items, match.groups.name, null, parseNumber(match.groups.count));
      continue;
    }

    // Fallback: bare product name like "бургер", "кола", "гречка с молоком"
    if (part.length >= 2) {
      addItem(items, part, null, 1);
    }
  }

  return mergeDuplicateItems(items);
}

function addItem(items, rawName, grams, count) {
  const name = cleanFoodName(rawName || "");
  if (name) {
    items.push({ name, grams: grams || null, count: count || 1 });
  }
}

function cleanFoodName(value) {
  let result = String(value || "")
    .toLowerCase()
    .replace(COOKING_WORDS_RE, " ")
    .replace(/[?.!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (let index = 0; index < 4; index += 1) {
    result = result.replace(STOP_WORDS_RE, "").trim();
  }

  return result
    .replace(/^(?:и|плюс)\s+/i, "")
    .replace(/\s+(?:и|плюс)$/i, "")
    .trim();
}

function parseNumber(value) {
  const number = Number(String(value || "").replace(",", "."));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function gramsFromUnit(unit = "", name = "", count = 1) {
  const unitRule = UNIT_GRAMS.find((item) => item.re.test(unit));
  let grams = unitRule?.grams || null;
  if (!grams) {
    grams = PIECE_GRAMS_BY_NAME.find((item) => item.re.test(name))?.grams || null;
  }
  return grams && count ? Math.round(grams * count) : null;
}

function mergeDuplicateItems(items) {
  const byName = new Map();
  for (const item of items) {
    const key = item.name.toLowerCase().trim();
    const existing = byName.get(key);
    if (existing) {
      if (item.grams && existing.grams) existing.grams += item.grams;
      else if (item.grams) existing.grams = item.grams;
      existing.count = (existing.count || 1) + (item.count || 1);
    } else {
      byName.set(key, { ...item });
    }
  }
  return [...byName.values()];
}

export function buildNutritionAnswer(result) {
  if (!result.items.length) {
    const details = result.warnings
      .map((warning) => warning.inputName || warning.message)
      .filter(Boolean)
      .join(", ");
    return details
      ? `Не смог посчитать КБЖУ: ${details}. Этот продукт нужно проверить в базе продуктов.`
      : "Напиши продукты и граммовки, например: 300 г творога 5% и 50 г грецких орехов.";
  }

  const lines = result.items.map((item) => {
    const macros = `${item.kcal} ккал, Б ${item.protein} г, Ж ${item.fat} г, У ${item.carbs} г`;
    return `${item.matchedProduct}, ${item.grams} г: ${macros}`;
  });

  const total = `Итого: ${result.total.kcal} ккал, Б ${result.total.protein} г, Ж ${result.total.fat} г, У ${result.total.carbs} г.`;
  const warningText = result.warnings.length
    ? ` Не нашёл в базе: ${result.warnings.map((warning) => warning.inputName).filter(Boolean).join(", ")}.`
    : "";

  return `Посчитал по базе продуктов. ${lines.join("; ")}. ${total}${warningText} Расчёт примерный и зависит от конкретного бренда/состава.`;
}

