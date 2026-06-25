import { Health } from "@capgo/capacitor-health";

export const healthProviderStates = {
  NOT_SUPPORTED: "not_supported",
  NOT_INSTALLED: "not_installed",
  PERMISSIONS_REQUIRED: "permissions_required",
  PARTIALLY_GRANTED: "partially_granted",
  CONNECTED: "connected",
  NO_DATA: "no_data",
  RATE_LIMITED: "rate_limited",
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
  [healthProviderStates.RATE_LIMITED]: "Health Connect temporarily limited refreshes",
};

export function isHealthRateLimitError(value) {
  if (!value) return false;
  if (Number(value?.errorCode ?? value?.code) === 7) return true;
  const text = [
    typeof value === "string" ? value : "",
    value?.state,
    value?.message,
    value?.errorCode,
    value?.code,
    value?.name,
    value?.cause?.message,
  ].filter(Boolean).join(" ").toLowerCase();
  return text.includes("429")
    || text.includes("quota")
    || text.includes("rate limit")
    || text.includes("rate-limit")
    || text.includes("ratelimit")
    || text.includes("too many requests");
}

export function normalizeHealthProviderResult(result, fallback = {}) {
  const next = { ...(fallback || {}), ...(result || {}) };
  if (next.state === healthProviderStates.RATE_LIMITED || isHealthRateLimitError(next)) {
    return {
      ...next,
      state: healthProviderStates.RATE_LIMITED,
      message: next.message || "Health Connect refresh quota is temporarily limited.",
      samples: next.samples || fallback?.samples || [],
    };
  }
  return next;
}

function getCapacitor() {
  if (typeof window === "undefined") return null;
  return window.Capacitor || null;
}

function getHealthPlugin() {
  return getCapacitor()?.Plugins?.FruitFitHealth || null;
}

function getDiagnosticsPlugin() {
  return getCapacitor()?.Plugins?.FruitFitDiagnostics || null;
}

function getPlatform() {
  return getCapacitor()?.getPlatform?.() || "web";
}

function isIosPlatform() {
  return getPlatform() === "ios";
}

const IOS_HEALTH_READ_TYPES = ["steps", "calories", "heartRate", "sleep", "distance", "workouts", "weight"];
const IOS_SOURCE_NAME = "Apple Health";
const IOS_SOURCE_PACKAGE = "apple.healthkit";

function nowDate() {
  return new Date();
}

