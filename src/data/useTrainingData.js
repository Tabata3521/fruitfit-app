import { useEffect, useMemo, useState } from "react";
import { cleanTitle, decodeText } from "../utils/decodeText";
import { didacticCatalog, resolveDidacticExercise } from "./didacticExerciseData";
import { resolveExerciseVideoOverride } from "./exerciseVideoOverrides";
import { assignMuscleTemplate } from "./muscleTemplates";
import { legacyRestrictionValue, normalizeRestrictionKeys, profileDefaults } from "./profileStore";

const dataFiles = ["/data/courses.json", "/data/lessons.json", "/data/exercises.json"];

function normalizeCourse(course) {
  const title = cleanTitle(course.display_name || course.technical_name);
  return {
    ...course,
    display_name: title,
    gender: decodeText(course.gender),
    goal: decodeText(course.goal),
    level: decodeText(course.level),
    restrictions: decodeText(course.restrictions),
  };
}

function normalizeLesson(lesson) {
  return {
    ...lesson,
    lesson_title: cleanTitle(lesson.lesson_title),
    lesson_description: decodeText(lesson.lesson_description),
    training_type: decodeText(lesson.training_type),
  };
}

function muscleMapFields(exercise = {}, meta = {}) {
  const safeMeta = meta || {};
  const assetPath = exercise.muscle_map_asset_path
    || exercise.muscleMapAssetPath
    || exercise.muscle_map_url
    || exercise.muscleMapUrl
    || safeMeta.muscle_map_asset_path
    || safeMeta.muscleMapAssetPath
    || safeMeta.muscle_map_url
    || safeMeta.muscleMapUrl
    || "";
  const label = exercise.muscle_map_label
    || exercise.muscleMapLabel
    || safeMeta.muscle_map_label
    || safeMeta.muscleMapLabel
    || "";
  const key = exercise.muscle_map_key
    || exercise.muscleMapKey
    || safeMeta.muscle_map_key
    || safeMeta.muscleMapKey
    || label;
  const version = exercise.muscle_map_version
    || exercise.muscleMapVersion
    || safeMeta.muscle_map_version
    || safeMeta.muscleMapVersion
    || "";
  const revision = exercise.muscle_map_revision
    || exercise.muscleMapRevision
    || safeMeta.muscle_map_revision
    || safeMeta.muscleMapRevision
    || version;
  const hash = exercise.muscle_map_hash
    || exercise.muscleMapHash
    || safeMeta.muscle_map_hash
    || safeMeta.muscleMapHash
    || revision;
  const updatedAt = exercise.muscle_map_updated_at
    || exercise.muscleMapUpdatedAt
    || safeMeta.muscle_map_updated_at
    || safeMeta.muscleMapUpdatedAt
    || hash;

  return {
    muscle_map_asset_path: assetPath,
    muscleMapAssetPath: assetPath,
    muscle_map_url: exercise.muscle_map_url || exercise.muscleMapUrl || safeMeta.muscle_map_url || safeMeta.muscleMapUrl || assetPath,
    muscleMapUrl: exercise.muscleMapUrl || exercise.muscle_map_url || safeMeta.muscleMapUrl || safeMeta.muscle_map_url || assetPath,
    muscle_map_label: label,
    muscleMapLabel: label,
    muscle_map_key: key,
    muscleMapKey: key,
    muscle_map_version: version,
    muscleMapVersion: version,
    muscle_map_revision: revision,
    muscleMapRevision: revision,
    muscle_map_hash: hash,
    muscleMapHash: hash,
    muscle_map_updated_at: updatedAt,
    muscleMapUpdatedAt: updatedAt,
  };
}

