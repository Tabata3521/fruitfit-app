export function normalizeExerciseKey(exercise) {
  return String(exercise?.exercise_id || exercise?.training_id || exercise?.exercise_name || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function readExerciseWeights() {
  try {
    return JSON.parse(localStorage.getItem("exerciseWeights") || "{}");
  } catch (_) {
    return {};
  }
}

export function getExerciseWeight(exercise, setNumber = null) {
  const key = normalizeExerciseKey(exercise);
  const entry = readExerciseWeights()[key] || null;
  if (!entry || setNumber == null) return entry;
  return entry.sets?.[String(setNumber)] || (entry.lastWeight ? { lastWeight: entry.lastWeight, history: entry.history || [], unit: entry.unit || "kg", updatedAt: entry.updatedAt } : null);
}

export function saveExerciseWeight(exercise, value, setNumber = null) {
  const normalized = normalizeExerciseKey(exercise);
  const weight = Number(value);
  if (!normalized || !Number.isFinite(weight) || weight <= 0) return null;

  const store = readExerciseWeights();
  const previous = store[normalized];
  const setKey = setNumber == null ? null : String(setNumber);
  const previousSet = setKey ? previous?.sets?.[setKey] : null;
  const history = [weight, ...((previousSet?.history || previous?.history || [])).filter((item) => item !== weight)].slice(0, 12);
  const setEntry = {
    lastWeight: weight,
    history,
    unit: "kg",
    updatedAt: new Date().toISOString(),
  };

  const entry = {
    ...previous,
    ...setEntry,
    sets: setKey ? { ...(previous?.sets || {}), [setKey]: setEntry } : previous?.sets || {},
  };

  store[normalized] = entry;
  localStorage.setItem("exerciseWeights", JSON.stringify(store));
  return setKey ? setEntry : entry;
}
