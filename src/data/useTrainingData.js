import { useEffect, useMemo, useState } from "react";
import { cleanTitle, decodeText } from "../utils/decodeText";
import { didacticCatalog, resolveDidacticExercise } from "./didacticExerciseData";
import { resolveExerciseVideoOverride } from "./exerciseVideoOverrides";
import { assignMuscleTemplate } from "./muscleTemplates";
import { profileDefaults } from "./profileStore";

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
    exercise_table_meta: resolvedMeta || null,
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
  const restrictionText = String(profile.restrictions || "").toLowerCase();
  const experienceText = String(profile.experience || "").toLowerCase();
  return {
    gender: profile.gender === "male" ? "male" : "female",
    goal: goalText.includes("похуд") || goalText.includes("рекомп")
      ? "weight_loss"
      : goalText.includes("масс") || goalText.includes("атлет")
        ? "muscle_gain"
        : "maintain",
    workoutsPerWeek: String(profile.trainingFrequency || "").startsWith("3") ? 3 : 2,
    limitation: restrictionText.includes("колен")
      ? "knees"
      : restrictionText.includes("спин") || restrictionText.includes("пояс")
        ? "back"
        : restrictionText.includes("плеч")
          ? "shoulders"
          : restrictionText.includes("тбс") || restrictionText.includes("таз")
            ? "hips"
            : "none",
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

function restrictionTerms(restrictions) {
  const text = String(restrictions || "").toLowerCase();
  if (text.includes("нет") || text.includes("без")) return ["без ограничений"];
  if (text.includes("колен")) return ["колен"];
  if (text.includes("спин") || text.includes("пояс")) return ["спин", "пояс"];
  if (text.includes("таз") || text.includes("тбс")) return ["таз", "тбс", "бедр"];
  if (text.includes("плеч")) return ["плеч"];
  return [];
}

function scoreCourse(course, profile) {
  const title = lowerTitle(course);
  const genderTerm = profile.gender === "male" ? "мужская" : "женская";
  const oppositeGender = profile.gender === "male" ? "женская" : "мужская";
  const terms = restrictionTerms(profile.restrictions);
  let score = 0;

  if (title.includes(genderTerm)) score += 120;
  if (title.includes(oppositeGender)) score -= 160;
  if (title.includes(goalTerm(profile.goal))) score += 44;
  if (title.includes(frequencyTerm(profile.trainingFrequency))) score += 34;
  if (terms.length && terms.some((term) => title.includes(term))) score += 18;
  if (!String(profile.restrictions || "").toLowerCase().includes("нет") && title.includes("без ограничений")) score -= 5;
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

  const course = selectCourse(data, profile, assignedProgramId);
  const lessons = data.lessons
    .filter((lesson) => lesson.course_id === course.course_id)
    .sort((a, b) => Number(a.lesson_number) - Number(b.lesson_number));

  const workouts = lessons.map((lesson, index) => {
    const exercises = data.exercises
      .filter((exercise) => exercise.course_id === course.course_id && exercise.lesson_id === lesson.lesson_id)
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
