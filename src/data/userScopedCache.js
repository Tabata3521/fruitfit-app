const AUTH_KEY = "fruitfit.authUser";

export const LEGACY_SENSITIVE_KEYS = Object.freeze([
  "fruitfit.profile",
  "fruitfit.health",
  "fruitfit.health.history",
  "fruitfit.measurements",
  "fruitfit.avatar",
  "fruitfit.programAssignment",
  "fruitfit.accessState",
  "fruitfit.aiCoach.chat",
  "fruitfit.paidProgramLock",
  "fruitfit.user_core",
  "fruitfit.ai_memory",
  "fruitfit.workout_history",
  "fruitfit.lectures",
  "exerciseWeights",
  "fruitfit.lectureProgress.v1",
  "fruitfit.selectedWorkoutState",
]);

export const LEGACY_SENSITIVE_PREFIXES = Object.freeze([
  "fruitfit.workoutReport.",
  "fruitfit.exerciseReplacements.",
]);

export function currentUserId() {
  if (typeof window === "undefined") return "";
  try {
    const user = JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
    return String(user?.id || user?.userId || user?.user_id || "").trim();
  } catch (_) {
    return "";
  }
}

export function scopedCacheKey(baseKey, userId = currentUserId()) {
  const id = String(userId || "").trim();
  return id ? `${baseKey}:${id}` : "";
}

export function readUserScopedCache(baseKey, userId = currentUserId(), fallback = null) {
  const id = String(userId || "").trim();
  if (!id) {
    console.info("[FruitFit cache] CACHE_READ_REJECTED", { key: baseKey, storedUserId: null, currentUserId: null, reason: "missing_current_user" });
    return fallback;
  }
  const key = scopedCacheKey(baseKey, id);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const envelope = JSON.parse(raw);
    const storedUserId = String(envelope?.userId || "").trim();
    if (storedUserId !== id || !Object.prototype.hasOwnProperty.call(envelope || {}, "data")) {
      console.info("[FruitFit cache] CACHE_READ_REJECTED", { key, storedUserId: storedUserId || null, currentUserId: id, reason: "user_mismatch_or_legacy_shape" });
      return fallback;
    }
    console.info("[FruitFit cache] CACHE_READ_ACCEPTED", { key, userId: id });
    return envelope.data;
  } catch (error) {
    console.info("[FruitFit cache] CACHE_READ_REJECTED", { key, storedUserId: null, currentUserId: id, reason: error?.message || "parse_error" });
    return fallback;
  }
}

export function writeUserScopedCache(baseKey, data, userId = currentUserId()) {
  const id = String(userId || "").trim();
  if (!id || typeof window === "undefined") return null;
  const key = scopedCacheKey(baseKey, id);
  const envelope = {
    userId: id,
    savedAt: new Date().toISOString(),
    data,
  };
  localStorage.setItem(key, JSON.stringify(envelope));
  return data;
}

export function removeLegacySensitiveCache() {
  if (typeof window === "undefined") return;
  LEGACY_SENSITIVE_KEYS.forEach((key) => localStorage.removeItem(key));
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (LEGACY_SENSITIVE_PREFIXES.some((prefix) => String(key || "").startsWith(prefix))) {
      localStorage.removeItem(key);
    }
  }
}

export function clearSensitiveInMemoryState() {
  if (typeof window === "undefined") return;
  console.info("[FruitFit cache] LOGOUT_CLEAR_SENSITIVE_STATE");
  window.dispatchEvent(new CustomEvent("fruitfit:profile-updated", { detail: null }));
  window.dispatchEvent(new CustomEvent("fruitfit:measurements-updated", { detail: [] }));
  window.dispatchEvent(new CustomEvent("fruitfit:health-reset", { detail: null }));
}