function normalizeExercise(exercise) {
  const title = cleanTitle(exercise.exercise_name);
  const resolvedMeta = resolveDidacticExercise(title);
  const resolvedVideo = resolvedMeta?.video_url || resolvedMeta?.rfVideoUrl || resolvedMeta?.rf_video_url || resolveExerciseVideoOverride(title) || null;
  const template = assignMuscleTemplate({ ...exercise, exercise_name: title, exercise_table_meta: resolvedMeta });
  return {
    ...exercise,
    exercise_name: title,
    comment: decodeText(exercise.comment),
    raw_line: decodeText(exercise.raw_line || exercise.comment || ""),
    weight: exercise.weight || null,
    preview_url: exercise.preview_url || exercise.image_path || null,
    video_url: resolvedVideo,
    rf_video_url: resolvedVideo,
    muscle_template_id: template.id,
    ...muscleMapFields(exercise, resolvedMeta),
    exercise_table_meta: resolvedMeta || null,
    group_id: exercise.group_id || exercise.superset_id || exercise.block_id || null,
  };
}

function normalizeCatalogExercise(exercise) {
  const title = cleanTitle(exercise.exercise_name || exercise.name || "");
  const resolvedMeta = exercise || resolveDidacticExercise(title);
  const template = assignMuscleTemplate({
    exercise_name: title,
    exercise_table_meta: resolvedMeta,
  });

  return {
    ...exercise,
    id: exercise.id || exercise.source_id || title,
    exercise_name: title,
    name: title,
    video_url: exercise.video_url || exercise.rfVideoUrl || null,
    rf_video_url: exercise.rfVideoUrl || exercise.video_url || null,
    muscle_template_id: exercise.muscle_template_id || template.id,
    ...muscleMapFields(exercise, resolvedMeta),
    exercise_table_meta: resolvedMeta || null,
  };
}

