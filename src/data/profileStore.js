export const PROFILE_STORAGE_KEY = "fruitfit.profile";

export const profileDefaults = {
  gender: "female",
  age: "30",
  height: "170",
  weight: "70",
  goal: "Набор мышечной массы",
  experience: "Новичок",
  trainingFrequency: "2 раза в неделю",
  restrictions: "Нет ограничений",
  dietType: "Обычное питание",
  calculatedCalories: 1800,
  recommendedCaloriesTarget: 1800,
  onboardingCompleted: false,
};

export const profileOptions = {
  gender: [
    ["male", "Мужчина"],
    ["female", "Женщина"],
  ],
  goal: ["Поддержание формы", "Похудение", "Набор мышечной массы"],
  experience: ["Новичок", "С опытом"],
  trainingFrequency: ["2 раза в неделю", "3 раза в неделю"],
  restrictions: ["Боли в коленях", "Боли в спине", "Боли в плечах", "Боли в тазобедренном суставе", "Нет ограничений"],
  dietType: ["Обычное питание", "Люблю мясо", "Люблю рыбу", "Вегетарианство", "Без лактозы", "Без глютена", "Без глютена и без лактозы"],
};

export const dietTypeToRation = {
  "Обычное питание": "Без ограничений",
  "Люблю мясо": "Мясоеды",
  "Люблю рыбу": "Рыбоеды",
  "Вегетарианство": "Вегетарианство",
  "Без лактозы": "Без лактозы",
  "Без глютена": "Без глютена",
  "Без глютена и без лактозы": "Без лактозы и без глютена",
};

function normalizeLegacyValue(value, field) {
  const text = String(value || "").toLowerCase();
  if (field === "dietType") {
    if (text.includes("обыч") || text.includes("нет") || text.includes("без огранич")) return "Обычное питание";
    if (text.includes("мяс")) return "Люблю мясо";
    if (text.includes("рыб")) return "Люблю рыбу";
    if (text.includes("вегет")) return "Вегетарианство";
    if (text.includes("лакт") && text.includes("глют")) return "Без глютена и без лактозы";
    if (text.includes("лакт")) return "Без лактозы";
    if (text.includes("глют")) return "Без глютена";
  }
  if (field === "restrictions") {
    if (text.includes("таз") || text.includes("тбс")) return "Боли в тазобедренном суставе";
    if (text.includes("спин") || text.includes("пояс")) return "Боли в спине";
    if (text.includes("колен")) return "Боли в коленях";
    if (text.includes("плеч")) return "Боли в плечах";
    if (text.includes("нет") || text.includes("без")) return "Нет ограничений";
  }
  if (field === "goal") {
    if (text.includes("масс") || text.includes("атлет")) return "Набор мышечной массы";
    if (text.includes("похуд") || text.includes("рекомп") || text.includes("жир")) return "Похудение";
    if (text.includes("поддерж") || text.includes("здоров") || text.includes("тонус") || text.includes("осанк") || text.includes("вынослив")) return "Поддержание формы";
  }
  if (field === "experience") {
    if (text.includes("нов") || text.includes("нет")) return "Новичок";
    if (text.includes("опыт") || text.includes("месяц") || text.includes("год") || text.includes("сред")) return "С опытом";
  }
  return value;
}

export function calculateMifflinCalories(profile = {}) {
  const gender = profile.gender === "male" ? "male" : "female";
  const age = Number(profile.age) || 30;
  const height = Number(profile.height) || 170;
  const weight = Number(profile.weight) || 70;
  const workouts = String(profile.trainingFrequency || "").startsWith("3") ? 3 : 2;

  // BMR по формуле Миффлина-Сен Жеора
  const bmr = 10 * weight + 6.25 * height - 5 * age + (gender === "male" ? 5 : -161);

  // Коэффициент активности: для обычного городского жителя 1.55 — это слишком много.
  // 2 тренировки + сидячий образ жизни = 1.2
  // 3 тренировки + сидячий образ жизни = 1.35
  const activity = workouts >= 3 ? 1.35 : 1.2;
  const tdee = bmr * activity;

  // Дельта на цель: фиксированные ккал
  const goal = String(profile.goal || "").toLowerCase();
  const goalDelta = goal.includes("похуд") ? -300 : goal.includes("масс") || goal.includes("набор") ? 200 : 0;

  const calculated = Math.round(tdee + goalDelta);

  // Список доступных рационов (должен совпадать с тем, что есть в данных питания)
  const targets = [1200, 1400, 1600, 1800, 2000, 2200, 2400, 2600, 2800, 3000];
  const recommended = targets.reduce((best, current) =>
    Math.abs(current - calculated) < Math.abs(best - calculated) ? current : best,
    targets[0],
  );

  return {
    calculatedCalories: Math.min(Math.max(1200, calculated), 3000), // Жесткий лимит до 3000 (максимальный рацион)
    recommendedCaloriesTarget: recommended,
  };
}

