import { resolveDidacticExercise } from "../data/didacticExerciseData";
import { resolveExerciseVideoOverride } from "../data/exerciseVideoOverrides";
import exerciseCatalogTable from "../data/exerciseCatalogTable.json";

function normalizeMediaName(value = "") {
  return String(value)
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[.,;:!?()[\]{}"'«»]/g, " ")
    .replace(/\bтехника выполнения упражнени[яй]\b/g, " ")
    .replace(/\bвыполнение упражнения\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenScore(query, candidate) {
  const queryTokens = normalizeMediaName(query).split(" ").filter((token) => token.length > 2);
  const candidateTokens = normalizeMediaName(candidate).split(" ").filter((token) => token.length > 2);
  if (!queryTokens.length || !candidateTokens.length) return 0;
  const hits = queryTokens.filter((token) => candidateTokens.some((candidateToken) => candidateToken === token || candidateToken.startsWith(token) || token.startsWith(candidateToken))).length;
  return hits / queryTokens.length;
}

function resolveCatalogVideo(exerciseName) {
  const normalized = normalizeMediaName(exerciseName);
  if (!normalized) return null;
  const exact = exerciseCatalogTable.find((item) => normalizeMediaName(item.exercise_name || item.name) === normalized);
  if (exact?.video_url) return exact.video_url;

  const best = exerciseCatalogTable
    .filter((item) => item.video_url)
    .map((item) => ({ item, score: tokenScore(exerciseName, item.exercise_name || item.name) }))
    .sort((a, b) => b.score - a.score)[0];
  return best?.score >= 0.75 ? best.item.video_url : null;
}

export function resolveExerciseMedia(exercise) {
  const exerciseName = exercise?.exercise_name || exercise?.name || exercise?.title || "";
  const catalogExercise = resolveDidacticExercise(exerciseName);
  const catalogVideo = resolveCatalogVideo(exerciseName);
  const overrideVideo = resolveExerciseVideoOverride(exerciseName);
  const preview =
    exercise?.preview_url ||
    exercise?.image_path ||
    exercise?.thumbnail_url ||
    exercise?.preview ||
    catalogExercise?.preview_url ||
    catalogExercise?.thumbnail_url ||
    null;

  const video =
    exercise?.rf_video_url ||
    exercise?.rfVideoUrl ||
    exercise?.video_url ||
    exercise?.media_url ||
    catalogExercise?.video_url ||
    catalogExercise?.rfVideoUrl ||
    catalogExercise?.rf_video_url ||
    overrideVideo ||
    catalogVideo ||
    null;

  return {
    provider: video ? detectProvider(video) : "none",
    preview,
    video,
    hasMedia: Boolean(preview || video),
  };
}

function detectProvider(url) {
  if (!url) return "none";
  if (/\.mp4(\?|$)/i.test(url)) return "direct-mp4";
  if (/vk\.com|vkvideo/i.test(url)) return "vk-video";
  if (/rutube/i.test(url)) return "rutube";
  if (/youtube|youtu\.be/i.test(url)) return "youtube";
  return "external";
}
