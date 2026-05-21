const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const courses = JSON.parse(fs.readFileSync(path.join(root, "public/data/courses.json"), "utf8"));
const lessons = JSON.parse(fs.readFileSync(path.join(root, "public/data/lessons.json"), "utf8"));
const exercises = JSON.parse(fs.readFileSync(path.join(root, "public/data/exercises.json"), "utf8"));

const lessonByCourse = lessons.reduce((acc, lesson) => {
  acc[lesson.course_id] = acc[lesson.course_id] || [];
  acc[lesson.course_id].push(lesson);
  return acc;
}, {});

const exerciseByLesson = exercises.reduce((acc, exercise) => {
  const key = `${exercise.course_id}:${exercise.lesson_id}`;
  acc[key] = acc[key] || [];
  acc[key].push(exercise);
  return acc;
}, {});

function parseMeta(course) {
  const tech = String(course.technical_name || "").toLowerCase();
  const display = String(course.display_name || "");
  const combined = `${tech} ${display.toLowerCase()}`;

  const gender = combined.includes("муж") ? "male" : combined.includes("жен") ? "female" : "";
  const goal = tech.includes("похуд") || display.toLowerCase().includes("похуд") || display.toLowerCase().includes("подхуд")
    ? "weight_loss"
    : tech.includes("набор_мышц") || display.toLowerCase().includes("массонабор") || display.toLowerCase().includes("набор")
      ? "muscle_gain"
      : tech.includes("поддержание") || display.toLowerCase().includes("поддерж")
        ? "maintain"
        : "";
  const workoutsPerWeek = tech.includes("три_тренировки") || display.toLowerCase().includes("три тренировки") ? 3 : tech.includes("две_тренировки") || display.toLowerCase().includes("две тренировки") ? 2 : null;
  const limitation = tech.includes("колен") || display.toLowerCase().includes("колен")
    ? "knees"
    : tech.includes("спин") || display.toLowerCase().includes("спин")
      ? "back"
      : tech.includes("плеч") || display.toLowerCase().includes("плеч")
        ? "shoulders"
        : tech.includes("тазобедрен") || display.toLowerCase().includes("тбс") || display.toLowerCase().includes("таз")
          ? "hips"
          : tech.includes("без_ограничений") || display.toLowerCase().includes("без ограничений")
            ? "none"
            : course.restrictions === "адаптивная"
              ? "adaptive"
              : "";
  const level = tech.includes("опыт") ? "experienced" : tech.includes("начина") ? "beginner" : "";
  const adaptive = tech.includes("адаптив") || course.restrictions === "адаптивная" || !workoutsPerWeek;

  return { gender, goal, workoutsPerWeek, limitation, level, adaptive };
}

function makeTag(meta) {
  if (meta.adaptive) {
    return `adaptive_${meta.gender || "any"}_${meta.goal || "general"}_${meta.level || "any"}`;
  }
  return `${meta.gender}_${meta.goal}_${meta.workoutsPerWeek}x_${meta.limitation}_${meta.level}`;
}

function cleanTitle(value) {
  return String(value || "")
    .replace(/\s*Добавить занятие\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

const programs = courses.map((course) => {
  const meta = parseMeta(course);
  const courseLessons = (lessonByCourse[course.course_id] || [])
    .sort((a, b) => Number(a.lesson_number) - Number(b.lesson_number))
    .map((lesson) => {
      const lessonExercises = (exerciseByLesson[`${lesson.course_id}:${lesson.lesson_id}`] || [])
        .sort((a, b) => Number(a.exercise_order) - Number(b.exercise_order))
        .map((exercise) => ({
          order: Number(exercise.exercise_order),
          name: exercise.exercise_name,
          sets: exercise.sets || null,
          reps: exercise.reps || null,
          comment: exercise.comment || exercise.raw_line || "",
          has_video: Boolean(exercise.has_video),
        }));
      return {
        id: lesson.lesson_id,
        lesson_id: lesson.lesson_id,
        training_id: lesson.training_id || lesson.lesson_id,
        number: Number(lesson.lesson_number),
        title: lesson.lesson_title,
        description: lesson.lesson_description || "",
        training_type: lesson.training_type || "",
        exercises_count: lessonExercises.length,
        exercises: lessonExercises,
      };
    });

  return {
    id: course.course_id,
    course_id: course.course_id,
    product_id: course.product_id || null,
    tag: makeTag(meta),
    gender: meta.gender,
    goal: meta.goal,
    workouts_per_week: meta.workoutsPerWeek,
    limitation: meta.limitation,
    level: meta.level,
    adaptive: meta.adaptive,
    title: cleanTitle(course.display_name || course.technical_name),
    description: cleanTitle(course.display_name || course.technical_name),
    technical_name: course.technical_name,
    source_url: course.course_url,
    pay_url: course.pay_url || null,
    days: courseLessons,
    lessons_count: courseLessons.length,
  };
});

const mainPrograms = programs.filter((program) => !program.adaptive && program.gender && program.goal && program.workouts_per_week && program.limitation && program.level);
const adaptivePrograms = programs.filter((program) => program.adaptive);
const out = {
  generated_at: new Date().toISOString(),
  total: programs.length,
  main_count: mainPrograms.length,
  adaptive_count: adaptivePrograms.length,
  programs,
};

fs.writeFileSync(path.join(root, "public/data/training-programs.json"), JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(root, "dist/data/training-programs.json"), JSON.stringify(out, null, 2));

const missing = [];
for (const gender of ["male", "female"]) {
  for (const goal of ["maintain", "weight_loss", "muscle_gain"]) {
    for (const workouts of [2, 3]) {
      for (const limitation of ["knees", "back", "shoulders", "hips", "none"]) {
        for (const level of ["beginner", "experienced"]) {
          const tag = `${gender}_${goal}_${workouts}x_${limitation}_${level}`;
          if (!mainPrograms.some((program) => program.tag === tag)) missing.push(tag);
        }
      }
    }
  }
}

console.log(JSON.stringify({
  total: programs.length,
  main: mainPrograms.length,
  adaptive: adaptivePrograms.length,
  missing_count: missing.length,
  missing: missing.slice(0, 20),
}, null, 2));
