import assert from "node:assert/strict";
import { createServer } from "vite";

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.has(String(key)) ? this.values.get(String(key)) : null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
  clear() { this.values.clear(); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();
globalThis.CustomEvent = class CustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
};
globalThis.window = {
  dispatchEvent() {},
  addEventListener() {},
  removeEventListener() {},
};

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });

try {
  const sessions = await vite.ssrLoadModule("/src/data/workoutSessions.js");
  const userId = "workout-session-test-user";
  localStorage.setItem("fruitfit.authUser", JSON.stringify({ id: userId }));
  const workout = {
    workout_id: "day-1",
    program_id: "program-1",
    lesson: { lesson_id: "lesson-1", lesson_title: "Грудь и спина" },
    exercises: Array.from({ length: 8 }, (_, index) => ({
      exercise_id: `exercise-${index + 1}`,
      exercise_order: index + 1,
      exercise_name: `Упражнение ${index + 1}`,
      sets: 4,
      reps: 10,
    })),
  };
  const program = { program_id: "program-1", workouts: [workout] };

  let session = sessions.createWorkoutSession({ workout, program, userId });
  session = sessions.saveWorkoutSession(session, { activate: true, userId });
  const firstId = sessions.stableExerciseId(workout.exercises[0], 0);
  const lastId = sessions.stableExerciseId(workout.exercises[7], 7);

  // 1-5: local-first persistence, reload, navigation and date independence.
  session = sessions.updateWorkoutSession(session.session_id, (draft) => {
    draft.exercises[firstId].sets[0].completed = true;
    draft.exercises[firstId].sets[0].weight = 40;
    draft.exercises[firstId].status = "in_progress";
    return draft;
  }, { userId, activate: true });
  assert.equal(sessions.readWorkoutSession(session.session_id, userId).exercises[firstId].sets[0].weight, 40);
  assert.equal(sessions.activeWorkoutSession(userId).session_id, session.session_id);
  assert.equal(sessions.workoutSessionForWorkout("day-1", userId).session_id, session.session_id);
  assert.equal(session.started_at, sessions.readWorkoutSession(session.session_id, userId).started_at);

  // 6-8: arbitrary exercise selection does not imply completion.
  session = sessions.updateWorkoutSession(session.session_id, {
    selected_exercise_id: lastId,
    last_opened_exercise_id: lastId,
  }, { userId, activate: true });
  assert.equal(session.exercises[lastId].status, "not_started");
  assert.equal(session.progress.completed_sets, 1);
  session = sessions.updateWorkoutSession(session.session_id, (draft) => {
    draft.exercises[lastId].sets[0].completed = true;
    draft.exercises[lastId].status = "in_progress";
    return draft;
  }, { userId, activate: true });
  assert.equal(session.exercises[firstId].status, "in_progress");
  assert.equal(session.exercises[lastId].status, "in_progress");

  // 9: skipped exercise can later be completed.
  session = sessions.updateWorkoutSession(session.session_id, (draft) => {
    draft.exercises["exercise-2"].status = "skipped";
    return draft;
  }, { userId, activate: true });
  session = sessions.updateWorkoutSession(session.session_id, (draft) => {
    draft.exercises["exercise-2"].sets = draft.exercises["exercise-2"].sets.map((set) => ({ ...set, completed: true }));
    draft.exercises["exercise-2"].status = "completed";
    return draft;
  }, { userId, activate: true });
  assert.equal(session.exercises["exercise-2"].status, "completed");

  // 10-11: absolute timer survives background/process death and expires correctly.
  const futureTimer = { phase: "rest", ends_at: new Date(Date.now() + 45_000).toISOString(), duration_seconds: 90 };
  assert.ok(sessions.timerRemainingSeconds(futureTimer) >= 44);
  assert.equal(sessions.timerRemainingSeconds({ ...futureTimer, ends_at: new Date(Date.now() - 1_000).toISOString() }), 0);

  // 12-16: multiple drafts, exactly one active session and explicit reset data.
  const workout2 = { ...workout, workout_id: "day-2", lesson: { lesson_id: "lesson-2", lesson_title: "Ноги" } };
  let second = sessions.createWorkoutSession({ workout: workout2, program, userId, status: "paused" });
  second = sessions.saveWorkoutSession(second, { activate: false, userId });
  assert.equal(sessions.activeWorkoutSession(userId).session_id, session.session_id);
  second = sessions.saveWorkoutSession({ ...second, status: "active" }, { activate: true, userId });
  assert.equal(sessions.activeWorkoutSession(userId).session_id, second.session_id);
  assert.equal(sessions.readWorkoutSession(session.session_id, userId).status, "paused");
  assert.equal(sessions.listWorkoutSessions(userId).length, 2);

  // 17: server program edits preserve removed exercise progress and add new items.
  const changedWorkout = {
    ...workout,
    exercises: [
      ...workout.exercises.slice(1),
      { exercise_id: "exercise-new", exercise_order: 9, exercise_name: "Новое упражнение", sets: 3 },
    ],
  };
  const reconciled = sessions.reconcileWorkoutSession(session, { workout: changedWorkout, program, userId });
  assert.equal(reconciled.exercises[firstId].removed_from_program, true);
  assert.equal(reconciled.exercises["exercise-new"].status, "not_started");

  // 18: drafts are isolated by user id.
  assert.equal(sessions.listWorkoutSessions("another-user").length, 0);

  // 19: legacy index-based session migrates without losing completed work.
  const legacyUser = "legacy-user";
  localStorage.setItem("fruitfit.authUser", JSON.stringify({ id: legacyUser }));
  sessionStorage.setItem("fruitfit.workout.sessionProgress:day-1", JSON.stringify({
    workoutId: "day-1",
    currentIndex: 2,
    completed: [0, 1],
    completedSets: 2,
    savedAt: Date.now(),
  }));
  const migrated = sessions.migrateLegacyWorkoutSession({ workout, program, userId: legacyUser });
  assert.equal(migrated.progress.completed_exercises, 2);
  assert.equal(migrated.exercises["exercise-3"].sets.filter((set) => set.completed).length, 2);

  // 20-22: completed is terminal, duplicate writes retain id, stale server state cannot overwrite local changes.
  let completed = sessions.completeWorkoutSession(migrated.session_id, { userId: legacyUser });
  assert.equal(sessions.activeWorkoutSession(legacyUser), null);
  const duplicate = sessions.saveWorkoutSession(completed, { activate: false, userId: legacyUser });
  assert.equal(duplicate.session_id, completed.session_id);
  completed = sessions.saveWorkoutSession({ ...completed, sync_status: "pending", local_version: 20 }, { activate: false, userId: legacyUser });
  const stale = sessions.applyServerWorkoutSession({
    session_id: completed.session_id,
    status: "active",
    version: 2,
    client_version: 2,
    state: { ...completed, status: "active", local_version: 2 },
  }, legacyUser);
  assert.equal(stale.status, "completed");

  // 23-24: a successful server acknowledgement is not a conflict; a real 409 is.
  localStorage.setItem("fruitfit.authUser", JSON.stringify({ id: userId }));
  const pending = sessions.saveWorkoutSession({
    ...second,
    local_version: 7,
    server_version: 0,
    sync_status: "syncing",
  }, { activate: true, userId });
  const acknowledged = sessions.applyServerWorkoutSession({
    session_id: pending.session_id,
    status: "active",
    version: 1,
    client_version: 7,
    state: pending,
  }, userId);
  assert.equal(acknowledged.sync_status, "synced");
  const conflicted = sessions.applyServerWorkoutSession({
    session_id: pending.session_id,
    status: "active",
    version: 2,
    client_version: 8,
    state: { ...pending, local_version: 8 },
  }, userId, { conflict: true });
  assert.equal(conflicted.sync_status, "conflict");

  console.log("workout session tests: PASS (24 scenarios)");
} finally {
  await vite.close();
}
