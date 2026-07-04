import { APP_STORE_REVIEW } from "../config/appStoreReview";

export const LOCKED_WORKOUT_MESSAGE = APP_STORE_REVIEW
  ? "Программа пока формируется."
  : "Эта тренировка недоступна по текущему доступу.";

function normalizedStatus(access) {
  return String(access?.status || access?.plan || access?.role || "").toLowerCase();
}

function normalizedRole(...values) {
  return values.map((value) => String(value || "").trim().toLowerCase()).find(Boolean) || "";
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return null;
}

function firstArray(...values) {
  for (const value of values) {
    if (Array.isArray(value)) return value;
    if (typeof value === "string" && value.trim()) {
      return value.split(",").map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function workoutTotal(value) {
  return Array.isArray(value) ? value.length : Math.max(0, Number(value) || 0);
}

function workoutIdentityValues(workout = {}) {
  return [
    workout.workout_id,
    workout.workoutId,
    workout.id,
    workout.lesson_id,
    workout.lessonId,
    workout.lesson?.lesson_id,
    workout.lesson?.lessonId,
    workout.lesson?.id,
    workout.lesson?.lesson_number,
  ].filter((value) => value !== undefined && value !== null).map((value) => String(value));
}

function workoutMatches(left, right) {
  if (left && right && left === right) return true;
  const leftValues = new Set(workoutIdentityValues(left));
  if (!leftValues.size) return false;
  return workoutIdentityValues(right).some((value) => leftValues.has(value));
}

export function originalWorkoutIndex(workouts = [], workout) {
  const items = Array.isArray(workouts) ? workouts : [];
  const index = items.findIndex((item) => workoutMatches(item, workout));
  return index >= 0 ? index : items.indexOf(workout);
}

function isAdminAccess(access = {}, userRole = "") {
  const role = normalizedRole(userRole, access?.userRole, access?.role, access?.user?.role);
  const status = normalizedRole(access?.status, access?.plan);
  return Boolean(
    access?.isAdmin ||
    access?.features?.admin ||
    status === "admin" ||
    role === "admin"
  );
}

export function accessTier(access) {
  if (APP_STORE_REVIEW) return "assigned";

  const status = normalizedStatus(access);
  const role = String(access?.role || "").toLowerCase();
  if (access?.isVip || status === "vip") return "vip";
  if (
    access?.isAdmin ||
    access?.isTrainer ||
    status === "admin" ||
    status === "trainer" ||
    role === "admin" ||
    role === "trainer"
  ) {
    return "full";
  }
  if (access?.isPaid || status === "paid") return "paid";
  return "free";
}

function readServerVisibleWorkoutIds(access = {}, explicitIds = null) {
  return firstArray(
    explicitIds,
    access?.visibleWorkoutIds,
    access?.visible_workout_ids,
    access?.limits?.visibleWorkoutIds,
    access?.limits?.visible_workout_ids,
    access?.features?.visibleWorkoutIds,
    access?.features?.visible_workout_ids,
    access?.meta?.visibleWorkoutIds,
    access?.meta?.visible_workout_ids,
    access?.meta?.limits?.visibleWorkoutIds,
    access?.meta?.limits?.visible_workout_ids,
    access?.appMap?.workouts?.visibleIds,
    access?.appMap?.workouts?.visibleWorkoutIds,
    access?.appMap?.training?.visibleWorkoutIds,
    access?.training?.visibleWorkoutIds,
    access?.training?.visible_workout_ids
  ).map((value) => String(value));
}

function serverWorkoutLimit(access, explicitCount = null) {
  return firstFiniteNumber(
    explicitCount,
    access?.serverVisibleWorkoutCount,
    access?.server_visible_workout_count,
    access?.limits?.workouts,
    access?.limits?.workoutCount,
    access?.limits?.visibleWorkouts,
    access?.limits?.visibleWorkoutCount,
    access?.limits?.visible_workout_count,
    access?.features?.workouts,
    access?.features?.workoutCount,
    access?.features?.visibleWorkouts,
    access?.features?.visibleWorkoutCount,
    access?.features?.visible_workout_count,
    access?.meta?.limits?.workouts,
    access?.meta?.limits?.visibleWorkouts,
    access?.meta?.limits?.visibleWorkoutCount,
    access?.meta?.limits?.visible_workout_count,
    access?.appMap?.workouts?.visibleCount,
    access?.appMap?.training?.visibleWorkoutCount,
    access?.training?.visibleWorkoutCount,
    access?.training?.visible_workout_count,
    access?.visibleWorkoutCount,
    access?.visible_workout_count,
    access?.workoutCount
  );
}

function freePreviewWorkoutCount(workoutsOrTotal = 0) {
  const total = workoutTotal(workoutsOrTotal);
  if (!Array.isArray(workoutsOrTotal) || !workoutsOrTotal.length) return Math.min(total, 3);

  const first = workoutsOrTotal[0] || {};
  const course = first.course || {};
  const text = [
    course.trainings_per_week,
    course.days_per_week,
    course.frequency,
    course.technical_name,
    course.display_name,
    course.gender,
    first.lesson?.training_type,
  ].filter(Boolean).join(" ").toLowerCase();

  if (/(^|\D)2(\D|$)/.test(text) || text.includes("две") || text.includes("два") || text.includes("2 раза")) {
    return Math.min(total, 2);
  }
  if (/(^|\D)3(\D|$)/.test(text) || text.includes("три") || text.includes("3 раза")) {
    return Math.min(total, 3);
  }
  return Math.min(total, 3);
}

function clientHardCap(total, admin) {
  if (admin) return total;
  if (total >= 24) return Math.min(total, 12);
  if (total >= 16) return Math.min(total, 8);
  return total;
}

function debugWorkoutVisibility(payload) {
  const debugEnabled = Boolean(import.meta.env?.DEV)
    || (typeof localStorage !== "undefined" && (
      localStorage.getItem("fruitfit.debug") === "1"
      || localStorage.getItem("fruitfit.debug.workouts") === "1"
    ));
  if (debugEnabled) console.info("[FruitFit workouts] client visibility", payload);
}

export function getClientVisibleWorkouts({
  workouts = [],
  userRole = "",
  accessLevel = "",
  serverVisibleWorkoutIds = null,
  serverVisibleWorkoutCount = null,
  access = {},
} = {}) {
  const items = Array.isArray(workouts) ? workouts : [];
  if (APP_STORE_REVIEW) {
    const serverIds = readServerVisibleWorkoutIds(access, serverVisibleWorkoutIds);
    const serverVisibleCount = serverWorkoutLimit(access, serverVisibleWorkoutCount);
    let visible = items;
    if (serverIds.length) {
      const allowed = new Set(serverIds);
      visible = visible.filter((workout) => workoutIdentityValues(workout).some((value) => allowed.has(value)));
    }
    if (serverVisibleCount !== null) {
      visible = visible.slice(0, Math.max(0, Math.floor(serverVisibleCount)));
    } else if (!serverIds.length) {
      visible = visible.slice(0, freePreviewWorkoutCount(items));
    }
    return visible.length ? visible : items.slice(0, Math.min(items.length, 3));
  }

  const totalWorkouts = items.length;
  const role = normalizedRole(userRole, access?.userRole, access?.role, access?.user?.role);
  const level = normalizedRole(accessLevel) || accessTier(access);
  const admin = isAdminAccess(access, role);
  const serverIds = readServerVisibleWorkoutIds(access, serverVisibleWorkoutIds);
  const serverVisibleCount = serverWorkoutLimit(access, serverVisibleWorkoutCount);
  const hardCap = clientHardCap(totalWorkouts, admin);

  if (admin) {
    debugWorkoutVisibility({
      totalWorkouts,
      serverVisibleCount: serverVisibleCount ?? (serverIds.length || null),
      clientHardCap: hardCap,
      finalVisibleCount: totalWorkouts,
      userRole: role || null,
      accessLevel: level,
    });
    return items;
  }

  let visible = items;
  if (serverIds.length) {
    const allowed = new Set(serverIds);
    visible = visible.filter((workout) => workoutIdentityValues(workout).some((value) => allowed.has(value)));
  }
  if (serverVisibleCount !== null) {
    visible = visible.slice(0, Math.max(0, Math.floor(serverVisibleCount)));
  }
  if (level === "free") {
    visible = visible.slice(0, freePreviewWorkoutCount(items));
  }
  visible = visible.slice(0, hardCap);

  debugWorkoutVisibility({
    totalWorkouts,
    serverVisibleCount: serverVisibleCount ?? (serverIds.length || null),
    clientHardCap: hardCap,
    finalVisibleCount: visible.length,
    userRole: role || null,
    accessLevel: level,
  });

  return visible;
}

export function unlockedWorkoutCount(workoutsOrTotal = 0, access) {
  const total = workoutTotal(workoutsOrTotal);
  if (APP_STORE_REVIEW) {
    return Array.isArray(workoutsOrTotal)
      ? getClientVisibleWorkouts({ workouts: workoutsOrTotal, access }).length
      : total;
  }

  if (Array.isArray(workoutsOrTotal)) {
    return getClientVisibleWorkouts({ workouts: workoutsOrTotal, access }).length;
  }

  const admin = isAdminAccess(access);
  const tier = accessTier(access);
  const serverLimit = serverWorkoutLimit(access);
  const serverIds = readServerVisibleWorkoutIds(access);
  let count = tier === "free" ? freePreviewWorkoutCount(total) : total;
  if (serverIds.length) count = Math.min(count, serverIds.length);
  if (serverLimit !== null) count = Math.min(count, Math.max(0, Math.floor(serverLimit)));
  return Math.min(total, count, clientHardCap(total, admin));
}

export function isWorkoutUnlocked(index, workoutsOrTotal, access) {
  if (APP_STORE_REVIEW) return true;

  const safeIndex = Number(index);
  if (!Number.isFinite(safeIndex) || safeIndex < 0) return false;
  if (Array.isArray(workoutsOrTotal)) {
    const workout = workoutsOrTotal[safeIndex];
    if (!workout) return false;
    return getClientVisibleWorkouts({ workouts: workoutsOrTotal, access }).some((item) => workoutMatches(item, workout));
  }
  return safeIndex < unlockedWorkoutCount(workoutsOrTotal, access);
}

export function visibleWorkoutsForAccess(workouts = [], access) {
  return getClientVisibleWorkouts({ workouts, access });
}

export function workoutAccessLabel(access, workoutsOrTotal = 0) {
  if (APP_STORE_REVIEW) return "Ознакомительная программа";

  const tier = accessTier(access);
  const count = unlockedWorkoutCount(workoutsOrTotal, access);
  if (tier === "full" && isAdminAccess(access)) return "Доступны все тренировки";
  if (tier === "vip") return "VIP: персональная программа";
  if (tier === "paid" || tier === "full") return `Доступно ${count} тренировок`;
  return `Бесплатно доступны первые ${count}`;
}
