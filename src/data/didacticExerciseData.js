import rawDidacticCatalog from "./didacticExerciseCatalog.json";
import { normalizeExerciseKey, resolveExerciseAlias } from "./exerciseAliases.js";
import { runtimeExerciseFallbacks } from "./exerciseRuntimeFallbacks.js";

const didacticCatalog = [...rawDidacticCatalog, ...runtimeExerciseFallbacks];

export function normalizeDidacticExerciseName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/^\s*\d+[.)]?\s*/, "")
    .replace(/\b(на|по)?\s*\d+\s*(раз|повтор(?:а|ов|ений)?|повт|сек(?:унд(?:а|ы)?)?|мин(?:ут(?:а|ы)?)?)\b/g, " ")
    .replace(/техника выполнения упражнени[яй]/g, " ")
    .replace(/[.,;:!?()[\]{}"«»]+/g, " ")
    .replace(/[*°]/g, " ")
    .replace(/[^а-яa-z0-9%]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMetaText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s+/g, " ")
    .trim();
}

export function profileGender(profile = {}) {
  return profile.gender === "male" || String(profile.gender || "").toLowerCase().includes("муж") ? "male" : "female";
}

export function restrictionKeysFromText(value) {
  const text = normalizeMetaText(value);
  const keys = [];
  if (text.includes("колен")) keys.push("knees");
  if (text.includes("спин") || text.includes("пояс")) keys.push("back");
  if (text.includes("плеч")) keys.push("shoulders");
  if (text.includes("локт")) keys.push("elbows");
  if (text.includes("таз") || text.includes("тбс")) keys.push("hips");
  return [...new Set(keys)];
}

export function userRestrictionKeys(profile = {}) {
  return restrictionKeysFromText(profile.restrictions || profile.limitation || profile.limitations || "");
}

export function isAllowedForProfileGender(exercise, profile = {}) {
  const gender = profileGender(profile);
  return !exercise?.gender || exercise.gender === "all" || exercise.gender === gender;
}

function hasRestrictionConflict(exercise, userRestrictions) {
  if (!userRestrictions.length) return false;
  const restrictions = Array.isArray(exercise?.restrictions) ? exercise.restrictions : restrictionKeysFromText(exercise?.restrictions_raw);
  return restrictions.some((restriction) => userRestrictions.includes(restriction));
}

export function resolveDidacticExercise(name) {
  const alias = resolveExerciseAlias(name);
  if (alias.specialStatus) return null;
  const lookupName = alias.canonicalName || name;
  const key = normalizeExerciseKey(lookupName);
  const didacticKey = normalizeDidacticExerciseName(lookupName);
  if (!key && !didacticKey) return null;

  return didacticCatalog.find((item) => normalizeExerciseKey(item.exercise_name) === key)
    || didacticCatalog.find((item) => item.normalized_name === didacticKey)
    || didacticCatalog.find((item) => {
      const itemKey = item.normalized_name || normalizeDidacticExerciseName(item.exercise_name);
      return itemKey && didacticKey && (itemKey.includes(didacticKey) || didacticKey.includes(itemKey));
    })
    || null;
}

export function didacticReplacementCandidates(sourceExercise, reason = "replace", profile = {}) {
  const source = resolveDidacticExercise(sourceExercise?.exercise_name || sourceExercise?.name || sourceExercise);
  if (!source) {
    return { source: null, alternatives: [], cautionAlternatives: [], needsManualReview: true };
  }

  const sourceKey = source.normalized_name || normalizeDidacticExerciseName(source.exercise_name);
  const restrictions = userRestrictionKeys(profile);
  const profileSafe = didacticCatalog.filter((candidate) => {
    const candidateKey = candidate.normalized_name || normalizeDidacticExerciseName(candidate.exercise_name);
    return candidateKey
      && candidateKey !== sourceKey
      && isAllowedForProfileGender(candidate, profile)
      && candidate.movement_vector === source.movement_vector
      && candidate.muscle_group === source.muscle_group
      && candidate.exercise_type === source.exercise_type;
  });

  const safe = [];
  const caution = [];
  for (const candidate of profileSafe) {
    const conflict = hasRestrictionConflict(candidate, restrictions);
    const prepared = {
      ...candidate,
      exercise_name: candidate.exercise_name,
      name: candidate.exercise_name,
      rf_video_url: candidate.rfVideoUrl || candidate.video_url || null,
      video_url: candidate.video_url || candidate.rfVideoUrl || null,
      category: classifyDidacticExercise(candidate.exercise_name),
      exercise_table_meta: candidate,
    };
    if (conflict) caution.push(prepared);
    else safe.push(prepared);
  }

  return {
    source,
    alternatives: safe.slice(0, 5),
    cautionAlternatives: caution.slice(0, 5),
    needsManualReview: safe.length === 0 && caution.length === 0,
  };
}

export function classifyDidacticExercise(name) {
  const meta = typeof name === "object" ? name : resolveDidacticExercise(name);
  return {
    source: meta ? "didactic_table" : "missing_didactic_table",
    tableId: meta?.id || null,
    tableName: meta?.exercise_name || "",
    muscleGroup: meta?.muscle_group || "",
    movementPattern: meta?.movement_vector || "",
    targetZone: meta?.muscle_group || "",
    equipment: "",
    equipmentFamily: "",
    laterality: "",
    axialLoad: false,
    restrictions: meta?.restrictions || [],
    restrictionNote: meta?.restrictions_raw || "",
    exerciseType: meta?.exercise_type || "",
    gender: meta?.gender || "",
    needsManualReview: !meta,
  };
}

export { didacticCatalog };
