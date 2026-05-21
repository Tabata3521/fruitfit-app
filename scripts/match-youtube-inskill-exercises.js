import fs from "node:fs";
import path from "node:path";

const YOUTUBE_PATH = "youtube-exercise-library/all_videos.json";
const INSKILL_PATH = "public/data/exercise-catalog.json";
const OUT_DIR = "youtube-exercise-library";

const youtube = JSON.parse(fs.readFileSync(YOUTUBE_PATH, "utf8"));
const inskill = JSON.parse(fs.readFileSync(INSKILL_PATH, "utf8"));

const stopWords = new Set([
  "как", "что", "если", "почему", "зачем", "это", "для", "при", "про", "или", "еще", "ещё",
  "лучшие", "лучшее", "упражнение", "упражнения", "техника", "выполнение", "тренер", "фитнес",
  "здоровье", "зож", "мотивация", "качалка", "бодибилдинг", "рекомендации", "советы", "смотри",
  "описании", "комментарии", "подарок", "канале", "видео", "сохрани", "потерять",
]);

const genericExerciseNames = new Set([
  "пресс", "растяжка", "кардио", "зарядка", "разминка", "заминка", "тяга", "жим",
]);

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/#[^\s#]+/g, " ")
    .replace(/[«»"“”]/g, "")
    .replace(/\s+[—-]\s*техника выполнения упражнения.*$/i, "")
    .replace(/\s+техника выполнения упражнения.*$/i, "")
    .replace(/\s+техника выполнения.*$/i, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedTitle(value) {
  return normalize(value)
    .replace(/\bна\s*бицепс\b/g, "бицепс")
    .replace(/\bнабицепс\b/g, "бицепс")
    .replace(/\bg\s*-\s*жим\b/g, "g жим")
    .trim();
}

function tokens(value) {
  return normalizedTitle(value)
    .split(/\s+/)
    .filter((token) => token.length > 1 && !stopWords.has(token));
}

function overlapScore(aTokens, bTokens) {
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  const common = [...a].filter((token) => b.has(token));
  const union = new Set([...a, ...b]);
  return {
    commonCount: common.length,
    common,
    jaccard: union.size ? common.length / union.size : 0,
    coverageA: a.size ? common.length / a.size : 0,
    coverageB: b.size ? common.length / b.size : 0,
  };
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  const curr = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev.splice(0, prev.length, ...curr);
  }

  return prev[b.length];
}

function similarity(a, b) {
  const distance = levenshtein(a, b);
  const longest = Math.max(a.length, b.length);
  return longest ? 1 - distance / longest : 0;
}

const inskillPrepared = inskill
  .filter((item) => item.name && !genericExerciseNames.has(normalizedTitle(item.name)))
  .map((item) => ({
    ...item,
    norm: normalizedTitle(item.name),
    tokens: tokens(item.name),
  }))
  .filter((item) => item.norm.length >= 5);

function scoreMatch(video, exercise) {
  const title = normalizedTitle(video.title);
  const titleTokens = tokens(video.title);
  const overlap = overlapScore(titleTokens, exercise.tokens);
  const lev = similarity(title, exercise.norm);
  let score = 0;
  let matchType = "weak";

  if (title === exercise.norm) {
    score = 1;
    matchType = "exact";
  } else if (title.includes(exercise.norm) && exercise.norm.length >= 8) {
    score = 0.96;
    matchType = "title_contains_exercise";
  } else if (exercise.norm.includes(title) && title.length >= 8 && titleTokens.length >= 2) {
    score = 0.9;
    matchType = "exercise_contains_title";
  } else if (overlap.commonCount >= 3 && overlap.coverageB >= 0.75) {
    score = 0.84;
    matchType = "token_coverage";
  } else if (overlap.commonCount >= 2 && overlap.jaccard >= 0.5 && overlap.coverageB >= 0.5) {
    score = 0.74;
    matchType = "token_similarity";
  } else if (title.length >= 8 && exercise.norm.length >= 8 && lev >= 0.78) {
    score = lev;
    matchType = "levenshtein";
  }

  return {
    score,
    matchType,
    overlap,
    titleNorm: title,
  };
}

const matches = [];

for (const video of youtube) {
  const candidates = inskillPrepared
    .map((exercise) => {
      const score = scoreMatch(video, exercise);
      return { exercise, ...score };
    })
    .filter((item) => item.score >= 0.7)
    .sort((a, b) => b.score - a.score || b.exercise.sourceCount - a.exercise.sourceCount)
    .slice(0, 5);

  if (!candidates.length) continue;

  const best = candidates[0];
  const confidence = best.score >= 0.84 ? "strong" : "review";
  matches.push({
    confidence,
    score: Number(best.score.toFixed(3)),
    match_type: best.matchType,
    youtube_title: video.title,
    youtube_url: video.youtube_url,
    video_id: video.video_id,
    thumbnail_url: video.thumbnail_url,
    duration: video.duration,
    upload_date: video.upload_date,
    inskill_exercise_id: best.exercise.id,
    inskill_exercise_name: best.exercise.name,
    inskill_category: best.exercise.exerciseCategory,
    muscle_group: best.exercise.muscleGroup,
    movement_pattern: best.exercise.movementPattern,
    category: video.category === "needs_review" ? best.exercise.muscleGroup || "needs_review" : video.category,
    alternatives: candidates.map((candidate) => ({
      score: Number(candidate.score.toFixed(3)),
      name: candidate.exercise.name,
      match_type: candidate.matchType,
    })),
  });
}

function csvEscape(value) {
  const text = Array.isArray(value) || typeof value === "object"
    ? JSON.stringify(value)
    : String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function writeCsv(filePath, rows, columns) {
  const csv = [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
  ].join("\n");
  fs.writeFileSync(filePath, `\uFEFF${csv}\n`, "utf8");
}

const strong = matches.filter((item) => item.confidence === "strong");
const review = matches.filter((item) => item.confidence === "review");
const uniqueInskillStrong = new Set(strong.map((item) => item.inskill_exercise_id));
const uniqueInskillAll = new Set(matches.map((item) => item.inskill_exercise_id));
const breakdown = matches.reduce((acc, item) => {
  const key = `${item.confidence}:${item.category || "needs_review"}`;
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});

const columns = [
  "confidence",
  "score",
  "match_type",
  "youtube_title",
  "inskill_exercise_name",
  "youtube_url",
  "video_id",
  "thumbnail_url",
  "duration",
  "upload_date",
  "category",
  "muscle_group",
  "movement_pattern",
  "inskill_category",
];

fs.writeFileSync(path.join(OUT_DIR, "youtube_inskill_matches.json"), `${JSON.stringify(matches, null, 2)}\n`, "utf8");
writeCsv(path.join(OUT_DIR, "youtube_inskill_matches.csv"), matches, columns);
fs.writeFileSync(path.join(OUT_DIR, "youtube_inskill_strong_links.txt"), `${strong.map((item) => item.youtube_url).join("\n")}\n`, "utf8");
fs.writeFileSync(path.join(OUT_DIR, "youtube_inskill_match_summary.json"), `${JSON.stringify({
  youtube_videos_scanned: youtube.length,
  inskill_exercises_scanned: inskillPrepared.length,
  matched_videos_total: matches.length,
  strong_matches: strong.length,
  review_matches: review.length,
  unique_inskill_exercises_strong: uniqueInskillStrong.size,
  unique_inskill_exercises_total: uniqueInskillAll.size,
  breakdown,
  output_files: [
    "youtube_inskill_matches.json",
    "youtube_inskill_matches.csv",
    "youtube_inskill_strong_links.txt",
    "youtube_inskill_match_summary.json",
  ],
}, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  youtube_videos_scanned: youtube.length,
  inskill_exercises_scanned: inskillPrepared.length,
  matched_videos_total: matches.length,
  strong_matches: strong.length,
  review_matches: review.length,
  unique_inskill_exercises_strong: uniqueInskillStrong.size,
  unique_inskill_exercises_total: uniqueInskillAll.size,
  breakdown,
  output_dir: path.resolve(OUT_DIR),
}, null, 2));
