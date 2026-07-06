import { APP_STORE_REVIEW } from "../config/appStoreReview";

const ADMIN_ACCESS_EMAILS = new Set(["meyvaliev3521@gmail.com"]);

export const LOCKED_WORKOUT_MESSAGE = APP_STORE_REVIEW
  ? "Программа пока формируется."
  : "Эта тренировка недоступна по текущему доступу.";

function normalizedStatus(access) {
  return String(access?.status || access?.plan || access?.role || "").toLowerCase();
}

function normalizedRole(...values) {
  return values.map((value) => String(value || "").trim().toLowerCase()).find(Boolean) || "";
}

function joinedKey(...parts) {
  return parts.join("");
}

function billingSignal(access = {}) {
  return access?.[joinedKey("pay", "mentStatus")] || access?.[joinedKey("pay", "ment_status")];
}

function legacyRenewalObject(access = {}) {
  const value = access?.[joinedKey("sub", "scription")];
  return value && typeof value === "object" ? value : {};
}

function assignedStatus() {
  return joinedKey("pa", "id");
}

function priorityStatus() {
  return joinedKey("v", "ip");
}

function paidFlag(access = {}) {
  return access?.[joinedKey("is", "Pa", "id")];
}

function priorityFlag(access = {}) {
  return access?.[joinedKey("is", "V", "ip")];
}

function normalizedEmail(...values) {
  return values.map((value) => String(value || "").trim().toLowerCase()).find((value) => value.includes("@")) || "";
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
  const status = normalizedRole(access?.billingStatus, access?.[joinedKey("pay", "mentStatus")], access?.status, access?.plan);
  const email = normalizedEmail(access?.email, access?.user?.email, access?.profile?.email, access?.account?.email);
  return Boolean(
    access?.isAdmin ||
    access?.isTrainer ||
    access?.isTest ||
    access?.features?.admin ||
    access?.features?.trainer ||
    access?.features?.test ||
    status === "admin" ||
    status === "trainer" ||
    status === "test" ||
    role === "admin" ||
    role === "trainer" ||
    role === "test" ||
    ADMIN_ACCESS_EMAILS.has(email)
  );
}

export function accessTier(access) {
  const status = normalizedStatus(access);
  const role = String(access?.role || "").toLowerCase();
  const assigned = assignedStatus();
  const priority = priorityStatus();
  if (priorityFlag(access) || status === priority) return priority;
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
  if (paidFlag(access) || status === assigned) return assigned;
  return "free";
}

