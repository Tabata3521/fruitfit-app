import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

export const NUTRITION_DB_PATH = path.join(projectRoot, "data", "nutrition.db");

let dbInstance = null;

export function getNutritionDb() {
  if (!dbInstance) {
    fs.mkdirSync(path.dirname(NUTRITION_DB_PATH), { recursive: true });
    dbInstance = new Database(NUTRITION_DB_PATH);
    dbInstance.pragma("journal_mode = WAL");
    dbInstance.pragma("foreign_keys = ON");
    createNutritionSchema(dbInstance);
  }
  return dbInstance;
}

export function createNutritionSchema(db = getNutritionDb()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      brand TEXT,
      category TEXT,
      kcal_per_100 REAL NOT NULL,
      protein_per_100 REAL NOT NULL,
      fat_per_100 REAL NOT NULL,
      carbs_per_100 REAL NOT NULL,
      serving_examples TEXT DEFAULT '[]',
      default_serving_grams REAL,
      source TEXT,
      is_verified INTEGER DEFAULT 0,
      country TEXT DEFAULT 'RU',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS product_aliases (
      id INTEGER PRIMARY KEY,
      product_id INTEGER NOT NULL,
      alias TEXT NOT NULL,
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_custom_products (
      id INTEGER PRIMARY KEY,
      user_id TEXT,
      name TEXT NOT NULL,
      kcal_per_100 REAL NOT NULL,
      protein_per_100 REAL NOT NULL,
      fat_per_100 REAL NOT NULL,
      carbs_per_100 REAL NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
    CREATE INDEX IF NOT EXISTS idx_product_aliases_alias ON product_aliases(alias);
    CREATE INDEX IF NOT EXISTS idx_product_aliases_product_id ON product_aliases(product_id);
    CREATE INDEX IF NOT EXISTS idx_user_custom_products_user_id ON user_custom_products(user_id);
  `);
  ensureColumn(db, "products", "serving_examples", "TEXT DEFAULT '[]'");
  ensureColumn(db, "products", "default_serving_grams", "REAL");
}

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function normalizeProductName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[“”"«»'`]/g, "")
    .replace(/[.,:;!?()[\]{}]/g, " ")
    .replace(/\s*%\s*/g, "%")
    .replace(/\s+/g, " ")
    .trim();
}

