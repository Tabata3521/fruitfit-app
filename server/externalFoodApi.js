const OPEN_FOOD_FACTS_URL = "https://world.openfoodfacts.org/cgi/search.pl";
const REQUEST_TIMEOUT_MS = 3500;

function normalizeExternalName(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[“”"«»'`]/g, "")
    .replace(/[.,:;!?()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  const rounded = Math.round(Number(value || 0) * factor) / factor;
  return Number.isInteger(rounded) ? rounded : rounded;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function scoreName(query, candidate = "") {
  const queryTokens = new Set(normalizeExternalName(query).split(" ").filter(Boolean));
  const candidateTokens = new Set(normalizeExternalName(candidate).split(" ").filter(Boolean));
  if (!queryTokens.size || !candidateTokens.size) return 0;
  let hits = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) hits += 1;
  }
  return hits / queryTokens.size;
}

function pickName(product = {}) {
  return (
    product.product_name_ru ||
    product.product_name ||
    product.generic_name_ru ||
    product.generic_name ||
    ""
  ).trim();
}

function mapOpenFoodFactsProduct(rawProduct, query) {
  const name = pickName(rawProduct);
  const nutriments = rawProduct.nutriments || {};
  const kcal = toNumber(nutriments["energy-kcal_100g"] ?? nutriments["energy-kcal"]);
  const protein = toNumber(nutriments.proteins_100g);
  const fat = toNumber(nutriments.fat_100g);
  const carbs = toNumber(nutriments.carbohydrates_100g);

  if (!name || kcal === null || protein === null || fat === null || carbs === null) {
    return null;
  }

  const brand = String(rawProduct.brands || "").split(",")[0]?.trim() || null;
  const category = Array.isArray(rawProduct.categories_tags)
    ? rawProduct.categories_tags[0]?.replace(/^en:/, "") || "External food"
    : "External food";

  const aliases = [
    query,
    rawProduct.product_name_ru,
    rawProduct.product_name,
    rawProduct.generic_name_ru,
    rawProduct.generic_name,
    brand ? `${name} ${brand}` : null,
  ].filter(Boolean);

  return {
    name,
    brand,
    category,
    kcal: round(kcal),
    protein: round(protein),
    fat: round(fat),
    carbs: round(carbs),
    aliases: [...new Set(aliases)],
    defaultServingGrams: 100,
    servingExamples: [
      { label: "100 г", grams: 100 },
      { label: "1 порция", grams: 100 },
    ],
    source: `openfoodfacts${rawProduct.code ? `:${rawProduct.code}` : ""}`,
    matchScore: scoreName(query, name),
  };
}

export async function lookupExternalFoodProduct(query, options = {}) {
  const normalizedQuery = normalizeExternalName(query);
  if (!normalizedQuery || options.externalFallback === false) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);

  try {
    const url = new URL(OPEN_FOOD_FACTS_URL);
    url.searchParams.set("search_terms", normalizedQuery);
    url.searchParams.set("search_simple", "1");
    url.searchParams.set("action", "process");
    url.searchParams.set("json", "1");
    url.searchParams.set("page_size", String(options.limit || 5));
    url.searchParams.set("fields", "code,product_name,product_name_ru,generic_name,generic_name_ru,brands,categories_tags,nutriments");

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "FruitFit/tagirfruit nutrition MVP",
      },
    });
    if (!response.ok) return null;

    const data = await response.json();
    const candidates = (data.products || [])
      .map((product) => mapOpenFoodFactsProduct(product, normalizedQuery))
      .filter(Boolean)
      .sort((a, b) => b.matchScore - a.matchScore);

    return candidates[0] || null;
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.warn("[FruitFit Nutrition] External food lookup failed", {
        query: normalizedQuery,
        message: error?.message || String(error),
      });
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
