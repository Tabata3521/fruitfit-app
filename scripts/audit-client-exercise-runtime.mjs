import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeExerciseKey, resolveExerciseAlias } from "../src/data/exerciseAliases.js";
import { resolveExerciseVideoOverride } from "../src/data/exerciseVideoOverrides.js";
import { assignMuscleTemplate } from "../src/data/muscleTemplates.js";
import { runtimeExerciseFallbacks } from "../src/data/exerciseRuntimeFallbacks.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

const programExercises = readJson("public/data/exercises.json");
const didacticCatalog = [...readJson("src/data/didacticExerciseCatalog.json"), ...runtimeExerciseFallbacks];
const exerciseCatalogTable = readJson("src/data/exerciseCatalogTable.json");

function normalizeDidacticExerciseName(value) {
  return normalizeExerciseKey(String(value || "")
    .replace(/^\s*\d+[.)]?\s*/, "")
    .replace(/[*°]/g, " "));
}

function resolveDidacticExerciseRuntime(name) {
  const alias = resolveExerciseAlias(name);
  if (alias.specialStatus) return { meta: null, alias, lookupName: name, path: "special_status" };
  const lookupName = alias.canonicalName || name;
  const key = normalizeExerciseKey(lookupName);
  const didacticKey = normalizeDidacticExerciseName(lookupName);
  if (!key && !didacticKey) return { meta: null, alias, lookupName, path: "empty_key" };

  const exact = didacticCatalog.find((item) => normalizeExerciseKey(item.exercise_name) === key);
  if (exact) return { meta: exact, alias, lookupName, path: alias.canonicalName ? "alias_exact_key" : "exact_key" };

  const normalized = didacticCatalog.find((item) => item.normalized_name === didacticKey);
  if (normalized) return { meta: normalized, alias, lookupName, path: alias.canonicalName ? "alias_normalized_name" : "normalized_name" };

  const includes = didacticCatalog.find((item) => {
    const itemKey = item.normalized_name || normalizeDidacticExerciseName(item.exercise_name);
    return itemKey && didacticKey && (itemKey.includes(didacticKey) || didacticKey.includes(itemKey));
  });
  if (includes) return { meta: includes, alias, lookupName, path: alias.canonicalName ? "alias_contains" : "contains" };

  return { meta: null, alias, lookupName, path: alias.canonicalName ? "alias_unresolved" : "unresolved" };
}

function normalizeMediaName(value = "") {
  return normalizeExerciseKey(value);
}

function tokenScore(query, candidate) {
  const queryTokens = normalizeMediaName(query).split(" ").filter((token) => token.length > 2);
  const candidateTokens = normalizeMediaName(candidate).split(" ").filter((token) => token.length > 2);
  if (!queryTokens.length || !candidateTokens.length) return 0;
  const hits = queryTokens.filter((token) => (
    candidateTokens.some((candidateToken) => candidateToken === token || candidateToken.startsWith(token) || token.startsWith(candidateToken))
  )).length;
  return hits / queryTokens.length;
}

function levenshtein(a, b) {
  const left = [...normalizeMediaName(a)];
  const right = [...normalizeMediaName(b)];
  const dp = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[left.length][right.length];
}

function similarity(a, b) {
  const left = normalizeMediaName(a);
  const right = normalizeMediaName(b);
  const max = Math.max([...left].length, [...right].length, 1);
  return 1 - (levenshtein(left, right) / max);
}

function bestCatalogCandidate(name) {
  return didacticCatalog
    .map((item) => {
      const candidateName = item.exercise_name || item.name || "";
      const score = Math.max(tokenScore(name, candidateName), similarity(name, candidateName));
      return { item, score };
    })
    .sort((a, b) => b.score - a.score)[0] || null;
}

