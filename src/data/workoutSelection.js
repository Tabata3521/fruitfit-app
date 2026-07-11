function clean(value) {
  return String(value || "").trim();
}

function workoutIds(workout = {}) {
  const lesson = workout?.lesson || workout?.day || workout?.workout || {};
  return [
    workout?.workout_id,
    workout?.workoutId,
    workout?.id,
    workout?.lesson_id,
    workout?.lessonId,
    lesson?.workout_id,
    lesson?.workoutId,
    lesson?.lesson_id,
    lesson?.lessonId,
    lesson?.id,
  ].map(clean).filter(Boolean);
}

function workoutTitle(workout = {}) {
  const lesson = workout?.lesson || workout?.day || workout?.workout || {};
  return clean(
    workout?.title
    || workout?.name
    || workout?.lessonTitle
    || workout?.lesson_title
    || lesson?.lesson_title
    || lesson?.title
    || lesson?.name
  ).toLowerCase();
}

export function selectedWorkoutStateIndex(workouts = [], state = null, programId = "") {
  const items = Array.isArray(workouts) ? workouts : [];
  if (!items.length || !state || typeof state !== "object") return -1;

  const selectedId = clean(state.workoutId || state.workout_id || state.lessonId || state.lesson_id);
  if (selectedId) {
    const idIndex = items.findIndex((item) => workoutIds(item).includes(selectedId));
    if (idIndex >= 0) return idIndex;
  }

  const selectedProgramId = clean(state.programId || state.program_id);
  const activeProgramId = clean(programId);
  if (selectedProgramId && activeProgramId && selectedProgramId !== activeProgramId) return -1;

  const selectedTitle = clean(state.title || state.lessonTitle || state.lesson_title).toLowerCase();
  if (selectedTitle) {
    const titleIndex = items.findIndex((item) => workoutTitle(item) === selectedTitle);
    if (titleIndex >= 0) return titleIndex;
  }

  const dayIndex = Number(state.dayIndex ?? state.selectedWorkoutIndex ?? state.index);
  return Number.isFinite(dayIndex) && dayIndex >= 0 && items[Math.floor(dayIndex)]
    ? Math.floor(dayIndex)
    : -1;
}
