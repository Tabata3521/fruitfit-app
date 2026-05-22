import { normalizeExerciseKey } from "./exerciseAliases.js";

const FULL_BODY_STRETCH_VIDEO_URL =
  "https://ac22cf36-390e-4f3a-b58f-98eb399f6f3b.selstorage.ru/exercises/%D0%A0%D0%B0%D1%81%D1%82%D1%8F%D0%B6%D0%BA%D0%B0%20%D0%BD%D0%B0%20%D0%B2%D1%81%D0%B5%20%D1%82%D0%B5%D0%BB%D0%BE.mp4";
const CROSSOVER_LUNGES_VIDEO_URL =
  "https://ac22cf36-390e-4f3a-b58f-98eb399f6f3b.selstorage.ru/exercises/%D0%B2%D1%8B%D0%BF%D0%B0%D0%B4%D1%8B-%D0%B2-%D0%BA%D1%80%D0%BE%D1%81%D1%81%D0%BE%D0%B2%D0%B5%D1%80%D0%B5.mp4";

export const exerciseVideoOverrides = {
  [normalizeExerciseKey("Растяжка на все тело")]: FULL_BODY_STRETCH_VIDEO_URL,
  [normalizeExerciseKey("Выпады в кроссовере")]: CROSSOVER_LUNGES_VIDEO_URL,
  [normalizeExerciseKey("Выпады в кроссовере, техника выполнения упражнения")]: CROSSOVER_LUNGES_VIDEO_URL,
};

export function resolveExerciseVideoOverride(name) {
  return exerciseVideoOverrides[normalizeExerciseKey(name)] || null;
}