function resolveCatalogVideoRuntime(exerciseName) {
  const normalized = normalizeMediaName(exerciseName);
  if (!normalized) return { video: null, path: "empty" };
  const exact = exerciseCatalogTable.find((item) => normalizeMediaName(item.exercise_name || item.name) === normalized);
  if (exact?.video_url) return { video: exact.video_url, path: "exerciseCatalogTable.exact" };

  const best = exerciseCatalogTable
    .filter((item) => item.video_url)
    .map((item) => ({ item, score: tokenScore(exerciseName, item.exercise_name || item.name) }))
    .sort((a, b) => b.score - a.score)[0];
  return best?.score >= 0.75
    ? { video: best.item.video_url, path: `exerciseCatalogTable.fuzzy:${best.score.toFixed(2)}` }
    : { video: null, path: best ? `no_fuzzy_match:${best.score.toFixed(2)}` : "no_catalog_video" };
}

function resolvedVideoFromNormalizeExercise(name, meta) {
  return meta?.video_url || meta?.rfVideoUrl || meta?.rf_video_url || resolveExerciseVideoOverride(name) || null;
}

function resolvedVideoFromMediaProvider(normalizedExercise, meta) {
  const catalogVideo = resolveCatalogVideoRuntime(normalizedExercise.exercise_name);
  const overrideVideo = resolveExerciseVideoOverride(normalizedExercise.exercise_name);
  const video = normalizedExercise.rf_video_url
    || normalizedExercise.rfVideoUrl
    || normalizedExercise.video_url
    || normalizedExercise.media_url
    || meta?.video_url
    || meta?.rfVideoUrl
    || meta?.rf_video_url
    || overrideVideo
    || catalogVideo.video
    || null;

  return {
    video,
    path: normalizedExercise.video_url
      ? "normalizedExercise.video_url"
      : meta?.video_url || meta?.rfVideoUrl || meta?.rf_video_url
        ? "resolvedMeta.video"
        : overrideVideo
          ? "exerciseVideoOverride"
          : catalogVideo.path,
  };
}

function slugFor(value) {
  return normalizeExerciseKey(value).replace(/\s+/g, "-");
}

const occurrenceByName = new Map();
for (const row of programExercises) {
  const name = String(row.exercise_name || "").trim();
  if (!name) continue;
  const entry = occurrenceByName.get(name) || { count: 0, rows: [] };
  entry.count += 1;
  if (entry.rows.length < 5) {
    entry.rows.push({
      course_id: row.course_id,
      lesson_id: row.lesson_id,
      exercise_order: row.exercise_order,
    });
  }
  occurrenceByName.set(name, entry);
}

const rows = [...occurrenceByName.entries()].map(([title, occurrence]) => {
  const resolved = resolveDidacticExerciseRuntime(title);
  const normalizedVideo = resolvedVideoFromNormalizeExercise(title, resolved.meta);
  const normalizedExercise = {
    exercise_name: title,
    video_url: normalizedVideo,
    rf_video_url: normalizedVideo,
    exercise_table_meta: resolved.meta,
  };
  const media = resolvedVideoFromMediaProvider(normalizedExercise, resolved.meta);
  const template = assignMuscleTemplate(normalizedExercise);
  const candidate = resolved.meta ? null : bestCatalogCandidate(title);
  const hasVideo = Boolean(media.video);
  const hasMap = Boolean(template.imageSrc);
  const canonicalTitle = resolved.meta?.exercise_name || resolved.alias.canonicalName || "";
  const aliasBroken = !resolved.meta && candidate?.score >= 0.86;

  return {
    title,
    count: occurrence.count,
    sampleRows: occurrence.rows,
    canonicalId: resolved.meta?.id || "",
    canonicalTitle,
    slug: slugFor(canonicalTitle || title),
    aliasKey: resolved.alias.key,
    aliasCanonicalName: resolved.alias.canonicalName || "",
    lookupPath: resolved.path,
    hasRuntimeMeta: Boolean(resolved.meta),
    videoUrl: media.video || "",
    videoLookupPath: media.path,
    hasVideo,
    thumbnail: normalizedExercise.preview_url || resolved.meta?.preview_url || resolved.meta?.thumbnail_url || "",
    muscleTemplateId: template.id || "",
    muscleLabel: template.muscleLabel || "",
    anatomyImage: template.imageSrc || "",
    anatomyStatus: template.status,
    hasMuscleMap: hasMap,
    primaryMuscle: resolved.meta?.muscle_group || resolved.meta?.muscleGroup || "",
    movementPattern: resolved.meta?.movement_vector || resolved.meta?.movementPattern || "",
    bestCandidateTitle: candidate?.item?.exercise_name || "",
    bestCandidateId: candidate?.item?.id || "",
    bestCandidateScore: candidate ? Number(candidate.score.toFixed(3)) : null,
    suggestedAlias: aliasBroken ? candidate.item.exercise_name : "",
    issues: [
      !resolved.meta ? "missing_runtime_meta" : "",
      !hasVideo ? "missing_runtime_video" : "",
      !hasMap ? "missing_runtime_muscle_map" : "",
      aliasBroken ? "probable_broken_alias" : "",
      resolved.meta && slugFor(resolved.meta.exercise_name) !== slugFor(canonicalTitle || title) ? "slug_mismatch" : "",
    ].filter(Boolean),
  };
}).sort((a, b) => a.title.localeCompare(b.title, "ru"));