function firstNonEmpty(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function numberOrFallback(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function assignmentProgramSource(assignment = {}) {
  return assignment?.program || assignment?.assignedProgram || assignment?.assigned_program || {};
}

function assignmentProgramId(assignment = {}) {
  const program = assignmentProgramSource(assignment);
  return String(firstNonEmpty(
    program.programId,
    program.program_id,
    program.courseId,
    program.course_id,
    program.id,
    assignment.programId,
    assignment.program_id,
    assignment.courseId,
    assignment.course_id,
    assignment.id
  ) || "").trim();
}

function normalizeAssignmentCourse(assignment = {}) {
  const program = assignmentProgramSource(assignment);
  const id = assignmentProgramId(assignment) || "server_program";
  const title = cleanTitle(firstNonEmpty(
    program.display_name,
    program.displayName,
    program.title,
    program.name,
    assignment.programTitle,
    assignment.program_title,
    assignment.title,
    assignment.name,
    "Персональная программа"
  ));
  const restrictionKeys = normalizeRestrictionKeys(
    firstNonEmpty(
      assignment.restrictionKeys,
      assignment.restriction_keys,
      program.restrictionKeys,
      program.restriction_keys,
      assignment.matchedRestrictions,
      assignment.matched_restrictions,
    ),
    firstNonEmpty(program.restrictions, assignment.restrictions, "none"),
  );
  return {
    ...program,
    course_id: id,
    id,
    display_name: title,
    technical_name: cleanTitle(firstNonEmpty(program.technical_name, program.technicalName, title)),
    gender: decodeText(firstNonEmpty(program.gender, assignment.gender, "")),
    goal: decodeText(firstNonEmpty(program.goal, assignment.goal, "")),
    level: decodeText(firstNonEmpty(program.level, assignment.level, "")),
    restrictionKeys,
    restrictions: legacyRestrictionValue(restrictionKeys),
  };
}

function serverWorkoutRoots(assignment = {}) {
  const program = assignmentProgramSource(assignment);
  return [
    assignment.availableWorkouts,
    assignment.available_workouts,
    assignment.visibleWorkouts,
    assignment.visible_workouts,
    program.days,
    program.workouts,
    program.lessons,
    assignment.days,
    assignment.workouts,
    assignment.lessons,
  ].filter(Array.isArray);
}

function collectServerExercises(value = {}) {
  const direct = [
    value.exercises,
    value.exerciseList,
    value.exercise_list,
    value.items,
  ].find(Array.isArray);
  if (direct) return direct;

  const groups = [
    value.blocks,
    value.exerciseBlocks,
    value.exercise_blocks,
    value.sections,
    value.supersets,
  ].filter(Array.isArray);

  return groups.flatMap((group) => group.flatMap((item) => collectServerExercises(item)));
}

function serverWorkoutId(workout = {}, index = 0) {
  const lesson = workout.lesson || workout.day || workout.workout || {};
  return String(firstNonEmpty(
    workout.workout_id,
    workout.workoutId,
    workout.day_id,
    workout.dayId,
    workout.lesson_id,
    workout.lessonId,
    workout.id,
    lesson.workout_id,
    lesson.workoutId,
    lesson.day_id,
    lesson.dayId,
    lesson.lesson_id,
    lesson.lessonId,
    lesson.id,
    `server_day_${index + 1}`
  ) || "").trim();
}

function serverWorkoutTitle(workout = {}, index = 0) {
  const lesson = workout.lesson || workout.day || workout.workout || {};
  return cleanTitle(firstNonEmpty(
    workout.lesson_title,
    workout.lessonTitle,
    workout.title,
    workout.name,
    workout.dayTitle,
    workout.day_title,
    lesson.lesson_title,
    lesson.lessonTitle,
    lesson.title,
    lesson.name,
    `День ${index + 1}`
  ));
}

function serverWorkoutLessonNumber(workout = {}, index = 0) {
  const lesson = workout.lesson || workout.day || workout.workout || {};
  const dayIndex = numberOrFallback(firstNonEmpty(workout.dayIndex, workout.day_index, lesson.dayIndex, lesson.day_index), null);
  if (dayIndex !== null) return dayIndex + 1;
  return numberOrFallback(firstNonEmpty(
    workout.lesson_number,
    workout.lessonNumber,
    workout.dayNumber,
    workout.day_number,
    workout.order,
    lesson.lesson_number,
    lesson.lessonNumber,
    lesson.dayNumber,
    lesson.day_number,
    lesson.order
  ), index + 1);
}

function normalizeServerWorkoutExercise(exercise = {}, index = 0, programId = "", lessonId = "") {
  const title = cleanTitle(firstNonEmpty(
    exercise.exercise_name,
    exercise.exerciseName,
    exercise.name,
    exercise.title,
    exercise.exercise_title,
    exercise.exerciseTitle,
    ""
  ));
  if (!title) return null;
  const resolvedMeta = resolveDidacticExercise(title);
  const resolvedVideo = exercise.video_url
    || exercise.videoUrl
    || exercise.rf_video_url
    || exercise.rfVideoUrl
    || resolvedMeta?.video_url
    || resolvedMeta?.rfVideoUrl
    || resolvedMeta?.rf_video_url
    || resolveExerciseVideoOverride(title)
    || null;
  const template = assignMuscleTemplate({
    ...exercise,
    exercise_name: title,
    exercise_table_meta: resolvedMeta,
  });
  const order = numberOrFallback(firstNonEmpty(
    exercise.exercise_order,
    exercise.exerciseOrder,
    exercise.order,
    exercise.position,
    exercise.sort,
    exercise.sort_order
  ), index + 1);
  return {
    ...exercise,
    id: firstNonEmpty(exercise.id, exercise.exercise_id, exercise.exerciseId, `${lessonId || programId}_${order}`),
    exercise_id: firstNonEmpty(exercise.exercise_id, exercise.exerciseId, exercise.id, `${lessonId || programId}_${order}`),
    course_id: firstNonEmpty(exercise.course_id, exercise.courseId, programId),
    lesson_id: firstNonEmpty(exercise.lesson_id, exercise.lessonId, lessonId),
    exercise_order: order,
    exercise_name: title,
    name: title,
    sets: firstNonEmpty(exercise.sets, exercise.setCount, exercise.set_count, exercise.plan?.sets, ""),
    reps: firstNonEmpty(exercise.reps, exercise.repetitions, exercise.repRange, exercise.rep_range, exercise.plan?.reps, ""),
    weight: firstNonEmpty(exercise.weight, exercise.weightText, exercise.weight_text, exercise.plan?.weight, null),
    rest: firstNonEmpty(exercise.rest, exercise.restSeconds, exercise.rest_seconds, exercise.plan?.rest, null),
    comment: decodeText(firstNonEmpty(exercise.comment, exercise.notes, exercise.note, "")),
    raw_line: decodeText(firstNonEmpty(exercise.raw_line, exercise.rawLine, exercise.comment, exercise.notes, "")),
    preview_url: firstNonEmpty(exercise.preview_url, exercise.previewUrl, exercise.image_path, exercise.imagePath, null),
    video_url: resolvedVideo,
    rf_video_url: resolvedVideo,
    muscle_template_id: exercise.muscle_template_id || exercise.muscleTemplateId || template.id,
    ...muscleMapFields(exercise, resolvedMeta),
    exercise_table_meta: resolvedMeta || exercise.exercise_table_meta || exercise.exerciseTableMeta || null,
    group_id: firstNonEmpty(exercise.group_id, exercise.groupId, exercise.superset_id, exercise.supersetId, exercise.block_id, exercise.blockId, null),
  };
}

function normalizeServerWorkout(workout = {}, index = 0, course, lessons = []) {
  const lessonNumber = serverWorkoutLessonNumber(workout, index);
  const lessonId = serverWorkoutId(workout, index);
  const title = serverWorkoutTitle(workout, index);
  const lesson = {
    ...(workout.lesson || workout.day || {}),
    lesson_id: lessonId,
    id: lessonId,
    course_id: course.course_id,
    lesson_number: lessonNumber,
    lesson_title: title,
    lesson_description: decodeText(firstNonEmpty(
      workout.lesson_description,
      workout.lessonDescription,
      workout.description,
      workout.notes,
      workout.lesson?.lesson_description,
      workout.lesson?.description,
      ""
    )),
    training_type: decodeText(firstNonEmpty(workout.training_type, workout.trainingType, workout.type, "")),
  };
  const exercises = collectServerExercises(workout)
    .map((exercise, exerciseIndex) => normalizeServerWorkoutExercise(exercise, exerciseIndex, course.course_id, lessonId))
    .filter(Boolean)
    .sort((a, b) => Number(a.exercise_order) - Number(b.exercise_order));
  const grouped = exercises.reduce((acc, exercise) => {
    if (!exercise.group_id) return acc;
    acc[exercise.group_id] = acc[exercise.group_id] || [];
    acc[exercise.group_id].push(exercise);
    return acc;
  }, {});
  const superset = Object.values(grouped).find((group) => group.length > 1) || [];
  return {
    ...workout,
    index,
    dayIndex: index,
    day_index: index,
    program_id: course.course_id,
    course_id: course.course_id,
    workout_id: lessonId,
    workoutId: lessonId,
    lesson_id: lessonId,
    lessonId: lessonId,
    title,
    course,
    lessons,
    lesson,
    exercises,
    currentExercise: exercises[0],
    completedCount: 0,
    progress: 0,
    superset,
    hasSupersetData: superset.length > 1,
    totals: {
      programs: 1,
      workouts: lessons.length,
      exercises: exercises.length,
    },
    source: "server_assignment",
  };
}

function chooseServerWorkoutRoot(assignment = {}) {
  const roots = serverWorkoutRoots(assignment);
  if (!roots.length) return [];
  return roots
    .map((items) => ({
      items,
      score: items.length * 10 + items.reduce((sum, item) => sum + collectServerExercises(item).length * 5 + (serverWorkoutTitle(item) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score)[0]?.items || [];
}

export function buildAssignmentProgramView(assignment = null, lessonIndex = 0, fallbackData = null) {
  if (!assignment || typeof assignment !== "object") return null;
  const rawWorkouts = chooseServerWorkoutRoot(assignment);
  if (!rawWorkouts.length) return null;

  const course = normalizeAssignmentCourse(assignment);
  const lessons = rawWorkouts.map((workout, index) => ({
    ...(workout.lesson || workout.day || {}),
    lesson_id: serverWorkoutId(workout, index),
    id: serverWorkoutId(workout, index),
    course_id: course.course_id,
    lesson_number: serverWorkoutLessonNumber(workout, index),
    lesson_title: serverWorkoutTitle(workout, index),
    lesson_description: decodeText(firstNonEmpty(workout.lesson_description, workout.lessonDescription, workout.description, "")),
    training_type: decodeText(firstNonEmpty(workout.training_type, workout.trainingType, workout.type, "")),
  }));
  const workouts = rawWorkouts.map((workout, index) => normalizeServerWorkout(workout, index, course, lessons));
  workouts.forEach((workout, index) => {
    workout.nextLesson = lessons[index + 1];
    workout.totals = {
      programs: fallbackData?.courses?.length || 1,
      workouts: workouts.length,
      exercises: workouts.reduce((sum, item) => sum + item.exercises.length, 0),
    };
  });

  const safeIndex = Math.max(0, Math.min(Number(lessonIndex) || 0, Math.max(workouts.length - 1, 0)));
  return {
    course,
    assignment,
    workouts,
    selectedWorkout: workouts[safeIndex],
    selectedWorkoutIndex: safeIndex,
    source: "server_assignment",
    exerciseCatalog: [
      ...(Array.isArray(fallbackData?.exercises) ? fallbackData.exercises : []),
      ...(Array.isArray(didacticCatalog) ? didacticCatalog.map(normalizeCatalogExercise) : []),
      ...workouts.flatMap((workout) => workout.exercises),
    ],
  };
}

function lowerTitle(course) {
  return cleanTitle(course.display_name || course.technical_name || "").toLowerCase();
}

function courseMeta(course) {
  const tech = String(course.technical_name || "").toLowerCase();
  const title = lowerTitle(course);
  const text = `${tech} ${title}`;
  return {
    gender: text.includes("муж") ? "male" : text.includes("жен") ? "female" : "",
    goal: text.includes("похуд") || text.includes("подхуд")
      ? "weight_loss"
      : text.includes("набор_мышц") || text.includes("массонабор") || text.includes("набор")
        ? "muscle_gain"
        : text.includes("поддерж") ? "maintain" : "",
    workoutsPerWeek: text.includes("три_тренировки") || text.includes("три тренировки") ? 3 : text.includes("две_тренировки") || text.includes("две тренировки") ? 2 : null,
    limitation: text.includes("колен")
      ? "knees"
      : text.includes("спин")
        ? "back"
        : text.includes("плеч")
          ? "shoulders"
          : text.includes("тазобедрен") || text.includes("тбс")
            ? "hips"
            : text.includes("без_ограничений") || text.includes("без ограничений")
              ? "none"
              : "",
    level: text.includes("опыт") ? "experienced" : text.includes("начина") ? "beginner" : "",
  };
}

function profileSelection(profile) {
  const goalText = String(profile.goal || "").toLowerCase();
  const restrictionKeys = normalizeRestrictionKeys(profile.restrictionKeys, profile.restrictions);
  const experienceText = String(profile.experience || "").toLowerCase();
  return {
    gender: profile.gender === "male" ? "male" : "female",
    goal: goalText.includes("похуд") || goalText.includes("рекомп")
      ? "weight_loss"
      : goalText.includes("масс") || goalText.includes("атлет")
        ? "muscle_gain"
        : "maintain",
    workoutsPerWeek: String(profile.trainingFrequency || "").startsWith("3") ? 3 : 2,
    limitation: restrictionKeys.find((key) => key !== "none") || "none",
    restrictionKeys,
    level: experienceText.includes("нов") || experienceText.includes("нет") ? "beginner" : "experienced",
  };
}

function goalTerm(goal) {
  const text = String(goal || "").toLowerCase();
  if (text.includes("масс") || text.includes("атлет")) return "массонабор";
  if (text.includes("похуд") || text.includes("рекомп")) return "похуд";
  return "поддерж";
}

function frequencyTerm(trainingFrequency) {
  return String(trainingFrequency || "").startsWith("2") ? "две тренировки" : "три тренировки";
}

function restrictionTerms(value, legacyValue = null) {
  const keys = normalizeRestrictionKeys(value, legacyValue);
  const terms = {
    none: ["без ограничений"],
    knees: ["колен"],
    back: ["спин", "пояс"],
    shoulders: ["плеч"],
    hips: ["таз", "тбс", "бедр"],
  };
  return keys.flatMap((key) => terms[key] || []);
}

function scoreCourse(course, profile) {
  const title = lowerTitle(course);
  const genderTerm = profile.gender === "male" ? "мужская" : "женская";
  const oppositeGender = profile.gender === "male" ? "женская" : "мужская";
  const restrictionKeys = normalizeRestrictionKeys(profile.restrictionKeys, profile.restrictions);
  const terms = restrictionTerms(restrictionKeys);
  let score = 0;

  if (title.includes(genderTerm)) score += 120;
  if (title.includes(oppositeGender)) score -= 160;
  if (title.includes(goalTerm(profile.goal))) score += 44;
  if (title.includes(frequencyTerm(profile.trainingFrequency))) score += 34;
  if (terms.length && terms.some((term) => title.includes(term))) score += 18;
  if (!restrictionKeys.includes("none") && title.includes("без ограничений")) score -= 5;
  if (title.includes("программа")) score += 3;

  return score;
}

function selectCourse(data, profileInput = {}, assignedProgramId = "") {
  if (assignedProgramId) {
    const assigned = data.courses.find((course) => String(course.course_id || course.id) === String(assignedProgramId));
    if (assigned) return assigned;
  }

  const profile = { ...profileDefaults, ...profileInput };
  const selection = profileSelection(profile);
  const exact = data.courses.find((course) => {
    const meta = courseMeta(course);
    return meta.gender === selection.gender
      && meta.goal === selection.goal
      && meta.workoutsPerWeek === selection.workoutsPerWeek
      && meta.limitation === selection.limitation
      && meta.level === selection.level;
  });
  if (exact) return exact;

  const scored = data.courses
    .map((course) => ({ course, score: scoreCourse(course, profile) }))
    .sort((a, b) => b.score - a.score);

  return scored[0]?.score > 0
    ? scored[0].course
    : data.courses.find((course) => lowerTitle(course).includes(profile.gender === "male" ? "мужская" : "женская")) || data.courses[0];
}

export function useTrainingData() {
  const [state, setState] = useState({ loading: true, error: "", data: null });

  useEffect(() => {
    let mounted = true;

    Promise.all(dataFiles.map((url) => fetch(url).then((response) => {
      if (!response.ok) throw new Error(`Не удалось загрузить ${url}`);
      return response.json();
    })))
      .then(([coursesRaw, lessonsRaw, exercisesRaw]) => {
        if (!mounted) return;
        const courses = coursesRaw.map(normalizeCourse);
        const lessons = lessonsRaw.map(normalizeLesson);
        const exercises = exercisesRaw.map(normalizeExercise);
        setState({ loading: false, error: "", data: { courses, lessons, exercises } });
      })
      .catch((error) => {
        if (mounted) setState({ loading: false, error: error.message, data: null });
      });

    return () => {
      mounted = false;
    };
  }, []);

  return useMemo(() => state, [state]);
}

export function buildWorkoutView(data, courseIndex = 0, lessonIndex = 0) {
  if (!data) return null;

  const course = typeof courseIndex === "string"
    ? data.courses.find((item) => item.course_id === courseIndex) || data.courses[0]
    : data.courses[courseIndex] || data.courses[0];
  const courseLessons = data.lessons
    .filter((lesson) => lesson.course_id === course.course_id)
    .sort((a, b) => Number(a.lesson_number) - Number(b.lesson_number));
  const lesson = courseLessons[lessonIndex] || courseLessons[0];
  const exercises = data.exercises
    .filter((exercise) => exercise.course_id === course.course_id && exercise.lesson_id === lesson.lesson_id)
    .sort((a, b) => Number(a.exercise_order) - Number(b.exercise_order));

  const currentExercise = exercises[1] || exercises[0];
  const completedCount = Math.min(1, exercises.length);
  const progress = exercises.length ? Math.round((completedCount / exercises.length) * 100) : 0;
  const grouped = exercises.reduce((acc, exercise) => {
    if (!exercise.group_id) return acc;
    acc[exercise.group_id] = acc[exercise.group_id] || [];
    acc[exercise.group_id].push(exercise);
    return acc;
  }, {});
  const superset = Object.values(grouped).find((group) => group.length > 1) || [];

  return {
    program_id: course.course_id,
    workout_id: lesson.lesson_id,
    course,
    lessons: courseLessons,
    lesson,
    exercises,
    currentExercise,
    completedCount,
    progress,
    superset,
    hasSupersetData: superset.length > 1,
    nextLesson: courseLessons[lessonIndex + 1],
    totals: {
      programs: data.courses.length,
      workouts: data.lessons.length,
      exercises: data.exercises.length,
    },
  };
}

export function buildProgramView(data, lessonIndex = 0, profile = profileDefaults, assignedProgramId = "") {
  if (!data) return null;

  const restrictionKeys = normalizeRestrictionKeys(profile.restrictionKeys, profile.restrictions);
  const baseCourse = selectCourse(data, profile, assignedProgramId);
  const course = {
    ...baseCourse,
    restrictionKeys,
    restrictions: legacyRestrictionValue(restrictionKeys),
  };
  const lessons = data.lessons
    .filter((lesson) => lesson.course_id === course.course_id)
    .sort((a, b) => Number(a.lesson_number) - Number(b.lesson_number));

  const workouts = lessons.map((lesson, index) => {
    const exercises = data.exercises
      .filter((exercise) => exercise.course_id === course.course_id && exercise.lesson_id === lesson.lesson_id)
      .filter((exercise) => {
        if (restrictionKeys.includes("none")) return true;
        const blockedFor = normalizeRestrictionKeys(
          exercise.exercise_table_meta?.restrictions ?? exercise.restrictions,
          exercise.exercise_table_meta?.restrictions_raw,
        ).filter((key) => key !== "none");
        return !blockedFor.some((key) => restrictionKeys.includes(key));
      })
      .sort((a, b) => Number(a.exercise_order) - Number(b.exercise_order));
    const grouped = exercises.reduce((acc, exercise) => {
      if (!exercise.group_id) return acc;
      acc[exercise.group_id] = acc[exercise.group_id] || [];
      acc[exercise.group_id].push(exercise);
      return acc;
    }, {});
    const superset = Object.values(grouped).find((group) => group.length > 1) || [];
    return {
      index,
      program_id: course.course_id,
      workout_id: lesson.lesson_id,
      course,
      lessons,
      lesson,
      exercises,
      currentExercise: exercises[0],
      completedCount: 0,
      progress: 0,
      superset,
      hasSupersetData: superset.length > 1,
      nextLesson: lessons[index + 1],
      totals: {
        programs: data.courses.length,
        workouts: data.lessons.length,
        exercises: data.exercises.length,
      },
    };
  });

  const safeIndex = Math.max(0, Math.min(lessonIndex, Math.max(workouts.length - 1, 0)));

  return {
    course,
    assignment: assignedProgramId ? { programId: assignedProgramId, active: String(course.course_id || course.id) === String(assignedProgramId) } : null,
    workouts,
    selectedWorkout: workouts[safeIndex],
    selectedWorkoutIndex: safeIndex,
    exerciseCatalog: [
      ...(Array.isArray(data.exercises) ? data.exercises : []),
      ...(Array.isArray(didacticCatalog) ? didacticCatalog.map(normalizeCatalogExercise) : []),
    ],
  };
}