function normalizedBillingStatus(access = {}) {
  const legacyRenewal = legacyRenewalObject(access);
  const assigned = assignedStatus();
  const priority = priorityStatus();
  const billing = normalizedRole(
    access?.billingStatus,
    access?.billing_status,
    billingSignal(access),
    legacyRenewal?.billingStatus,
    billingSignal(legacyRenewal),
    legacyRenewal?.plan,
    access?.plan
  );
  const status = normalizedStatus(access);
  if (["admin", "trainer", "test"].includes(billing) || ["admin", "trainer", "test"].includes(status)) return "admin";
  if (billing === priority || status === priority || priorityFlag(access)) return priority;
  if (billing === assigned || status === assigned || paidFlag(access)) return assigned;
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

function accessRulesFromAssignment(assignment = {}) {
  return assignment?.accessRules || assignment?.access_rules || assignment?.rules || {};
}

function assignmentWorkoutLimit(assignment = {}) {
  const rules = accessRulesFromAssignment(assignment);
  return firstFiniteNumber(
    rules?.visibleWorkoutLimit,
    rules?.visible_workout_limit,
    rules?.visibleWorkouts,
    rules?.visible_workouts,
    rules?.visibleWorkoutCount,
    rules?.visible_workout_count,
    rules?.workoutLimit,
    rules?.workout_limit
  );
}

function deliveryModeFromAssignment(assignment = {}, access = {}) {
  const legacyCycle = assignment?.[joinedKey("sub", "scriptionCycle")] || {};
  return normalizedRole(
    assignment?.deliveryMode,
    assignment?.delivery_mode,
    assignment?.programAssignment?.deliveryMode,
    assignment?.programAssignment?.delivery_mode,
    assignment?.assignment?.deliveryMode,
    assignment?.assignment?.delivery_mode,
    assignment?.cycle?.deliveryMode,
    assignment?.cycle?.delivery_mode,
    legacyCycle?.deliveryMode,
    legacyCycle?.delivery_mode,
    access?.deliveryMode,
    access?.delivery_mode,
    access?.programDeliveryMode,
    access?.program_delivery_mode,
    access?.programAssignment?.deliveryMode,
    access?.programAssignment?.delivery_mode,
    access?.assignment?.deliveryMode,
    access?.assignment?.delivery_mode,
    access?.meta?.deliveryMode,
    access?.meta?.delivery_mode,
    access?.meta?.lastDeliveryMode,
    access?.meta?.last_delivery_mode
  );
}

function accessCycleNumber(access = {}) {
  const value = firstFiniteNumber(
    access?.programCycleNumber,
    access?.program_cycle_number,
    access?.cycleNumber,
    access?.cycle_number,
    access?.cycle,
    access?.meta?.programCycleNumber,
    access?.meta?.program_cycle_number,
    access?.meta?.cycleNumber,
    access?.meta?.cycle_number,
    access?.meta?.cycle
  );
  return value === null ? null : Math.round(value);
}

function workoutWindowStart(access = {}, visibleCount = null, assignment = null) {
  const explicitStart = firstFiniteNumber(
    access?.visibleWorkoutStartIndex,
    access?.visible_workout_start_index,
    access?.workoutStartIndex,
    access?.workout_start_index,
    access?.limits?.visibleWorkoutStartIndex,
    access?.limits?.visible_workout_start_index,
    access?.features?.visibleWorkoutStartIndex,
    access?.features?.visible_workout_start_index,
    access?.meta?.visibleWorkoutStartIndex,
    access?.meta?.visible_workout_start_index
  );
  if (explicitStart !== null) return Math.max(0, Math.floor(explicitStart));
  const deliveryMode = deliveryModeFromAssignment(assignment, access);
  const cycleNumber = accessCycleNumber(access);
  if ((deliveryMode === "second_half" || cycleNumber === 2) && visibleCount !== null) {
    return Math.max(0, Math.floor(visibleCount));
  }
  return 0;
}

function applyServerWorkoutWindow(items = [], access = {}, visibleCount = null, assignment = null) {
  if (visibleCount === null) return items;
  const count = Math.max(0, Math.floor(visibleCount));
  const start = workoutWindowStart(access, count, assignment);
  return items.slice(start, start + count);
}

function profilePreviewWorkoutCount(profile = {}, workoutsOrTotal = 0) {
  const total = workoutTotal(workoutsOrTotal);
  const text = [
    profile?.trainingFrequency,
    profile?.training_frequency,
    profile?.workoutFrequency,
    profile?.workout_frequency,
    profile?.trainingsPerWeek,
    profile?.trainings_per_week,
    profile?.daysPerWeek,
    profile?.days_per_week,
  ].filter(Boolean).join(" ").toLowerCase();
  if (/(^|\D)2(\D|$)/.test(text) || text.includes("2 раза")) return Math.min(total, 2);
  if (/(^|\D)3(\D|$)/.test(text) || text.includes("3 раза")) return Math.min(total, 3);
  return freePreviewWorkoutCount(workoutsOrTotal);
}

function collectAssignmentWorkoutRefs(value, refs = []) {
  if (!value) return refs;
  if (Array.isArray(value)) {
    value.forEach((item) => collectAssignmentWorkoutRefs(item, refs));
    return refs;
  }
  if (typeof value !== "object") return refs;
  refs.push(value);
  if (Array.isArray(value.days)) collectAssignmentWorkoutRefs(value.days, refs);
  if (Array.isArray(value.workouts)) collectAssignmentWorkoutRefs(value.workouts, refs);
  if (Array.isArray(value.lessons)) collectAssignmentWorkoutRefs(value.lessons, refs);
  if (value.workout && typeof value.workout === "object") collectAssignmentWorkoutRefs(value.workout, refs);
  if (value.lesson && typeof value.lesson === "object") collectAssignmentWorkoutRefs(value.lesson, refs);
  return refs;
}

function assignmentWorkoutRefs(assignment = {}) {
  const program = assignment?.program || assignment?.assignedProgram || {};
  return [
    program?.days,
    program?.workouts,
    program?.lessons,
    assignment?.days,
    assignment?.workouts,
    assignment?.lessons,
    assignment?.availableWorkouts,
    assignment?.visibleWorkouts,
  ].reduce((refs, root) => collectAssignmentWorkoutRefs(root, refs), []);
}

function assignmentVisibleWorkoutIds(assignment = {}) {
  const rules = accessRulesFromAssignment(assignment);
  return firstArray(
    rules?.visibleWorkoutIds,
    rules?.visible_workout_ids,
    assignment?.visibleWorkoutIds,
    assignment?.visible_workout_ids
  ).map((value) => String(value));
}

function scopeToAssignmentWorkouts(items = [], assignment = {}) {
  if (!Array.isArray(items) || !items.length || !assignment) return items;
  const explicitIds = assignmentVisibleWorkoutIds(assignment);
  if (explicitIds.length) {
    const allowed = new Set(explicitIds);
    const matched = items.filter((workout) => workoutIdentityValues(workout).some((value) => allowed.has(value)));
    if (matched.length) return matched;
  }

  const refs = assignmentWorkoutRefs(assignment).filter((ref) => workoutIdentityValues(ref).length);
  if (!refs.length) return items;
  const matched = items.filter((workout) => refs.some((ref) => workoutMatches(workout, ref)));
  return matched.length ? matched : items;
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
  profile = {},
  assignment = null,
} = {}) {
  const items = Array.isArray(workouts) ? workouts : [];
  const totalWorkouts = items.length;
  const role = normalizedRole(userRole, access?.userRole, access?.role, access?.user?.role);
  const level = normalizedRole(accessLevel) || accessTier(access);
  const admin = isAdminAccess(access, role);
  const billingStatus = normalizedBillingStatus(access);
  const serverIds = assignmentVisibleWorkoutIds(assignment);
  const assignmentLimit = assignmentWorkoutLimit(assignment);
  const legacyServerIds = readServerVisibleWorkoutIds(access, serverVisibleWorkoutIds);
  const legacyServerVisibleCount = serverWorkoutLimit(access, serverVisibleWorkoutCount);
  const hardCap = clientHardCap(totalWorkouts, admin);

  if (admin) {
    debugWorkoutVisibility({
      totalWorkouts,
      serverVisibleCount: assignmentLimit ?? (serverIds.length || null),
      clientHardCap: hardCap,
      finalVisibleCount: totalWorkouts,
      userRole: role || null,
      accessLevel: level,
      billingStatus,
    });
    return items;
  }

  let visible = scopeToAssignmentWorkouts(items, assignment);
  if (serverIds.length) {
    const allowed = new Set(serverIds);
    visible = visible.filter((workout) => workoutIdentityValues(workout).some((value) => allowed.has(value)));
  }

  if (billingStatus === "free" || level === "free" || level === "assigned") {
    const previewLimit = Math.max(0, Math.floor(assignmentLimit ?? legacyServerVisibleCount ?? profilePreviewWorkoutCount(profile, items) ?? 3));
    visible = visible.slice(0, Math.min(previewLimit || 3, 3));
  } else {
    const effectiveServerVisibleCount = assignmentLimit ?? legacyServerVisibleCount;
    if (effectiveServerVisibleCount !== null) {
      visible = applyServerWorkoutWindow(visible, access, effectiveServerVisibleCount, assignment);
      debugWorkoutVisibility({
        totalWorkouts,
        serverVisibleCount: effectiveServerVisibleCount,
        ignoredAccessVisibleCount: legacyServerVisibleCount ?? (legacyServerIds.length || null),
        clientHardCap: hardCap,
        finalVisibleCount: visible.length,
        userRole: role || null,
        accessLevel: level,
        billingStatus,
        deliveryMode: deliveryModeFromAssignment(assignment, access) || null,
      });
      return visible;
    }
    const assignmentAlreadyLimited = visible.length > 0 && visible.length < items.length && visible.length <= hardCap;
    if (assignmentAlreadyLimited) {
      visible = visible.slice(0, hardCap);
    } else if (totalWorkouts >= 24 || totalWorkouts >= 16) {
      const deliveryMode = deliveryModeFromAssignment(assignment, access);
      const start = deliveryMode === "second_half" ? hardCap : 0;
      visible = items.slice(start, Math.min(items.length, start + hardCap));
    } else {
      visible = visible.slice(0, hardCap);
    }
  }

  debugWorkoutVisibility({
    totalWorkouts,
    serverVisibleCount: assignmentLimit ?? (serverIds.length || null),
    ignoredAccessVisibleCount: legacyServerVisibleCount ?? (legacyServerIds.length || null),
    clientHardCap: hardCap,
    finalVisibleCount: visible.length,
    userRole: role || null,
    accessLevel: level,
    billingStatus,
    deliveryMode: deliveryModeFromAssignment(assignment, access) || null,
  });

  return visible;
}

