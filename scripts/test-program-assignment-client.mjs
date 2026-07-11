import assert from "node:assert/strict";
import fs from "node:fs";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });

try {
  const training = await vite.ssrLoadModule("/src/data/useTrainingData.js");
  const access = await vite.ssrLoadModule("/src/data/accessRules.js");
  const selection = await vite.ssrLoadModule("/src/data/workoutSelection.js");
  const data = {
    courses: JSON.parse(fs.readFileSync("public/data/courses.json", "utf8")),
    lessons: JSON.parse(fs.readFileSync("public/data/lessons.json", "utf8")),
    exercises: JSON.parse(fs.readFileSync("public/data/exercises.json", "utf8")),
  };
  const customProgramId = "custom_program_test";
  const days = Array.from({ length: 12 }, (_, index) => ({
    id: index === 5 ? "day_1782585966188_932650c39439f" : `custom_day_${index + 1}`,
    title: `Custom day ${index + 1}`,
    dayIndex: index + 1,
    exercises: [{ id: `exercise_${index + 1}`, name: `Exercise ${index + 1}`, sets: 3, reps: 10 }],
  }));
  const assignment = {
    programId: customProgramId,
    program: { program_id: customProgramId, title: "Custom program", days },
    availableWorkouts: days,
    currentWorkout: { ...days[2], workoutId: days[2].id },
    visibleWorkoutCount: 12,
    accessRules: { visibleWorkoutLimit: 12 },
  };

  const selectedIds = [0, 2, 5, 11].map((index) => training.buildAssignmentProgramView(assignment, index, data).selectedWorkout.workout_id);
  assert.deepEqual(selectedIds, ["custom_day_1", "custom_day_3", "day_1782585966188_932650c39439f", "custom_day_12"]);
  assert.equal(training.buildAssignmentProgramView(assignment, 5, data).selectedWorkout.exercises[0].exercise_name, "Exercise 6");

  const fullProgram = training.buildAssignmentProgramView(assignment, 0, data);
  assert.equal(access.getClientVisibleWorkouts({ workouts: fullProgram.workouts, access: { billingStatus: "free" }, assignment: { accessRules: { visibleWorkoutLimit: 3 } } }).length, 3);
  assert.equal(access.getClientVisibleWorkouts({ workouts: fullProgram.workouts, access: { billingStatus: "vip", isVip: true }, assignment }).length, 12);

  const previewWorkouts = fullProgram.workouts.slice(0, 3);
  assert.equal(selection.selectedWorkoutStateIndex(previewWorkouts, {
    workoutId: previewWorkouts[2].workout_id,
    programId: "server-program-alias",
    dayIndex: 2,
  }, customProgramId), 2);
  assert.equal(selection.selectedWorkoutStateIndex(previewWorkouts, {
    workoutId: previewWorkouts[1].workout_id,
    programId: "client-program-alias",
    dayIndex: 1,
  }, customProgramId), 1);
  assert.equal(selection.selectedWorkoutStateIndex(previewWorkouts, {
    workoutId: previewWorkouts[0].workout_id,
    programId: "client-program-alias",
    dayIndex: 0,
  }, customProgramId), 0);
  assert.equal(selection.selectedWorkoutStateIndex(previewWorkouts, {
    workoutId: "workout-from-another-program",
    programId: "other-program",
    dayIndex: 0,
  }, customProgramId), -1);
  console.log("program assignment client tests: PASS");
} finally {
  await vite.close();
}
