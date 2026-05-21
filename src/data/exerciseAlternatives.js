import { classifyDidacticExercise, didacticReplacementCandidates } from "./didacticExerciseData.js";

function reasonLabel(reason) {
  return {
    busy: "тренажер занят",
    replace: "замена упражнения",
    equipment: "нет оборудования",
    discomfort: "дискомфорт/боль",
  }[reason] || "замена";
}

export function classifyExercise(name) {
  return classifyDidacticExercise(name);
}

export function getExerciseAlternatives(exercise, reason = "busy", _catalog = [], profile = {}) {
  const result = didacticReplacementCandidates(exercise, reason, profile);
  const source = result.source;

  return {
    reason: reasonLabel(reason),
    muscleGroup: source?.muscle_group || "",
    movementPattern: source?.movement_vector || "",
    targetZone: source?.muscle_group || "",
    equipment: "",
    restrictions: source?.restrictions || [],
    alternatives: result.alternatives,
    cautionAlternatives: result.cautionAlternatives,
    needsManualReview: result.needsManualReview,
  };
}
