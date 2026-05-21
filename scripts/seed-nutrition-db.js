import { createNutritionSchema, getNutritionDb, NUTRITION_DB_PATH } from "../server/nutritionDb.js";
import { foodMvpProducts } from "../server/foodMvpSeed.js";

const db = getNutritionDb();
createNutritionSchema(db);

const insertProduct = db.prepare(`
  INSERT INTO products (
    name, brand, category, kcal_per_100, protein_per_100, fat_per_100, carbs_per_100,
    serving_examples, default_serving_grams, source, is_verified, country, updated_at
  )
  VALUES (
    @name, @brand, @category, @kcal, @protein, @fat, @carbs,
    @serving_examples, @default_serving_grams, @source, @is_verified, @country, CURRENT_TIMESTAMP
  )
`);

const insertAlias = db.prepare(`
  INSERT INTO product_aliases (product_id, alias)
  VALUES (?, ?)
`);

const seed = db.transaction(() => {
  db.prepare("DELETE FROM product_aliases").run();
  db.prepare("DELETE FROM products").run();

  for (const product of foodMvpProducts) {
    const result = insertProduct.run({
      name: product.name,
      brand: product.brand || null,
      category: product.category,
      kcal: product.kcal,
      protein: product.protein,
      fat: product.fat,
      carbs: product.carbs,
      serving_examples: JSON.stringify(product.servingExamples || []),
      default_serving_grams: product.defaultServingGrams || null,
      source: product.source || "ru_mvp_common_food_reference_v1",
      is_verified: 1,
      country: "RU",
    });

    const aliases = new Set([product.name, ...(product.aliases || [])]);
    for (const alias of aliases) {
      insertAlias.run(result.lastInsertRowid, alias);
    }
  }
});

seed();

console.log(`[nutrition] Seeded ${foodMvpProducts.length} products into ${NUTRITION_DB_PATH}`);
