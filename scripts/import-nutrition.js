import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanTitle, decodeText } from "../src/utils/decodeText.js";
import { foodMvpProducts } from "../server/foodMvpSeed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const defaultInput = "C:\\Users\\Meyva\\Downloads\\store-5905500-202605091613.csv";
const input = process.argv[2] || defaultInput;
const output = path.join(projectRoot, "public", "data", "nutrition.json");
const reportDate = (process.env.NUTRITION_REPORT_DATE || new Date().toISOString().slice(0, 10));
const quarantineOutput = path.join(projectRoot, "reports", `nutrition-quarantine-${reportDate}.json`);
const nutritionImagesManifestPath = path.join(projectRoot, "public", "nutrition-images", "manifest.json");
const FAT_MIN_PERCENT = 25;
const FAT_MAX_PERCENT = 35;
const PROTEIN_MAX_PERCENT = 20;
const MEAL_PROTEIN_MAX_PERCENT = 35;
const REALISTIC_CALORIE_DIFF_PERCENT = 10;
const DAILY_CALORIE_TARGET_DIFF_PERCENT = 5;
const REQUIRED_MEAL_TYPES = ["Завтрак", "Обед", "Ужин", "Перекус"];
const MEAL_TARGET_SHARE = {
  "Завтрак": 0.25,
  "Обед": 0.35,
  "Ужин": 0.30,
  "Перекус": 0.10,
};
const PORTION_LIMITS_GRAMS = {
  fish: 250,
  chicken: 250,
  turkey: 250,
  beef: 250,
  tofu: 250,
  dryCereal: 120,
  vegetables: 400,
  oil: 20,
  nuts: 40,
};

function readNutritionImageManifest() {
  try {
    const payload = JSON.parse(fs.readFileSync(nutritionImagesManifestPath, "utf8"));
    return payload?.images && typeof payload.images === "object" ? payload.images : {};
  } catch {
    return {};
  }
}

function localizeNutritionImages(meals) {
  const manifest = readNutritionImageManifest();
  let localized = 0;
  let remote = 0;
  let missing = 0;

  for (const meal of meals) {
    const photo = String(meal.photo || "").trim();
    if (!photo) continue;
    if (!/^https?:\/\//i.test(photo)) continue;
    remote += 1;
    const localPath = manifest[photo]?.localPath;
    if (typeof localPath === "string" && localPath.startsWith("/nutrition-images/")) {
      meal.photo = localPath;
      localized += 1;
    } else {
      missing += 1;
    }
  }

  return {
    mode: "local",
    originalHost: "static.tildacdn.com",
    imagesDir: "/nutrition-images/",
    localizedMeals: localized,
    remoteMealsBeforeLocalization: remote,
    missingLocalImages: missing,
    manifestImages: Object.keys(manifest).length,
  };
}

const PRODUCT_ALIAS_OVERRIDES = new Map([
  ["\u043c\u043e\u0440\u0435\u043f\u0440\u043e\u0434\u0443\u043a\u0442\u044b", "\u0410\u0441\u0441\u043e\u0440\u0442\u0438 \u043c\u043e\u0440\u0435\u043f\u0440\u043e\u0434\u0443\u043a\u0442\u043e\u0432"],
  ["\u043a\u0440\u0435\u0432\u0435\u0442\u043a\u0438", "\u0410\u0441\u0441\u043e\u0440\u0442\u0438 \u043c\u043e\u0440\u0435\u043f\u0440\u043e\u0434\u0443\u043a\u0442\u043e\u0432"],
  ["\u043a\u0430\u043b\u044c\u043c\u0430\u0440\u044b", "\u0410\u0441\u0441\u043e\u0440\u0442\u0438 \u043c\u043e\u0440\u0435\u043f\u0440\u043e\u0434\u0443\u043a\u0442\u043e\u0432"],
  ["цельнозерновой хлеб", "Хлеб цельнозерновой"],
  ["хлеб цельнозерновой", "Хлеб цельнозерновой"],
  ["яйцо вареное", "Яйцо куриное"],
  ["яйцо варёное", "Яйцо куриное"],
  ["яйца вареные", "Яйцо куриное"],
  ["яйца варёные", "Яйцо куриное"],
  ["яичные белки", "Белок яичный"],
  ["яичный белок", "Белок яичный"],
  ["филе скумбрии", "Скумбрия"],
  ["скумбрия филе", "Скумбрия"],
  ["скумбрия", "Скумбрия"],
  ["филе лосося", "Лосось"],
  ["лосось стейк", "Лосось"],
  ["стейк лосося", "Лосось"],
  ["лосось", "Лосось"],
  ["оливковое масло", "Масло оливковое"],
  ["масло", "Масло оливковое"],
  ["перец", "Болгарский перец"],
  ["болгарский перец", "Болгарский перец"],
  ["картофель", "Картофель сырой"],
  ["картофельное пюре", "Картофель отварной"],
  ["помидоры", "Помидор"],
  ["томат", "Помидор"],
  ["лук", "Лук репчатый"],
  ["рис", "Рис белый вареная"],
  ["рис басмати", "Рис белый вареная"],
  ["овсянка", "Овсянка вареная"],
  ["овсяные хлопья", "Овсянка сухая"],
  ["греческий йогурт", "Йогурт греческий"],
  ["йогурт натуральный без сахара", "Йогурт натуральный"],
  ["йогурт натуральный", "Йогурт натуральный"],
  ["йогурт 2", "Йогурт натуральный"],
  ["йогурт 2 5", "Йогурт натуральный"],
  ["грецкие орехи", "Грецкие орехи"],
  ["грецкий орех", "Грецкие орехи"],
  ["семена чиа", "Семена чиа"],
  ["семена льна", "Семена льна"],
  ["мед", "Мед"],
  ["мёд", "Мед"],
  ["зеленый горошек", "Зеленый горошек"],
  ["зеленая фасоль", "Зеленая фасоль"],
  ["фасоль вареная", "Фасоль вареная"],
  ["фасоль варёная", "Фасоль вареная"],
  ["красная чечевица", "Чечевица красная вареная"],
  ["чечевица вареная", "Чечевица красная вареная"],
  ["чечевица варёная", "Чечевица красная вареная"],
  ["листья салата", "Листья салата"],
  ["лист салата", "Листья салата"],
  ["салат микс", "Листья салата"],
  ["салат‑микс", "Листья салата"],
  ["маслины", "Маслины"],
  ["оливки", "Маслины"],
  ["безглютеновый хлеб", "Безглютеновый хлеб"],
  ["цельнозерновая булка", "Хлеб цельнозерновой"],
  ["финики", "Финики"],
  ["курага", "Курага"],
  ["изюм", "Изюм"],
  ["филе семги", "Лосось"],
  ["филе сёмги", "Лосось"],
  ["семга", "Лосось"],
  ["сёмга", "Лосось"],
  ["филе дорадо", "Дорадо"],
  ["дорадо", "Дорадо"],
  ["йогуртовый соус", "Йогуртовый соус"],
  ["ягоды", "Ягоды"],
  ["тыквенные семечки", "Тыквенные семечки"],
  ["гуакамоле", "Гуакамоле"],
  ["цельнозерновая мука", "Цельнозерновая мука"],
  ["кукурузная крупа", "Кукурузная крупа"],
  ["кус кус", "Кускус вареная"],
  ["кус‑кус", "Кускус вареная"],
  ["ассорти морепродуктов", "Ассорти морепродуктов"],
  ["ореховой микс", "Ореховой микс"],
  ["ореховый микс", "Ореховой микс"],
  ["сухофрукты", "Сухофрукты"],
]);

const IGNORABLE_INGREDIENT_PATTERNS = [
  /по вкусу/i,
  /^соль(?:\s|$)/i,
  /^перец(?:\s|$)/i,
  /^специи(?:\s|$)/i,
  /соль[, ]+перец/i,
  /^вода(?:\s|$)/i,
  /^овощной бульон(?:\s|$)/i,
  /^зелень(?:\s|$)/i,
  /^укроп(?:\s|$)/i,
  /^петрушка(?:\s|$)/i,
  /^кинза(?:\s|$)/i,
  /^лимонный сок(?:\s|$)/i,
  /^чеснок[, ]+специи/i,
  /^измельчить\s/i,
  /^смешать\s/i,
  /^запечь\s/i,
  /^обжарить\s/i,
  /^варить\s/i,
];

function productRef(name, category, kcal, protein, fat, carbs, aliases = []) {
  return {
    name,
    category,
    kcal,
    protein,
    fat,
    carbs,
    aliases: [...new Set([name.toLowerCase(), ...aliases])],
  };
}

const SUPPLEMENTAL_PRODUCTS = [
  productRef("Зеленый горошек", "Овощи", 73, 5, 0.4, 14, ["зелёный горошек", "горошек"]),
  productRef("Зеленая фасоль", "Овощи", 31, 1.8, 0.1, 7, ["зелёная фасоль", "стручковая фасоль"]),
  productRef("Тофу", "Белковые продукты", 76, 8, 4.8, 1.9, ["сыр тофу"]),
  productRef("Хумус", "Бобовые", 166, 7.9, 9.6, 14.3, ["хумус классический"]),
  productRef("Фасоль вареная", "Бобовые", 123, 8.7, 0.5, 21.5, ["фасоль варёная", "фасоль готовая"]),
  productRef("Шампиньоны", "Грибы", 27, 4.3, 1, 1, ["шампиньон", "грибы шампиньоны"]),
  productRef("Листья салата", "Овощи", 15, 1.4, 0.2, 2.9, ["лист салата", "салат микс", "салат‑микс"]),
  productRef("Маслины", "Овощи", 115, 0.8, 10.7, 6.3, ["оливки", "маслины без косточки"]),
  productRef("Безглютеновый хлеб", "Хлеб", 250, 5, 4, 45, ["хлеб без глютена"]),
  productRef("Семена чиа", "Семена", 486, 16.5, 30.7, 42.1, ["чиа"]),
  productRef("Семена льна", "Семена", 534, 18.3, 42.2, 28.9, ["лен", "лён", "семя льна"]),
  productRef("Финики", "Сухофрукты", 277, 2, 0.5, 75, ["финик"]),
  productRef("Курага", "Сухофрукты", 241, 3.4, 0.5, 62.6, ["сушеный абрикос", "сушёный абрикос"]),
  productRef("Изюм", "Сухофрукты", 299, 3.1, 0.5, 79.2, ["изюм без косточек"]),
  productRef("Дорадо", "Рыба", 96, 19, 2, 0, ["дорада"]),
  productRef("Бекон", "Мясо", 250, 23, 18, 1, ["бекон постный", "постный бекон", "индейка бекон", "индюшачий бекон"]),
  productRef("Йогуртовый соус", "Соусы", 70, 3, 2, 8, ["соус йогуртовый"]),
  productRef("Ягоды", "Ягоды", 40, 0.9, 0.4, 7, ["ягодный микс", "смесь ягод"]),
  productRef("Тыквенные семечки", "Семена", 559, 30, 49, 10.7, ["семечки тыквенные"]),
  productRef("Гуакамоле", "Соусы", 150, 2, 13, 8, ["соус гуакамоле"]),
  productRef("Цельнозерновая мука", "Мука", 340, 12, 2.5, 61, ["мука цельнозерновая"]),
  productRef("Кукурузная крупа", "Крупы", 328, 8.3, 1.2, 71, ["полента"]),
  productRef("Ассорти морепродуктов", "Морепродукты", 100, 21, 1.2, 1, ["морской коктейль"]),
  productRef("Ореховой микс", "Орехи", 620, 18, 56, 16, ["ореховый микс", "смесь орехов"]),
  productRef("Сухофрукты", "Сухофрукты", 290, 2.5, 0.6, 70, ["смесь сухофруктов"]),
];

SUPPLEMENTAL_PRODUCTS.push(
  productRef("\u0410\u0441\u0441\u043e\u0440\u0442\u0438 \u043c\u043e\u0440\u0435\u043f\u0440\u043e\u0434\u0443\u043a\u0442\u043e\u0432", "\u041c\u043e\u0440\u0435\u043f\u0440\u043e\u0434\u0443\u043a\u0442\u044b", 100, 21, 1.2, 1, ["\u043c\u043e\u0440\u0435\u043f\u0440\u043e\u0434\u0443\u043a\u0442\u044b", "\u043a\u0440\u0435\u0432\u0435\u0442\u043a\u0438", "\u043a\u0430\u043b\u044c\u043c\u0430\u0440\u044b", "\u043c\u0438\u0434\u0438\u0438", "\u043c\u043e\u0440\u0441\u043a\u043e\u0439 \u043a\u043e\u043a\u0442\u0435\u0439\u043b\u044c"]),
);

const SEAFOOD_ASSORTI_PRODUCT = {
  name: "\u0410\u0441\u0441\u043e\u0440\u0442\u0438 \u043c\u043e\u0440\u0435\u043f\u0440\u043e\u0434\u0443\u043a\u0442\u043e\u0432",
  category: "\u041c\u043e\u0440\u0435\u043f\u0440\u043e\u0434\u0443\u043a\u0442\u044b",
  kcal: 100,
  protein: 21,
  fat: 1.2,
  carbs: 1,
};

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ";" && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  const headers = rows.shift();
  return rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header.replace(/^"|"$/g, ""), cells[index] || ""])));
}