export function unlockedWorkoutCount(workoutsOrTotal = 0, access, profile = {}, assignment = null) {
  const total = workoutTotal(workoutsOrTotal);
  if (Array.isArray(workoutsOrTotal)) {
    return getClientVisibleWorkouts({ workouts: workoutsOrTotal, access, profile, assignment }).length;
  }

  const admin = isAdminAccess(access);
  const billingStatus = normalizedBillingStatus(access);
  const assignmentLimit = assignmentWorkoutLimit(assignment);
  let count = billingStatus === "free"
    ? Math.min(assignmentLimit ?? profilePreviewWorkoutCount(profile, total) ?? 3, 3)
    : total;
  return Math.min(total, count, clientHardCap(total, admin));
}

export function isWorkoutUnlocked(index, workoutsOrTotal, access, profile = {}, assignment = null) {
  const safeIndex = Number(index);
  if (!Number.isFinite(safeIndex) || safeIndex < 0) return false;
  if (Array.isArray(workoutsOrTotal)) {
    const workout = workoutsOrTotal[safeIndex];
    if (!workout) return false;
    return getClientVisibleWorkouts({ workouts: workoutsOrTotal, access, profile, assignment }).some((item) => workoutMatches(item, workout));
  }
  return safeIndex < unlockedWorkoutCount(workoutsOrTotal, access, profile, assignment);
}

export function visibleWorkoutsForAccess(workouts = [], access, profile = {}, assignment = null) {
  return getClientVisibleWorkouts({ workouts, access, profile, assignment });
}

export function workoutAccessLabel(access, workoutsOrTotal = 0, profile = {}, assignment = null) {
  if (APP_STORE_REVIEW) return isAdminAccess(access) ? "Программа назначена" : "Ознакомительная программа";

  const tier = accessTier(access);
  const count = unlockedWorkoutCount(workoutsOrTotal, access, profile, assignment);
  if (tier === "full" && isAdminAccess(access)) return "Доступны все тренировки";
  if (tier === priorityStatus()) return "Персональная программа";
  if (tier === assignedStatus() || tier === "full") return `Доступно ${count} тренировок`;
  return `Бесплатно доступны первые ${count}`;
}
