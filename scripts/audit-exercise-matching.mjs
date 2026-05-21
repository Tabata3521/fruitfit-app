import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const programExercisesPath = path.join(projectRoot, "public", "data", "exercises.json");
const exerciseDbPath = path.join(projectRoot, "src", "data", "exerciseCatalogTable.json");
const outputDir = path.join(projectRoot, "audit");

const programExercises = JSON.parse(fs.readFileSync(programExercisesPath, "utf8"));
const exerciseDb = JSON.parse(fs.readFileSync(exerciseDbPath, "utf8"));

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\([^)]*\)/g, " ")
    .replace(/техника выполнения упражнен(ия|ий)/g, " ")
    .replace(/упражнение\s*\d+/g, " ")
    .replace(/\b(сидя|стоя|лежа|лёжа)\b/g, " $1 ")
    .replace(/[^а-яa-z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stemToken(token) {
  const value = normalize(token);
  if (value.length <= 5) return value;
  return value
    .replace(/(ами|ями|ого|ему|ыми|ими|ую|ая|ое|ые|ий|ый|ой|ом|ем|ах|ях|ов|ев|а|я|ы|и|е|у|ю)$/u, "");
}

function tokens(value) {
  return normalize(value)
    .split(" ")
    .map(stemToken)
    .filter((token) => token.length > 1 && !["на", "в", "с", "со", "по", "к", "из", "за", "для", "под"].includes(token));
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

function tokenScore(programName, dbName) {
  const a = tokens(programName);
  const b = tokens(dbName);
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter((token) => setB.has(token)).length;
  const containment = intersection / Math.max(setA.size, 1);
  const jaccard = intersection / Math.max(new Set([...setA, ...setB]).size, 1);
  return containment * 0.7 + jaccard * 0.3;
}

function charScore(programName, dbName) {
  const a = normalize(programName);
  const b = normalize(dbName);
  if (!a || !b) return 0;
  const distance = levenshtein(a, b);
  return 1 - distance / Math.max(a.length, b.length, 1);
}

function substringBoost(programName, dbName) {
  const a = normalize(programName);
  const b = normalize(dbName);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (b.includes(a)) return 0.92;
  if (a.includes(b)) return 0.88;
  return 0;
}

function score(programName, dbName) {
  const exact = normalize(programName) === normalize(dbName);
  if (exact) return 1;
  return Math.max(
    substringBoost(programName, dbName),
    tokenScore(programName, dbName) * 0.78 + charScore(programName, dbName) * 0.22,
  );
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const programMap = new Map();
for (const row of programExercises) {
  const name = String(row.exercise_name || "").trim();
  if (!name) continue;
  const key = normalize(name);
  if (!programMap.has(key)) {
    programMap.set(key, {
      programName: name,
      normalizedProgramName: key,
      occurrences: 0,
      courseIds: new Set(),
      lessonIds: new Set(),
      examples: [],
    });
  }
  const item = programMap.get(key);
  item.occurrences += 1;
  if (row.course_id) item.courseIds.add(String(row.course_id));
  if (row.lesson_id) item.lessonIds.add(String(row.lesson_id));
  if (item.examples.length < 3) item.examples.push(row.comment || row.raw_line || "");
}

const dbItems = exerciseDb.map((item) => ({
  id: item.id,
  dbName: item.name || item.exercise_name,
  normalizedDbName: normalize(item.name || item.exercise_name),
  muscleGroup: item.muscleGroup || item.muscleGroupRaw || "",
  movementPattern: item.movementPattern || "",
  targetZone: item.targetZone || "",
  hasVideo: Boolean(item.rfVideoUrl || item.video_url),
}));

const auditRows = [...programMap.values()].map((programItem) => {
  const ranked = dbItems
    .map((dbItem) => ({
      ...dbItem,
      confidence: score(programItem.programName, dbItem.dbName),
    }))
    .sort((a, b) => b.confidence - a.confidence || a.dbName.localeCompare(b.dbName, "ru"));

  const best = ranked[0];
  const second = ranked[1];
  let status = "no_match";
  let reason = "Нет кандидата с достаточной похожестью.";
  if (best.confidence >= 0.999) {
    status = "exact_match";
    reason = "Нормализованные названия совпадают полностью.";
  } else if (best.confidence >= 0.72 && second && Math.abs(best.confidence - second.confidence) < 0.06) {
    status = "ambiguous_match";
    reason = `Несколько близких кандидатов: ${best.dbName} / ${second.dbName}.`;
  } else if (best.confidence >= 0.64) {
    status = "fuzzy_match";
    reason = best.normalizedDbName.includes(programItem.normalizedProgramName)
      ? "Название из программы является частью названия в exercise DB."
      : "Высокая похожесть по токенам/строке.";
  }

  return {
    "Название в программе": programItem.programName,
    "Нормализованное название в программе": programItem.normalizedProgramName,
    "Найденное совпадение в exercise DB": status === "no_match" ? "" : best.dbName,
    "DB id": status === "no_match" ? "" : best.id,
    "Confidence score": Number(best.confidence.toFixed(3)),
    "Статус": status,
    "Причина": reason,
    "Предлагаемый alias": ["fuzzy_match", "ambiguous_match"].includes(status) ? best.dbName : "",
    "Встречается в программах": programItem.occurrences,
    "Кол-во course_id": programItem.courseIds.size,
    "Кол-во lesson_id": programItem.lessonIds.size,
    "Muscle group DB": status === "no_match" ? "" : best.muscleGroup,
    "Pattern DB": status === "no_match" ? "" : best.movementPattern,
    "Target zone DB": status === "no_match" ? "" : best.targetZone,
    "DB has video": status === "no_match" ? "" : best.hasVideo,
    "Второй кандидат": second?.dbName || "",
    "Score второго кандидата": second ? Number(second.confidence.toFixed(3)) : "",
    "Пример raw/comment": programItem.examples.filter(Boolean).join(" | "),
  };
});

auditRows.sort((a, b) => {
  const order = { no_match: 0, ambiguous_match: 1, fuzzy_match: 2, exact_match: 3 };
  return order[a["Статус"]] - order[b["Статус"]]
    || b["Встречается в программах"] - a["Встречается в программах"]
    || a["Название в программе"].localeCompare(b["Название в программе"], "ru");
});

const aliasSuggestions = {};
for (const row of auditRows) {
  if (row["Статус"] === "fuzzy_match" && row["Предлагаемый alias"]) {
    aliasSuggestions[row["Нормализованное название в программе"]] = normalize(row["Предлагаемый alias"]);
  }
}

const statusCounts = auditRows.reduce((acc, row) => {
  acc[row["Статус"]] = (acc[row["Статус"]] || 0) + 1;
  return acc;
}, {});

fs.mkdirSync(outputDir, { recursive: true });

const headers = Object.keys(auditRows[0] || {});
const csv = [
  headers.map(csvEscape).join(";"),
  ...auditRows.map((row) => headers.map((header) => csvEscape(row[header])).join(";")),
].join("\n");

fs.writeFileSync(path.join(outputDir, "exercise_matching_audit.csv"), `\uFEFF${csv}`, "utf8");
fs.writeFileSync(path.join(outputDir, "exercise_aliases_suggestions.json"), JSON.stringify(aliasSuggestions, null, 2), "utf8");
fs.writeFileSync(path.join(outputDir, "exercise_matching_summary.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  programExerciseRows: programExercises.length,
  uniqueProgramExercises: programMap.size,
  exerciseDbRows: exerciseDb.length,
  statusCounts,
  aliasSuggestionsCount: Object.keys(aliasSuggestions).length,
}, null, 2), "utf8");

console.log(JSON.stringify({
  outputDir,
  programExerciseRows: programExercises.length,
  uniqueProgramExercises: programMap.size,
  exerciseDbRows: exerciseDb.length,
  statusCounts,
  aliasSuggestionsCount: Object.keys(aliasSuggestions).length,
}, null, 2));
