const FULL_BODY_STRETCH_VIDEO_URL =
  "https://ac22cf36-390e-4f3a-b58f-98eb399f6f3b.selstorage.ru/exercises/%D0%A0%D0%B0%D1%81%D1%82%D1%8F%D0%B6%D0%BA%D0%B0%20%D0%BD%D0%B0%20%D0%B2%D1%81%D0%B5%20%D1%82%D0%B5%D0%BB%D0%BE.mp4";
const CLASSIC_LUNGES_VIDEO_URL =
  "https://ac22cf36-390e-4f3a-b58f-98eb399f6f3b.selstorage.ru/exercises/%D0%B2%D1%8B%D0%BF%D0%B0%D0%B4%D1%8B-%D1%81-%D0%B3%D0%B0%D0%BD%D1%82%D0%B5%D0%BB%D1%8F%D0%BC%D0%B8.mp4";
const SMITH_PUSHUPS_VIDEO_URL =
  "https://ac22cf36-390e-4f3a-b58f-98eb399f6f3b.selstorage.ru/exercises/%D0%BE%D1%82%D0%B6%D0%B8%D0%BC%D0%B0%D0%BD%D0%B8%D1%8F-%D0%B2-%D1%82%D1%80%D0%B5%D0%BD%D0%B0%D0%B6%D0%B5%D1%80%D0%B5-%D1%81%D0%BC%D0%B8%D1%82%D1%82%D0%B0.mp4";
const PLIE_SQUAT_VIDEO_URL =
  "https://ac22cf36-390e-4f3a-b58f-98eb399f6f3b.selstorage.ru/exercises/%D0%BF%D1%80%D0%B8%D1%81%D0%B5%D0%B4-%D1%81-%D1%82%D0%BE%D1%87%D0%BA%D0%BE%D0%B9-%D0%BE%D0%BF%D0%BE%D1%80%D1%8B.mp4";

function fallbackExercise({
  id,
  exerciseName,
  muscleGroup,
  movementPattern,
  exerciseType = "client_fallback",
  videoUrl = null,
  restrictions = [],
}) {
  const normalizedName = exerciseName.toLowerCase().replace(/ё/g, "е");
  const targetZone = muscleGroup;

  return {
    id,
    source: "client_runtime_fallback",
    source_row: null,
    exercise_name: exerciseName,
    name: exerciseName,
    normalized_name: normalizedName,
    muscle_group: muscleGroup,
    muscleGroup,
    muscleGroupRaw: muscleGroup,
    movement_vector: movementPattern,
    movementPattern,
    movementPatternRaw: movementPattern,
    didactic_pattern: movementPattern,
    exercise_type: exerciseType,
    targetZone,
    targetZoneNormalized: targetZone.toLowerCase().replace(/ё/g, "е"),
    restrictions_raw: restrictions.length ? restrictions.join(", ") : "Нет",
    restrictions,
    restrictionNote: restrictions.length ? restrictions.join(", ") : "Нет",
    gender: "all",
    gender_raw: "Мужские и женские",
    rfVideoUrl: videoUrl,
    video_url: videoUrl,
    video_match_status: videoUrl ? "client_runtime_fallback" : "missing_source_video",
    video_match_confidence: videoUrl ? 1 : 0,
    video_match_reason: videoUrl ? "manual_runtime_binding" : "no_safe_video_binding_found",
  };
}

export const runtimeExerciseFallbacks = [
  fallbackExercise({
    id: "runtime_full_body_stretch",
    exerciseName: "Растяжка на все тело",
    muscleGroup: "Растяжка на все тело",
    movementPattern: "мобилизация / растяжка",
    exerciseType: "ЛФК",
    videoUrl: FULL_BODY_STRETCH_VIDEO_URL,
  }),
  fallbackExercise({
    id: "runtime_classic_lunges",
    exerciseName: "Классические выпады",
    muscleGroup: "Квадрицепс / ягодицы",
    movementPattern: "выпад",
    exerciseType: "База",
    videoUrl: CLASSIC_LUNGES_VIDEO_URL,
  }),
  fallbackExercise({
    id: "runtime_smith_pushups",
    exerciseName: "Отжимания в смитте",
    muscleGroup: "Грудные / трицепс",
    movementPattern: "горизонтальный жим / отжимание",
    exerciseType: "База",
    videoUrl: SMITH_PUSHUPS_VIDEO_URL,
  }),
  fallbackExercise({
    id: "runtime_plie_squat",
    exerciseName: "Присед плие",
    muscleGroup: "Приводящие / ягодицы",
    movementPattern: "приседание",
    exerciseType: "База",
    videoUrl: PLIE_SQUAT_VIDEO_URL,
  }),
];