export function normalizeProfile(raw = {}) {
  const legacyGoal = normalizeLegacyValue(raw.goal, "goal");
  const legacyExperience = normalizeLegacyValue(raw.experience || raw.level, "experience");
  const legacyRestrictions = normalizeLegacyValue(raw.restrictions, "restrictions");
  const legacyDietType = normalizeLegacyValue(raw.dietType, "dietType");
  const legacyFrequency = String(raw.trainingFrequency || "").startsWith("3") ? "3 раза в неделю" : "2 раза в неделю";

  const calories = calculateMifflinCalories({ ...profileDefaults, ...raw, goal: legacyGoal, trainingFrequency: raw.trainingFrequency || legacyFrequency });
  return {
    ...profileDefaults,
    ...raw,
    gender: raw.gender === "male" ? "male" : raw.gender === "female" ? "female" : profileDefaults.gender,
    goal: profileOptions.goal.includes(legacyGoal) ? legacyGoal : profileDefaults.goal,
    experience: profileOptions.experience.includes(legacyExperience) ? legacyExperience : profileDefaults.experience,
    trainingFrequency: profileOptions.trainingFrequency.includes(raw.trainingFrequency) ? raw.trainingFrequency : legacyFrequency,
    restrictions: profileOptions.restrictions.includes(legacyRestrictions) ? legacyRestrictions : profileDefaults.restrictions,
    dietType: profileOptions.dietType.includes(legacyDietType) ? legacyDietType : profileDefaults.dietType,
    calculatedCalories: Number(raw.calculatedCalories) || calories.calculatedCalories,
    recommendedCaloriesTarget: Number(raw.recommendedCaloriesTarget) || calories.recommendedCaloriesTarget,
    onboardingCompleted: Boolean(raw.onboardingCompleted),
  };
}

export function loadProfile() {
  if (typeof window === "undefined") return profileDefaults;
  try {
    return normalizeProfile(JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || "null") || {});
  } catch (_) {
    return profileDefaults;
  }
}

export function saveProfile(profile) {
  const withCalories = { ...profile, ...calculateMifflinCalories(profile) };
  const normalized = normalizeProfile(withCalories);
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent("fruitfit:profile-updated", { detail: normalized }));
  return normalized;
}

export function validateProfile(profile) {
  const errors = {};
  const age = Number(profile.age);
  const height = Number(profile.height);
  const weight = Number(profile.weight);

  if (!profile.gender) errors.gender = "Выберите пол.";
  if (!profile.goal) errors.goal = "Выберите цель.";
  if (!profile.experience) errors.experience = "Выберите опыт тренировок.";
  if (!profile.trainingFrequency) errors.trainingFrequency = "Выберите частоту тренировок.";
  if (!profile.restrictions) errors.restrictions = "Выберите ограничения.";
  if (!profile.dietType) errors.dietType = "Выберите тип питания.";

  if (!profile.age || Number.isNaN(age) || age < 12 || age > 90) errors.age = "Возраст: 12–90 лет.";
  if (!profile.height || Number.isNaN(height) || height < 120 || height > 230) errors.height = "Рост: 120–230 см.";
  if (!profile.weight || Number.isNaN(weight) || weight < 35 || weight > 250) errors.weight = "Вес: 35–250 кг.";

  return errors;
}

export function profileSummary(profile) {
  const gender = profile.gender === "male" ? "мужская" : "женская";
  return `${gender} программа • ${profile.goal} • ${profile.trainingFrequency}`;
}

export function markOnboardingComplete(profile) {
  return saveProfile({ ...profile, onboardingCompleted: true });
}
