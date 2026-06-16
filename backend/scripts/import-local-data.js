import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { closePool, query, transaction } from "../src/db.js";
import { runMigrations } from "../src/migrate.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");
const sourceRoot = path.resolve(process.env.FRUITFIT_SOURCE_ROOT || path.join(backendRoot, ".."));

const catalogSources = [
  ["nutrition", "public/data/nutrition.json"],
  ["courses", "public/data/courses.json"],
  ["lessons", "public/data/lessons.json"],
  ["exercises", "public/data/exercises.json"],
  ["exercise-catalog", "public/data/exercise-catalog.json"],
  ["training-programs", "public/data/training-programs.json"]
];

async function main() {
  console.log(`[import] source root: ${sourceRoot}`);
  await runMigrations();
  for (const [key, relativePath] of catalogSources) {
    await importCatalogDocument(key, path.join(sourceRoot, relativePath), relativePath);
  }
  await importLectures();
  await importNutritionDb();
}

async function importCatalogDocument(key, filePath, sourcePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`[import] skip ${key}: missing ${filePath}`);
    return;
  }
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  await query(
    `INSERT INTO catalog_documents (key, data, source_path, imported_at, updated_at)
     VALUES ($1, $2::jsonb, $3, now(), now())
     ON CONFLICT (key)
     DO UPDATE SET data = EXCLUDED.data,
                   source_path = EXCLUDED.source_path,
                   imported_at = now(),
                   updated_at = now()`,
    [key, JSON.stringify(data), sourcePath]
  );
  console.log(`[import] catalog ${key}: ${describeJson(data)}`);
}

async function importLectures() {
  const filePath = path.join(sourceRoot, "src/data/lectures.js");
  if (!fs.existsSync(filePath)) {
    console.warn(`[import] skip lectures: missing ${filePath}`);
    return;
  }
  const module = await import(pathToFileURL(filePath).href);
  const lectures = Array.isArray(module.lectures) ? module.lectures : [];
  await query(
    `INSERT INTO catalog_documents (key, data, source_path, imported_at, updated_at)
     VALUES ('lectures', $1::jsonb, $2, now(), now())
     ON CONFLICT (key)
     DO UPDATE SET data = EXCLUDED.data,
                   source_path = EXCLUDED.source_path,
                   imported_at = now(),
                   updated_at = now()`,
    [JSON.stringify(lectures), "src/data/lectures.js"]
  );
  console.log(`[import] catalog lectures: ${lectures.length} items`);
}

async function importNutritionDb() {
  const sqlitePath = path.join(sourceRoot, "data/nutrition.db");
  if (!fs.existsSync(sqlitePath)) {
    console.warn(`[import] skip nutrition db: missing ${sqlitePath}`);
    return;
  }
  const dump = dumpSqlite(sqlitePath);
  const products = Array.isArray(dump.products) ? dump.products : [];
  const aliases = Array.isArray(dump.product_aliases) ? dump.product_aliases : [];

  await transaction(async (client) => {
    await client.query("TRUNCATE product_aliases, products RESTART IDENTITY");
    for (const product of products) {
      await client.query(
        `INSERT INTO products (
           id, name, brand, category, kcal_per_100, protein_per_100, fat_per_100, carbs_per_100,
           serving_examples, default_serving_grams, source, is_verified, country, created_at, updated_at
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,COALESCE($14::timestamptz, now()),COALESCE($15::timestamptz, now()))
         ON CONFLICT (id)
         DO UPDATE SET name = EXCLUDED.name,
                       brand = EXCLUDED.brand,
                       category = EXCLUDED.category,
                       kcal_per_100 = EXCLUDED.kcal_per_100,
                       protein_per_100 = EXCLUDED.protein_per_100,
                       fat_per_100 = EXCLUDED.fat_per_100,
                       carbs_per_100 = EXCLUDED.carbs_per_100,
                       serving_examples = EXCLUDED.serving_examples,
                       default_serving_grams = EXCLUDED.default_serving_grams,
                       source = EXCLUDED.source,
                       is_verified = EXCLUDED.is_verified,
                       country = EXCLUDED.country,
                       updated_at = now()`,
        [
          Number(product.id),
          product.name,
          product.brand || null,
          product.category || null,
          Number(product.kcal_per_100 ?? product.kcal ?? 0),
          Number(product.protein_per_100 ?? product.protein ?? 0),
          Number(product.fat_per_100 ?? product.fat ?? 0),
          Number(product.carbs_per_100 ?? product.carbs ?? 0),
          JSON.stringify(parseJsonArray(product.serving_examples)),
          product.default_serving_grams === null || product.default_serving_grams === undefined
            ? null
            : Number(product.default_serving_grams),
          product.source || null,
          Boolean(Number(product.is_verified || 0)),
          product.country || "RU",
          product.created_at || null,
          product.updated_at || null
        ]
      );
    }
    for (const alias of aliases) {
      if (!alias.product_id || !alias.alias) continue;
      await client.query(
        `INSERT INTO product_aliases (product_id, alias)
         VALUES ($1, $2)
         ON CONFLICT (product_id, alias) DO NOTHING`,
        [Number(alias.product_id), String(alias.alias)]
      );
    }
  });

  console.log(`[import] products: ${products.length}, aliases: ${aliases.length}`);
}

function dumpSqlite(sqlitePath) {
  const python = `
import json
import sqlite3
import sys

conn = sqlite3.connect(sys.argv[1])
conn.row_factory = sqlite3.Row
out = {}
for table in ("products", "product_aliases"):
    rows = conn.execute(f"SELECT * FROM {table}").fetchall()
    out[table] = [dict(row) for row in rows]
print(json.dumps(out, ensure_ascii=False))
`;
  for (const command of ["python3", "python"]) {
    const result = spawnSync(command, ["-", sqlitePath], {
      input: python,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024
    });
    if (result.status === 0) return JSON.parse(result.stdout);
  }
  throw new Error("Python with sqlite3 module is required to import data/nutrition.db");
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function describeJson(data) {
  if (Array.isArray(data)) return `${data.length} items`;
  if (Array.isArray(data?.meals)) return `${data.meals.length} meals`;
  if (Array.isArray(data?.programs)) return `${data.programs.length} programs`;
  return `${Object.keys(data || {}).length} keys`;
}

main()
  .then(() => closePool())
  .catch(async (error) => {
    console.error("[import] failed", error);
    await closePool().catch(() => {});
    process.exit(1);
  });
