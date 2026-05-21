import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanTitle, decodeText } from "../src/utils/decodeText.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const defaultInput = "C:\\Users\\Meyva\\Downloads\\store-5905500-202605091613.csv";
const input = process.argv[2] || defaultInput;
const output = path.join(projectRoot, "public", "data", "nutrition.json");

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
  const parsed = categories.map((item) => {
    const match = item.match(/(.+?)\s+(\d{3,4})$/);
    return {
      label: item,
      ration: match ? match[1].trim() : item,
      caloriesTarget: match ? Number(match[2]) : null,
    };
  });
  return parsed;
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

const csv = fs.readFileSync(input, "utf8");
const rows = parseCsv(csv);
const meals = rows
  .map(normalizeMeal)
  .filter((meal) => meal.title && !/^title$/i.test(meal.title) && !/^characteristics:/i.test(meal.day) && !/^characteristics:/i.test(meal.mealType));
const rations = [...new Set(meals.flatMap((meal) => meal.rations))].sort();
const caloriesTargets = [...new Set(meals.flatMap((meal) => meal.caloriesTargets))].sort((a, b) => a - b);
const days = [...new Set(meals.map((meal) => meal.day).filter(Boolean))];
const mealTypes = [...new Set(meals.map((meal) => meal.mealType).filter(Boolean))];

const payload = {
  importedAt: new Date().toISOString(),
  source: path.basename(input),
  meals,
  filters: { rations, caloriesTargets, days, mealTypes },
};

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ meals: meals.length, rations, caloriesTargets, days, mealTypes }, null, 2));
