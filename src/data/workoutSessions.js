import { currentUserId, readUserScopedCache, writeUserScopedCache } from "./userScopedCache";

export const WORKOUT_SESSIONS_KEY = "fruitfit.workout_sessions.v2";
export const WORKOUT_SESSION_SCHEMA_VERSION = 2;
const LEGACY_SESSION_PREFIX = "fruitfit.workout.sessionProgress:";
const SESSION_STATUSES = new Set(["active", "paused", "completed", "abandoned"]);
const EXERCISE_STATUSES = new Set(["not_started", "in_progress", "completed", "skipped"]);

function nowIso() {
  return new Date().toISOString();
}

function text(value) {
  return String(value ?? "").trim();
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `ws_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

export function stableWorkoutId(workout = {}) {
  return text(
    workout.workout_id
    || workout.workoutId
    || workout.lesson_id
    || workout.lessonId
    || workout.id
    || workout.training_id
    || workout.trainingId
  );
}

export function stableExerciseId(exercise = {}, index = 0) {
  const direct = text(
    exercise.session_exercise_id
    || exercise.sessionExerciseId
    || exercise.exercise_id
    || exercise.exerciseId
    || exercise.training_id
    || exercise.trainingId
    || exercise.id
  );
  if (direct) return direct;
  const lesson = text(exercise.lesson_id || exercise.lessonId);
  const order = Number(exercise.exercise_order ?? exercise.exerciseOrder ?? index + 1);
  const name = text(exercise.exercise_name || exercise.name).toLowerCase();
  return [lesson || "exercise", Number.isFinite(order) ? order : index + 1, name].filter(Boolean).join(":");
}

export function stableSetId(exerciseId, setNumber) {
  return `${text(exerciseId)}:set:${Math.max(1, Number(setNumber) || 1)}`;
}

function normalizeSet(set = {}, exerciseId, setNumber) {
  const number = Math.max(1, Number(set.set_number ?? set.setNumber ?? setNumber) || 1);
  return {
    set_id: text(set.set_id || set.setId) || stableSetId(exerciseId, number),
    set_number: number,
    completed: Boolean(set.completed),
    weight: set.weight === "" || set.weight == null ? null : Number(set.weight),
    reps: set.reps === "" || set.reps == null ? null : Number(set.reps),
    duration_seconds: set.duration_seconds == null ? null : Math.max(0, Number(set.duration_seconds) || 0),
    updated_at: text(set.updated_at || set.updatedAt) || null,
  };
}

function plannedSetCount(exercise = {}) {
  return Math.max(1, Math.min(20, Number(exercise.sets) || 1));
}

export function normalizeExerciseState(state = {}, exercise = {}, index = 0) {
  const exerciseId = text(state.exercise_id || state.exerciseId) || stableExerciseId(exercise, index);
  const count = Math.max(
    plannedSetCount(exercise),
    Array.isArray(state.sets) ? state.sets.length : 0,
  );
  const sourceSets = Array.isArray(state.sets) ? state.sets : [];
  const sets = Array.from({ length: count }, (_, setIndex) => (
    normalizeSet(sourceSets[setIndex] || {}, exerciseId, setIndex + 1)
  ));
  const completedSets = sets.filter((set) => set.completed).length;
  let status = EXERCISE_STATUSES.has(state.status) ? state.status : "not_started";
  if (completedSets >= count && count > 0) status = "completed";
  if (status === "not_started" && (completedSets || sets.some((set) => set.weight != null || set.reps != null))) {
    status = "in_progress";
  }
  return {
    exercise_id: exerciseId,
    title: text(state.title) || text(exercise.exercise_name || exercise.name),
    order: Number(exercise.exercise_order ?? exercise.exerciseOrder ?? state.order ?? index + 1) || index + 1,
    status,
    sets,
    notes: text(state.notes),
    skipped_at: text(state.skipped_at || state.skippedAt) || null,
    completed_at: text(state.completed_at || state.completedAt) || null,
    updated_at: text(state.updated_at || state.updatedAt) || null,
  };
}

function programIdFrom(program = {}, workout = {}) {
  return text(
    workout.program_id
    || workout.programId
    || program.program_id
    || program.programId
    || program.course?.program_id
    || workout.course?.program_id
  );
}

function programDayIdFrom(workout = {}) {
  return text(
    workout.program_day_id
    || workout.programDayId
    || workout.day_id
    || workout.dayId
    || workout.lesson?.lesson_id
    || workout.lesson_id
    || workout.lessonId
  ) || stableWorkoutId(workout);
}

export function calculateWorkoutProgress(session = {}) {
  const exercises = Object.values(session.exercises || {});
  const completedExercises = exercises.filter((exercise) => exercise.status === "completed").length;
  const completedSets = exercises.reduce(
    (total, exercise) => total + (exercise.sets || []).filter((set) => set.completed).length,
    0,
  );
  const totalSets = exercises.reduce((total, exercise) => total + (exercise.sets || []).length, 0);
  return {
    completed_exercises: completedExercises,
    total_exercises: exercises.length,
    completed_sets: completedSets,
    total_sets: totalSets,
    percent: totalSets ? Math.round((completedSets / totalSets) * 100) : 0,
  };
}

export function reconcileWorkoutSession(session = {}, { workout = {}, program = {}, userId = currentUserId() } = {}) {
  const timestamp = nowIso();
  const exercises = {};
  const previous = session.exercises && typeof session.exercises === "object" ? session.exercises : {};
  const currentExercises = Array.isArray(workout.exercises) ? workout.exercises : [];
  const currentExerciseIds = currentExercises.map((exercise, index) => stableExerciseId(exercise, index));
  const previousExerciseIds = Object.keys(previous).filter((id) => !previous[id]?.removed_from_program);
  const addedExerciseIds = currentExerciseIds.filter((id) => !previous[id]);
  const removedExerciseIds = previousExerciseIds.filter((id) => !currentExerciseIds.includes(id));
  currentExercises.forEach((exercise, index) => {
    const id = stableExerciseId(exercise, index);
    exercises[id] = normalizeExerciseState(previous[id] || {}, exercise, index);
  });
  Object.entries(previous).forEach(([id, state]) => {
    if (exercises[id]) return;
    exercises[id] = {
      ...normalizeExerciseState(state, {}, Number(state?.order || 1) - 1),
      removed_from_program: true,
    };
  });
  const workoutId = stableWorkoutId(workout) || text(session.workout_id);
  const selectedId = text(session.selected_exercise_id);
  const firstExerciseId = currentExercises.length ? stableExerciseId(currentExercises[0], 0) : "";
  const normalized = {
    schema_version: WORKOUT_SESSION_SCHEMA_VERSION,
    session_id: text(session.session_id) || uuid(),
    user_id: text(userId || session.user_id),
    program_id: programIdFrom(program, workout) || text(session.program_id),
    program_day_id: programDayIdFrom(workout) || text(session.program_day_id),
    workout_id: workoutId,
    workout_title: text(workout.lesson?.lesson_title || workout.title || session.workout_title),
    started_at: text(session.started_at) || timestamp,
    updated_at: text(session.updated_at) || timestamp,
    last_active_at: text(session.last_active_at) || timestamp,
    completed_at: text(session.completed_at) || null,
    status: SESSION_STATUSES.has(session.status) ? session.status : "paused",
    selected_exercise_id: exercises[selectedId] ? selectedId : firstExerciseId,
    last_opened_exercise_id: exercises[text(session.last_opened_exercise_id)]
      ? text(session.last_opened_exercise_id)
      : (exercises[selectedId] ? selectedId : firstExerciseId),
    recommended_next_exercise_id: text(session.recommended_next_exercise_id),
    scroll_position: Math.max(0, Number(session.scroll_position) || 0),
    notes: text(session.notes),
    timer: normalizeTimer(session.timer),
    exercises,
    local_version: Math.max(1, Number(session.local_version) || 1),
    server_version: Math.max(0, Number(session.server_version) || 0),
    sync_status: text(session.sync_status) || "local",
    last_synced_at: text(session.last_synced_at) || null,
    conflict: session.conflict || null,
    program_revision: text(session.program_revision || program.updated_at || program.updatedAt) || null,
    program_update: previousExerciseIds.length && (addedExerciseIds.length || removedExerciseIds.length)
      ? {
          detected_at: timestamp,
          added_exercise_ids: addedExerciseIds,
          removed_exercise_ids: removedExerciseIds,
        }
      : (session.program_update || null),
  };
  normalized.progress = calculateWorkoutProgress(normalized);
  normalized.recommended_next_exercise_id = Object.values(normalized.exercises)
    .sort((a, b) => a.order - b.order)
    .find((exercise) => exercise.status !== "completed")?.exercise_id || "";
  return normalized;
}

export function normalizeTimer(timer = {}) {
  const phase = ["idle", "prestart", "work", "workPaused", "restReady", "rest", "restPaused", "done"].includes(timer.phase)
    ? timer.phase
    : "idle";
  return {
    phase,
    duration_seconds: Math.max(0, Number(timer.duration_seconds ?? timer.durationSeconds) || 0),
    started_at: text(timer.started_at || timer.startedAt) || null,
    ends_at: text(timer.ends_at || timer.endsAt) || null,
    paused_at: text(timer.paused_at || timer.pausedAt) || null,
    remaining_seconds: Math.max(0, Number(timer.remaining_seconds ?? timer.remainingSeconds) || 0),
    exercise_id: text(timer.exercise_id || timer.exerciseId),
  };
}

export function timerRemainingSeconds(timer = {}, at = Date.now()) {
  const normalized = normalizeTimer(timer);
  if ((normalized.phase === "work" || normalized.phase === "rest" || normalized.phase === "prestart") && normalized.ends_at) {
    return Math.max(0, Math.ceil((new Date(normalized.ends_at).getTime() - at) / 1000));
  }
  return normalized.remaining_seconds;
}

function readStore(userId = currentUserId()) {
  const value = readUserScopedCache(WORKOUT_SESSIONS_KEY, userId, null);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { schema_version: WORKOUT_SESSION_SCHEMA_VERSION, sessions: {}, active_session_id: null };
  }
  return {
    schema_version: WORKOUT_SESSION_SCHEMA_VERSION,
    sessions: value.sessions && typeof value.sessions === "object" ? value.sessions : {},
    active_session_id: text(value.active_session_id) || null,
  };
}

function writeStore(store, userId = currentUserId()) {
  writeUserScopedCache(WORKOUT_SESSIONS_KEY, store, userId);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("fruitfit:workout-sessions-updated", { detail: store }));
  }
  return store;
}

export function listWorkoutSessions(userId = currentUserId()) {
  return Object.values(readStore(userId).sessions).sort(
    (a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime(),
  );
}

export function readWorkoutSession(sessionId, userId = currentUserId()) {
  return readStore(userId).sessions[text(sessionId)] || null;
}

export function activeWorkoutSession(userId = currentUserId()) {
  const store = readStore(userId);
  const active = store.sessions[store.active_session_id] || null;
  return active?.status === "active" ? active : null;
}

export function workoutSessionForWorkout(workoutId, userId = currentUserId()) {
  const id = text(workoutId);
  return listWorkoutSessions(userId).find(
    (session) => session.workout_id === id && session.status !== "abandoned",
  ) || null;
}

export function migrateLegacyWorkoutSession({ workout, program, userId = currentUserId() }) {
  if (typeof window === "undefined") return null;
  const workoutId = stableWorkoutId(workout);
  if (!workoutId || workoutSessionForWorkout(workoutId, userId)) return null;
  try {
    const key = `${LEGACY_SESSION_PREFIX}${workoutId}`;
    const raw = sessionStorage.getItem(key);
    const legacy = raw ? JSON.parse(raw) : null;
    if (!legacy) return null;
    const exercises = {};
    const items = Array.isArray(workout.exercises) ? workout.exercises : [];
    const completedIndexes = new Set(Array.isArray(legacy.completed) ? legacy.completed.map(Number) : []);
    items.forEach((exercise, index) => {
      const id = stableExerciseId(exercise, index);
      const completed = completedIndexes.has(index);
      const state = normalizeExerciseState({}, exercise, index);
      if (completed) {
        state.status = "completed";
        state.sets = state.sets.map((set) => ({ ...set, completed: true }));
        state.completed_at = text(legacy.savedAt ? new Date(legacy.savedAt).toISOString() : "") || nowIso();
      } else if (index === Number(legacy.currentIndex) && Number(legacy.completedSets) > 0) {
        state.status = "in_progress";
        state.sets = state.sets.map((set, setIndex) => ({ ...set, completed: setIndex < Number(legacy.completedSets) }));
      }
      exercises[id] = state;
    });
    const selected = items[Math.max(0, Number(legacy.currentIndex) || 0)];
    const migrated = reconcileWorkoutSession({
      session_id: uuid(),
      status: "active",
      selected_exercise_id: selected ? stableExerciseId(selected, Number(legacy.currentIndex) || 0) : "",
      exercises,
      timer: {
        phase: legacy.phase,
        remaining_seconds: legacy.phase === "rest" ? legacy.restSeconds : legacy.setSeconds,
        duration_seconds: legacy.phase === "rest" ? legacy.restDuration : legacy.workDuration,
      },
      updated_at: legacy.savedAt ? new Date(legacy.savedAt).toISOString() : nowIso(),
    }, { workout, program, userId });
    saveWorkoutSession(migrated, { activate: true, userId });
    sessionStorage.removeItem(key);
    return migrated;
  } catch (_) {
    return null;
  }
}

export function createWorkoutSession({ workout, program, userId = currentUserId(), status = "active" }) {
  return reconcileWorkoutSession({ session_id: uuid(), status }, { workout, program, userId });
}

export function saveWorkoutSession(session, { activate = session?.status === "active", userId = currentUserId() } = {}) {
  const id = text(session?.session_id);
  if (!id || !text(userId)) return null;
  const store = readStore(userId);
  const timestamp = nowIso();
  const nextSession = {
    ...session,
    user_id: text(userId),
    updated_at: timestamp,
    last_active_at: timestamp,
    local_version: Math.max(1, Number(session.local_version) || 0),
  };
  nextSession.progress = calculateWorkoutProgress(nextSession);
  if (activate) {
    Object.entries(store.sessions).forEach(([otherId, other]) => {
      if (otherId !== id && other.status === "active") {
        store.sessions[otherId] = { ...other, status: "paused", updated_at: timestamp };
      }
    });
    nextSession.status = "active";
    store.active_session_id = id;
  } else if (store.active_session_id === id && nextSession.status !== "active") {
    store.active_session_id = null;
  }
  store.sessions[id] = nextSession;
  writeStore(store, userId);
  return nextSession;
}

export function updateWorkoutSession(sessionId, updater, { userId = currentUserId(), activate = null } = {}) {
  const current = readWorkoutSession(sessionId, userId);
  if (!current || current.status === "completed") return current;
  const copy = typeof structuredClone === "function"
    ? structuredClone(current)
    : JSON.parse(JSON.stringify(current));
  const patch = typeof updater === "function" ? updater(copy) : updater;
  if (!patch) return current;
  const next = {
    ...current,
    ...patch,
    local_version: Math.max(1, Number(current.local_version) || 0) + 1,
    sync_status: typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "pending",
  };
  return saveWorkoutSession(next, {
    activate: activate == null ? next.status === "active" : activate,
    userId,
  });
}

export function completeWorkoutSession(sessionId, { userId = currentUserId() } = {}) {
  const current = readWorkoutSession(sessionId, userId);
  if (!current) return null;
  const timestamp = nowIso();
  return saveWorkoutSession({
    ...current,
    status: "completed",
    completed_at: timestamp,
    selected_exercise_id: current.selected_exercise_id,
    local_version: Math.max(1, Number(current.local_version) || 0) + 1,
    sync_status: "pending",
  }, { activate: false, userId });
}

export function abandonWorkoutSession(sessionId, { userId = currentUserId() } = {}) {
  return updateWorkoutSession(sessionId, { status: "abandoned", sync_status: "pending" }, { userId, activate: false });
}

export function deleteWorkoutSession(sessionId, userId = currentUserId()) {
  const store = readStore(userId);
  delete store.sessions[text(sessionId)];
  if (store.active_session_id === text(sessionId)) store.active_session_id = null;
  writeStore(store, userId);
}

export function applyServerWorkoutSession(serverSession, userId = currentUserId(), { conflict = false } = {}) {
  if (!serverSession?.session_id) return null;
  const local = readWorkoutSession(serverSession.session_id, userId);
  const incomingVersion = Number(serverSession.version || serverSession.server_version || 0);
  const incomingClientVersion = Number(
    serverSession.client_version
    || serverSession.state?.local_version
    || serverSession.local_version
    || 0,
  );
  if (local?.status === "completed" && serverSession.status !== "completed") return local;
  if (serverSession.status === "completed") {
    conflict = false;
  } else if (conflict && local) {
    return saveWorkoutSession({
      ...local,
      conflict: { server: serverSession, detected_at: nowIso() },
      sync_status: "conflict",
    }, { activate: local.status === "active", userId });
  }
  if (local && Number(local.server_version || 0) > incomingVersion) return local;
  if (
    local
    && local.sync_status !== "synced"
    && Number(local.local_version || 0) > incomingClientVersion
  ) {
    return local;
  }
  return saveWorkoutSession({
    ...(serverSession.state || serverSession),
    session_id: serverSession.session_id,
    server_version: incomingVersion,
    local_version: Math.max(incomingVersion, Number(local?.local_version || 0), 1),
    sync_status: "synced",
    last_synced_at: nowIso(),
  }, { activate: serverSession.status === "active", userId });
}
