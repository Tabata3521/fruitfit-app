export const RESTRICTION_KEYS = ["none", "knees", "back", "shoulders", "hips"];
export const PHYSICAL_RESTRICTION_KEYS = RESTRICTION_KEYS.filter((key) => key !== "none");
export const restrictionOptions = [
  ["none", "Нет ограничений"],
  ["knees", "Колени"],
  ["back", "Спина"],
  ["shoulders", "Плечи"],
  ["hips", "Тазобедренные суставы"],
];

const restrictionLabelMap = Object.fromEntries(restrictionOptions);

function restrictionKeyFromValue(value) {
  const text = String(value || "").trim().toLowerCase().replace(/ё/g, "е");
  if (!text) return "";
  if (RESTRICTION_KEYS.includes(text)) return text;
  if (text.includes("колен")) return "knees";
  if (text.includes("спин") || text.includes("пояс")) return "back";
  if (text.includes("плеч")) return "shoulders";
  if (text.includes("таз") || text.includes("тбс") || text.includes("бедр")) return "hips";
  if (text === "none" || text.includes("нет огранич") || text.includes("без огранич")) return "none";
  return "";
}

function flattenRestrictionValues(value) {
  if (Array.isArray(value)) return value.flatMap(flattenRestrictionValues);
  if (value === null || value === undefined) return [];
  const text = String(value).trim();
  if (!text) return [];
  const direct = restrictionKeyFromValue(text);
  if (direct && !/[;,|]/.test(text)) return [direct];
  return text.split(/[;,|]/).map(restrictionKeyFromValue).filter(Boolean);
}

export function normalizeRestrictionKeys(value, fallbackValue = null) {
  const source = value !== undefined && value !== null ? value : fallbackValue;
  const keys = [...new Set(flattenRestrictionValues(source))];
  const physical = keys.filter((key) => key !== "none" && PHYSICAL_RESTRICTION_KEYS.includes(key));
  return physical.length ? physical : ["none"];
}

export function legacyRestrictionValue(value) {
  return normalizeRestrictionKeys(value)[0] || "none";
}

export function restrictionLabel(key) {
  if (key === "none") return "Без ограничений";
  return restrictionLabelMap[key] || "";
}

export function restrictionLabels(value) {
  return normalizeRestrictionKeys(value).map(restrictionLabel).filter(Boolean);
}

export function toggleRestrictionKey(currentValue, key) {
  if (!RESTRICTION_KEYS.includes(key)) return normalizeRestrictionKeys(currentValue);
  if (key === "none") return ["none"];
  const current = normalizeRestrictionKeys(currentValue).filter((item) => item !== "none");
  const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
  return next.length ? next : ["none"];
}
