import { currentUserId, readUserScopedCache, scopedCacheKey, writeUserScopedCache } from "./userScopedCache";

export const USER_CORE_CONTAINER_KEY = "fruitfit.user_core";
export const HEALTH_CONTAINER_KEY = "fruitfit.health";
export const AI_MEMORY_CONTAINER_KEY = "fruitfit.ai_memory";
export const WORKOUT_HISTORY_CONTAINER_KEY = "fruitfit.workout_history";
export const LECTURES_CONTAINER_KEY = "fruitfit.lectures";

const USER_CORE_LEGACY_FIELDS = Object.freeze({
  profile: "fruitfit.profile",
  accessState: "fruitfit.accessState",
  programAssignment: "fruitfit.programAssignment",
  measurements: "fruitfit.measurements",
  avatar: "fruitfit.avatar",
  paidProgramLock: "fruitfit.paidProgramLock",
});

const AI_MEMORY_LEGACY_FIELDS = Object.freeze({
  chatHistory: "fruitfit.aiCoach.chat",
});

function userIdOrEmpty(userId = currentUserId()) {
  return String(userId || "").trim();
}

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function readContainer(baseKey, userId = currentUserId(), fallback = null) {
  const id = userIdOrEmpty(userId);
  if (!id) return fallback;
  return readUserScopedCache(baseKey, id, fallback);
}

function writeContainer(baseKey, data, userId = currentUserId()) {
  const id = userIdOrEmpty(userId);
  if (!id) return null;
  return writeUserScopedCache(baseKey, data, id);
}

function legacyScopedValue(baseKey, userId) {
  const id = userIdOrEmpty(userId);
  if (!id) return null;
  return readUserScopedCache(baseKey, id, null);
}

function buildMigratedUserCore(userId) {
  const core = {};
  Object.entries(USER_CORE_LEGACY_FIELDS).forEach(([field, legacyKey]) => {
    const value = legacyScopedValue(legacyKey, userId);
    if (hasValue(value)) core[field] = value;
  });
  return core;
}

function buildMigratedAiMemory(userId) {
  const memory = {};
  Object.entries(AI_MEMORY_LEGACY_FIELDS).forEach(([field, legacyKey]) => {
    const value = legacyScopedValue(legacyKey, userId);
    if (hasValue(value)) memory[field] = value;
  });
  return memory;
}

function readObjectContainer(baseKey, userId, migrate) {
  const id = userIdOrEmpty(userId);
  if (!id) return {};
  const stored = readContainer(baseKey, id, null);
  if (stored && typeof stored === "object" && !Array.isArray(stored)) return stored;
  const migrated = migrate?.(id) || {};
  if (hasValue(migrated)) writeContainer(baseKey, migrated, id);
  return migrated;
}

function writeObjectPatch(baseKey, patch, userId, migrate) {
  const id = userIdOrEmpty(userId);
  if (!id) return {};
  const current = readObjectContainer(baseKey, id, migrate);
  const next = { ...current, ...(patch || {}) };
  writeContainer(baseKey, next, id);
  return next;
}

export function readUserCore(userId = currentUserId()) {
  return readObjectContainer(USER_CORE_CONTAINER_KEY, userId, buildMigratedUserCore);
}

export function writeUserCore(patch = {}, userId = currentUserId()) {
  return writeObjectPatch(USER_CORE_CONTAINER_KEY, patch, userId, buildMigratedUserCore);
}

export function readUserCoreField(field, userId = currentUserId(), fallback = null) {
  const core = readUserCore(userId);
  return Object.prototype.hasOwnProperty.call(core, field) ? core[field] : fallback;
}

export function writeUserCoreField(field, value, userId = currentUserId()) {
  writeUserCore({ [field]: value }, userId);
  return value;
}

export function readHealthContainer(userId = currentUserId(), fallback = null) {
  const health = readContainer(HEALTH_CONTAINER_KEY, userId, null);
  return health && typeof health === "object" ? health : fallback;
}

export function writeHealthContainer(health, userId = currentUserId()) {
  return writeContainer(HEALTH_CONTAINER_KEY, health, userId);
}

export function readAiMemory(userId = currentUserId()) {
  return readObjectContainer(AI_MEMORY_CONTAINER_KEY, userId, buildMigratedAiMemory);
}

export function writeAiMemory(patch = {}, userId = currentUserId()) {
  return writeObjectPatch(AI_MEMORY_CONTAINER_KEY, patch, userId, buildMigratedAiMemory);
}

export function readAiMemoryField(field, userId = currentUserId(), fallback = null) {
  const memory = readAiMemory(userId);
  return Object.prototype.hasOwnProperty.call(memory, field) ? memory[field] : fallback;
}

export function writeAiMemoryField(field, value, userId = currentUserId()) {
  writeAiMemory({ [field]: value }, userId);
  return value;
}

export function readWorkoutHistory(userId = currentUserId()) {
  return readObjectContainer(WORKOUT_HISTORY_CONTAINER_KEY, userId, () => ({}));
}

export function writeWorkoutHistory(patch = {}, userId = currentUserId()) {
  return writeObjectPatch(WORKOUT_HISTORY_CONTAINER_KEY, patch, userId, () => ({}));
}

export function readWorkoutHistoryField(field, userId = currentUserId(), fallback = null) {
  const history = readWorkoutHistory(userId);
  return Object.prototype.hasOwnProperty.call(history, field) ? history[field] : fallback;
}

export function writeWorkoutHistoryField(field, value, userId = currentUserId()) {
  writeWorkoutHistory({ [field]: value }, userId);
  return value;
}

export function readLecturesContainer(userId = currentUserId()) {
  return readObjectContainer(LECTURES_CONTAINER_KEY, userId, () => ({}));
}

export function writeLecturesContainer(patch = {}, userId = currentUserId()) {
  return writeObjectPatch(LECTURES_CONTAINER_KEY, patch, userId, () => ({}));
}

export function readLecturesField(field, userId = currentUserId(), fallback = null) {
  const lectures = readLecturesContainer(userId);
  return Object.prototype.hasOwnProperty.call(lectures, field) ? lectures[field] : fallback;
}

export function writeLecturesField(field, value, userId = currentUserId()) {
  writeLecturesContainer({ [field]: value }, userId);
  return value;
}

export function clearCurrentUserContainers(userId = currentUserId()) {
  const id = userIdOrEmpty(userId);
  if (!id || typeof window === "undefined") return;
  [
    USER_CORE_CONTAINER_KEY,
    HEALTH_CONTAINER_KEY,
    AI_MEMORY_CONTAINER_KEY,
    WORKOUT_HISTORY_CONTAINER_KEY,
    LECTURES_CONTAINER_KEY,
    ...Object.values(USER_CORE_LEGACY_FIELDS),
    ...Object.values(AI_MEMORY_LEGACY_FIELDS),
    "fruitfit.health.history",
  ].forEach((baseKey) => {
    const key = scopedCacheKey(baseKey, id);
    if (key) localStorage.removeItem(key);
  });
}