const duplicateCatalogIds = Object.entries(didacticCatalog.reduce((acc, item) => {
  const id = item.id || "";
  if (!id) return acc;
  acc[id] = acc[id] || [];
  acc[id].push(item.exercise_name);
  return acc;
}, {})).filter(([, items]) => items.length > 1);

const uniqueVideoUrls = [...new Set(rows.map((row) => row.videoUrl).filter(Boolean))];
const missingVideos = rows.filter((row) => !row.hasVideo);
const missingMaps = rows.filter((row) => !row.hasMuscleMap);
const unresolved = rows.filter((row) => !row.hasRuntimeMeta);
const probableAliases = rows.filter((row) => row.suggestedAlias);

const summary = {
  totalProgramExerciseRows: programExercises.length,
  totalClientExercises: rows.length,
  didacticCatalogRows: didacticCatalog.length,
  withVideo: rows.filter((row) => row.hasVideo).length,
  withMuscleMap: rows.filter((row) => row.hasMuscleMap).length,
  brokenVideo: missingVideos.length,
  brokenMaps: missingMaps.length,
  unresolvedExercises: unresolved.length,
  probableBrokenAliases: probableAliases.length,
  duplicateCanonicalIds: duplicateCatalogIds.length,
  uniqueVideoUrls: uniqueVideoUrls.length,
};

const outDir = path.join(root, "audit");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "client_exercise_runtime_audit.json"), JSON.stringify({
  summary,
  duplicateCatalogIds,
  missingVideos,
  missingMaps,
  unresolved,
  probableAliases,
  rows,
}, null, 2), "utf8");

function csvEscape(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const columns = [
  "title",
  "count",
  "canonicalId",
  "canonicalTitle",
  "slug",
  "lookupPath",
  "videoLookupPath",
  "videoUrl",
  "anatomyStatus",
  "muscleLabel",
  "anatomyImage",
  "primaryMuscle",
  "movementPattern",
  "bestCandidateTitle",
  "bestCandidateScore",
  "suggestedAlias",
  "issues",
];
const csv = [
  columns.join(","),
  ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
].join("\n");
fs.writeFileSync(path.join(outDir, "client_exercise_runtime_audit.csv"), `\uFEFF${csv}`, "utf8");

console.log(JSON.stringify({
  summary,
  missingVideos: missingVideos.map((row) => row.title),
  missingMaps: missingMaps.map((row) => row.title),
  probableAliases: probableAliases.map((row) => ({
    title: row.title,
    suggestedAlias: row.suggestedAlias,
    score: row.bestCandidateScore,
  })),
}, null, 2));
