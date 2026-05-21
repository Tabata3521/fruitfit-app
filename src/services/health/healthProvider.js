export const healthProviderStates = {
  NOT_SUPPORTED: "not_supported",
  NOT_INSTALLED: "not_installed",
  PERMISSIONS_REQUIRED: "permissions_required",
  PARTIALLY_GRANTED: "partially_granted",
  CONNECTED: "connected",
  NO_DATA: "no_data",
  ERROR: "error",
};

export const healthProviderLabels = {
  [healthProviderStates.NOT_SUPPORTED]: "Не поддерживается",
  [healthProviderStates.NOT_INSTALLED]: "Health Connect не установлен",
  [healthProviderStates.PERMISSIONS_REQUIRED]: "Разрешение не выдано",
  [healthProviderStates.PARTIALLY_GRANTED]: "Часть разрешений выдана",
  [healthProviderStates.CONNECTED]: "Подключено",
  [healthProviderStates.NO_DATA]: "Нет данных",
  [healthProviderStates.ERROR]: "Ошибка подключения",
};

function getCapacitor() {
  if (typeof window === "undefined") return null;
  return window.Capacitor || null;
}

function getHealthPlugin() {
  return getCapacitor()?.Plugins?.FruitFitHealth || null;
}

function webUnavailable() {
  return {
    state: healthProviderStates.NOT_SUPPORTED,
    source: "web",
    message: "В web/PWA трекер не подключён. Реальные данные доступны в Android APK через Health Connect.",
  };
}

async function callPlugin(method, fallback, payload) {
  const plugin = getHealthPlugin();
  if (!plugin || typeof plugin[method] !== "function") return fallback;
  try {
    return await plugin[method](payload || {});
  } catch (error) {
    return {
      state: healthProviderStates.ERROR,
      source: "native",
      message: error?.message || "Не удалось получить данные здоровья.",
      samples: [],
    };
  }
}

export async function getHealthAvailability() {
  const capacitor = getCapacitor();
  const platform = capacitor?.getPlatform?.() || "web";
  if (platform === "web") return webUnavailable();

  const plugin = getHealthPlugin();
  if (!plugin) {
    return {
      state: healthProviderStates.NOT_INSTALLED,
      source: platform === "ios" ? "Apple Health" : "Health Connect",
      message: platform === "ios"
        ? "Нативный мост Apple HealthKit ещё не подключён."
        : "Нативный мост Health Connect ещё не подключён.",
    };
  }

  return callPlugin("getHealthAvailability", {
    state: healthProviderStates.PERMISSIONS_REQUIRED,
    source: platform === "ios" ? "Apple Health" : "Health Connect",
    message: "Разрешите доступ к данным здоровья.",
  });
}

export async function requestHealthPermissions() {
  return callPlugin("requestHealthPermissions", webUnavailable());
}

export async function openHealthSettings() {
  return callPlugin("openHealthSettings", webUnavailable());
}

export async function openHealthSource(sourceId = "health_connect") {
  return callPlugin("openHealthSource", webUnavailable(), { sourceId });
}

export async function getSteps(range = "today", options = {}) {
  return callPlugin(
    "getSteps",
    { state: healthProviderStates.NO_DATA, source: null, range, total: null, rawTotal: null, selectedSourcePackage: null, samples: [] },
    { range, ...options }
  );
}

export async function getCalories(range = "today") {
  return callPlugin("getCalories", { state: healthProviderStates.NO_DATA, source: null, range, active: null, total: null, samples: [] }, { range });
}

export async function getHeartRate(range = "today") {
  return callPlugin("getHeartRate", {
    state: healthProviderStates.NO_DATA,
    source: null,
    range,
    min: null,
    avg: null,
    max: null,
    latestBpm: null,
    latestTimestamp: null,
    latestSourcePackage: null,
    recordsCount: 0,
    samplesCount: 0,
    sources: [],
    samples: [],
  }, { range });
}

export async function getSleep(range = "today") {
  return callPlugin("getSleep", { state: healthProviderStates.NO_DATA, source: null, range, minutes: 0, sessions: [], fragments: [] }, { range });
}

export async function getSleepStages(range = "today") {
  return callPlugin("getSleepStages", { state: healthProviderStates.NO_DATA, source: null, range, stages: [] }, { range });
}

export async function getDistance(range = "today") {
  return callPlugin("getDistance", { state: healthProviderStates.NO_DATA, source: null, range, meters: null, samples: [] }, { range });
}

export async function getExerciseSessions(range = "today") {
  return callPlugin("getExerciseSessions", { state: healthProviderStates.NO_DATA, source: null, range, sessions: [] }, { range });
}

export async function getWeight(range = "latest") {
  return callPlugin("getWeight", { state: healthProviderStates.NO_DATA, source: null, range, value: null, samples: [] }, { range });
}

export const healthSources = {
  healthConnect: {
    id: "health_connect",
    label: "Health Connect",
    platform: "android",
    adapters: ["Mi Fitness", "Zepp", "Samsung Health", "Google Fit", "Garmin", "Fitbit", "WHOOP", "Oura"],
  },
  appleHealth: {
    id: "apple_health",
    label: "Apple Health",
    platform: "ios",
    adapters: ["Apple Watch", "Garmin", "Fitbit", "WHOOP", "Oura"],
  },
  manual: {
    id: "manual",
    label: "Ручной ввод",
    platform: "all",
    adapters: [],
  },
};

export const healthSourceShortcuts = [
  { id: "health_connect", label: "Health Connect", hint: "Системный транспорт данных здоровья" },
  { id: "samsung_health", label: "Samsung Health", hint: "Galaxy Watch и Samsung Health" },
  { id: "google_fit", label: "Google Fit", hint: "Промежуточный источник для Mi Fitness/Zepp" },
  { id: "zepp", label: "Zepp / Amazfit", hint: "Amazfit и Zepp" },
  { id: "mi_fitness", label: "Mi Fitness", hint: "Xiaomi Watch / Mi Fitness" },
];
