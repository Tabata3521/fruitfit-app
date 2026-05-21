import fs from "node:fs";
import path from "node:path";
import catalog from "../src/data/exerciseCatalogTable.json" with { type: "json" };
import { assignMuscleTemplate, normalizeTemplateText } from "../src/data/muscleTemplates.js";

function csv(value) {
  const text = String(value ?? "");
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const rows = catalog.map((exercise) => {
  const assigned = assignMuscleTemplate({ ...exercise, exercise_table_meta: exercise });
  return {
    exercise_name: exercise.name || exercise.exercise_name,
    normalized_name: normalizeTemplateText(exercise.name || exercise.exercise_name || ""),
    muscle_group: exercise.muscleGroupRaw || exercise.muscleGroup || "",
    pattern: exercise.movementPatternRaw || exercise.movementPattern || "",
    muscle_label: assigned.muscleLabel || "",
    normalized_label: assigned.normalizedLabel || "",
    image_asset_path: assigned.imageSrc || "",
    status: assigned.status,
    confidence: assigned.confidence,
    method: assigned.method,
    review_status: assigned.reviewStatus,
  };
});

const outDir = path.resolve("audit");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "exercise_muscle_template_audit.csv");
const header = [
  "exercise_name",
  "normalized_name",
  "muscle_group",
  "pattern",
  "muscle_label",
  "normalized_label",
  "image_asset_path",
  "status",
  "confidence",
  "method",
  "review_status",
];
fs.writeFileSync(outPath, [
  header.join(";"),
  ...rows.map((row) => header.map((key) => csv(row[key])).join(";")),
].join("\n"), "utf8");

const total = rows.length;
const mappedOk = rows.filter((row) => row.status === "ok").length;
const aliasUsed = rows.filter((row) => row.status === "alias_used").length;
const missingImages = rows.filter((row) => row.status === "missing_image");
const missingLabels = rows.filter((row) => row.status === "missing_label");
const needsReview = rows.filter((row) => String(row.review_status || "").includes("needs_review"));
const byLabel = rows.reduce((acc, row) => {
  const key = row.normalized_label || "missing_label";
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});

console.log(JSON.stringify({
  outPath,
  total,
  mappedOk,
  aliasUsed,
  missingImages: missingImages.length,
  missingLabels: missingLabels.length,
  needsReview: needsReview.length,
  missingImageLabels: [...new Set(missingImages.map((row) => row.normalized_label || row.muscle_label))],
  missingLabelExercises: missingLabels.map((row) => row.exercise_name),
  needsReviewLabels: [...new Set(needsReview.map((row) => row.normalized_label))],
  byLabel,
}, null, 2));
