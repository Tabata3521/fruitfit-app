import { readAiMemory, readHealthContainer, readUserCore, readUserCoreField, writeUserCoreField } from "./dataContainers";
import { dietTypeToRation } from "./profileStore";
import { currentUserId, scopedCacheKey } from "./userScopedCache";
import { activeNutritionData } from "./nutritionCatalogStore";

function cleanId(value) {
  return String(value || "").trim();
}

function cleanTitle(value) {
  return String(value || "").trim();
}

function assignmentDeliveryMode(assignment = {}) {
  return cleanId(
    assignment.deliveryMode
    || assignment.delivery_mode
    || assignment.meta?.deliveryMode
    || assignment.meta?.delivery_mode
    || assignment.meta?.lastDeliveryMode
    || assignment.meta?.last_delivery_mode
  );
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizedTitle(value) {
  return cleanTitle(value).toLowerCase().replace(/\s+/g, " ");
}

function nutritionTargetFromProfile(profile = {}) {
  if (!profile || typeof profile !== "object") return null;
  const nutritionData = activeNutritionData(profile);
  const rawCaloriesTarget = numberOrNull(profile.recommendedCaloriesTarget || profile.recommended_calories_target || profile.calculatedCalories || profile.calculated_calories);
  const caloriesTarget = nearestNutritionCaloriesTarget(rawCaloriesTarget || 1800, nutritionData);
  const ration = nutritionRationFromProfile(profile, nutritionData);
  const totals = nutritionTotalsForTarget({ caloriesTarget, ration, nutritionData });
  return {
    calories: caloriesTarget,
    caloriesTarget,
    protein: totals.protein,
    fat: totals.fat,
    fats: totals.fat,
    carbs: totals.carbs,
    dietType: cleanTitle(profile.dietType || profile.diet_type) || null,
    ration,
    goal: cleanTitle(profile.goal) || null,
    tolerance: 0,
    source: "questionnaire",
  };
}

function nearestNutritionCaloriesTarget(preferred = 1800, nutritionData = {}) {
  const targets = (nutritionData?.filters?.caloriesTargets || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const target = numberOrNull(preferred) || 1800;
  if (!targets.length) return target;
  return targets.reduce((best, current) => (
    Math.abs(current - target) < Math.abs(best - target) ? current : best
  ), targets[0]);
}

function nutritionRationFromProfile(profile = {}, nutritionData = {}) {
  const preferred = dietTypeToRation[profile?.dietType] || dietTypeToRation[profile?.diet_type] || cleanTitle(profile?.dietType || profile?.diet_type);
  const rations = nutritionData?.filters?.rations || [];
  if (rations.includes(preferred)) return preferred;
  return rations[0] || preferred || null;
}

function nutritionTotalsForTarget({ caloriesTarget, ration, nutritionData = {} } = {}) {
  const days = nutritionData?.filters?.days || [];
  const day = days.includes("Понедельник") ? "Понедельник" : days[0];
  const planKey = `${ration}|${Number(caloriesTarget)}|${day}`;
  const planTotals = nutritionData?.plans?.[planKey]?.totals;
  if (planTotals && typeof planTotals === "object") {
    return {
      calories: Number(planTotals.calories) || Number(caloriesTarget) || null,
      protein: Number(planTotals.protein) || null,
      fat: Number(planTotals.fat) || null,
      carbs: Number(planTotals.carbs) || null,
    };
  }
  const meals = Array.isArray(nutritionData?.meals) ? nutritionData.meals : [];
  const plannedIds = nutritionData?.plans?.[planKey]?.mealIds || [];
  const mealById = new Map(meals.map((meal) => [String(meal.id), meal]));
  const plannedMeals = plannedIds.map((id) => mealById.get(String(id))).filter(Boolean);
  const uniqueMeals = [];
  const seenTypes = new Set();
  for (const meal of plannedMeals.length ? plannedMeals : meals) {
    if (!meal?.rations?.includes(ration)) continue;
    if (!meal?.caloriesTargets?.includes(Number(caloriesTarget))) continue;
    if (day && meal.day !== day) continue;
    if (seenTypes.has(meal.mealType)) continue;
    seenTypes.add(meal.mealType);
    uniqueMeals.push(meal);
  }
  const totals = uniqueMeals.reduce((acc, meal) => ({
    calories: acc.calories + Number(meal.calories || 0),
    protein: acc.protein + Number(meal.protein || 0),
    fat: acc.fat + Number(meal.fat || 0),
    carbs: acc.carbs + Number(meal.carbs || 0),
  }), { calories: 0, protein: 0, fat: 0, carbs: 0 });
  return {
    calories: totals.calories ? Math.round(totals.calories) : Number(caloriesTarget) || null,
    protein: totals.protein ? Math.round(totals.protein) : null,
    fat: totals.fat ? Math.round(totals.fat) : null,
    carbs: totals.carbs ? Math.round(totals.carbs) : null,
  };
}

function dayNumberFromTitle(value) {
  const match = cleanTitle(value).match(/(?:день|day)\s*(\d{1,3})/i);
  const number = match ? Number(match[1]) : null;
  return Number.isFinite(number) && number > 0 ? number : null;
}

function programIdFromWorkoutIdentifier(...values) {
  const text = values.map((value) => String(value || "")).filter(Boolean).join(" ");
  if (!text) return "";
  const matches = [...text.matchAll(/(?:inskill_program|inskill_day)_(\d{3,})/gi)].map((match) => match[1]);
  return matches.length ? matches[matches.length - 1] : "";
}

function lessonIdFromWorkoutIdentifier(...values) {
  const text = values.map((value) => String(value || "")).filter(Boolean).join(" ");
  if (!text) return "";
  const matches = [...text.matchAll(/(?:^|_)(\d{3,})(?=$|_)/g)].map((match) => match[1]);
  return matches.length ? matches[matches.length - 1] : "";
}

function workoutIdentity(workout = {}) {
  const lesson = workout.lesson || workout.day || workout.workout || {};
  const rawWorkoutId = cleanId(firstPresent(
    workout.workoutId,
    workout.workout_id,
    workout.id,
    workout.lessonId,
    workout.lesson_id,
    lesson.workoutId,
    lesson.workout_id,
    lesson.lessonId,
    lesson.lesson_id,
    lesson.id
  ));
  const rawLessonId = cleanId(firstPresent(
    workout.lessonId,
    workout.lesson_id,
    lesson.lessonId,
    lesson.lesson_id,
    lesson.id
  ));
  const inferredLessonId = lessonIdFromWorkoutIdentifier(rawLessonId, rawWorkoutId);
  return {
    workoutId: rawWorkoutId,
    lessonId: cleanId(firstPresent(rawLessonId, inferredLessonId, rawWorkoutId)),
    title: cleanTitle(firstPresent(
      workout.title,
      workout.name,
      workout.lessonTitle,
      workout.lesson_title,
      workout.dayTitle,
      workout.day_title,
      workout.workoutTitle,
      workout.workout_title,
      lesson.title,
      lesson.name,
      lesson.lessonTitle,
      lesson.lesson_title
    )),
  };
}

function exerciseRuntimeShape(exercise = {}) {
  if (!exercise || typeof exercise !== "object") return null;
  const id = firstPresent(exercise.id, exercise.exercise_id, exercise.exerciseId, exercise.source_id, exercise.tableId);
  const name = firstPresent(exercise.exercise_name, exercise.name, exercise.title);
  const order = numberOrNull(firstPresent(exercise.exercise_order, exercise.order, exercise.position, exercise.sortOrder));
  const sets = firstPresent(exercise.sets, exercise.set_count, exercise.setCount);
  const reps = firstPresent(exercise.reps, exercise.repetitions, exercise.rep_range, exercise.repRange);
  const rest = firstPresent(exercise.rest, exercise.rest_seconds, exercise.restSeconds, exercise.rest_time, exercise.restTime);
  const notes = firstPresent(exercise.notes, exercise.note, exercise.comment, exercise.raw_line, exercise.description);
  return {
    id: id || name || null,
    name: cleanTitle(name) || null,
    order,
    sets: sets ?? null,
    reps: reps ?? null,
    weight: exercise.weight || exercise.weight_hint || exercise.weightHint || null,
    notes: cleanTitle(notes) || null,
    rest: rest ?? null,
  };
}

function workoutPublicShape(workout = {}, assignment = null, source = "server_assignment") {
  if (!workout || typeof workout !== "object") return null;
  const lesson = workout.lesson || workout.day || workout.workout || {};
  const identity = workoutIdentity(workout);
  const programIdFromWorkout = programIdFromWorkoutIdentifier(identity.workoutId, identity.lessonId);
  const indexValue = numberOrNull(firstPresent(
    workout.index,
    workout.workoutIndex,
    workout.workout_index,
    workout.dayIndex,
    workout.day_index,
    lesson.index
  ));
  const titleDayNumber = dayNumberFromTitle(identity.title);
  const lessonNumber = numberOrNull(firstPresent(
    workout.lessonNumber,
    workout.lesson_number,
    workout.dayNumber,
    workout.day_number,
    workout.order,
    lesson.lessonNumber,
    lesson.lesson_number,
    lesson.dayNumber,
    lesson.day_number,
    lesson.order,
    titleDayNumber,
    indexValue != null ? indexValue + 1 : null
  ));
  const programId = cleanId(firstPresent(
    workout.programId,
    workout.program_id,
    workout.courseId,
    workout.course_id,
    workout.course?.course_id,
    workout.course?.id,
    programIdFromWorkout,
    assignment?.programId,
    assignment?.program_id,
    assignment?.id
  ));
  const useful = identity.workoutId || identity.lessonId || identity.title || lessonNumber != null;
  if (!useful) return null;
  return {
    programId: programId || null,
    workoutId: identity.workoutId || null,
    lessonId: identity.lessonId || identity.workoutId || null,
    lessonNumber: lessonNumber || null,
    dayIndex: titleDayNumber ? titleDayNumber - 1 : (indexValue != null ? indexValue : (lessonNumber ? lessonNumber - 1 : null)),
    title: identity.title || null,
    index: titleDayNumber ? titleDayNumber - 1 : (indexValue != null ? indexValue : (lessonNumber ? lessonNumber - 1 : null)),
    deliveryMode: assignmentDeliveryMode(assignment || {}) || null,
    exerciseCount: Array.isArray(workout.exercises) ? workout.exercises.length : 0,
    exercises: Array.isArray(workout.exercises)
      ? workout.exercises.slice(0, 32).map(exerciseRuntimeShape).filter(Boolean)
      : [],
    source,
    resolvedAt: workout.resolvedAt || workout.resolved_at || new Date().toISOString(),
  };
}

function currentWorkoutCandidates(assignment = null) {
  if (!assignment || typeof assignment !== "object") return [];
  const program = assignment.program && typeof assignment.program === "object" ? assignment.program : {};
  const meta = assignment.meta && typeof assignment.meta === "object" ? assignment.meta : {};
  return [
    assignment.currentWorkout,
    assignment.current_workout,
    assignment.todayWorkout,
    assignment.today_workout,
    assignment.activeWorkout,
    assignment.active_workout,
    assignment.currentDay,
    assignment.current_day,
    assignment.workout,
    assignment.lesson,
    program.currentWorkout,
    program.current_workout,
    program.todayWorkout,
    program.today_workout,
    program.activeWorkout,
    program.active_workout,
    program.currentDay,
    program.current_day,
    meta.currentWorkout,
    meta.current_workout,
    meta.todayWorkout,
    meta.today_workout,
  ].filter(Boolean);
}

export function normalizeServerWorkout(workout = null, assignment = null) {
  return workoutPublicShape(workout, assignment, "server_assignment");
}

export function serverCurrentWorkoutFromAssignment(assignment = null) {
  for (const candidate of currentWorkoutCandidates(assignment)) {
    const normalized = normalizeServerWorkout(candidate, assignment);
    if (normalized) return normalized;
  }
  return null;
}

function workoutMatchesServerWorkout(workout = null, serverWorkout = null) {
  if (!workout || !serverWorkout) return false;
  const identity = workoutIdentity(workout);
  const serverWorkoutId = cleanId(serverWorkout.workoutId || serverWorkout.workout_id);
  const serverLessonId = cleanId(serverWorkout.lessonId || serverWorkout.lesson_id);
  const serverLessonNumber = numberOrNull(serverWorkout.lessonNumber || serverWorkout.lesson_number);
  const serverTitle = normalizedTitle(serverWorkout.title);

  if (serverWorkoutId && [identity.workoutId, identity.lessonId].map(cleanId).includes(serverWorkoutId)) return true;
  if (serverLessonId && [identity.workoutId, identity.lessonId].map(cleanId).includes(serverLessonId)) return true;
  const workoutLessonNumber = numberOrNull(
    workout.lesson?.lesson_number
    || workout.lessonNumber
    || workout.lesson_number
    || workout.dayNumber
    || workout.day_number
  );
  if (serverLessonNumber != null && workoutLessonNumber === serverLessonNumber) return true;
  return Boolean(serverTitle && normalizedTitle(identity.title) === serverTitle);
}

export function findWorkoutIndexForServerWorkout(program = null, serverWorkout = null) {
  const workouts = Array.isArray(program?.workouts) ? program.workouts : [];
  if (!workouts.length || !serverWorkout) return -1;
  return workouts.findIndex((item) => workoutMatchesServerWorkout(item, serverWorkout));
}

function debugWorkoutShape(workout = null) {
  if (!workout || typeof workout !== "object") return null;
  const identity = workoutIdentity(workout);
  return {
    programId: cleanId(workout.programId || workout.program_id || workout.course?.course_id || workout.course?.id) || null,
    workoutId: identity.workoutId || null,
    lessonId: identity.lessonId || null,
    lessonNumber: numberOrNull(workout.lesson?.lesson_number || workout.lessonNumber || workout.lesson_number),
    title: identity.title || null,
    index: numberOrNull(workout.index),
  };
}

const LEGACY_WORKOUT_STATE_KEYS = Object.freeze([
  "fruitfit.currentWorkout",
  "fruitfit.selectedWorkoutIndex",
  "fruitfit.workoutIndex",
  "fruitfit.currentWorkoutIndex",
  "fruitfit.selectedWorkout",
]);

export function resetStaleWorkoutState({ userId = currentUserId(), reason = "manual-reset" } = {}) {
  const id = cleanId(userId);
  if (typeof window !== "undefined") {
    LEGACY_WORKOUT_STATE_KEYS.forEach((baseKey) => {
      localStorage.removeItem(baseKey);
      if (id) localStorage.removeItem(scopedCacheKey(baseKey, id));
    });
  }
  if (id) {
    writeUserCoreField("currentWorkout", null, id);
    writeUserCoreField("selectedWorkoutIndex", null, id);
  }
  console.info("[FruitFit currentWorkout] CACHE_WORKOUT", {
    action: "reset_stale_workout_state",
    reason,
    userId: id || null,
    clearedLegacyKeys: LEGACY_WORKOUT_STATE_KEYS,
  });
}

export function getUserCoreSnapshot(userId = currentUserId()) {
  const id = cleanId(userId);
  return id ? readUserCore(id) : {};
}

export function getHealthSnapshot(userId = currentUserId()) {
  const id = cleanId(userId);
  return id ? readHealthContainer(id, null) : null;
}

function sumHistoryValues(rows = []) {
  return (Array.isArray(rows) ? rows : []).reduce((total, item) => (
    total + (Number(item?.value ?? item?.steps ?? item?.calories ?? item?.minutes ?? 0) || 0)
  ), 0);
}

function compactMetricSource(metric = {}) {
  if (!metric || typeof metric !== "object") return null;
  return {
    dataSource: metric.dataSource || null,
    sourceName: metric.sourceName || metric.latestSourceName || metric.selectedSourceName || null,
    sourcePackage: metric.sourcePackage || metric.latestSourcePackage || metric.selectedSourcePackage || null,
    status: metric.status || metric.widgetState || null,
  };
}

function runtimeHealthSnapshot(health = null) {
  if (!health || typeof health !== "object") return null;
  const steps = health.steps || {};
  const sleep = health.sleep || {};
  const calories = health.calories || {};
  const heart = health.heart_rate || health.heartRate || {};
  const refresh = health.healthRefresh || {};
  const history7d = health.history7d || {};
  const stepsHistory = Array.isArray(history7d.steps) ? history7d.steps : [];
  const caloriesHistory = Array.isArray(history7d.calories) ? history7d.calories : [];
  const sleepHistory = Array.isArray(history7d.sleep) ? history7d.sleep : [];
  const heartHistory = Array.isArray(history7d.heartRate) ? history7d.heartRate : (Array.isArray(heart.history7d) ? heart.history7d : []);
  return {
    steps: {
      today: numberOrNull(steps.today ?? steps.dashboardValue ?? steps.finalDashboardValue),
      goal: numberOrNull(steps.goal),
      weekTotal: sumHistoryValues(stepsHistory) || numberOrNull(steps.detailValue),
      history7d: stepsHistory.slice(-7),
    },
    sleep: {
      minutes: numberOrNull(sleep.minutes),
      quality: numberOrNull(sleep.quality),
      lastNightMinutes: numberOrNull(sleep.lastNightMinutes || sleep.sleepLastNightMinutes),
      history7d: sleepHistory.slice(-7),
    },
    calories: {
      activeToday: numberOrNull(calories.activeToday ?? calories.today ?? calories.dashboardValue),
      totalToday: numberOrNull(calories.totalToday),
      restingToday: numberOrNull(calories.restingToday),
      goal: numberOrNull(calories.goal),
      weekTotal: sumHistoryValues(caloriesHistory) || numberOrNull(calories.detailValue),
      history7d: caloriesHistory.slice(-7),
    },
    heartRate: {
      latestBpm: numberOrNull(heart.latestBpm ?? heart.current),
      resting: numberOrNull(heart.resting),
      avg24h: numberOrNull(heart.avg24h),
      avg7d: numberOrNull(heart.avg7d),
      range24h: Array.isArray(heart.range24h || heart.dayRange) ? (heart.range24h || heart.dayRange) : [],
      latestTimestamp: heart.latestTimestamp || null,
      history7d: heartHistory.slice(-7),
    },
    source: {
      steps: compactMetricSource(steps),
      sleep: compactMetricSource(sleep),
      calories: compactMetricSource(calories),
      heartRate: compactMetricSource(heart),
    },
    freshness: refresh.dataFreshness || heart.freshness || steps.freshness || calories.freshness || sleep.freshness || "unknown",
    lastSyncAt: refresh.lastNativeReadFinishedAt || refresh.lastRefreshFinishedAt || health.updatedAt || health.savedAt || null,
  };
}

export function getAiMemorySnapshot(userId = currentUserId()) {
  const id = cleanId(userId);
  return id ? readAiMemory(id) : {};
}

export function persistCurrentWorkout({ programAssignment = null, currentWorkout = null, userId = currentUserId() } = {}) {
  const id = cleanId(userId);
  if (!id) return null;
  resetStaleWorkoutState({ userId: id, reason: "before_server_workout_overwrite" });
  const assignment = programAssignment || readUserCoreField("programAssignment", id, null) || null;
  const resolved = normalizeServerWorkout(currentWorkout, assignment) || serverCurrentWorkoutFromAssignment(assignment);
  writeUserCoreField("currentWorkout", resolved, id);
  console.info("[FruitFit currentWorkout] SERVER_WORKOUT", {
    userId: id,
    source: "program-assignment",
    workoutId: resolved?.workoutId || null,
    lessonNumber: resolved?.lessonNumber || null,
    title: resolved?.title || null,
    deliveryMode: resolved?.deliveryMode || null,
  });
  console.info("[FruitFit currentWorkout] CACHE_WORKOUT", {
    userId: id,
    action: resolved ? "overwrite_server_value" : "clear_stale_value",
    workoutId: resolved?.workoutId || null,
    title: resolved?.title || null,
  });
  return resolved;
}

export function buildAiCoachClientContext({
  profile = null,
  programAssignment = null,
  currentWorkout = null,
  serverCurrentWorkout = null,
  selectedWorkoutId = "",
  selectedWorkoutTitle = "",
  selectionResolution = null,
  debugWorkoutHint = null,
  messages = [],
} = {}) {
  const userId = currentUserId();
  if (!userId) return {};
  const core = getUserCoreSnapshot(userId);
  const health = getHealthSnapshot(userId);
  const memory = getAiMemorySnapshot(userId);
  const effectiveProfile = profile || core.profile || null;
  const assignment = programAssignment || core.programAssignment || null;
  const resolvedCurrentWorkout = normalizeServerWorkout(currentWorkout, assignment) || serverCurrentWorkoutFromAssignment(assignment);
  const resolvedServerWorkout = normalizeServerWorkout(serverCurrentWorkout, assignment) || serverCurrentWorkoutFromAssignment(assignment);
  const hasExplicitWorkoutSelection = Boolean(cleanId(selectedWorkoutId) || cleanTitle(selectedWorkoutTitle));
  const selectedWorkout = resolvedCurrentWorkout ? {
    ...resolvedCurrentWorkout,
    workoutId: cleanId(selectedWorkoutId || resolvedCurrentWorkout.workoutId || resolvedCurrentWorkout.lessonId) || null,
    lessonId: cleanId(resolvedCurrentWorkout.lessonId || selectedWorkoutId || resolvedCurrentWorkout.workoutId) || null,
    title: cleanTitle(selectedWorkoutTitle || resolvedCurrentWorkout.title) || null,
    dayIndex: numberOrNull(resolvedCurrentWorkout.dayIndex ?? resolvedCurrentWorkout.index),
    exercises: Array.isArray(resolvedCurrentWorkout.exercises) ? resolvedCurrentWorkout.exercises : [],
  } : null;
  const cleanSelectedWorkoutId = cleanId(selectedWorkoutId || selectedWorkout?.workoutId || selectedWorkout?.lessonId);
  const cleanSelectedWorkoutTitle = cleanTitle(selectedWorkoutTitle || selectedWorkout?.title);
  const compactHealthSnapshot = runtimeHealthSnapshot(health);
  const context = {
    contextType: "clientRuntimeContext",
    profile: effectiveProfile,
    accessState: core.accessState || null,
    programAssignment: assignment,
    selectedWorkout,
    currentWorkout: selectedWorkout,
    currentWorkoutSource: hasExplicitWorkoutSelection ? "user_selection" : (selectedWorkout ? "server_assignment" : "none"),
    serverCurrentWorkout: resolvedServerWorkout,
    selectedWorkoutId: cleanSelectedWorkoutId || null,
    selectedWorkoutTitle: cleanSelectedWorkoutTitle || null,
    userSelectedWorkoutWinsForThisRequest: Boolean(selectionResolution?.userSelectedWorkoutWinsForThisRequest),
    workoutSelectionConflict: selectionResolution ? {
      rule: selectionResolution.rule || null,
      source: selectionResolution.source || null,
      selectedPropConflicts: Boolean(selectionResolution.selectedPropConflicts),
      serverWorkoutConflicts: Boolean(selectionResolution.serverWorkoutConflicts),
      userSelectedWorkoutWinsForThisRequest: Boolean(selectionResolution.userSelectedWorkoutWinsForThisRequest),
      storedWorkoutId: selectionResolution.storedWorkoutId || null,
      storedWorkoutTitle: selectionResolution.storedWorkoutTitle || null,
      selectedPropWorkoutId: selectionResolution.selectedPropWorkoutId || null,
      selectedPropWorkoutTitle: selectionResolution.selectedPropWorkoutTitle || null,
      serverWorkoutId: selectionResolution.serverWorkoutId || null,
      serverWorkoutTitle: selectionResolution.serverWorkoutTitle || null,
    } : null,
    selectionResolution: selectionResolution || null,
    debugWorkoutHint: {
      uiWorkout: debugWorkoutShape(debugWorkoutHint),
      cacheWorkout: debugWorkoutShape(core.currentWorkout),
    },
    healthSnapshot: compactHealthSnapshot,
    nutritionTarget: nutritionTargetFromProfile(effectiveProfile),
    recentMessages: Array.isArray(messages) ? messages : [],
    aiMemory: {
      preferences: memory.preferences || null,
      summaries: memory.summaries || null,
    },
  };
  console.info("[FruitFit Coach UI] AI_CONTEXT_BUILD", {
    userId,
    hasProfile: Boolean(context.profile),
    hasProgramAssignment: Boolean(context.programAssignment),
    hasCurrentWorkout: Boolean(context.currentWorkout),
    currentWorkoutTitle: context.currentWorkout?.title || null,
    selectedWorkoutId: context.selectedWorkoutId || null,
    selectedWorkoutTitle: context.selectedWorkoutTitle || null,
    selectedWorkoutExerciseCount: context.selectedWorkout?.exercises?.length || 0,
    serverWorkoutTitle: context.serverCurrentWorkout?.title || null,
    userSelectedWorkoutWinsForThisRequest: context.userSelectedWorkoutWinsForThisRequest,
    workoutSelectionConflict: context.workoutSelectionConflict ? {
      selectedPropConflicts: context.workoutSelectionConflict.selectedPropConflicts,
      serverWorkoutConflicts: context.workoutSelectionConflict.serverWorkoutConflicts,
    } : null,
    hasHealth: Boolean(context.healthSnapshot),
    healthLastSyncAt: context.healthSnapshot?.lastSyncAt || null,
    hasNutritionTarget: Boolean(context.nutritionTarget),
    recentMessages: context.recentMessages.length,
  });
  return context;
}
