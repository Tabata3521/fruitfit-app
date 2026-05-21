import fs from "node:fs";
import path from "node:path";
import exercises from "../public/data/exercises.json" with { type: "json" };
import catalog from "../src/data/exerciseCatalogTable.json" with { type: "json" };
import { normalizeExerciseKey, resolveExerciseAlias } from "../src/data/exerciseAliases.js";

function tableMetaFor(name) {
  const alias = resolveExerciseAlias(name);
  if (alias.specialStatus) return null;
  const key = normalizeExerciseKey(alias.canonicalName || name);
  return catalog.find((item) => normalizeExerciseKey(item.name) === key)
    || catalog.find((item) => {
      const itemKey = normalizeExerciseKey(item.name);
      return itemKey && (key.includes(itemKey) || itemKey.includes(key));
    })
    || null;
}

function tokens(value) {
  return normalizeExerciseKey(value).split(" ").filter((token) => token.length > 2);
}

function score(a, b) {
  const one = new Set(tokens(a));
  const two = tokens(b);
  if (!one.size || !two.length) return 0;
  const hit = two.filter((token) => one.has(token)).length;
  return hit / Math.max(one.size, two.length);
}

const unique = [...new Map(exercises.map((item) => [normalizeExerciseKey(item.exercise_name), item.exercise_name])).values()];
const rows = unique.map((name) => {
  const meta = tableMetaFor(name);
  const hasVideo = Boolean(meta?.rfVideoUrl || meta?.video_url);
  const best = catalog
    .filter((item) => item.rfVideoUrl || item.video_url)
    .map((item) => ({ item, score: score(name, item.name) }))
    .sort((a, b) => b.score - a.score)[0];
  return {
    program_name: name,
    matched_name: meta?.name || "",
    app_has_video: hasVideo,
    suggested_match: best?.item?.name || "",
    suggested_score: best?.score || 0,
    suggested_has_video: Boolean(best?.item?.rfVideoUrl || best?.item?.video_url),
  };
});

const missing = rows.filter((row) => !row.app_has_video && row.suggested_score >= 0.55);
const outDir = path.resolve("audit");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "exercise_video_matching_audit.csv");
const header = Object.keys(rows[0] || {});
const csv = (value) => {
  const text = String(value ?? "");
  return /[",;\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
fs.writeFileSync(outPath, [header.join(";"), ...rows.map((row) => header.map((key) => csv(row[key])).join(";"))].join("\n"), "utf8");
console.log(JSON.stringify({ outPath, uniqueProgramExercises: unique.length, appMissingVideoWithPossibleMatch: missing.length, missing: missing.slice(0, 20) }, null, 2));
