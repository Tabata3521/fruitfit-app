import { parseFoodItemsFromMessage, buildNutritionAnswer, isNutritionIntent } from "../server/foodParser.js";
import {
  calculateNutritionItemsWithFallback,
  getNutritionDb,
  createNutritionSchema,
  NUTRITION_DB_PATH,
} from "../server/nutritionDb.js";

const db = getNutritionDb();
createNutritionSchema(db);

const testPhrases = [
  "2 яйца и банан",
  "250 г риса и куриная грудка",
  "бургер и кола",
  "творог 5% 200 г",
  "гречка с молоком",
];

console.log(`[nutrition:test] DB: ${NUTRITION_DB_PATH}`);

for (const phrase of testPhrases) {
  console.log("\n==========================================");
  console.log(`Фраза: "${phrase}"`);
  console.log(`Intent: ${isNutritionIntent(phrase, { db }) ? "yes" : "no"}`);

  const parsedItems = parseFoodItemsFromMessage(phrase);
  console.log("Parsed:", JSON.stringify(parsedItems, null, 2));

  const result = await calculateNutritionItemsWithFallback(parsedItems, { db });
  console.log("Matched foods:");
  for (const item of result.items) {
    console.log(
      `  - ${item.inputName} -> ${item.matchedProduct} | ${item.grams} г | ${item.kcal} ккал | Б ${item.protein} / Ж ${item.fat} / У ${item.carbs} | ${item.matchedBy}`,
    );
  }

  const unmatched = result.warnings.map((warning) => warning.inputName || warning.message).filter(Boolean);
  console.log(`Unmatched: ${unmatched.length ? unmatched.join(", ") : "none"}`);
  console.log(`Total: ${result.total.kcal} ккал | Б ${result.total.protein} / Ж ${result.total.fat} / У ${result.total.carbs}`);
  console.log("Answer:", buildNutritionAnswer(result));
}
