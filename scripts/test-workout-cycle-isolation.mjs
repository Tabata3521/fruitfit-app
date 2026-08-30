import assert from "node:assert/strict";
import { createServer } from "vite";

class MemoryStorage {
  constructor() { this.values = new Map(); }
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
  constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
};
globalThis.window = {
  dispatchEvent() {},
  addEventListener() {},
  removeEventListener() {},
};

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });

try {
  const sessions = await vite.ssrLoadModule("/src/data/workoutSessions.js");
  const completion = await vite.ssrLoadModule("/src/data/workoutCompletion.js");
  const cycle = await vite.ssrLoadModule("/src/data/workoutCycle.js");
  const selection = await vite.ssrLoadModule("/src/data/workoutSelection.js");
  const weights = await vite.ssrLoadModule("/src/utils/exerciseWeights.js");

  const userId = "cycle-isolation-user";
  const otherUserId = "cycle-isolation-other-user";
  const cycle1 = { cycleId: "cycle-12", cycleNumber: 1, accessFrom: "2026-07-29T00:00:00.000Z", accessUntil: "2026-08-28T00:00:00.000Z" };
  const cycle2 = { cycleId: "cycle-14", cycleNumber: 2, accessFrom: "2026-08-28T00:00:00.000Z", accessUntil: "2026-09-27T00:00:00.000Z" };
  const numberedCycle1 = { cycleNumber: 1, accessFrom: "2026-07-29T00:00:00.000Z" };
  const numberedCycle2 = { cycleNumber: 2, accessFrom: "2026-08-28T00:00:00.000Z" };
  const datedCycle2 = { accessFrom: "2026-08-28T00:00:00.000Z" };
  const workout = {
    workout_id: "same-workout-id",
    program_id: "same-program-id",
    lesson: { lesson_id: "same-day-id", lesson_title: "Одна и та же тренировка" },
    exercises: [{ exercise_id: "same-exercise-id", exercise_order: 1, exercise_name: "Жим", sets: 2, reps: 10 }],
  };
  const program = { program_id: "same-program-id", workouts: [workout] };

  localStorage.setItem("fruitfit.authUser", JSON.stringify({ id: userId }));

  // A: completing the first cycle never makes the identical workout completed in cycle 2.
  let first = sessions.createWorkoutSession({ workout, program, userId, cycle: cycle1 });
  first = sessions.saveWorkoutSession(first, { activate: true, userId });
  first = sessions.updateWorkoutSession(first.session_id, (draft) => {
    draft.exercises["same-exercise-id"].sets = draft.exercises["same-exercise-id"].sets.map((set) => ({ ...set, completed: true }));
    draft.exercises["same-exercise-id"].status = "completed";
    return draft;
  }, { userId, activate: true });
  first = sessions.completeWorkoutSession(first.session_id, { userId });
  completion.markWorkoutCompleted(workout.workout_id, { completedAt: "2026-08-27T10:00:00.000Z" }, cycle1, userId);
  assert.equal(completion.isWorkoutCompleted(workout.workout_id, cycle1, userId), true);
  assert.equal(completion.isWorkoutCompleted(workout.workout_id, cycle2, userId), false);
  const second = sessions.createWorkoutSession({ workout, program, userId, cycle: cycle2 });
  assert.equal(second.subscription_cycle_id, cycle2.cycleId);
  assert.equal(second.progress.completed_sets, 0);
  assert.equal(sessions.workoutSessionForWorkout(workout.workout_id, userId, cycle2), null);
  const numberedFirst = sessions.createWorkoutSession({ workout, program, userId, cycle: numberedCycle1 });
  sessions.saveWorkoutSession(numberedFirst, { activate: false, userId });
  assert.equal(sessions.workoutSessionForWorkout(workout.workout_id, userId, numberedCycle2), null);

  // B: a legacy session saved during the currently active cycle migrates without losing progress.
  const legacySession = sessions.createWorkoutSession({ workout, program, userId });
  legacySession.started_at = "2026-08-29T10:00:00.000Z";
  legacySession.updated_at = "2026-08-29T10:00:00.000Z";
  legacySession.exercises["same-exercise-id"].sets[0].completed = true;
  legacySession.exercises["same-exercise-id"].status = "in_progress";
  sessions.saveWorkoutSession(legacySession, { activate: false, userId });
  const migrated = sessions.workoutSessionForWorkout(workout.workout_id, userId, cycle2);
  assert.equal(migrated.subscription_cycle_id, cycle2.cycleId);
  assert.equal(migrated.exercises["same-exercise-id"].sets[0].completed, true);

  // C: both cycle histories remain present; no destructive reset occurred.
  const storedCycles = sessions.listWorkoutSessions(userId).map((item) => item.subscription_cycle_id).filter(Boolean);
  assert.ok(storedCycles.includes(cycle1.cycleId));
  assert.ok(storedCycles.includes(cycle2.cycleId));

  // D: strength memory is deliberately global by exercise id, independent of cycle.
  weights.saveExerciseWeight({ exercise_id: "same-exercise-id" }, 80, 1);
  assert.equal(weights.getExerciseWeight({ exercise_id: "same-exercise-id" }, 1).lastWeight, 80);

  // E: a draft from cycle 1 cannot be selected as cycle 2, even with identical program/workout ids.
  assert.equal(selection.selectedWorkoutStateIndex(
    [workout],
    { workoutId: workout.workout_id, programId: program.program_id, subscription_cycle_id: cycle1.cycleId, dayIndex: 0 },
    program.program_id,
    cycle2,
  ), -1);
  assert.equal(selection.selectedWorkoutStateIndex(
    [workout],
    { workoutId: workout.workout_id, programId: program.program_id, subscription_cycle_id: cycle2.cycleId, dayIndex: 0 },
    program.program_id,
    cycle2,
  ), 0);

  // F: logout/login remains isolated by user-scoped storage.
  assert.equal(sessions.listWorkoutSessions(otherUserId).length, 0);
  assert.equal(completion.isWorkoutCompleted(workout.workout_id, cycle1, otherUserId), false);

  // Legacy completed state before the new cycle is never attributed to the new cycle.
  assert.equal(cycle.legacyStateBelongsToCycle({ completedAt: "2026-08-27T10:00:00.000Z" }, cycle2), false);
  assert.equal(cycle.legacyStateBelongsToCycle({ completedAt: "2026-08-29T10:00:00.000Z" }, cycle2), true);

  // Access-date-only contracts still isolate cycles and safely migrate current legacy state.
  assert.equal(cycle.cycleIdentity(datedCycle2), "cycle-from:2026-08-28T00:00:00.000Z");
  assert.equal(cycle.legacyStateBelongsToCycle({ updatedAt: "2026-08-29T10:00:00.000Z" }, datedCycle2), true);
  assert.equal(cycle.legacyStateBelongsToCycle({ updatedAt: "2026-08-27T10:00:00.000Z" }, datedCycle2), false);

  // A new number-only cycle must not retain an ID from the previous cycle.
  const renormalized = cycle.withWorkoutCycle({
    subscription_cycle_id: cycle1.cycleId,
    subscription_cycle_number: cycle1.cycleNumber,
  }, numberedCycle2);
  assert.equal(renormalized.subscription_cycle_id, null);
  assert.equal(renormalized.subscription_cycle_number, numberedCycle2.cycleNumber);
  assert.equal(cycle.cycleIdentity(renormalized), "cycle-number:2");

  console.log("workout cycle isolation tests: PASS (A-F + legacy/access-date normalization)");
} finally {
  await vite.close();
}