function htmlToSections(html) {
  const clean = decodeText(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const ingredients = [];
  const recipe = [];
  let mode = "";
  for (const line of clean) {
    if (/продукты|ингредиенты/i.test(line)) {
      mode = "ingredients";
      continue;
    }
    if (/рецепт|приготов/i.test(line)) {
      mode = "recipe";
      continue;
    }
    if (mode === "ingredients") ingredients.push(line.replace(/^•\s*/, ""));
    else if (mode === "recipe") recipe.push(line);
  }

  return {
    ingredients,
    recipe: recipe.join(" "),
    text: clean.join("\n"),
  };
}

function parseMacros(value) {
  const match = decodeText(value || "").match(/(\d+(?:[.,]\d+)?)\D+(\d+(?:[.,]\d+)?)\D+(\d+(?:[.,]\d+)?)\D+(\d+(?:[.,]\d+)?)/);
  if (!match) return { calories: 0, protein: 0, fat: 0, carbs: 0 };
  return {
    calories: Number(match[1].replace(",", ".")),
    protein: Number(match[2].replace(",", ".")),
    fat: Number(match[3].replace(",", ".")),
    carbs: Number(match[4].replace(",", ".")),
  };
}

function parseCategory(rawCategory) {
  const categories = decodeText(rawCategory || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
  return categories.map((item) => {
    const match = item.match(/(.+?)\s+(\d{3,4})$/);
    return {
      label: item,
      ration: match ? match[1].trim() : item,
      caloriesTarget: match ? Number(match[2]) : null,
    };
  });
}

function macroCalories(macros = {}) {
  return Math.round(Number(macros.protein || 0) * 4 + Number(macros.fat || 0) * 9 + Number(macros.carbs || 0) * 4);
}

function macroDiffPercent(macros = {}) {
  const calories = Number(macros.calories || 0);
  if (!calories) return null;
  return round(Math.abs(calories - macroCalories(macros)) / calories * 100, 1);
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"']/g, "")
    .replace(/[.,:;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeIngredientName(value) {
  return normalizeText(value)
    .replace(/\b(вареное|вареные|вареная|вареный|варёное|варёные|варёная|варёный|отварное|отварные|запеченная|запечённая|свежее|свежие|сырой)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildProductIndex() {
  const index = new Map();
  for (const product of [...foodMvpProducts, ...SUPPLEMENTAL_PRODUCTS]) {
    for (const alias of [product.name, ...(product.aliases || [])]) {
      const key = normalizeIngredientName(alias);
      if (key && !index.has(key)) index.set(key, product);
    }
  }
  return index;
}

const productIndex = buildProductIndex();

function productByName(value) {
  const exactName = normalizeIngredientName(value);
  const override = PRODUCT_ALIAS_OVERRIDES.get(exactName);
  if (override) return productIndex.get(normalizeIngredientName(override)) || null;
  if (productIndex.has(exactName)) return productIndex.get(exactName);
  for (const [alias, product] of productIndex.entries()) {
    if (exactName.length >= 4 && (exactName.includes(alias) || alias.includes(exactName))) return product;
  }
  return null;
}

function isIgnorableIngredient(line) {
  const text = normalizeText(line);
  return IGNORABLE_INGREDIENT_PATTERNS.some((pattern) => pattern.test(text));
}

function dedupeIngredients(ingredients = []) {
  const seen = new Set();
  const unique = [];
  for (const ingredient of ingredients) {
    const key = normalizeText(ingredient);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(ingredient);
  }
  return unique;
}

function parseIngredient(line) {
  const text = String(line || "").trim();
  const gramsInParens = text.match(/\([^0-9]*(\d+(?:[.,]\d+)?)\s*(?:г|g|мл|ml)[^)]*\)/i);
  const gramsAfterDash = text.match(/(?:^|[–—-])[^0-9]*(\d+(?:[.,]\d+)?)\s*(?:г|g|мл|ml)/i);
  const countMatch = text.match(/(?:^|[–—-])[^0-9]*(\d+(?:[.,]\d+)?)\s*(?:шт|штук)/i);
  const gramsMatch = gramsInParens || gramsAfterDash;
  const grams = gramsMatch ? Number(gramsMatch[1].replace(",", ".")) : null;
  const name = text
    .split(/[–—-]/)[0]
    .replace(/\(.+?\)/g, "")
    .trim();
  const compositeMatch = text.match(/\(([^()]+)\)/);
  const parentheticalCompositeNames = compositeMatch && /[,/]/.test(compositeMatch[1])
    ? compositeMatch[1].split(/[,/]/).map((item) => item.trim()).filter(Boolean)
    : [];
  const nameCompositeNames = grams && /,/.test(name)
    ? name.split(",").map((item) => item.trim()).filter(Boolean)
    : [];
  const compositeNames = parentheticalCompositeNames.length ? parentheticalCompositeNames : nameCompositeNames;
  const count = countMatch ? Number(countMatch[1].replace(",", ".")) : null;
  return { raw: text, name, grams, count, compositeNames };
}

function formatScaledAmount(value) {
  const rounded = Math.round(Number(value || 0));
  return String(Math.max(1, rounded));
}

function scaleIngredientLine(line, factor, baseGrams) {
  if (!Number.isFinite(factor) || Math.abs(factor - 1) < 0.01 || isIgnorableIngredient(line)) return line;
  const scaledGrams = baseGrams ? formatScaledAmount(baseGrams * factor) : null;
  if (!scaledGrams) return line;
  if (/\([^)]*\d+(?:[.,]\d+)?\s*(?:г|g|мл|ml)[^)]*\)/i.test(line)) {
    return line.replace(/(\([^0-9]*)(\d+(?:[.,]\d+)?)(\s*)(г|g|мл|ml)([^)]*\))/i, `$1${scaledGrams}$3$4$5`);
  }
  if (/(^|[–—-])([^0-9]*)(\d+(?:[.,]\d+)?)(\s*)(г|g|мл|ml)/i.test(line)) {
    return line.replace(/(^|[–—-])([^0-9]*)(\d+(?:[.,]\d+)?)(\s*)(г|g|мл|ml)/i, `$1$2${scaledGrams}$4$5`);
  }
  if (/(?:^|[–—-])[^0-9]*\d+(?:[.,]\d+)?\s*(?:шт|штук)/i.test(line)) {
    return `${line} (${scaledGrams} г)`;
  }
  return line;
}

function productPartsForIngredient(parsed) {
  const normalizedRaw = normalizeText(parsed.raw);
  if (parsed.grams && (
    normalizedRaw.includes("\u043c\u043e\u0440\u0435\u043f\u0440\u043e\u0434\u0443\u043a\u0442")
    || normalizedRaw.includes("\u043a\u0440\u0435\u0432\u0435\u0442")
    || normalizedRaw.includes("\u043a\u0430\u043b\u044c\u043c\u0430\u0440")
    || normalizedRaw.includes("\u043c\u0438\u0434\u0438")
  )) {
    return [{ name: parsed.name, grams: parsed.grams, product: SEAFOOD_ASSORTI_PRODUCT }];
  }

  if (parsed.compositeNames.length && parsed.grams) {
    const products = parsed.compositeNames.map((name) => ({ name, product: productByName(name) }));
    if (products.every((item) => item.product)) {
      const grams = parsed.grams / products.length;
      return products.map((item) => ({ name: item.name, grams, product: item.product }));
    }
  }

  const product = productByName(parsed.name);
  if (!product) return [];
  const grams = parsed.grams || (parsed.count && product.defaultServingGrams ? parsed.count * product.defaultServingGrams : null);
  return [{ name: parsed.name, grams, product }];
}

function addProductTotals(acc, product, grams) {
  const multiplier = grams / 100;
  acc.productCalories += Number(product.kcal || 0) * multiplier;
  acc.protein += Number(product.protein || 0) * multiplier;
  acc.fat += Number(product.fat || 0) * multiplier;
  acc.carbs += Number(product.carbs || 0) * multiplier;
}

function macrosForProductGrams(product, grams) {
  const multiplier = Number(grams || 0) / 100;
  return {
    calories: Number(product.kcal || 0) * multiplier,
    protein: Number(product.protein || 0) * multiplier,
    fat: Number(product.fat || 0) * multiplier,
    carbs: Number(product.carbs || 0) * multiplier,
  };
}

function totalsForParts(parts = []) {
  return parts.reduce((acc, part) => {
    const macros = macrosForProductGrams(part.product, part.grams);
    acc.calories += macros.calories;
    acc.protein += macros.protein;
    acc.fat += macros.fat;
    acc.carbs += macros.carbs;
    return acc;
  }, { calories: 0, protein: 0, fat: 0, carbs: 0 });
}

function productSearchText(product = {}) {
  return normalizeText(`${product.name || ""} ${product.category || ""}`);
}

function portionLimitForProduct(product = {}) {
  const text = productSearchText(product);
  if (text.includes("\u0442\u043e\u0444\u0443")) return PORTION_LIMITS_GRAMS.tofu;
  if (text.includes("\u043a\u0443\u043a\u0443\u0440\u0443\u0437\u043d\u0430\u044f \u043a\u0440\u0443\u043f\u0430")) return PORTION_LIMITS_GRAMS.dryCereal;
  if (text.includes("масл")) return PORTION_LIMITS_GRAMS.oil;
  if (text.includes("орех") || text.includes("миндаль") || text.includes("кешью") || text.includes("арахис") || text.includes("фундук") || text.includes("фисташ")) return PORTION_LIMITS_GRAMS.nuts;
  if (text.includes("кур")) return PORTION_LIMITS_GRAMS.chicken;
  if (text.includes("индей")) return PORTION_LIMITS_GRAMS.turkey;
  if (text.includes("говяд")) return PORTION_LIMITS_GRAMS.beef;
  if (text.includes("рыб") || text.includes("лосос") || text.includes("семг") || text.includes("сёмг") || text.includes("скумбр") || text.includes("треск") || text.includes("минтай") || text.includes("хек") || text.includes("тунец") || text.includes("морепродукт") || text.includes("кревет") || text.includes("кальмар") || text.includes("мидии")) return PORTION_LIMITS_GRAMS.fish;
  if (text.includes("овощ") || text.includes("огур") || text.includes("помид") || text.includes("морков") || text.includes("капуст") || text.includes("перец") || text.includes("кабач") || text.includes("тыкв") || text.includes("брокк") || text.includes("картоф")) return PORTION_LIMITS_GRAMS.vegetables;
  return null;
}

function productCaloriesPerGram(product = {}) {
  return Number(product.kcal || 0) / 100;
}

function isProteinDominantProduct(product = {}) {
  const proteinCalories = Number(product.protein || 0) * 4;
  const fatCalories = Number(product.fat || 0) * 9;
  const carbCalories = Number(product.carbs || 0) * 4;
  const text = productSearchText(product);
  return proteinCalories >= Math.max(fatCalories, carbCalories) && Number(product.protein || 0) >= 10
    || text.includes("птица")
    || text.includes("мясо")
    || text.includes("рыб")
    || text.includes("морепродукт")
    || text.includes("творог");
}

function isCarbDominantProduct(product = {}) {
  const carbCalories = Number(product.carbs || 0) * 4;
  const proteinCalories = Number(product.protein || 0) * 4;
  const fatCalories = Number(product.fat || 0) * 9;
  const text = productSearchText(product);
  return carbCalories >= Math.max(proteinCalories, fatCalories)
    && !text.includes("овощ")
    && !text.includes("фрукт")
    && !text.includes("ягод")
    && !text.includes("масл")
    && !text.includes("орех");
}

function isOilProduct(product = {}) {
  return productSearchText(product).includes("масл");
}

function isNutProduct(product = {}) {
  const text = productSearchText(product);
  return text.includes("орех") || text.includes("миндаль") || text.includes("кешью") || text.includes("арахис") || text.includes("фундук") || text.includes("фисташ");
}

function currentPartGrams(parts = [], product = {}) {
  return parts
    .filter((part) => part.product?.name === product?.name)
    .reduce((sum, part) => sum + Number(part.grams || 0), 0);
}

function addCaloriesFromCarbCandidates(parts, calorieDeficit, candidates = []) {
  for (const product of candidates) {
    if (!product) continue;
    const limit = portionLimitForProduct(product) || 650;
    const available = Math.max(0, limit - currentPartGrams(parts, product));
    if (available <= 0) continue;
    const gramsToAdd = Math.min(calorieDeficit / Math.max(1, productCaloriesPerGram(product)), 350, available);
    const added = addOrIncreasePart(parts, product, gramsToAdd, limit);
    if (added > 0) return { product, grams: added };
  }
  return null;
}

function isFatDominantProduct(product = {}) {
  const proteinCalories = Number(product.protein || 0) * 4;
  const fatCalories = Number(product.fat || 0) * 9;
  const carbCalories = Number(product.carbs || 0) * 4;
  const text = productSearchText(product);
  return fatCalories > Math.max(proteinCalories, carbCalories)
    || isOilProduct(product)
    || isNutProduct(product)
    || text.includes("авокад")
    || text.includes("бекон");
}

function mergeParts(parts = []) {
  const byProduct = new Map();
  for (const part of parts) {
    if (!part.product || !Number.isFinite(Number(part.grams)) || Number(part.grams) <= 0) continue;
    const key = part.product.name;
    const current = byProduct.get(key) || { product: part.product, grams: 0 };
    current.grams += Number(part.grams);
    byProduct.set(key, current);
  }
  return [...byProduct.values()];
}

function addOrIncreasePart(parts, product, gramsToAdd, maxTotalGrams = null) {
  if (!product || !Number.isFinite(gramsToAdd) || gramsToAdd <= 0) return 0;
  let part = parts.find((item) => item.product.name === product.name);
  if (!part) {
    part = { product, grams: 0 };
    parts.push(part);
  }
  const current = Number(part.grams || 0);
  const allowed = maxTotalGrams ? Math.max(0, maxTotalGrams - current) : gramsToAdd;
  const added = Math.min(gramsToAdd, allowed);
  part.grams = current + added;
  return added;
}

function capPortions(parts = []) {
  const adjustments = [];
  for (const part of parts) {
    const limit = portionLimitForProduct(part.product);
    if (limit && part.grams > limit) {
      adjustments.push({
        type: "portion_capped",
        product: part.product.name,
        before: round(part.grams),
        after: limit,
        limit,
      });
      part.grams = limit;
    }
  }
  return adjustments;
}

function ingredientPartsFromLines(lines = []) {
  const issues = [];
  const parts = [];
  for (const line of lines) {
    if (isIgnorableIngredient(line)) continue;
    const parsed = parseIngredient(line);
    const parsedParts = productPartsForIngredient(parsed);
    if (!parsedParts.length) {
      issues.push({ type: "missing_ingredient_after_balance", ingredient: line, aliasNeeded: parsed.name });
      continue;
    }
    if (parsedParts.some((part) => !part.grams)) {
      issues.push({ type: "missing_grams_after_balance", ingredient: line });
      continue;
    }
    for (const part of parsedParts) {
      parts.push({
        product: part.product,
        grams: Number(part.grams),
      });
    }
  }
  return { parts: mergeParts(parts), issues };
}

function generatedIngredientLine(part) {
  return `${part.product.name} — ${formatScaledAmount(part.grams)} г`;
}

function balanceMealParts(inputParts, targetCalories) {
  const issues = [];
  const adjustments = [];
  const parts = mergeParts(inputParts.map((part) => ({ product: part.product, grams: Number(part.grams || 0) })));
  adjustments.push(...capPortions(parts));

  const targetProtein = Number(targetCalories || 0) * MEAL_PROTEIN_MAX_PERCENT / 100 / 4;
  let totals = totalsForParts(parts);
  if (targetProtein && totals.protein > targetProtein) {
    const proteinParts = parts.filter((part) => isProteinDominantProduct(part.product));
    const nonProteinProtein = parts
      .filter((part) => !isProteinDominantProduct(part.product))
      .reduce((sum, part) => sum + macrosForProductGrams(part.product, part.grams).protein, 0);
    const proteinPartProtein = proteinParts.reduce((sum, part) => sum + macrosForProductGrams(part.product, part.grams).protein, 0);
    if (proteinPartProtein > 0) {
      const allowedProteinPartProtein = Math.max(0, targetProtein - nonProteinProtein);
      const ratio = Math.max(0.2, Math.min(1, allowedProteinPartProtein / proteinPartProtein));
      if (ratio < 0.999) {
        for (const part of proteinParts) {
          const before = part.grams;
          part.grams *= ratio;
          adjustments.push({ type: "protein_reduced", product: part.product.name, before: round(before), after: round(part.grams), ratio: round(ratio, 3) });
        }
      }
    }
  }
  adjustments.push(...capPortions(parts));

  const oilProduct = productByName("оливковое масло") || productByName("масло");
  const carbProduct = parts.find((part) => isCarbDominantProduct(part.product))?.product
    || productByName("рис")
    || productByName("картофель")
    || productByName("хлеб цельнозерновой");
  const nutProduct = parts.find((part) => isNutProduct(part.product))?.product || productByName("грецкие орехи");

  const carbCandidates = [
    carbProduct,
    productByName("\u0440\u0438\u0441"),
    productByName("\u043a\u0430\u0440\u0442\u043e\u0444\u0435\u043b\u044c"),
    productByName("\u0445\u043b\u0435\u0431 \u0446\u0435\u043b\u044c\u043d\u043e\u0437\u0435\u0440\u043d\u043e\u0432\u043e\u0439"),
  ].filter(Boolean);

  for (let iteration = 0; iteration < 4; iteration += 1) {
    totals = totalsForParts(parts);
    const calorieDeficit = Number(targetCalories || 0) - totals.calories;
    if (calorieDeficit <= Number(targetCalories || 0) * REALISTIC_CALORIE_DIFF_PERCENT / 100) break;

    const targetFat = Number(targetCalories || 0) * 0.30 / 9;
    const fatDeficit = targetFat - totals.fat;
    if (fatDeficit > 1 && oilProduct) {
      const oilToAdd = Math.min(fatDeficit, calorieDeficit / Math.max(1, productCaloriesPerGram(oilProduct)) / 100 * 100);
      const added = addOrIncreasePart(parts, oilProduct, oilToAdd, PORTION_LIMITS_GRAMS.oil);
      if (added > 0) {
        adjustments.push({ type: "fat_added", product: oilProduct.name, grams: round(added) });
        continue;
      }
    }

    if (fatDeficit > 3 && nutProduct) {
      const nutFatPerGram = Number(nutProduct.fat || 0) / 100;
      const nutsToAdd = nutFatPerGram ? fatDeficit / nutFatPerGram : 0;
      const added = addOrIncreasePart(parts, nutProduct, nutsToAdd, PORTION_LIMITS_GRAMS.nuts);
      if (added > 0) {
        adjustments.push({ type: "nuts_added", product: nutProduct.name, grams: round(added) });
        continue;
      }
    }

    const carbAdded = addCaloriesFromCarbCandidates(parts, calorieDeficit, carbCandidates);
    if (carbAdded) {
      adjustments.push({ type: "carbs_added", product: carbAdded.product.name, grams: round(carbAdded.grams) });
      continue;
    }
    break;
  }

  adjustments.push(...capPortions(parts));
  totals = totalsForParts(parts);
  const calorieDiffPercent = targetCalories ? Math.abs(totals.calories - targetCalories) / targetCalories * 100 : 0;
  const proteinPercent = totals.calories ? totals.protein * 4 / totals.calories * 100 : 0;
  const fatPercent = totals.calories ? totals.fat * 9 / totals.calories * 100 : 0;
  if (calorieDiffPercent > REALISTIC_CALORIE_DIFF_PERCENT) {
    issues.push({ type: "unable_to_rebalance_calories", targetCalories, actualCalories: round(totals.calories), diffPercent: round(calorieDiffPercent) });
  }
  for (const part of parts) {
    const limit = portionLimitForProduct(part.product);
    if (limit && part.grams > limit + 0.5) {
      issues.push({ type: "portion_limit_exceeded", product: part.product.name, grams: round(part.grams), limit });
    }
  }
  return { parts: mergeParts(parts), totals, adjustments, issues, proteinPercent: round(proteinPercent), fatPercent: round(fatPercent) };
}

function rebalanceMeal(meal) {
  const { parts, issues } = ingredientPartsFromLines(meal.ingredients || []);
  if (issues.length || !parts.length) return { status: "quarantine", issues, meal };
  const balanced = balanceMealParts(parts, Number(meal.calories || 0));
  if (balanced.issues.length) {
    return {
      status: "quarantine",
      issues: balanced.issues,
      adjustments: balanced.adjustments,
      meal,
    };
  }
  return {
    status: balanced.adjustments.length ? "balanced" : "unchanged",
    adjustments: balanced.adjustments,
    meal: (() => {
      const protein = round(balanced.totals.protein);
      const fat = round(balanced.totals.fat);
      const carbs = round(balanced.totals.carbs);
      return {
      ...meal,
      calories: macroCalories({ protein, fat, carbs }),
      protein,
      fat,
      carbs,
      ingredients: balanced.parts.map(generatedIngredientLine),
      };
    })(),
  };
}

function normalizeMeal(row, index) {
  const categories = parseCategory(row.Category);
  const sections = htmlToSections(row.Text);
  return {
    id: row["Tilda UID"] || row["External ID"] || `meal-${index + 1}`,
    title: cleanTitle(row.Title),
    mealType: cleanTitle(row["Characteristics:Прием пищи"] || row.Mark),
    day: cleanTitle(row["Characteristics:День недели"]),
    categories,
    rations: [...new Set(categories.map((item) => item.ration))],
    caloriesTargets: [...new Set(categories.map((item) => item.caloriesTarget).filter(Boolean))],
    description: decodeText(row.Description || ""),
    photo: row.Photo || "",
    ...parseMacros(row.Description),
    ingredients: sections.ingredients,
    recipe: sections.recipe,
    rawText: sections.text,
  };
}

function repairMealNutrition(meal) {
  const oldMacros = {
    calories: Number(meal.calories || 0),
    protein: Number(meal.protein || 0),
    fat: Number(meal.fat || 0),
    carbs: Number(meal.carbs || 0),
  };
  const uniqueIngredients = dedupeIngredients(meal.ingredients || []);
  const issues = [];
  const matchedIngredients = [];
  const ingredientBaseGrams = new Map();
  const totals = { productCalories: 0, protein: 0, fat: 0, carbs: 0 };

  for (const line of uniqueIngredients) {
    if (isIgnorableIngredient(line)) continue;
    const parsed = parseIngredient(line);
    const parts = productPartsForIngredient(parsed);
    if (!parts.length) {
      issues.push({ type: "missing_ingredient", ingredient: line, aliasNeeded: parsed.name });
      continue;
    }
    if (parts.some((part) => !part.grams)) {
      issues.push({ type: "missing_grams", ingredient: line });
      continue;
    }
    for (const part of parts) {
      addProductTotals(totals, part.product, part.grams);
      ingredientBaseGrams.set(line, (ingredientBaseGrams.get(line) || 0) + part.grams);
      matchedIngredients.push({
        ingredient: line,
        matchedProduct: part.product.name,
        grams: round(part.grams, 1),
      });
    }
  }

  if (!matchedIngredients.length) issues.push({ type: "no_reliable_ingredients", ingredient: "" });

  const rawRecalculated = {
    protein: round(totals.protein),
    fat: round(totals.fat),
    carbs: round(totals.carbs),
  };
  rawRecalculated.calories = macroCalories(rawRecalculated);
  const ingredientScaleFactor = oldMacros.calories && rawRecalculated.calories
    ? oldMacros.calories / rawRecalculated.calories
    : 1;
  const recalculated = {
    calories: oldMacros.calories || rawRecalculated.calories,
    protein: round(rawRecalculated.protein * ingredientScaleFactor),
    fat: round(rawRecalculated.fat * ingredientScaleFactor),
    carbs: round(rawRecalculated.carbs * ingredientScaleFactor),
  };
  const scaledIngredients = uniqueIngredients.map((line) => scaleIngredientLine(line, ingredientScaleFactor, ingredientBaseGrams.get(line)));

  const oldFormulaDiffPercent = macroDiffPercent(oldMacros);
  const dedupedIngredients = uniqueIngredients.length !== (meal.ingredients || []).length;
  const oldVsRecalculatedDiffPercent = oldMacros.calories
    ? round(Math.abs(oldMacros.calories - recalculated.calories) / oldMacros.calories * 100, 1)
    : null;

  const reportBase = {
    id: meal.id,
    title: meal.title,
    mealType: meal.mealType,
    day: meal.day,
    caloriesTargets: meal.caloriesTargets,
    rations: meal.rations,
    old: oldMacros,
    recalculated,
    oldFormulaDiffPercent,
    oldVsRecalculatedDiffPercent,
    ingredientScaleFactor: round(ingredientScaleFactor, 3),
    rawRecalculated,
    matchedIngredients,
    dedupedIngredients,
  };

  if (issues.length) {
    return {
      status: "quarantine",
      meal,
      report: {
        ...reportBase,
        reasons: issues,
      },
    };
  }

  const repairedMeal = {
    ...meal,
    calories: recalculated.calories,
    protein: recalculated.protein,
    fat: recalculated.fat,
    carbs: recalculated.carbs,
    ingredients: scaledIngredients,
  };
  const balanced = rebalanceMeal(repairedMeal);
  if (balanced.status === "quarantine") {
    return {
      status: "quarantine",
      meal,
      report: {
        ...reportBase,
        reasons: balanced.issues,
        balanceAdjustments: balanced.adjustments || [],
      },
    };
  }

  const shouldReportCorrection = dedupedIngredients
    || Math.abs(ingredientScaleFactor - 1) > 0.05
    || (oldFormulaDiffPercent !== null && oldFormulaDiffPercent > 10)
    || (oldVsRecalculatedDiffPercent !== null && oldVsRecalculatedDiffPercent > 10)
    || balanced.status === "balanced";

  return {
    status: shouldReportCorrection ? "corrected" : "valid",
    meal: balanced.meal,
    report: shouldReportCorrection ? {
      ...reportBase,
      balanced: balanced.status === "balanced",
      balanceAdjustments: balanced.adjustments || [],
    } : null,
  };
}

function mealStats(meals) {
  const over10 = meals.filter((meal) => {
    const diff = macroDiffPercent(meal);
    return diff !== null && diff > 10;
  });
  return {
    total: meals.length,
    formulaMismatchOver10: over10.length,
  };
}

function buildFilters(meals) {
  return {
    rations: [...new Set(meals.flatMap((meal) => meal.rations))].sort(),
    caloriesTargets: [...new Set(meals.flatMap((meal) => meal.caloriesTargets))].sort((a, b) => a - b),
    days: [...new Set(meals.map((meal) => meal.day).filter(Boolean))],
    mealTypes: [...new Set(meals.map((meal) => meal.mealType).filter(Boolean))],
  };
}

function dailyPlanFor(meals, { ration, caloriesTarget, day }) {
  const uniqueMeals = [];
  const seenTypes = new Set();
  for (const meal of meals) {
    if (!meal.rations?.includes(ration)) continue;
    if (!meal.caloriesTargets?.includes(Number(caloriesTarget))) continue;
    if (meal.day !== day) continue;
    if (seenTypes.has(meal.mealType)) continue;
    seenTypes.add(meal.mealType);
    uniqueMeals.push(meal);
  }
  const totals = uniqueMeals.reduce((acc, meal) => ({
    calories: acc.calories + Number(meal.calories || 0),
    protein: acc.protein + Number(meal.protein || 0),
    fat: acc.fat + Number(meal.fat || 0),
    carbs: acc.carbs + Number(meal.carbs || 0),
  }), { calories: 0, protein: 0, fat: 0, carbs: 0 });
  return {
    meals: uniqueMeals.map((meal) => ({ id: meal.id, title: meal.title, mealType: meal.mealType })),
    totals: {
      calories: Math.round(totals.calories),
      protein: round(totals.protein),
      fat: round(totals.fat),
      carbs: round(totals.carbs),
    },
    fatPercent: totals.calories ? round(totals.fat * 9 / totals.calories * 100, 1) : null,
  };
}

function selectedIndexesForPlan(meals, { ration, caloriesTarget, day }) {
  const selectedIndexes = [];
  const seenTypes = new Set();
  for (let index = 0; index < meals.length; index += 1) {
    const meal = meals[index];
    if (!meal.rations?.includes(ration)) continue;
    if (!meal.caloriesTargets?.includes(Number(caloriesTarget))) continue;
    if (meal.day !== day) continue;
    if (seenTypes.has(meal.mealType)) continue;
    seenTypes.add(meal.mealType);
    selectedIndexes.push(index);
  }
  return selectedIndexes;
}

function totalsForMealIndexes(meals, indexes) {
  return indexes.reduce((acc, index) => {
    const meal = meals[index];
    acc.calories += Number(meal.calories || 0);
    acc.protein += Number(meal.protein || 0);
    acc.fat += Number(meal.fat || 0);
    acc.carbs += Number(meal.carbs || 0);
    return acc;
  }, { calories: 0, protein: 0, fat: 0, carbs: 0 });
}

function scopedMealForPlan(meal, { ration, caloriesTarget, day, idSuffix }) {
  return {
    ...meal,
    id: `${meal.id}-${idSuffix}`,
    day,
    rations: [ration],
    caloriesTargets: [Number(caloriesTarget)],
    categories: [{
      label: `${ration} ${caloriesTarget}`,
      ration,
      caloriesTarget: Number(caloriesTarget),
    }],
  };
}

function rebalanceMealToCalories(meal, targetCalories) {
  const parsed = ingredientPartsFromLines(meal.ingredients || []);
  if (parsed.issues.length || !parsed.parts.length) {
    return { meal, issues: parsed.issues.length ? parsed.issues : [{ type: "missing_parts_for_target_rebalance" }], adjustments: [] };
  }
  const totals = totalsForParts(parsed.parts);
  const scale = totals.calories && targetCalories ? Number(targetCalories) / totals.calories : 1;
  const scaledParts = parsed.parts.map((part) => ({
    ...part,
    grams: part.grams * scale,
  }));
  return mealFromBalancedParts(meal, scaledParts, targetCalories);
}

function candidateTargetsDistance(meal, caloriesTarget) {
  const targets = meal.caloriesTargets || [];
  if (!targets.length) return Number.MAX_SAFE_INTEGER;
  return Math.min(...targets.map((target) => Math.abs(Number(target) - Number(caloriesTarget))));
}

function findMealCandidate(meals, { ration, caloriesTarget, day, mealType, targetCalories }) {
  const candidates = meals
    .filter((meal) => meal.mealType === mealType && meal.rations?.includes(ration) && meal.day !== day)
    .map((meal) => {
      const sameTarget = meal.caloriesTargets?.includes(Number(caloriesTarget));
      const targetDistance = candidateTargetsDistance(meal, caloriesTarget);
      const calorieDistance = Math.abs(Number(meal.calories || 0) - Number(targetCalories || 0));
      return {
        meal,
        score: (sameTarget ? 0 : 1000 + targetDistance * 2) + calorieDistance,
      };
    })
    .sort((a, b) => a.score - b.score);
  return candidates.map((item) => item.meal);
}

function completeDailyPlans(meals, filters) {
  const nextMeals = meals.map((meal) => ({ ...meal, ingredients: [...(meal.ingredients || [])] }));
  const reports = [];

  for (const ration of filters.rations) {
    for (const caloriesTarget of filters.caloriesTargets) {
      for (const day of filters.days) {
        let selectedIndexes = selectedIndexesForPlan(nextMeals, { ration, caloriesTarget, day });
        let seenTypes = new Set(selectedIndexes.map((index) => nextMeals[index].mealType));
        let missingTypes = REQUIRED_MEAL_TYPES.filter((mealType) => !seenTypes.has(mealType));
        if (!missingTypes.length) continue;

        for (const mealType of missingTypes) {
          selectedIndexes = selectedIndexesForPlan(nextMeals, { ration, caloriesTarget, day });
          seenTypes = new Set(selectedIndexes.map((index) => nextMeals[index].mealType));
          if (seenTypes.has(mealType)) continue;

          const totals = totalsForMealIndexes(nextMeals, selectedIndexes);
          const remainingTypes = REQUIRED_MEAL_TYPES.filter((type) => !seenTypes.has(type));
          const calorieGap = Number(caloriesTarget || 0) - totals.calories;
          const fallbackTarget = Number(caloriesTarget || 0) * (MEAL_TARGET_SHARE[mealType] || 0.25);
          const targetCalories = calorieGap > Number(caloriesTarget || 0) * 0.08
            ? Math.max(Number(caloriesTarget || 0) * 0.08, calorieGap / Math.max(1, remainingTypes.length))
            : fallbackTarget;
          const candidates = findMealCandidate(nextMeals, { ration, caloriesTarget, day, mealType, targetCalories });

          let inserted = false;
          const failures = [];
          for (const candidate of candidates.slice(0, 8)) {
            const scoped = scopedMealForPlan(candidate, {
              ration,
              caloriesTarget,
              day,
              idSuffix: `fill-${normalizeText(ration).replace(/\s+/g, "-")}-${caloriesTarget}-${normalizeText(day).replace(/\s+/g, "-")}-${normalizeText(mealType).replace(/\s+/g, "-")}`,
            });
            const balanced = rebalanceMealToCalories(scoped, targetCalories);
            if (balanced.issues.length) {
              failures.push({ sourceId: candidate.id, title: candidate.title, issues: balanced.issues });
              continue;
            }
            nextMeals.push(balanced.meal);
            reports.push({
              reason: "missing_meal_filled",
              ration,
              caloriesTarget,
              day,
              mealType,
              targetCalories: Math.round(targetCalories),
              sourceMealId: candidate.id,
              sourceTitle: candidate.title,
              insertedMealId: balanced.meal.id,
              insertedTitle: balanced.meal.title,
              adjustments: balanced.adjustments,
            });
            inserted = true;
            break;
          }

          if (!inserted) {
            reports.push({
              reason: "missing_meal_fill_failed",
              ration,
              caloriesTarget,
              day,
              mealType,
              targetCalories: Math.round(targetCalories),
              failures,
            });
          }
        }
      }
    }
  }

  return { meals: nextMeals, reports };
}

function fatValidationReport(meals, filters) {
  const issues = [];
  const ration = "Без ограничений";
  const targets = filters.caloriesTargets.filter((target) => [2000, 2200, 2400].includes(Number(target)));
  for (const caloriesTarget of targets) {
    for (const day of filters.days) {
      const plan = dailyPlanFor(meals, { ration, caloriesTarget, day });
      if (!plan.meals.length) continue;
      if (plan.fatPercent !== null && plan.fatPercent < FAT_MIN_PERCENT) {
        issues.push({
          ration,
          caloriesTarget,
          day,
          reason: "fat_percent_below_minimum",
          minPercent: FAT_MIN_PERCENT,
          maxPercent: FAT_MAX_PERCENT,
          ...plan,
        });
      }
    }
  }
  return issues;
}

function mealFromBalancedParts(meal, parts, targetCalories = Number(meal.calories || 0)) {
  const balanced = balanceMealParts(parts, targetCalories);
  if (balanced.issues.length) {
    return { meal, issues: balanced.issues, adjustments: balanced.adjustments || [] };
  }
  const protein = round(balanced.totals.protein);
  const fat = round(balanced.totals.fat);
  const carbs = round(balanced.totals.carbs);
  return {
    meal: {
      ...meal,
      calories: macroCalories({ protein, fat, carbs }),
      protein,
      fat,
      carbs,
      ingredients: balanced.parts.map(generatedIngredientLine),
    },
    issues: [],
    adjustments: balanced.adjustments || [],
  };
}

function repairSeafoodNamedMeals(meals) {
  const reports = [];
  const nextMeals = meals.map((meal) => {
    const title = normalizeText(meal.title);
    const hasSeafoodTitle = title.includes("\u043c\u043e\u0440\u0435\u043f\u0440\u043e\u0434\u0443\u043a\u0442");
    const hasSeafoodIngredient = (meal.ingredients || []).some((line) => normalizeText(line).includes("\u043c\u043e\u0440\u0435\u043f\u0440\u043e\u0434\u0443\u043a\u0442"));
    if (!hasSeafoodTitle || hasSeafoodIngredient) return meal;

    const parts = [
      { product: SEAFOOD_ASSORTI_PRODUCT, grams: 150 },
      { product: productByName("\u043b\u0443\u043a"), grams: 110 },
      { product: productByName("\u043c\u043e\u0440\u043a\u043e\u0432\u044c"), grams: 110 },
      { product: productByName("\u043f\u0435\u0440\u0435\u0446"), grams: 110 },
      { product: productByName("\u043a\u0430\u0440\u0442\u043e\u0444\u0435\u043b\u044c"), grams: 110 },
      { product: productByName("\u043e\u043b\u0438\u0432\u043a\u043e\u0432\u043e\u0435 \u043c\u0430\u0441\u043b\u043e"), grams: 12 },
    ].filter((part) => part.product);
    const balanced = mealFromBalancedParts(meal, parts, Number(meal.calories || 0));
    if (balanced.issues.length) {
      reports.push({
        id: meal.id,
        title: meal.title,
        reason: "seafood_named_meal_repair_failed",
        issues: balanced.issues,
      });
      return meal;
    }
    reports.push({
      id: meal.id,
      title: meal.title,
      reason: "seafood_named_meal_repaired",
      before: {
        calories: meal.calories,
        protein: meal.protein,
        fat: meal.fat,
        carbs: meal.carbs,
        ingredients: meal.ingredients,
      },
      after: {
        calories: balanced.meal.calories,
        protein: balanced.meal.protein,
        fat: balanced.meal.fat,
        carbs: balanced.meal.carbs,
        ingredients: balanced.meal.ingredients,
      },
      adjustments: balanced.adjustments,
    });
    return balanced.meal;
  });
  return { meals: nextMeals, reports };
}

function applyDailyProteinCaps(meals, filters) {
  const nextMeals = meals.map((meal) => ({ ...meal, ingredients: [...(meal.ingredients || [])] }));
  const reports = [];
  const oilProduct = productByName("оливковое масло") || productByName("масло");

  for (const ration of filters.rations) {
    for (const caloriesTarget of filters.caloriesTargets) {
      for (const day of filters.days) {
        const selectedIndexes = selectedIndexesForPlan(nextMeals, { ration, caloriesTarget, day });
        if (!selectedIndexes.length) continue;

        const totals = totalsForMealIndexes(nextMeals, selectedIndexes);
        const calorieDiffPercent = Number(caloriesTarget || 0)
          ? Math.abs(totals.calories - Number(caloriesTarget)) / Number(caloriesTarget) * 100
          : 0;
        const proteinPercent = totals.calories ? totals.protein * 4 / totals.calories * 100 : 0;
        const fatPercent = totals.calories ? totals.fat * 9 / totals.calories * 100 : 0;
        const needsCalorieScale = calorieDiffPercent > DAILY_CALORIE_TARGET_DIFF_PERCENT;
        const needsProteinCap = proteinPercent > PROTEIN_MAX_PERCENT + 0.5;
        const needsFatTrim = fatPercent > FAT_MAX_PERCENT + 0.5;
        const needsFatBoost = fatPercent < FAT_MIN_PERCENT;
        if (!needsCalorieScale && !needsProteinCap && !needsFatTrim && !needsFatBoost) continue;

        const parsedMeals = selectedIndexes.map((index) => {
          const parsed = ingredientPartsFromLines(nextMeals[index].ingredients || []);
          return { index, ...parsed };
        });
        if (parsedMeals.some((item) => item.issues.length)) {
          reports.push({
            ration,
            caloriesTarget,
            day,
            reason: "daily_protein_cap_parse_failed",
            issues: parsedMeals.flatMap((item) => item.issues),
          });
          continue;
        }

        const targetCalories = Number(caloriesTarget) || totals.calories;
        const calorieScale = totals.calories && needsCalorieScale ? targetCalories / totals.calories : 1;
        const calorieScaledMeals = parsedMeals.map((item) => ({
          ...item,
          targetCalories: Number(nextMeals[item.index].calories || 0) * calorieScale,
          parts: item.parts.map((part) => ({ ...part, grams: part.grams * calorieScale })),
        }));

        const scaledTotals = calorieScaledMeals.reduce((acc, item) => {
          const itemTotals = totalsForParts(item.parts);
          acc.calories += itemTotals.calories;
          acc.protein += itemTotals.protein;
          acc.fat += itemTotals.fat;
          acc.carbs += itemTotals.carbs;
          return acc;
        }, { calories: 0, protein: 0, fat: 0, carbs: 0 });
        const maxProtein = targetCalories * PROTEIN_MAX_PERCENT / 100 / 4;
        const dominantProtein = calorieScaledMeals.reduce((sum, item) => sum + item.parts
          .filter((part) => isProteinDominantProduct(part.product))
          .reduce((partSum, part) => partSum + macrosForProductGrams(part.product, part.grams).protein, 0), 0);
        const nonDominantProtein = calorieScaledMeals.reduce((sum, item) => sum + item.parts
          .filter((part) => !isProteinDominantProduct(part.product))
          .reduce((partSum, part) => partSum + macrosForProductGrams(part.product, part.grams).protein, 0), 0);
        const allowedDominantProtein = Math.max(0, maxProtein - nonDominantProtein);
        const proteinRatio = needsProteinCap && dominantProtein ? Math.max(0.15, Math.min(1, allowedDominantProtein / dominantProtein)) : 1;
        const fatRatio = needsFatTrim ? Math.max(0.35, Math.min(1, 34.5 / Math.max(1, fatPercent))) : 1;

        const adjustments = [];
        const issues = [];
        for (const item of calorieScaledMeals) {
          const reducedParts = item.parts.map((part) => ({
            ...part,
            grams: isProteinDominantProduct(part.product)
              ? part.grams * proteinRatio
              : isFatDominantProduct(part.product)
                ? part.grams * fatRatio
                : part.grams,
          }));
          if (needsFatBoost && oilProduct) {
            const desiredFat = Number(item.targetCalories || 0) * 0.30 / 9;
            const currentItemTotals = totalsForParts(reducedParts);
            const fatDeficit = Math.max(0, desiredFat - currentItemTotals.fat);
            const oilFatPerGram = Number(oilProduct.fat || 0) / 100 || 1;
            if (fatDeficit > 1) {
              const beforeOilTotals = totalsForParts(reducedParts);
              const added = addOrIncreasePart(reducedParts, oilProduct, fatDeficit / oilFatPerGram, PORTION_LIMITS_GRAMS.oil);
              if (added > 0) {
                const addedCalories = Math.max(0, totalsForParts(reducedParts).calories - beforeOilTotals.calories);
                let caloriesToRemove = addedCalories;
                const carbParts = reducedParts
                  .filter((part) => isCarbDominantProduct(part.product))
                  .sort((a, b) => b.grams - a.grams);
                for (const carbPart of carbParts) {
                  if (caloriesToRemove <= 1) break;
                  const caloriesPerGram = productCaloriesPerGram(carbPart.product);
                  if (!caloriesPerGram) continue;
                  const removableGrams = Math.max(0, carbPart.grams - 20);
                  const removeGrams = Math.min(removableGrams, caloriesToRemove / caloriesPerGram);
                  carbPart.grams -= removeGrams;
                  caloriesToRemove -= removeGrams * caloriesPerGram;
                }
              }
            }
          }
          const finalBalanced = mealFromBalancedParts(nextMeals[item.index], reducedParts, item.targetCalories);
          if (finalBalanced.issues.length) {
            issues.push(...finalBalanced.issues.map((issue) => ({ ...issue, mealId: nextMeals[item.index].id, title: nextMeals[item.index].title })));
            continue;
          }
          nextMeals[item.index] = finalBalanced.meal;
          adjustments.push({
            mealId: finalBalanced.meal.id,
            title: finalBalanced.meal.title,
            calorieScale: round(calorieScale, 3),
            proteinRatio: round(proteinRatio, 3),
            fatRatio: round(fatRatio, 3),
            fatBoost: needsFatBoost,
            adjustments: finalBalanced.adjustments,
          });
        }

        const after = selectedIndexes.reduce((acc, index) => {
          const meal = nextMeals[index];
          acc.calories += Number(meal.calories || 0);
          acc.protein += Number(meal.protein || 0);
          acc.fat += Number(meal.fat || 0);
          acc.carbs += Number(meal.carbs || 0);
          return acc;
        }, { calories: 0, protein: 0, fat: 0, carbs: 0 });
        const afterProteinPercent = after.calories ? after.protein * 4 / after.calories * 100 : null;
        reports.push({
          ration,
          caloriesTarget,
          day,
          reason: issues.length ? "daily_protein_cap_partial" : "daily_protein_cap_applied",
          before: {
            calories: Math.round(totals.calories),
            protein: round(totals.protein),
            fat: round(totals.fat),
            carbs: round(totals.carbs),
            proteinPercent: round(totals.protein * 4 / totals.calories * 100),
            fatPercent: round(totals.fat * 9 / totals.calories * 100),
          },
          after: {
            calories: Math.round(after.calories),
            protein: round(after.protein),
            fat: round(after.fat),
            carbs: round(after.carbs),
            proteinPercent: round(afterProteinPercent),
            fatPercent: after.calories ? round(after.fat * 9 / after.calories * 100) : null,
          },
          maxProteinPercent: PROTEIN_MAX_PERCENT,
          targetCalories,
          needsCalorieScale,
          needsProteinCap,
          needsFatTrim,
          needsFatBoost,
          adjustments,
          issues,
        });
      }
    }
  }

  return { meals: nextMeals, reports };
}

const csv = fs.readFileSync(input, "utf8");
const rows = parseCsv(csv);
const importedMeals = rows
  .map(normalizeMeal)
  .filter((meal) => meal.title && !/^title$/i.test(meal.title) && !/^characteristics:/i.test(meal.day) && !/^characteristics:/i.test(meal.mealType));

const beforeStats = mealStats(importedMeals);
const repaired = importedMeals.map(repairMealNutrition);
let meals = repaired
  .filter((item) => item.status !== "quarantine")
  .map((item) => item.meal);
const corrected = repaired
  .filter((item) => item.status === "corrected" && item.report)
  .map((item) => item.report);
const quarantine = repaired
  .filter((item) => item.status === "quarantine")
  .map((item) => item.report);
let filters = buildFilters(meals);
const dailyCompletion = completeDailyPlans(meals, filters);
meals = dailyCompletion.meals;
filters = buildFilters(meals);
const dailyProteinBalance = applyDailyProteinCaps(meals, filters);
meals = dailyProteinBalance.meals;
filters = buildFilters(meals);
const dailyProteinBalanceFollowup = applyDailyProteinCaps(meals, filters);
meals = dailyProteinBalanceFollowup.meals;
filters = buildFilters(meals);
const seafoodNamedMealRepair = repairSeafoodNamedMeals(meals);
meals = seafoodNamedMealRepair.meals;
filters = buildFilters(meals);
const dailyProteinBalanceFinal = applyDailyProteinCaps(meals, filters);
meals = dailyProteinBalanceFinal.meals;
filters = buildFilters(meals);
const imageSource = localizeNutritionImages(meals);
const afterStats = mealStats(meals);
const dailyFatIssues = fatValidationReport(meals, filters);
const missingIngredients = new Map();
for (const item of quarantine) {
  for (const reason of item.reasons || []) {
    if (reason.type !== "missing_ingredient") continue;
    const key = reason.aliasNeeded || reason.ingredient;
    missingIngredients.set(key, (missingIngredients.get(key) || 0) + 1);
  }
}

const payload = {
  importedAt: new Date().toISOString(),
  source: path.basename(input),
  meals,
  filters,
  imageSource,
};

const quarantineReport = {
  generatedAt: new Date().toISOString(),
  source: path.basename(input),
  rules: {
    formula: "calories ~= protein*4 + fat*9 + carbs*4",
    formulaMismatchThresholdPercent: 10,
    fatValidation: {
      ration: "Без ограничений",
      checkedTargets: [2000, 2200, 2400],
      minPercent: FAT_MIN_PERCENT,
      maxPercent: FAT_MAX_PERCENT,
    },
  },
  stats: {
    before: beforeStats,
    after: afterStats,
    corrected: corrected.length,
    quarantine: quarantine.length,
    dailyCompletion: dailyCompletion.reports.length,
    dailyFatIssues: dailyFatIssues.length,
    dailyProteinBalance: dailyProteinBalance.reports.length + dailyProteinBalanceFollowup.reports.length + dailyProteinBalanceFinal.reports.length,
    seafoodNamedMealRepair: seafoodNamedMealRepair.reports.length,
  },
  topMissingIngredients: [...missingIngredients.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([ingredient, count]) => ({ ingredient, count })),
  corrected,
  quarantine,
  dailyCompletion: dailyCompletion.reports,
  dailyProteinBalance: [
    ...dailyProteinBalance.reports.map((item) => ({ ...item, pass: 1 })),
    ...dailyProteinBalanceFollowup.reports.map((item) => ({ ...item, pass: 2 })),
    ...dailyProteinBalanceFinal.reports.map((item) => ({ ...item, pass: 3 })),
  ],
  seafoodNamedMealRepair: seafoodNamedMealRepair.reports,
  dailyFatIssues,
};

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.mkdirSync(path.dirname(quarantineOutput), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
fs.writeFileSync(quarantineOutput, `${JSON.stringify(quarantineReport, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  meals: meals.length,
  removedToQuarantine: quarantine.length,
  corrected: corrected.length,
  before: beforeStats,
  after: afterStats,
  imageSource,
  quarantineReport: path.relative(projectRoot, quarantineOutput),
  filters,
}, null, 2));