function startOfLocalDay(date = nowDate()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function rangeToDates(range = "today") {
  const now = nowDate();
  const todayStart = startOfLocalDay(now);
  if (range === "last24h") return { startDate: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(), endDate: now.toISOString() };
  if (range === "week") return { startDate: addDays(todayStart, -6).toISOString(), endDate: now.toISOString() };
  if (range === "month") return { startDate: addDays(todayStart, -29).toISOString(), endDate: now.toISOString() };
  if (range === "latest") return { startDate: addDays(todayStart, -365).toISOString(), endDate: now.toISOString() };
  return { startDate: todayStart.toISOString(), endDate: now.toISOString() };
}

function numeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sampleTime(sample = {}) {
  return sample.endDate || sample.startDate || sample.time || null;
}

function normalizeIosSample(sample = {}, fallbackDateType = "") {
  const value = numeric(sample.value, 0);
  return {
    ...sample,
    dataType: sample.dataType || fallbackDateType,
    value,
    total: value,
    startTime: sample.startDate || sample.startTime || null,
    endTime: sample.endDate || sample.endTime || null,
    time: sampleTime(sample),
    date: String(sample.startDate || sample.endDate || "").slice(0, 10),
    sourceName: sample.sourceName || IOS_SOURCE_NAME,
    sourcePackage: sample.sourceId || sample.sourcePackage || IOS_SOURCE_PACKAGE,
  };
}

function sourceTotal(samples = []) {
  return samples.reduce((sum, item) => sum + numeric(item.value ?? item.total, 0), 0);
}

function iosRawSampleLimit(range = "today") {
  if (range === "month") return 20000;
  if (range === "week") return 8000;
  if (range === "last24h" || range === "today") return 2500;
  return 5000;
}

function iosStateFromSamples(samples = [], total = null) {
  if (samples.length || numeric(total, 0) > 0) return healthProviderStates.CONNECTED;
  return healthProviderStates.NO_DATA;
}

function iosAggregateSourceSummary(samples = [], total = null) {
  return {
    sourceName: IOS_SOURCE_NAME,
    sourcePackage: IOS_SOURCE_PACKAGE,
    total: total == null ? sourceTotal(samples) : numeric(total, 0),
    value: total == null ? sourceTotal(samples) : numeric(total, 0),
    convertedValue: total == null ? sourceTotal(samples) : numeric(total, 0),
    convertedActive: total == null ? sourceTotal(samples) : numeric(total, 0),
    recordsCount: samples.length,
    aggregate: true,
  };
}

function iosSourceSummaries(sourceSamples = [], aggregateSamples = [], aggregateTotal = null) {
  const grouped = new Map();
  sourceSamples.forEach((sample) => {
    const sourcePackage = sample.sourcePackage || IOS_SOURCE_PACKAGE;
    const sourceName = sample.sourceName || IOS_SOURCE_NAME;
    const key = `${sourcePackage}::${sourceName}`;
    const current = grouped.get(key) || {
      sourceName,
      sourcePackage,
      total: 0,
      value: 0,
      convertedValue: 0,
      convertedActive: 0,
      recordsCount: 0,
      aggregate: false,
    };
    const value = numeric(sample.value ?? sample.total, 0);
    current.total += value;
    current.value += value;
    current.convertedValue += value;
    current.convertedActive += value;
    current.recordsCount += 1;
    grouped.set(key, current);
  });
  const rawSources = Array.from(grouped.values())
    .map((source) => ({
      ...source,
      total: Math.round(source.total),
      value: Math.round(source.value),
      convertedValue: Math.round(source.convertedValue),
      convertedActive: Math.round(source.convertedActive),
    }))
    .filter((source) => source.recordsCount > 0 || source.total > 0)
    .sort((a, b) => (b.total - a.total) || String(a.sourceName).localeCompare(String(b.sourceName)));
  return [iosAggregateSourceSummary(aggregateSamples, aggregateTotal), ...rawSources];
}

async function iosReadSourceSamples(dataType, range) {
  try {
    return await iosReadSamples(dataType, range, iosRawSampleLimit(range));
  } catch (error) {
    console.warn("[FruitFit HealthKit] source samples unavailable", { dataType, range, message: error?.message || error });
    return [];
  }
}

function mapIosAuthorization(status = {}) {
  const readAuthorized = Array.isArray(status.readAuthorized) ? status.readAuthorized : [];
  const readDenied = Array.isArray(status.readDenied) ? status.readDenied : [];
  if (readAuthorized.length === 0 && readDenied.length === 0) {
    return {
      state: healthProviderStates.PERMISSIONS_REQUIRED,
      source: IOS_SOURCE_NAME,
      message: "Allow Apple Health access to show activity, sleep, heart rate, and recovery data.",
      readAuthorized,
      readDenied,
    };
  }
  return {
    state: readDenied.length ? healthProviderStates.PARTIALLY_GRANTED : healthProviderStates.CONNECTED,
    source: IOS_SOURCE_NAME,
    message: readDenied.length
      ? "Some Apple Health permissions are missing."
      : "Apple Health is connected.",
    readAuthorized,
    readDenied,
  };
}

async function iosAvailability() {
  try {
    const availability = await Health.isAvailable();
    if (!availability?.available) {
      return {
        state: healthProviderStates.NOT_SUPPORTED,
        source: IOS_SOURCE_NAME,
        message: availability?.reason || "Apple Health is unavailable on this device.",
      };
    }
    try {
      const status = await Health.checkAuthorization({ read: IOS_HEALTH_READ_TYPES, write: [] });
      return mapIosAuthorization(status);
    } catch (_) {
      return {
        state: healthProviderStates.PERMISSIONS_REQUIRED,
        source: IOS_SOURCE_NAME,
        message: "Allow Apple Health access to show activity, sleep, heart rate, and recovery data.",
      };
    }
  } catch (error) {
    return {
      state: healthProviderStates.ERROR,
      source: IOS_SOURCE_NAME,
      message: error?.message || "Unable to check Apple Health availability.",
    };
  }
}

async function iosRequestAuthorization() {
  try {
    const availability = await Health.isAvailable();
    if (!availability?.available) {
      return {
        state: healthProviderStates.NOT_SUPPORTED,
        source: IOS_SOURCE_NAME,
        message: availability?.reason || "Apple Health is unavailable on this device.",
      };
    }
    const status = await Health.requestAuthorization({ read: IOS_HEALTH_READ_TYPES, write: [] });
    return mapIosAuthorization(status);
  } catch (error) {
    return {
      state: healthProviderStates.ERROR,
      source: IOS_SOURCE_NAME,
      message: error?.message || "Unable to request Apple Health access.",
    };
  }
}

async function iosAggregated(dataType, range, aggregation = "sum") {
  const dates = rangeToDates(range);
  const response = await Health.queryAggregated({
    dataType,
    ...dates,
    bucket: "day",
    aggregation,
  });
  return (response?.samples || []).map((sample) => normalizeIosSample({ ...sample, dataType }, dataType));
}

async function iosReadSamples(dataType, range, limit = 1000) {
  const dates = rangeToDates(range);
  const response = await Health.readSamples({
    dataType,
    ...dates,
    limit,
    ascending: true,
  });
  return (response?.samples || []).map((sample) => normalizeIosSample({ ...sample, dataType }, dataType));
}

async function iosMetricResult(dataType, range, resultFactory, fallback) {
  try {
    const availability = await iosAvailability();
    if (![healthProviderStates.CONNECTED, healthProviderStates.PARTIALLY_GRANTED].includes(availability.state)) {
      return { ...fallback, state: availability.state, source: IOS_SOURCE_NAME, message: availability.message };
    }
    return await resultFactory();
  } catch (error) {
    return {
      ...fallback,
      state: healthProviderStates.ERROR,
      source: IOS_SOURCE_NAME,
      range,
      message: error?.message || `Unable to read Apple Health ${dataType}.`,
    };
  }
}

async function iosSteps(range = "today") {
  const fallback = { state: healthProviderStates.NO_DATA, source: IOS_SOURCE_NAME, range, total: null, rawTotal: null, selectedSourcePackage: null, recordsCount: 0, sources: [], samples: [] };
  return iosMetricResult("steps", range, async () => {
    const [samples, sourceSamples] = await Promise.all([
      iosAggregated("steps", range, "sum"),
      iosReadSourceSamples("steps", range),
    ]);
    const total = Math.round(sourceTotal(samples));
    const sourceLimit = iosRawSampleLimit(range);
    return {
      ...fallback,
      aggregateStrategy: "apple_health_aggregate",
      state: iosStateFromSamples(samples, total),
      total,
      rawTotal: total,
      selectedSourcePackage: IOS_SOURCE_PACKAGE,
      selectedSourceName: IOS_SOURCE_NAME,
      recordsCount: samples.length,
      recordsCountRaw: sourceSamples.length,
      sourceSamplesLimited: sourceSamples.length >= sourceLimit,
      sources: iosSourceSummaries(sourceSamples, samples, total),
      sourceSamples,
      samples,
    };
  }, fallback);
}

async function iosCalories(range = "today") {
  const fallback = { state: healthProviderStates.NO_DATA, source: IOS_SOURCE_NAME, range, active: null, convertedActive: null, rawActive: null, rawUnit: "kilocalorie", unit: "kcal", total: null, recordsCount: 0, sources: [], samples: [] };
  return iosMetricResult("calories", range, async () => {
    const [samples, sourceSamples] = await Promise.all([
      iosAggregated("calories", range, "sum"),
      iosReadSourceSamples("calories", range),
    ]);
    const active = Math.round(sourceTotal(samples));
    const sourceLimit = iosRawSampleLimit(range);
    return {
      ...fallback,
      aggregateStrategy: "apple_health_aggregate",
      state: iosStateFromSamples(samples, active),
      active,
      convertedActive: active,
      rawActive: active,
      total: active,
      recordsCount: samples.length,
      recordsCountRaw: sourceSamples.length,
      sourceSamplesLimited: sourceSamples.length >= sourceLimit,
      sources: iosSourceSummaries(sourceSamples, samples, active),
      sourceSamples,
      samples,
    };
  }, fallback);
}

async function iosDistance(range = "today") {
  const fallback = { state: healthProviderStates.NO_DATA, source: IOS_SOURCE_NAME, range, meters: null, samples: [] };
  return iosMetricResult("distance", range, async () => {
    const samples = await iosAggregated("distance", range, "sum");
    const meters = Math.round(sourceTotal(samples));
    return {
      ...fallback,
      state: iosStateFromSamples(samples, meters),
      meters,
      recordsCount: samples.length,
      sources: iosSourceSummary(samples, meters),
      samples,
    };
  }, fallback);
}

async function iosHeartRate(range = "today") {
  const fallback = { state: healthProviderStates.NO_DATA, source: IOS_SOURCE_NAME, range, min: null, avg: null, max: null, latestBpm: null, latestTimestamp: null, latestAgeMinutes: null, latestSourcePackage: null, recordsCount: 0, samplesCount: 0, sources: [], samples: [] };
  return iosMetricResult("heartRate", range, async () => {
    const samples = await iosReadSamples("heartRate", range, 2000);
    const values = samples.map((item) => numeric(item.value, NaN)).filter(Number.isFinite);
    const latest = [...samples].reverse().find((item) => Number.isFinite(numeric(item.value, NaN))) || null;
    const latestTimestamp = sampleTime(latest || {});
    const latestAgeMinutes = latestTimestamp ? Math.max(0, Math.round((Date.now() - new Date(latestTimestamp).getTime()) / 60000)) : null;
    return {
      ...fallback,
      state: values.length ? healthProviderStates.CONNECTED : healthProviderStates.NO_DATA,
      min: values.length ? Math.round(Math.min(...values)) : null,
      avg: values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
      max: values.length ? Math.round(Math.max(...values)) : null,
      latestBpm: latest ? Math.round(numeric(latest.value, 0)) : null,
      latestTimestamp,
      latestAgeMinutes,
      latestSourcePackage: latest?.sourcePackage || IOS_SOURCE_PACKAGE,
      recordsCount: samples.length,
      samplesCount: samples.length,
      sources: iosSourceSummary(samples, null),
      samples,
    };
  }, fallback);
}

async function iosSleep(range = "today") {
  const fallback = { state: healthProviderStates.NO_DATA, source: IOS_SOURCE_NAME, range, minutes: 0, sessions: [], fragments: [] };
  return iosMetricResult("sleep", range, async () => {
    const samples = await iosReadSamples("sleep", range === "today" ? "last24h" : range, 1000);
    const sessions = samples.map((sample) => ({
      ...sample,
      minutes: numeric(sample.value, 0),
      start: sample.startDate || sample.startTime || null,
      end: sample.endDate || sample.endTime || null,
      state: sample.sleepState || null,
    }));
    const minutes = Math.round(sessions.reduce((sum, item) => sum + numeric(item.minutes, 0), 0));
    return {
      ...fallback,
      state: sessions.length ? healthProviderStates.CONNECTED : healthProviderStates.NO_DATA,
      minutes,
      sessions,
      fragments: sessions,
      recordsCount: sessions.length,
      samples,
    };
  }, fallback);
}

async function iosWorkouts(range = "today") {
  const fallback = { state: healthProviderStates.NO_DATA, source: IOS_SOURCE_NAME, range, sessions: [] };
  return iosMetricResult("workouts", range, async () => {
    const dates = rangeToDates(range);
    const response = await Health.queryWorkouts({ ...dates, limit: 100, ascending: true });
    const sessions = (response?.workouts || []).map((item) => ({
      ...item,
      sourceName: item.sourceName || IOS_SOURCE_NAME,
      sourcePackage: item.sourceId || IOS_SOURCE_PACKAGE,
      calories: numeric(item.totalEnergyBurned, 0),
      distanceMeters: numeric(item.totalDistance, 0),
      durationSeconds: numeric(item.duration, 0),
    }));
    return {
      ...fallback,
      state: sessions.length ? healthProviderStates.CONNECTED : healthProviderStates.NO_DATA,
      sessions,
      recordsCount: sessions.length,
    };
  }, fallback);
}

async function iosWeight(range = "latest") {
  const fallback = { state: healthProviderStates.NO_DATA, source: IOS_SOURCE_NAME, range, value: null, samples: [] };
  return iosMetricResult("weight", range, async () => {
    const samples = await iosReadSamples("weight", "latest", 100);
    const latest = [...samples].reverse().find((item) => Number.isFinite(numeric(item.value, NaN))) || null;
    return {
      ...fallback,
      state: latest ? healthProviderStates.CONNECTED : healthProviderStates.NO_DATA,
      value: latest ? numeric(latest.value, null) : null,
      latestTimestamp: sampleTime(latest || {}),
      recordsCount: samples.length,
      samples,
    };
  }, fallback);
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
    return normalizeHealthProviderResult(await plugin[method](payload || {}), fallback);
  } catch (error) {
    if (isHealthRateLimitError(error)) {
      return normalizeHealthProviderResult({
        state: healthProviderStates.ERROR,
        source: "native",
        message: error?.message || "Health Connect refresh quota is temporarily limited.",
        errorCode: error?.code || error?.errorCode || null,
        samples: [],
      }, fallback);
    }
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
  if (platform === "ios") return iosAvailability();

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
  if (isIosPlatform()) return iosRequestAuthorization();
  return callPlugin("requestHealthPermissions", webUnavailable());
}

export async function openHealthSettings() {
  if (isIosPlatform()) {
    return {
      state: healthProviderStates.NOT_SUPPORTED,
      source: IOS_SOURCE_NAME,
      message: "Open Apple Health permissions from iOS Settings > Privacy & Security > Health.",
    };
  }
  return callPlugin("openHealthSettings", webUnavailable());
}

export async function openHealthSource(sourceId = "health_connect") {
  if (isIosPlatform()) {
    return {
      state: healthProviderStates.NOT_SUPPORTED,
      source: IOS_SOURCE_NAME,
      sourceId,
      message: "Apple Health source management opens from the iOS Health app.",
    };
  }
  return callPlugin("openHealthSource", webUnavailable(), { sourceId });
}

export async function getDeviceDiagnostics() {
  if (isIosPlatform()) {
    return {
      platform: "ios",
      source: IOS_SOURCE_NAME,
      message: "Native Android/Huawei diagnostics are not available on iOS.",
    };
  }
  const fallback = {
    platform: getPlatform(),
    source: "web",
    message: "Native device diagnostics are unavailable in this build.",
    installedPackages: [],
    lastNativeCrash: { exists: false, text: null },
  };
  const plugin = getDiagnosticsPlugin() || getHealthPlugin();
  if (!plugin || typeof plugin.getDeviceDiagnostics !== "function") return fallback;
  try {
    return await plugin.getDeviceDiagnostics({});
  } catch (error) {
    return { ...fallback, state: healthProviderStates.ERROR, message: error?.message || fallback.message };
  }
}

export async function getSteps(range = "today", options = {}) {
  if (isIosPlatform()) return iosSteps(range, options);
  return callPlugin(
    "getSteps",
    { state: healthProviderStates.NO_DATA, source: null, range, total: null, rawTotal: null, selectedSourcePackage: null, recordsCount: 0, sources: [], samples: [] },
    { range, ...options }
  );
}

export async function getCalories(range = "today", options = {}) {
  if (isIosPlatform()) return iosCalories(range, options);
  return callPlugin("getCalories", {
    state: healthProviderStates.NO_DATA,
    source: null,
    range,
    active: null,
    convertedActive: null,
    rawActive: null,
    rawUnit: null,
    unit: "kcal",
    total: null,
    recordsCount: 0,
    sources: [],
    samples: [],
  }, { range, ...options });
}

export async function getHeartRate(range = "today") {
  if (isIosPlatform()) return iosHeartRate(range);
  return callPlugin("getHeartRate", {
    state: healthProviderStates.NO_DATA,
    source: null,
    range,
    min: null,
    avg: null,
    max: null,
    latestBpm: null,
    latestTimestamp: null,
    latestAgeMinutes: null,
    latestSourcePackage: null,
    recordsCount: 0,
    samplesCount: 0,
    sources: [],
    samples: [],
  }, { range });
}

export async function getSleep(range = "today") {
  if (isIosPlatform()) return iosSleep(range);
  return callPlugin("getSleep", { state: healthProviderStates.NO_DATA, source: null, range, minutes: 0, sessions: [], fragments: [] }, { range });
}

export async function getSleepStages(range = "today") {
  if (isIosPlatform()) return { state: healthProviderStates.NO_DATA, source: IOS_SOURCE_NAME, range, stages: [] };
  return callPlugin("getSleepStages", { state: healthProviderStates.NO_DATA, source: null, range, stages: [] }, { range });
}

export async function getDistance(range = "today") {
  if (isIosPlatform()) return iosDistance(range);
  return callPlugin("getDistance", { state: healthProviderStates.NO_DATA, source: null, range, meters: null, samples: [] }, { range });
}

export async function getExerciseSessions(range = "today") {
  if (isIosPlatform()) return iosWorkouts(range);
  return callPlugin("getExerciseSessions", { state: healthProviderStates.NO_DATA, source: null, range, sessions: [] }, { range });
}

export async function getWeight(range = "latest") {
  if (isIosPlatform()) return iosWeight(range);
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
  { id: "huawei_health", label: "Huawei Health", hint: "EMUI / Huawei Health diagnostics" },
  { id: "health_connect", label: "Health Connect", hint: "Системный транспорт данных здоровья" },
  { id: "samsung_health", label: "Samsung Health", hint: "Galaxy Watch и Samsung Health" },
  { id: "google_fit", label: "Google Fit", hint: "Optional connected app; Health Connect aggregate remains canonical" },
  { id: "zepp", label: "Zepp / Amazfit", hint: "Amazfit и Zepp" },
  { id: "mi_fitness", label: "Mi Fitness", hint: "Xiaomi Watch / Mi Fitness" },
  { id: "whoop", label: "WHOOP", hint: "WHOOP через Health Connect / Apple Health" },
  { id: "apple_health", label: "Apple Health", hint: "iPhone и Apple Watch через HealthKit" },
];
