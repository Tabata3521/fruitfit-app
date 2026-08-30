import { readWorkoutHistoryField, writeWorkoutHistoryField } from "./dataContainers";
import { currentUserId } from "./userScopedCache";
import { cycleIdentity, cycleScopedWorkoutKey, legacyStateBelongsToCycle, withWorkoutCycle } from "./workoutCycle";

const COMPLETED_WORKOUTS_FIELD = "completedWorkouts";
export const WORKOUT_COMPLETION_EVENT = "fruitfit:workout-completed";

function completionMap() {
  const value = readWorkoutHistoryField(COMPLETED_WORKOUTS_FIELD, undefined, {});
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function workoutCompletion(workoutId, cycle = {}, userId = currentUserId()) {
  const id = String(workoutId || "").trim();
  if (!id) return null;
  const map = completionMap();
  const hasCycle = cycleIdentity(cycle) !== "legacy-unscoped";
  if (!hasCycle && map[id]?.completedAt) return map[id];
  const scopedKey = cycleScopedWorkoutKey(id, cycle, userId);
  if (map[scopedKey]?.completedAt) return map[scopedKey];
  const legacy = map[id];
  if (!hasCycle || !legacy || !legacyStateBelongsToCycle(legacy, cycle)) return null;
  const migrated = withWorkoutCycle({ ...legacy, workoutId: id, migratedFromLegacy: true }, cycle);
  writeWorkoutHistoryField(COMPLETED_WORKOUTS_FIELD, { ...map, [scopedKey]: migrated });
  return migrated;
}

export function isWorkoutCompleted(workoutId, cycle = {}, userId = currentUserId()) {
  return Boolean(workoutCompletion(workoutId, cycle, userId)?.completedAt);
}

export function markWorkoutCompleted(workoutId, details = {}, cycle = {}, userId = currentUserId()) {
  const workoutKey = String(workoutId || "").trim();
  if (!workoutKey) return null;
  const map = completionMap();
  const key = cycleScopedWorkoutKey(workoutKey, cycle, userId);
  const completion = withWorkoutCycle({
    ...map[key],
    ...details,
    workoutId: workoutKey,
    completedAt: map[key]?.completedAt || new Date().toISOString(),
  }, cycle);
  writeWorkoutHistoryField(COMPLETED_WORKOUTS_FIELD, { ...map, [key]: completion });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(WORKOUT_COMPLETION_EVENT, { detail: completion }));
  }
  return completion;
}
