import { getMuscleImageInfo, normalizeMuscleLabel } from "./anatomyMuscleMapping.js";
import { decodeText } from "../utils/decodeText.js";

const API_BASE_URL = String(import.meta.env?.VITE_FRUITFIT_API_URL || "https://api.tagirfruit.ru").replace(/\/$/, "");
const LOCAL_ASSET_PREFIXES = Object.freeze([
  "/muscle-templates/",
  "/nutrition-images/",
  "/data/",
]);

export function normalizeTemplateText(value) {
  return decodeText(String(value || ""))
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/техника выполнения упражнения/gi, " ")
    .replace(/[^а-яa-z0-9%]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rawMuscleLabelForExercise(exercise = {}) {
  const meta = exercise.exercise_table_meta || exercise.category || {};
  const name = exercise.exercise_name || exercise.name || meta.name || "";
  const nameKey = normalizeTemplateText(name);

  if (meta.specialStatus === "stretching" || nameKey.includes("растяжка на все тело")) {
    return "Растяжка на все тело";
  }

  const rawLabel = exercise.targetZone
    || exercise.target_zone
    || meta.targetZone
    || exercise.muscleLabel
    || exercise.muscle_label
    || "";

  if (normalizeTemplateText(rawLabel) === "лфк") {
    if (nameKey.includes("плеч")) return "Ротаторная манжета плеча";
    if (nameKey.includes("присед")) return "Квадрицепс / ягодицы";
    if (nameKey.includes("латераль") || nameKey.includes("боков")) return "Квадратная мышца поясницы";
    if (nameKey.includes("вытяж")) return "Разгибатели позвоночника";
  }

  return rawLabel;
}

function firstText(...values) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function normalizeMuscleMapImageUrl(value) {
  const image = String(value || "").trim();
  if (!image) return "";
  if (/^(https?:|data:|blob:)/i.test(image)) return image;
  if (LOCAL_ASSET_PREFIXES.some((prefix) => image.startsWith(prefix))) return image;
  if (!image.startsWith("/")) return image;

  try {
    return new URL(image, `${API_BASE_URL}/`).toString();
  } catch (_) {
    return image;
  }
}

function serverMuscleMapOverride(exercise = {}, fallbackLabel = "") {
  const meta = exercise.exercise_table_meta || exercise.category || {};
  const rawImage = firstText(
    exercise.muscle_map_asset_path,
    exercise.muscleMapAssetPath,
    exercise.muscle_map_url,
    exercise.muscleMapUrl,
    meta.muscle_map_asset_path,
    meta.muscleMapAssetPath,
    meta.muscle_map_url,
    meta.muscleMapUrl,
  );

  const image = normalizeMuscleMapImageUrl(rawImage);
  if (!image) return null;

  const rawLabel = firstText(
    exercise.muscle_map_label,
    exercise.muscleMapLabel,
    exercise.muscle_map_key,
    exercise.muscleMapKey,
    meta.muscle_map_label,
    meta.muscleMapLabel,
    meta.muscle_map_key,
    meta.muscleMapKey,
    fallbackLabel,
  );

  const normalizedLabel = normalizeMuscleLabel(rawLabel || fallbackLabel || "server_muscle_map");
  const version = firstText(
    exercise.muscle_map_version,
    exercise.muscleMapVersion,
    exercise.muscle_map_revision,
    exercise.muscleMapRevision,
    exercise.muscle_map_hash,
    exercise.muscleMapHash,
    exercise.muscle_map_updated_at,
    exercise.muscleMapUpdatedAt,
    meta.muscle_map_version,
    meta.muscleMapVersion,
    meta.muscle_map_revision,
    meta.muscleMapRevision,
    meta.muscle_map_hash,
    meta.muscleMapHash,
    meta.muscle_map_updated_at,
    meta.muscleMapUpdatedAt,
    image,
    rawImage,
  );

  return {
    image,
    rawLabel,
    normalizedLabel,
    version,
    cacheKey: `${image}|${version}`,
    reviewStatus: firstText(
      exercise.muscle_map_status,
      exercise.muscleMapStatus,
      meta.muscle_map_status,
      meta.muscleMapStatus,
      "server_override",
    ),
  };
}

export function muscleTemplateImageSrc(templateIdOrLabel) {
  if (!templateIdOrLabel) return "";
  return getMuscleImageInfo(templateIdOrLabel).image;
}

export function assignMuscleTemplate(exercise = {}) {
  const rawLabel = rawMuscleLabelForExercise(exercise);
  const serverOverride = serverMuscleMapOverride(exercise, rawLabel);

  if (serverOverride) {
    return {
      id: serverOverride.normalizedLabel,
      label: serverOverride.normalizedLabel,
      muscleLabel: serverOverride.rawLabel || rawLabel,
      normalizedLabel: serverOverride.normalizedLabel,
      imageSrc: serverOverride.image,
      confidence: 1,
      method: "server_override",
      notes: serverOverride.reviewStatus,
      status: "ok",
      reviewStatus: serverOverride.reviewStatus,
      version: serverOverride.version,
      hash: serverOverride.version,
      updatedAt: serverOverride.version,
      cacheKey: serverOverride.cacheKey,
      template: {
        id: serverOverride.normalizedLabel,
        label: serverOverride.normalizedLabel,
        image: serverOverride.image,
        source: "server_override",
        version: serverOverride.version,
      },
      serverOverride: true,
    };
  }

  const imageInfo = getMuscleImageInfo(rawLabel);

  return {
    id: imageInfo.normalizedLabel,
    label: imageInfo.normalizedLabel,
    muscleLabel: rawLabel,
    normalizedLabel: imageInfo.normalizedLabel,
    imageSrc: imageInfo.image,
    confidence: imageInfo.status === "ok" ? 1 : imageInfo.status === "alias_used" ? 0.92 : 0,
    method: imageInfo.status === "ok" ? "label_exact" : imageInfo.status,
    notes: imageInfo.reviewStatus,
    status: imageInfo.status,
    reviewStatus: imageInfo.reviewStatus,
    template: imageInfo.image
      ? { id: imageInfo.normalizedLabel, label: imageInfo.normalizedLabel, image: imageInfo.image }
      : null,
  };
}

export { normalizeMuscleLabel };
