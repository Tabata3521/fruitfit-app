import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { cleanTitle, decodeText } from "../src/utils/decodeText.js";
import { foodMvpProducts } from "../server/foodMvpSeed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const defaultInput = "C:\\Users\\Meyva\\Downloads\\store-5905500-202605091613.csv";
const input = process.argv[2] || defaultInput;
const output = path.join(projectRoot, "public", "data", "nutrition.json");
const backendOutput = path.join(projectRoot, "backend", "data", "nutrition.json");
const runtimeSummaryOutput = path.join(projectRoot, "src", "data", "nutritionPlanSummary.json");
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
      meal.photo = "";
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
    .replace(/(продукты|ингредиенты)\s*:/gi, "\n$1\n")
    .replace(/(рецепт|приготовление)\s*:/gi, "\n$1\n")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const ingredients = [];
  const recipe = [];
  let mode = "";
  let ingredientsHeaders = 0;
  let recipeHeaders = 0;
  for (const line of clean) {
    if (/^(?:продукты|ингредиенты)$/i.test(line)) {
      mode = "ingredients";
      ingredientsHeaders += 1;
      continue;
    }
    if (/^(?:рецепт|приготовление)$/i.test(line)) {
      mode = "recipe";
      recipeHeaders += 1;
      continue;
    }
    if (mode === "ingredients") ingredients.push(line.replace(/^•\s*/, ""));
    else if (mode === "recipe") recipe.push(line);
  }

  return {
    ingredients,
    recipe: recipe.join(" "),
    text: clean.join("\n"),
    ingredientsHeaders,
    recipeHeaders,
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
  const genericComposite = /(?:ягод|овощ|орех|морепродукт|ассорти|смесь|микс)/i.test(name);
  const parentheticalCompositeNames = genericComposite && compositeMatch && /[,/]/.test(compositeMatch[1])
    ? compositeMatch[1].split(/[,/]/).map((item) => item.trim()).filter(Boolean)
    : [];
  const commaSeparatedNames = grams && /,/.test(name)
    ? name.split(",").map((item) => item.trim()).filter(Boolean)
    : [];
  const nameCompositeNames = commaSeparatedNames.length > 1 && commaSeparatedNames.every((item) => productByName(item))
    ? commaSeparatedNames
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
  const protein = Number(product.protein || 0) * multiplier;
  const fat = Number(product.fat || 0) * multiplier;
  const carbs = Number(product.carbs || 0) * multiplier;
  return {
    calories: protein * 4 + fat * 9 + carbs * 4,
    protein,
    fat,
    carbs,
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
  return (
    Number(product.protein || 0) * 4
    + Number(product.fat || 0) * 9
    + Number(product.carbs || 0) * 4
  ) / 100;
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
  const parts = mergeParts(inputParts.map((part) => ({ product: part.product, grams: Number(part.grams || 0) })));
  const adjustments = [];
  for (const part of parts) {
    const limit = portionLimitForProduct(part.product);
    if (!limit || part.grams <= limit) continue;
    const before = part.grams;
    part.grams = limit;
    adjustments.push({
      type: "portion_capped",
      product: part.product.name,
      before: round(before),
      after: limit,
    });
  }

  let totals = totalsForParts(parts);
  let calorieDeficit = Number(targetCalories || 0) - totals.calories;
  if (calorieDeficit > Number(targetCalories || 0) * REALISTIC_CALORIE_DIFF_PERCENT / 100) {
    const candidates = parts
      .filter((part) => !isProteinDominantProduct(part.product) && productCaloriesPerGram(part.product) > 0)
      .sort((a, b) => {
        const aFat = isFatDominantProduct(a.product) ? 1 : 0;
        const bFat = isFatDominantProduct(b.product) ? 1 : 0;
        return bFat - aFat;
      });

    for (const part of candidates) {
      if (calorieDeficit <= Number(targetCalories || 0) * 0.02) break;
      const explicitLimit = portionLimitForProduct(part.product);
      const practicalLimit = explicitLimit || Math.max(part.grams * 1.75, part.grams + 120);
      const capacity = Math.max(0, practicalLimit - part.grams);
      const caloriesPerGram = productCaloriesPerGram(part.product);
      const addedGrams = Math.min(capacity, calorieDeficit / caloriesPerGram);
      if (addedGrams <= 0) continue;
      part.grams += addedGrams;
      calorieDeficit -= addedGrams * caloriesPerGram;
      adjustments.push({
        type: "existing_ingredient_increased",
        product: part.product.name,
        grams: round(addedGrams),
      });
    }
    totals = totalsForParts(parts);
  }

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
  return { parts, totals, adjustments, issues, proteinPercent: round(proteinPercent), fatPercent: round(fatPercent) };
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
    sourceSectionStats: {
      ingredientsHeaders: sections.ingredientsHeaders,
      recipeHeaders: sections.recipeHeaders,
    },
  };
}

