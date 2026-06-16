import express from "express";
import { query } from "./db.js";

const ALLOWED_KEYS = new Set([
  "nutrition",
  "courses",
  "lessons",
  "exercises",
  "exercise-catalog",
  "training-programs",
  "lectures"
]);

export const catalogRouter = express.Router();

catalogRouter.get("/:key", async (req, res) => {
  const key = normalizeKey(req.params.key);
  if (!ALLOWED_KEYS.has(key)) {
    res.status(404).json({ error: "Unknown catalog" });
    return;
  }
  const result = await query("SELECT key, data, updated_at FROM catalog_documents WHERE key = $1", [key]);
  if (!result.rowCount) {
    res.status(404).json({ error: "Catalog is not imported" });
    return;
  }
  res.json({ key: result.rows[0].key, updatedAt: result.rows[0].updated_at, data: result.rows[0].data });
});

catalogRouter.get("/", async (_req, res) => {
  const result = await query(
    `SELECT key, jsonb_typeof(data) AS type, updated_at
     FROM catalog_documents
     ORDER BY key`
  );
  res.json({ catalogs: result.rows });
});

export const rawDataRouter = express.Router();

rawDataRouter.get("/:name", async (req, res) => {
  const key = normalizeKey(req.params.name);
  if (!ALLOWED_KEYS.has(key)) {
    res.status(404).json({ error: "Unknown data document" });
    return;
  }
  const result = await query("SELECT data FROM catalog_documents WHERE key = $1", [key]);
  if (!result.rowCount) {
    res.status(404).json({ error: "Data document is not imported" });
    return;
  }
  res.json(result.rows[0].data);
});

function normalizeKey(value) {
  return String(value || "").replace(/\.json$/i, "").trim();
}
