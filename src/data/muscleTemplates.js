import { getMuscleImageInfo, normalizeMuscleLabel } from "./anatomyMuscleMapping.js";
import { decodeText } from "../utils/decodeText.js";

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

export function muscleTemplateImageSrc(templateIdOrLabel) {
  if (!templateIdOrLabel) return "";
  return getMuscleImageInfo(templateIdOrLabel).image;
}

export function assignMuscleTemplate(exercise = {}) {
  const rawLabel = rawMuscleLabelForExercise(exercise);
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