function contentConsistencyIssues(meal, ingredients = []) {
  const title = normalizeText(meal.title);
  const ingredientText = normalizeText(ingredients.join(" "));
  const issues = [];
  const requiredTitleIngredients = [
    { title: "морепродукт", ingredients: ["морепродукт", "кревет", "кальмар", "мидии"] },
    { title: "скумбр", ingredients: ["скумбр"] },
    { title: "лосос", ingredients: ["лосос", "семг", "сёмг"] },
    { title: "авокад", ingredients: ["авокад"] },
    { title: "яй", ingredients: ["яй", "яич"] },
  ];
  for (const rule of requiredTitleIngredients) {
    if (title.includes(rule.title) && !rule.ingredients.some((token) => ingredientText.includes(token))) {
      issues.push({ type: "title_ingredient_mismatch", titleToken: rule.title });
    }
  }
  if (Number(meal.sourceSectionStats?.ingredientsHeaders || 0) > 1 || Number(meal.sourceSectionStats?.recipeHeaders || 0) > 1) {
    issues.push({
      type: "multiple_recipe_blocks",
      ingredientsHeaders: meal.sourceSectionStats?.ingredientsHeaders || 0,
      recipeHeaders: meal.sourceSectionStats?.recipeHeaders || 0,
    });
  }
  if (!String(meal.recipe || "").trim()) {
    issues.push({ type: "missing_recipe" });
  }
  return issues;
}

