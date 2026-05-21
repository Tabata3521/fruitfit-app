import { normalizeTemplateText } from "./muscleTemplates.js";

const CORE_WORDS = ["кор", "пресс", "косые", "нижний пресс", "прямая мышца живота", "стабилизация"];

function uniq(items) {
  return [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))];
}

function splitMuscles(value) {
  return uniq(String(value || "")
    .replace(/\s+и\s+/gi, "/")
    .split(/[\/,;]+/)
    .map((item) => item.trim()));
}

function isCore(value) {
  const key = normalizeTemplateText(value);
  return CORE_WORDS.some((word) => key.includes(normalizeTemplateText(word)));
}

function includesAny(value, words) {
  const key = normalizeTemplateText(value);
  return words.some((word) => key.includes(normalizeTemplateText(word)));
}

const overrides = [
  {
    match: ["римские подтягивания", "подтягивания"],
    primary: ["широчайшие мышцы спины"],
    secondary: ["бицепс", "задняя дельта"],
    stabilizers: ["мышцы кора"],
  },
  {
    match: ["жим арнольда"],
    primary: ["передняя дельта", "средняя дельта"],
    secondary: ["трицепс"],
    stabilizers: ["мышцы кора"],
  },
  {
    match: ["отжимания на брусьях", "брусья"],
    primary: ["трицепс", "нижняя грудь"],
    secondary: ["передняя дельта"],
    stabilizers: ["мышцы кора"],
  },
  {
    match: ["планка"],
    primary: ["мышцы кора"],
    secondary: ["плечевой пояс"],
    stabilizers: ["ягодицы", "разгибатели позвоночника"],
  },
  {
    match: ["присед", "гак", "выпады"],
    primary: ["квадрицепс", "ягодицы"],
    secondary: ["бицепс бедра", "приводящие"],
    stabilizers: ["мышцы кора", "разгибатели позвоночника"],
  },
  {
    match: ["комплекс лфк упражнений на плечи", "ротаторная манжета"],
    primary: ["ротаторная манжета плеча"],
    secondary: ["задняя дельта", "плечевой пояс"],
    stabilizers: ["лопаточные стабилизаторы"],
  },
];

function overrideFor(name) {
  const key = normalizeTemplateText(name);
  return overrides.find((item) => item.match.some((word) => key.includes(normalizeTemplateText(word)))) || null;
}

export function buildMuscleProfile(exercise = {}) {
  const name = exercise.exercise_name || exercise.name || "";
  const meta = exercise.exercise_table_meta || {};
  const direct = overrideFor(name);
  if (direct) return direct;

  const target = splitMuscles(exercise.targetZone || exercise.target_zone || meta.targetZone);
  const group = splitMuscles(exercise.muscleGroup || exercise.muscle_group || meta.muscleGroup);
  const pattern = `${exercise.movementPattern || exercise.pattern || meta.movementPattern || ""} ${name}`;

  let primary = target.length ? [target[0]] : group;
  let secondary = target.slice(1);
  let stabilizers = [];

  if (target.some(isCore) || group.some(isCore) || includesAny(pattern, ["планка", "антиротация", "стабилизация"])) {
    primary = ["мышцы кора"];
    secondary = uniq([...secondary, ...target.filter((item) => !isCore(item))]);
  }

  if (includesAny(pattern, ["тяга", "подтяг"])) {
    if (!primary.length) primary = ["широчайшие мышцы спины"];
    secondary = uniq([...secondary, "бицепс", "задняя дельта"]);
    stabilizers.push("мышцы кора");
  }

  if (includesAny(pattern, ["жим", "отжим"])) {
    if (!primary.length) primary = ["грудные мышцы"];
    secondary = uniq([...secondary, "трицепс", "передняя дельта"]);
    stabilizers.push("мышцы кора");
  }

  if (includesAny(pattern, ["присед", "выпад", "гак", "жим ногами"])) {
    primary = primary.length ? primary : ["квадрицепс", "ягодицы"];
    secondary = uniq([...secondary, "бицепс бедра", "приводящие"]);
    stabilizers = uniq([...stabilizers, "мышцы кора", "разгибатели позвоночника"]);
  }

  if (includesAny(pattern, ["станов", "мертв", "мёртв", "румын", "гиперэкстенз"])) {
    primary = primary.length ? primary : ["ягодицы", "бицепс бедра"];
    secondary = uniq([...secondary, "разгибатели позвоночника"]);
    stabilizers.push("мышцы кора");
  }

  return {
    primary: uniq(primary),
    secondary: uniq(secondary).filter((item) => !primary.includes(item)),
    stabilizers: uniq(stabilizers),
  };
}