function toTokens(value) {
  return normalizeProductName(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array(b.length + 1);

  for (let i = 0; i < a.length; i += 1) {
    current[0] = i + 1;
    for (let j = 0; j < b.length; j += 1) {
      const insert = current[j] + 1;
      const remove = previous[j + 1] + 1;
      const replace = previous[j] + (a[i] === b[j] ? 0 : 1);
      current[j + 1] = Math.min(insert, remove, replace);
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length];
}

function stringSimilarity(a, b) {
  const left = normalizeProductName(a);
  const right = normalizeProductName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const maxLength = Math.max(left.length, right.length);
  const editScore = 1 - levenshtein(left, right) / maxLength;

  const leftTokens = new Set(toTokens(left));
  const rightTokens = new Set(toTokens(right));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size || 1;
  const tokenScore = intersection / union;

  return Math.max(editScore, tokenScore);
}

function getCatalogRows(db = getNutritionDb(), userId = "") {
  const products = db
    .prepare(
      `SELECT id, name, brand, category, kcal_per_100, protein_per_100, fat_per_100, carbs_per_100, serving_examples, default_serving_grams, source, is_verified, country
       FROM products`,
    )
    .all();
  const aliases = db
    .prepare(
      `SELECT product_id, alias
       FROM product_aliases`,
    )
    .all();

  const aliasesByProduct = new Map();
  for (const row of aliases) {
    const list = aliasesByProduct.get(row.product_id) || [];
    list.push(row.alias);
    aliasesByProduct.set(row.product_id, list);
  }

  const catalog = products.map((product) => ({
    ...product,
    aliases: aliasesByProduct.get(product.id) || [],
    isCustom: false,
  }));

  if (userId) {
    const customProducts = db
      .prepare(
        `SELECT id, name, kcal_per_100, protein_per_100, fat_per_100, carbs_per_100
         FROM user_custom_products
         WHERE user_id = ? OR user_id IS NULL`,
      )
      .all(userId)
      .map((product) => ({
        ...product,
        id: `custom:${product.id}`,
        brand: null,
        category: "Пользовательский продукт",
        source: "user_custom_products",
        is_verified: 0,
        country: "RU",
        serving_examples: "[]",
        default_serving_grams: null,
        aliases: [],
        isCustom: true,
      }));
    catalog.push(...customProducts);
  }

  return catalog;
}

function makeProductDto(product, confidence, matchedBy) {
  return {
    id: product.id,
    name: product.name,
    brand: product.brand || null,
    category: product.category || null,
    kcal_per_100: product.kcal_per_100,
    protein_per_100: product.protein_per_100,
    fat_per_100: product.fat_per_100,
    carbs_per_100: product.carbs_per_100,
    serving_examples: parseServingExamples(product.serving_examples),
    default_serving_grams: product.default_serving_grams || null,
    source: product.source || null,
    is_verified: Number(product.is_verified || 0),
    country: product.country || "RU",
    confidence,
    matchedBy,
  };
}

function parseServingExamples(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

export function findProduct(inputName, options = {}) {
  const normalizedInput = normalizeProductName(inputName);
  if (!normalizedInput) return null;

  const catalog = getCatalogRows(options.db || getNutritionDb(), options.userId || "");

  for (const product of catalog) {
    if (normalizeProductName(product.name) === normalizedInput) {
      return makeProductDto(product, 1, "product_exact");
    }
  }

  for (const product of catalog) {
    for (const alias of product.aliases || []) {
      if (normalizeProductName(alias) === normalizedInput) {
        return makeProductDto(product, 0.95, "alias_exact");
      }
    }
  }

  let best = null;
  for (const product of catalog) {
    const candidates = [product.name, ...(product.aliases || [])];
    for (const candidate of candidates) {
      const score = stringSimilarity(normalizedInput, candidate);
      if (!best || score > best.score) {
        best = { product, score, candidate };
      }
    }
  }

  if (!best || best.score < 0.68) {
    return best
      ? {
          matched: false,
          inputName,
          confidence: round(best.score),
          suggestion: best.score >= 0.58 ? best.product.name : null,
        }
      : null;
  }

  return makeProductDto(best.product, round(Math.min(best.score, 0.9)), "fuzzy");
}

export function searchProducts(query, options = {}) {
  const normalizedQuery = normalizeProductName(query);
  if (!normalizedQuery) return [];

  return getCatalogRows(options.db || getNutritionDb(), options.userId || "")
    .map((product) => {
      const candidates = [product.name, ...(product.aliases || [])];
      const score = Math.max(...candidates.map((candidate) => stringSimilarity(normalizedQuery, candidate)));
      return {
        id: product.id,
        name: product.name,
        brand: product.brand || null,
        category: product.category || null,
        kcal_per_100: product.kcal_per_100,
        protein_per_100: product.protein_per_100,
        fat_per_100: product.fat_per_100,
        carbs_per_100: product.carbs_per_100,
        confidence: round(score),
      };
    })
    .filter((product) => product.confidence >= 0.35 || normalizeProductName(product.name).includes(normalizedQuery))
    .sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name, "ru"))
    .slice(0, Number(options.limit || 10));
}

export function calculateNutritionItems(items, options = {}) {
  const warnings = [];
  const calculatedItems = [];

  for (const item of Array.isArray(items) ? items : []) {
    const inputName = String(item?.name || "").trim();
    let grams = Number(String(item?.grams || "").replace(",", "."));

    if (!inputName) {
      warnings.push({ type: "invalid_item", message: "??????? ??? ???????? ????????." });
      continue;
    }

    const matched = findProduct(inputName, options);
    if (!matched || matched.matched === false) {
      warnings.push({
        type: "product_not_found",
        inputName,
        suggestion: matched?.suggestion || null,
        confidence: matched?.confidence || 0,
        message: `??????? "${inputName}" ?? ?????? ? ???? ?????????.`,
      });
      continue;
    }

    if (!Number.isFinite(grams) || grams <= 0) {
      grams = Number(matched.default_serving_grams || 0);
      if (!Number.isFinite(grams) || grams <= 0) {
        warnings.push({ type: "invalid_grams", inputName, message: `??? "${inputName}" ????? ????????? ??? ???????? ??????.` });
        continue;
      }
    }

    const multiplier = grams / 100;
    calculatedItems.push({
      inputName,
      matchedProduct: matched.name,
      grams: round(grams),
      kcal: Math.round(matched.kcal_per_100 * multiplier),
      protein: round(matched.protein_per_100 * multiplier),
      fat: round(matched.fat_per_100 * multiplier),
      carbs: round(matched.carbs_per_100 * multiplier),
      confidence: matched.confidence,
      matchedBy: matched.matchedBy,
      servingExamples: matched.serving_examples || [],
    });
  }

  const total = calculatedItems.reduce(
    (acc, item) => ({
      kcal: acc.kcal + item.kcal,
      protein: acc.protein + item.protein,
      fat: acc.fat + item.fat,
      carbs: acc.carbs + item.carbs,
    }),
    { kcal: 0, protein: 0, fat: 0, carbs: 0 },
  );

  return {
    items: calculatedItems,
    total: {
      kcal: Math.round(total.kcal),
      protein: round(total.protein),
      fat: round(total.fat),
      carbs: round(total.carbs),
    },
    warnings,
  };
}

export function round(value, digits = 1) {
  const factor = 10 ** digits;
  const rounded = Math.round(Number(value || 0) * factor) / factor;
  return Number.isInteger(rounded) ? rounded : rounded;
}
