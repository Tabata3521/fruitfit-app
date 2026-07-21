import { readWorkoutHistoryField, writeWorkoutHistoryField } from "./dataContainers";

const COMPLETED_WORKOUTS_FIELD = "completedWorkouts";
export const WORKOUT_COMPLETION_EVENT = "fruitfit:workout-completed";

function completionMap() {
  const value = readWorkoutHistoryField(COMPLETED_WORKOUTS_FIELD, undefined, {});
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function isWorkoutCompleted(workoutId) {
  const key = String(workoutId || "").trim();
  return Boolean(key && completionMap()[key]?.completedAt);
}

export function markWorkoutCompleted(workoutId, details = {}) {
  const key = String(workoutId || "").trim();
  if (!key) return null;
  const map = completionMap();
  const completion = {
    ...map[key],
    ...details,
    workoutId: key,
    completedAt: map[key]?.completedAt || new Date().toISOString(),
  };
  writeWorkoutHistoryField(COMPLETED_WORKOUTS_FIELD, { ...map, [key]: completion });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(WORKOUT_COMPLETION_EVENT, { detail: completion }));
  }
  return completion;
}