function repairMealNutrition(meal) {
  const oldMacros = {
    calories: Number(meal.calories || 0),
    protein: Number(meal.protein || 0),
    fat: Number(meal.fat || 0),
    carbs: Number(meal.carbs || 0),
  };
  const uniqueIngredients = dedupeIngredients(meal.ingredients || []);
  const issues = contentConsistencyIssues(meal, uniqueIngredients);
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
  const validated = rebalanceMeal(repairedMeal);
  if (validated.status === "quarantine") {
    return {
      status: "quarantine",
      meal,
      report: {
        ...reportBase,
        reasons: validated.issues,
      },
    };
  }

  const shouldReportCorrection = dedupedIngredients
    || Math.abs(ingredientScaleFactor - 1) > 0.05
    || (oldFormulaDiffPercent !== null && oldFormulaDiffPercent > 10)
    || (oldVsRecalculatedDiffPercent !== null && oldVsRecalculatedDiffPercent > 10)
    || validated.status === "balanced";

  return {
    status: shouldReportCorrection ? "corrected" : "valid",
    meal: validated.meal,
    report: shouldReportCorrection ? {
      ...reportBase,
      balanceAdjustments: validated.adjustments || [],
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

function dailyPlanKey(ration, caloriesTarget, day) {
  return `${ration}|${Number(caloriesTarget)}|${day}`;
}

function planSelectionScore(meals, caloriesTarget) {
  const totals = meals.reduce((acc, meal) => ({
    calories: acc.calories + Number(meal.calories || 0),
    protein: acc.protein + Number(meal.protein || 0),
    fat: acc.fat + Number(meal.fat || 0),
    carbs: acc.carbs + Number(meal.carbs || 0),
  }), { calories: 0, protein: 0, fat: 0, carbs: 0 });
  const target = Number(caloriesTarget) || totals.calories || 1;
  const calorieDiffPercent = Math.abs(totals.calories - target) / target * 100;
  const fatPercent = totals.calories ? totals.fat * 9 / totals.calories * 100 : 0;
  const proteinPercent = totals.calories ? totals.protein * 4 / totals.calories * 100 : 0;
  const score = calorieDiffPercent * 20
    + Math.max(0, FAT_MIN_PERCENT - fatPercent) * 30
    + Math.max(0, fatPercent - FAT_MAX_PERCENT) * 30
    + Math.max(0, proteinPercent - 22) * 35
    + Math.max(0, 15 - proteinPercent) * 5;
  return {
    score,
    totals,
    calorieDiffPercent,
    fatPercent,
    proteinPercent,
  };
}

function minimumProteinServing(part) {
  const text = productSearchText(part.product);
  if (text.includes("йогурт") || text.includes("творог")) return Math.min(part.grams, 75);
  if (text.includes("яй")) return Math.min(part.grams, 40);
  return Math.min(part.grams, 40);
}

function minimumFatServing(part) {
  if (isOilProduct(part.product)) return Math.min(part.grams, 3);
  if (isNutProduct(part.product)) return Math.min(part.grams, 10);
  if (productSearchText(part.product).includes("авокад")) return Math.min(part.grams, 30);
  return Math.min(part.grams, 10);
}

function rebalancePlanSelection(sourceMeals, caloriesTarget, idSuffix, ration) {
  const parsedMeals = sourceMeals.map((meal) => {
    const parsed = ingredientPartsFromLines(meal.ingredients || []);
    return {
      meal,
      parts: parsed.parts.map((part) => ({ ...part })),
      issues: parsed.issues,
      addedIngredients: [],
    };
  });
  if (parsedMeals.some((item) => item.issues.length || !item.parts.length)) {
    return { valid: false, reason: "plan_rebalance_parse_failed" };
  }

  const allParts = () => parsedMeals.flatMap((item) => item.parts);
  const totals = () => totalsForParts(allParts());
  const target = Number(caloriesTarget) || totals().calories;
  let current = totals();

  const initialScale = current.calories ? target / current.calories : 1;
  if (Math.abs(initialScale - 1) > 0.05) {
    for (const part of allParts()) {
      const limit = portionLimitForProduct(part.product);
      part.grams = Math.min(part.grams * initialScale, limit || Number.POSITIVE_INFINITY);
    }
    current = totals();
  }

  const maxProtein = target * 0.19 / 4;
  if (current.protein > maxProtein) {
    const proteinParts = allParts().filter((part) => isProteinDominantProduct(part.product));
    const dominantProtein = proteinParts.reduce((sum, part) => sum + macrosForProductGrams(part.product, part.grams).protein, 0);
    const otherProtein = current.protein - dominantProtein;
    const ratio = dominantProtein ? Math.max(0, Math.min(1, (maxProtein - otherProtein) / dominantProtein)) : 1;
    for (const part of proteinParts) {
      part.grams = Math.max(minimumProteinServing(part), part.grams * ratio);
    }
    current = totals();
  }

  const fatTargetGrams = target * 0.30 / 9;
  let fatPercent = current.calories ? current.fat * 9 / current.calories * 100 : 0;
  if (fatPercent > FAT_MAX_PERCENT) {
    const fatParts = allParts().filter((part) => isFatDominantProduct(part.product));
    const ratio = Math.max(0, Math.min(1, 30 / fatPercent));
    for (const part of fatParts) {
      part.grams = Math.max(minimumFatServing(part), part.grams * ratio);
    }
    current = totals();
    let remainingFatDeficit = fatTargetGrams - current.fat;
    if (remainingFatDeficit > 0.5) {
      const oilProduct = productByName("оливковое масло") || productByName("масло");
      const nutProduct = productByName("грецкие орехи");
      const supplementTargets = [
        { product: oilProduct, meal: parsedMeals.find((item) => item.meal.mealType === "Обед"), limit: PORTION_LIMITS_GRAMS.oil },
        { product: oilProduct, meal: parsedMeals.find((item) => item.meal.mealType === "Ужин"), limit: PORTION_LIMITS_GRAMS.oil },
        { product: nutProduct, meal: parsedMeals.find((item) => item.meal.mealType === "Перекус"), limit: PORTION_LIMITS_GRAMS.nuts },
      ];
      for (const supplement of supplementTargets) {
        if (remainingFatDeficit <= 0.5) break;
        if (!supplement.product || !supplement.meal) continue;
        const fatPerGram = Number(supplement.product.fat || 0) / 100;
        const added = addOrIncreasePart(
          supplement.meal.parts,
          supplement.product,
          fatPerGram ? remainingFatDeficit / fatPerGram : 0,
          supplement.limit
        );
        if (added > 0) {
          supplement.meal.addedIngredients.push(supplement.product.name);
          remainingFatDeficit -= added * fatPerGram;
        }
      }
      current = totals();
    }
  }

  if (current.fat < fatTargetGrams) {
    let fatParts = allParts()
      .filter((part) => isFatDominantProduct(part.product))
      .sort((a, b) => Number(b.product.fat || 0) - Number(a.product.fat || 0));
    if (!fatParts.length) {
      const oilProduct = productByName("оливковое масло") || productByName("масло");
      const targetMeal = parsedMeals.find((item) => item.meal.mealType === "Обед") || parsedMeals[0];
      if (oilProduct && targetMeal) {
        const added = addOrIncreasePart(targetMeal.parts, oilProduct, 10, PORTION_LIMITS_GRAMS.oil);
        if (added > 0) {
          targetMeal.addedIngredients.push(oilProduct.name);
          fatParts = allParts()
            .filter((part) => isFatDominantProduct(part.product))
            .sort((a, b) => Number(b.product.fat || 0) - Number(a.product.fat || 0));
          current = totals();
        }
      }
    }
    let fatDeficit = fatTargetGrams - current.fat;
    for (const part of fatParts) {
      if (fatDeficit <= 0.5) break;
      const fatPerGram = Number(part.product.fat || 0) / 100;
      const limit = portionLimitForProduct(part.product) || Math.max(part.grams * 1.5, part.grams + 50);
      const add = fatPerGram ? Math.min(limit - part.grams, fatDeficit / fatPerGram) : 0;
      if (add <= 0) continue;
      part.grams += add;
      fatDeficit -= add * fatPerGram;
    }
    current = totals();
  }

  let calorieDelta = target - current.calories;
  if (Math.abs(calorieDelta) > target * 0.02) {
    const energyParts = allParts()
      .filter((part) => !isProteinDominantProduct(part.product) && !isFatDominantProduct(part.product) && productCaloriesPerGram(part.product) > 0)
      .sort((a, b) => Number(b.product.carbs || 0) - Number(a.product.carbs || 0));
    if (calorieDelta > 0) {
      for (const part of energyParts) {
        if (calorieDelta <= target * 0.01) break;
        const caloriesPerGram = productCaloriesPerGram(part.product);
        const explicitLimit = portionLimitForProduct(part.product);
        const text = productSearchText(part.product);
        const namedLimit = text.includes("мед") ? 50
          : text.includes("хлеб") ? 250
            : text.includes("фрукт") || text.includes("банан") || text.includes("яблок") || text.includes("ягод") ? 400
              : text.includes("рис") || text.includes("греч") || text.includes("киноа") || text.includes("макарон") || text.includes("паста") ? 300
                : null;
        const practicalLimit = explicitLimit || namedLimit || Math.max(part.grams * 3, part.grams + 350);
        const add = Math.min(practicalLimit - part.grams, calorieDelta / caloriesPerGram);
        if (add <= 0) continue;
        part.grams += add;
        calorieDelta -= add * caloriesPerGram;
      }
      if (calorieDelta > target * 0.02) {
        const riceProduct = productByName("рис");
        const targetMeal = parsedMeals.find((item) => item.meal.mealType === "Обед") || parsedMeals[0];
        if (riceProduct && targetMeal) {
          const added = addOrIncreasePart(
            targetMeal.parts,
            riceProduct,
            calorieDelta / productCaloriesPerGram(riceProduct),
            300
          );
          if (added > 0) {
            targetMeal.addedIngredients.push(riceProduct.name);
            calorieDelta -= added * productCaloriesPerGram(riceProduct);
          }
        }
      }
      if (calorieDelta > target * 0.02) {
        const supplements = [
          {
            product: productByName("банан"),
            targetMeal: parsedMeals.find((item) => item.meal.mealType === "Перекус") || parsedMeals[0],
            limit: 300,
          },
          {
            product: String(ration || "").toLowerCase().includes("глют")
              ? null
              : productByName("хлеб цельнозерновой"),
            targetMeal: parsedMeals.find((item) => item.meal.mealType === "Завтрак") || parsedMeals[0],
            limit: 150,
          },
        ];
        for (const supplement of supplements) {
          if (calorieDelta <= target * 0.02) break;
          if (!supplement.product || !supplement.targetMeal) continue;
          const added = addOrIncreasePart(
            supplement.targetMeal.parts,
            supplement.product,
            calorieDelta / productCaloriesPerGram(supplement.product),
            supplement.limit
          );
          if (added > 0) {
            supplement.targetMeal.addedIngredients.push(supplement.product.name);
            calorieDelta -= added * productCaloriesPerGram(supplement.product);
          }
        }
      }
    } else {
      let caloriesToRemove = Math.abs(calorieDelta);
      for (const part of energyParts) {
        if (caloriesToRemove <= target * 0.01) break;
        const caloriesPerGram = productCaloriesPerGram(part.product);
        const removable = Math.max(0, part.grams - 20);
        const remove = Math.min(removable, caloriesToRemove / caloriesPerGram);
        part.grams -= remove;
        caloriesToRemove -= remove * caloriesPerGram;
      }
    }
  }

  const mealForType = (mealType) => (
    parsedMeals.find((item) => item.meal.mealType === mealType) || parsedMeals[0]
  );
  const addTrackedPart = (meal, product, grams, limit) => {
    if (!meal || !product || grams <= 0) return 0;
    const existed = meal.parts.some((part) => part.product.name === product.name);
    const added = addOrIncreasePart(meal.parts, product, grams, limit);
    if (added > 0 && !existed) meal.addedIngredients.push(product.name);
    return added;
  };
  const addFatGrams = (fatGrams) => {
    let remaining = Math.max(0, fatGrams);
    const supplements = [
      { product: productByName("оливковое масло") || productByName("масло"), meal: mealForType("Обед"), limit: PORTION_LIMITS_GRAMS.oil },
      { product: productByName("оливковое масло") || productByName("масло"), meal: mealForType("Ужин"), limit: PORTION_LIMITS_GRAMS.oil },
      { product: productByName("грецкие орехи"), meal: mealForType("Перекус"), limit: PORTION_LIMITS_GRAMS.nuts },
      { product: productByName("авокадо"), meal: mealForType("Завтрак"), limit: 150 },
    ];
    for (const supplement of supplements) {
      if (remaining <= 0.2 || !supplement.product) break;
      const fatPerGram = Number(supplement.product.fat || 0) / 100;
      if (fatPerGram <= 0) continue;
      const added = addTrackedPart(
        supplement.meal,
        supplement.product,
        remaining / fatPerGram,
        supplement.limit
      );
      remaining -= added * fatPerGram;
    }
    return Math.max(0, remaining);
  };
  const removeCaloriesFromCarbs = (calories) => {
    let remaining = Math.max(0, calories);
    const candidates = allParts()
      .filter((part) => (
        !isProteinDominantProduct(part.product)
        && !isFatDominantProduct(part.product)
        && Number(part.product.carbs || 0) >= 5
      ))
      .sort((left, right) => Number(right.product.carbs || 0) - Number(left.product.carbs || 0));
    for (const part of candidates) {
      if (remaining <= target * 0.002) break;
      const caloriesPerGram = productCaloriesPerGram(part.product);
      const removable = Math.max(0, part.grams - 20);
      const removed = caloriesPerGram > 0 ? Math.min(removable, remaining / caloriesPerGram) : 0;
      part.grams -= removed;
      remaining -= removed * caloriesPerGram;
    }
    return Math.max(0, remaining);
  };
  const addCaloriesFromCarbs = (calories) => {
    let remaining = Math.max(0, calories);
    const existing = allParts()
      .filter((part) => (
        !isProteinDominantProduct(part.product)
        && !isFatDominantProduct(part.product)
        && Number(part.product.carbs || 0) >= 5
      ))
      .sort((left, right) => Number(right.product.carbs || 0) - Number(left.product.carbs || 0));
    for (const part of existing) {
      if (remaining <= target * 0.002) break;
      const caloriesPerGram = productCaloriesPerGram(part.product);
      const text = productSearchText(part.product);
      const limit = portionLimitForProduct(part.product)
        || (text.includes("хлеб") ? 250 : text.includes("фрукт") || text.includes("банан") ? 400 : 350);
      const added = caloriesPerGram > 0 ? Math.min(Math.max(0, limit - part.grams), remaining / caloriesPerGram) : 0;
      part.grams += added;
      remaining -= added * caloriesPerGram;
    }
    const supplements = [
      { product: productByName("рис"), meal: mealForType("Обед"), limit: 300 },
      { product: productByName("рис"), meal: mealForType("Ужин"), limit: 300 },
      { product: productByName("картофель"), meal: mealForType("Ужин"), limit: PORTION_LIMITS_GRAMS.vegetables },
      { product: productByName("банан"), meal: mealForType("Перекус"), limit: 300 },
      {
        product: String(ration || "").toLowerCase().includes("глют") ? null : productByName("хлеб цельнозерновой"),
        meal: mealForType("Завтрак"),
        limit: 150,
      },
    ];
    for (const supplement of supplements) {
      if (remaining <= target * 0.002 || !supplement.product) break;
      const caloriesPerGram = productCaloriesPerGram(supplement.product);
      const added = caloriesPerGram > 0
        ? addTrackedPart(supplement.meal, supplement.product, remaining / caloriesPerGram, supplement.limit)
        : 0;
      remaining -= added * caloriesPerGram;
    }
    return Math.max(0, remaining);
  };

  for (let pass = 0; pass < 3; pass += 1) {
    current = totals();
    const currentFatPercent = current.calories ? current.fat * 9 / current.calories * 100 : 0;
    if (currentFatPercent > FAT_MAX_PERCENT) {
      let fatToRemove = current.fat - target * 0.30 / 9;
      const fatParts = allParts()
        .filter((part) => isFatDominantProduct(part.product))
        .sort((left, right) => Number(right.product.fat || 0) - Number(left.product.fat || 0));
      for (const part of fatParts) {
        if (fatToRemove <= 0.2) break;
        const fatPerGram = Number(part.product.fat || 0) / 100;
        const removable = Math.max(0, part.grams - minimumFatServing(part));
        const removed = fatPerGram > 0 ? Math.min(removable, fatToRemove / fatPerGram) : 0;
        part.grams -= removed;
        fatToRemove -= removed * fatPerGram;
      }
      current = totals();
      addCaloriesFromCarbs(target - current.calories);
    } else if (currentFatPercent < FAT_MIN_PERCENT) {
      addFatGrams(target * 0.30 / 9 - current.fat);
      current = totals();
      removeCaloriesFromCarbs(current.calories - target);
    }

    current = totals();
    const finalCalorieDelta = target - current.calories;
    if (finalCalorieDelta > target * 0.002) addCaloriesFromCarbs(finalCalorieDelta);
    else if (finalCalorieDelta < -target * 0.002) removeCaloriesFromCarbs(Math.abs(finalCalorieDelta));
  }

  const generatedMeals = parsedMeals.map(({ meal, parts, addedIngredients }, index) => {
    const mealTotals = totalsForParts(parts);
    const protein = round(mealTotals.protein);
    const fat = round(mealTotals.fat);
    const carbs = round(mealTotals.carbs);
    return {
      ...meal,
      id: `${meal.id}-plan-${idSuffix}-${index + 1}`,
      calories: macroCalories({ protein, fat, carbs }),
      protein,
      fat,
      carbs,
      ingredients: parts.map(generatedIngredientLine),
      recipe: addedIngredients.length
        ? `${meal.recipe} Дополните блюдо: ${[...new Set(addedIngredients)].join(", ")}.`
        : meal.recipe,
    };
  });
  const validation = planSelectionScore(generatedMeals, target);
  const hasPortionIssue = generatedMeals.some((meal) => ingredientPartsFromLines(meal.ingredients || []).parts.some((part) => {
    const limit = portionLimitForProduct(part.product);
    return limit && part.grams > limit + 0.5;
  }));
  const valid = !hasPortionIssue
    && validation.calorieDiffPercent <= 10
    && validation.fatPercent >= FAT_MIN_PERCENT
    && validation.fatPercent <= FAT_MAX_PERCENT
    && validation.proteinPercent <= 30;
  return { valid, hasPortionIssue, meals: generatedMeals, ...validation };
}

function buildDailyPlanSelections(meals, filters) {
  const plans = {};
  const reports = [];
  const generatedMeals = [];
  for (const ration of filters.rations) {
    for (const caloriesTarget of filters.caloriesTargets) {
      for (const day of filters.days) {
        const candidatesByType = REQUIRED_MEAL_TYPES.map((mealType) => (
          meals
            .filter((meal) => (
              meal.mealType === mealType
              && meal.rations?.includes(ration)
              && meal.caloriesTargets?.includes(Number(caloriesTarget))
              && meal.day === day
            ))
            .sort((left, right) => (
              Math.abs(Number(left.calories || 0) - Number(caloriesTarget) * (MEAL_TARGET_SHARE[mealType] || 0.25))
              - Math.abs(Number(right.calories || 0) - Number(caloriesTarget) * (MEAL_TARGET_SHARE[mealType] || 0.25))
            ))
            .slice(0, 12)
        ));
        if (candidatesByType.some((items) => !items.length)) {
          reports.push({ ration, caloriesTarget, day, reason: "plan_selection_missing_meal_type" });
          continue;
        }

        let best = null;
        const selected = [];
        const visit = (typeIndex) => {
          if (typeIndex >= candidatesByType.length) {
            const result = planSelectionScore(selected, caloriesTarget);
            if (!best || result.score < best.score) {
              best = { ...result, meals: [...selected] };
            }
            return;
          }
          for (const meal of candidatesByType[typeIndex]) {
            selected.push(meal);
            visit(typeIndex + 1);
            selected.pop();
          }
        };
        visit(0);
        if (!best) continue;

        const idSuffix = crypto.createHash("sha1").update(`${ration}|${caloriesTarget}|${day}`).digest("hex").slice(0, 10);
        const rebalanced = rebalancePlanSelection(best.meals, caloriesTarget, idSuffix, ration);
        const selectedPlan = rebalanced?.valid ? rebalanced : best;
        if (rebalanced?.valid) generatedMeals.push(...rebalanced.meals);
        else reports.push({
          ration,
          caloriesTarget,
          day,
          reason: rebalanced?.reason || "plan_rebalance_failed_validation",
          calorieDiffPercent: round(rebalanced?.calorieDiffPercent),
          fatPercent: round(rebalanced?.fatPercent),
          proteinPercent: round(rebalanced?.proteinPercent),
          totals: rebalanced?.totals || null,
          hasPortionIssue: Boolean(rebalanced?.hasPortionIssue),
        });
        const key = dailyPlanKey(ration, caloriesTarget, day);
        plans[key] = {
          ration,
          caloriesTarget: Number(caloriesTarget),
          day,
          mealIds: selectedPlan.meals.map((meal) => meal.id),
          totals: {
            calories: Math.round(selectedPlan.totals.calories),
            protein: round(selectedPlan.totals.protein),
            fat: round(selectedPlan.totals.fat),
            carbs: round(selectedPlan.totals.carbs),
          },
          calorieDiffPercent: round(selectedPlan.calorieDiffPercent),
          fatPercent: round(selectedPlan.fatPercent),
          proteinPercent: round(selectedPlan.proteinPercent),
        };
        if (selectedPlan.calorieDiffPercent > 10 || selectedPlan.fatPercent < FAT_MIN_PERCENT || selectedPlan.fatPercent > FAT_MAX_PERCENT || selectedPlan.proteinPercent > 30) {
          reports.push({
            ration,
            caloriesTarget,
            day,
            reason: "plan_selection_warning",
            ...plans[key],
          });
        }
      }
    }
  }
  return { plans, reports, generatedMeals };
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

function fatValidationReport(meals, filters, plans = {}) {
  const issues = [];
  const ration = "Без ограничений";
  const mealById = new Map(meals.map((meal) => [String(meal.id), meal]));
  const targets = filters.caloriesTargets.filter((target) => [2000, 2200, 2400].includes(Number(target)));
  for (const caloriesTarget of targets) {
    for (const day of filters.days) {
      const selectedMeals = (plans[dailyPlanKey(ration, caloriesTarget, day)]?.mealIds || [])
        .map((id) => mealById.get(String(id)))
        .filter(Boolean);
      const plan = selectedMeals.length
        ? dailyPlanFor(selectedMeals, { ration, caloriesTarget, day })
        : dailyPlanFor(meals, { ration, caloriesTarget, day });
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
const imageSource = localizeNutritionImages(meals);
const dailyPlanSelections = buildDailyPlanSelections(meals, filters);
meals = [...meals, ...dailyPlanSelections.generatedMeals];
const afterStats = mealStats(meals);
const dailyFatIssues = fatValidationReport(meals, filters, dailyPlanSelections.plans);
const missingIngredients = new Map();
for (const item of quarantine) {
  for (const reason of item.reasons || []) {
    if (reason.type !== "missing_ingredient") continue;
    const key = reason.aliasNeeded || reason.ingredient;
    missingIngredients.set(key, (missingIngredients.get(key) || 0) + 1);
  }
}

const contentVersion = crypto
  .createHash("sha256")
  .update(JSON.stringify({ meals, filters, plans: dailyPlanSelections.plans }))
  .digest("hex");
const payload = {
  contentVersion,
  importedAt: new Date().toISOString(),
  source: path.basename(input),
  meals,
  filters,
  plans: dailyPlanSelections.plans,
  imageSource,
};
const runtimeSummary = {
  contentVersion,
  importedAt: payload.importedAt,
  source: "bundled_summary",
  meals: [],
  filters,
  plans: dailyPlanSelections.plans,
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
    dailyProteinBalance: 0,
    seafoodNamedMealRepair: 0,
    dailyPlanSelectionWarnings: dailyPlanSelections.reports.length,
  },
  topMissingIngredients: [...missingIngredients.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([ingredient, count]) => ({ ingredient, count })),
  corrected,
  quarantine,
  dailyCompletion: dailyCompletion.reports,
  dailyProteinBalance: [],
  seafoodNamedMealRepair: [],
  dailyPlanSelections: dailyPlanSelections.reports,
  dailyFatIssues,
};

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.mkdirSync(path.dirname(backendOutput), { recursive: true });
fs.mkdirSync(path.dirname(runtimeSummaryOutput), { recursive: true });
fs.mkdirSync(path.dirname(quarantineOutput), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
fs.writeFileSync(backendOutput, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
fs.writeFileSync(runtimeSummaryOutput, `${JSON.stringify(runtimeSummary, null, 2)}\n`, "utf8");
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
