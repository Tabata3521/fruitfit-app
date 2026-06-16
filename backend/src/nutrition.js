import express from "express";
import { query } from "./db.js";

export const nutritionRouter = express.Router();

nutritionRouter.get("/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const limit = Math.max(1, Math.min(50, Number(req.query.limit || 10)));
  if (!q) {
    res.json({ items: [] });
    return;
  }
  const items = await searchProducts(q, { limit });
  res.json({ items });
});

nutritionRouter.post("/calc", async (req, res) => {
  const result = await calculateNutritionItems(req.body?.items || []);
  res.json(result);
});

export async function searchProducts(input, { limit = 10 } = {}) {
  const products = await loadProducts();
  const normalized = normalizeProductName(input);
  if (!normalized) return [];

  return products
    .map((product) => {
      const candidates = [product.name, ...(product.aliases || [])];
      const score = Math.max(...candidates.map((candidate) => stringSimilarity(normalized, candidate)));
      return toProductDto(product, round(score), "search");
    })
    .filter((product) => product.confidence >= 0.35 || normalizeProductName(product.name).includes(normalized))
    .sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name, "ru"))
    .slice(0, limit);
}

export async function calculateNutritionItems(items) {
  const warnings = [];
  const calculatedItems = [];

  for (const item of Array.isArray(items) ? items : []) {
    const inputName = String(item?.name || "").trim();
    let grams = item?.grams !== null && item?.grams !== undefined ? Number(String(item.grams).replace(",", ".")) : null;

    if (!inputName) {
      warnings.push({ type: "invalid_item", message: "Product name is empty." });
      continue;
    }

    const matched = await findProduct(inputName);
    if (!matched) {
      warnings.push({ type: "product_not_found", inputName, message: "Product is not in the nutrition database." });
      continue;
    }

    if (!Number.isFinite(grams) || grams <= 0) {
      grams = Number(matched.default_serving_grams || 0) * Number(item.count || 1);
      if (!Number.isFinite(grams) || grams <= 0) {
        warnings.push({ type: "invalid_grams", inputName, message: "Grams or default serving is required." });
        continue;
      }
    }

    const multiplier = grams / 100;
    calculatedItems.push({
      inputName,
      matchedProduct: matched.name,
      grams: round(grams),
      kcal: Math.round(Number(matched.kcal_per_100) * multiplier),
      protein: round(Number(matched.protein_per_100) * multiplier),
      fat: round(Number(matched.fat_per_100) * multiplier),
      carbs: round(Number(matched.carbs_per_100) * multiplier),
      confidence: matched.confidence,
      matchedBy: matched.matchedBy,
      servingExamples: matched.serving_examples || [],
      source: matched.source || null
    });
  }

  const total = calculatedItems.reduce(
    (acc, item) => ({
      kcal: acc.kcal + item.kcal,
      protein: acc.protein + item.protein,
      fat: acc.fat + item.fat,
      carbs: acc.carbs + item.carbs
    }),
    { kcal: 0, protein: 0, fat: 0, carbs: 0 }
  );

  return {
    items: calculatedItems,
    total: {
      kcal: Math.round(total.kcal),
      protein: round(total.protein),
      fat: round(total.fat),
      carbs: round(total.carbs)
    },
    warnings
  };
}

async function findProduct(inputName) {
  const products = await loadProducts();
  const normalized = normalizeProductName(inputName);
  if (!normalized) return null;

  for (const product of products) {
    if (normalizeProductName(product.name) === normalized) return toProductDto(product, 1, "product_exact");
  }
  for (const product of products) {
    for (const alias of product.aliases || []) {
      if (normalizeProductName(alias) === normalized) return toProductDto(product, 0.95, "alias_exact");
    }
  }

  let best = null;
  for (const product of products) {
    for (const candidate of [product.name, ...(product.aliases || [])]) {
      const score = stringSimilarity(normalized, candidate);
      if (!best || score > best.score) best = { product, score };
    }
  }
  if (!best || best.score < 0.68) return null;
  return toProductDto(best.product, round(Math.min(best.score, 0.9)), "fuzzy");
}

let productCache = null;
let productCacheAt = 0;

async function loadProducts() {
  if (productCache && Date.now() - productCacheAt < 60_000) return productCache;
  const result = await query(`
    SELECT
      p.id,
      p.name,
      p.brand,
      p.category,
      p.kcal_per_100,
      p.protein_per_100,
      p.fat_per_100,
      p.carbs_per_100,
      p.serving_examples,
      p.default_serving_grams,
      p.source,
      p.is_verified,
      p.country,
      COALESCE(jsonb_agg(pa.alias) FILTER (WHERE pa.alias IS NOT NULL), '[]'::jsonb) AS aliases
    FROM products p
    LEFT JOIN product_aliases pa ON pa.product_id = p.id
    GROUP BY p.id
    ORDER BY p.name
  `);
  productCache = result.rows.map((row) => ({
    ...row,
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
    serving_examples: Array.isArray(row.serving_examples) ? row.serving_examples : []
  }));
  productCacheAt = Date.now();
  return productCache;
}

function toProductDto(product, confidence, matchedBy) {
  return {
    id: product.id,
    name: product.name,
    brand: product.brand || null,
    category: product.category || null,
    kcal_per_100: Number(product.kcal_per_100 || 0),
    protein_per_100: Number(product.protein_per_100 || 0),
    fat_per_100: Number(product.fat_per_100 || 0),
    carbs_per_100: Number(product.carbs_per_100 || 0),
    serving_examples: product.serving_examples || [],
    default_serving_grams: product.default_serving_grams === null ? null : Number(product.default_serving_grams || 0),
    source: product.source || null,
    is_verified: Boolean(product.is_verified),
    country: product.country || "RU",
    confidence,
    matchedBy
  };
}

export function normalizeProductName(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\u0451/g, "\u0435")
    .replace(/[.,:;!?()[\]{}"'\u00ab\u00bb`]/g, " ")
    .replace(/\s*%\s*/g, "%")
    .replace(/\s+/g, " ")
    .trim();
}

function stringSimilarity(a, b) {
  const left = normalizeProductName(a);
  const right = normalizeProductName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (right.includes(left) || left.includes(right)) return 0.82;

  const maxLength = Math.max(left.length, right.length);
  const editScore = 1 - levenshtein(left, right) / maxLength;
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size || 1;
  return Math.max(editScore, intersection / union);
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
      current[j + 1] = Math.min(current[j] + 1, previous[j + 1] + 1, previous[j] + (a[i] === b[j] ? 0 : 1));
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length];
}

export function round(value, digits = 1) {
  const factor = 10 ** digits;
  const rounded = Math.round(Number(value || 0) * factor) / factor;
  return Number.isInteger(rounded) ? rounded : rounded;
}
