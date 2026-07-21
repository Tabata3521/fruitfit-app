import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  getCalories,
  getDeviceDiagnostics,
  getExerciseSessions,
  getHealthAvailability,
  getHeartRate,
  getSleep,
  getSteps,
  healthProviderStates,
  isHealthRateLimitError,
  openHealthSettings,
  requestHealthPermissions,
} from "../services/health/healthProvider";
import { fetchMenstrualCycle, saveMenstrualCycle } from "./authStore";
import { readHealthContainer, writeHealthContainer } from "./dataContainers";
import { loadProfile } from "./profileStore";
import { currentUserId } from "./userScopedCache";

export const HEALTH_STORAGE_KEY = "fruitfit.health";
const HEALTH_REFRESH_CACHE_MS = 3 * 60 * 1000;
const HEALTH_CANONICAL_SCHEMA_VERSION = 3;
const HEALTH_RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000;
const HEALTH_METRIC_TTL_MS = {
  steps: 5 * 60 * 1000,
  calories: 5 * 60 * 1000,
  heartRate: 5 * 60 * 1000,
  sleep: 30 * 60 * 1000,
  workouts: 15 * 60 * 1000,
  weight: 60 * 60 * 1000,
};
const HEALTH_QUERY_MODES = {
  DASHBOARD: "dashboard",
  HISTORY_7D: "history_7d",
  HISTORY: "history",
  DEBUG_SNAPSHOT: "debug_snapshot",
};
const CLIENT_ERROR_BUFFER_KEY = "__fruitfitClientErrors";
const CLIENT_ERROR_STORAGE_KEY = "fruitfit.client.errors";

function loadClientErrorLog() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(CLIENT_ERROR_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(-50) : [];
  } catch (_) {
    return [];
  }
}

function saveClientErrorLog(items = []) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CLIENT_ERROR_STORAGE_KEY, JSON.stringify(items.slice(-50)));
  } catch (_) {
    // Diagnostics must never break app startup.
  }
}

if (typeof window !== "undefined" && !window.__fruitfitHealthErrorListenersInstalled) {
  window.__fruitfitHealthErrorListenersInstalled = true;
  const pushClientError = (entry) => {
    const current = Array.isArray(window[CLIENT_ERROR_BUFFER_KEY]) ? window[CLIENT_ERROR_BUFFER_KEY] : [];
    const next = [...current, { at: new Date().toISOString(), ...entry }].slice(-20);
    window[CLIENT_ERROR_BUFFER_KEY] = next;
    saveClientErrorLog([...loadClientErrorLog(), ...next.slice(-1)]);
  };
  window.addEventListener("error", (event) => {
    pushClientError({ type: "error", message: event.message, source: event.filename, line: event.lineno, column: event.colno });
  });
  window.addEventListener("unhandledrejection", (event) => {
    pushClientError({ type: "unhandledrejection", message: String(event.reason?.message || event.reason || "Unhandled promise rejection") });
  });
}
const RATE_LIMITED_WIDGET_STATUSES = new Set(["rate_limited", "using_cache", "temporarily_unavailable"]);
const LEGACY_CANONICAL_STRATEGIES = new Set([
  "auto_google_fit",
  "median_cluster",
  "auto_android_phone",
  "auto_conservative_fallback",
  "preferred_user_source",
  "native_cached_selection",
  "selected_origin_not_blind_sum",
  "health_connect_records",
  "cached_snapshot",
]);

const weekLabels = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function nativeHealthDisplayName(source = "") {
  return String(source || "").toLowerCase().includes("apple") ? "Apple Health" : nativeHealthFallbackName();
}

function nativeHealthFallbackName() {
  try {
    return window?.Capacitor?.getPlatform?.() === "ios" ? "Apple Health" : "Health Connect";
  } catch (_) {
    return "Health Connect";
  }
}

const defaultCycle = {
  lastPeriodStartDate: "",
  cycleLengthDays: 28,
  periodLengthDays: 5,
  lutealPhaseLengthDays: 14,
  configured: false,
  dataSource: null,
};

const defaultHeart = {
  current: null,
  resting: null,
  baselineResting: null,
  avgWorkout: null,
  dayRange: [null, null],
  range24h: [null, null],
  avg24h: null,
  latestBpm: null,
  latestTimestamp: null,
  latestSourcePackage: null,
  latestSourceName: null,
  displayMode: "no_data",
  displayReason: "no heart-rate records",
  hourly: [],
  weekRaw: [],
  history7d: [],
  queryDiagnostics: {},
  condition: "нет",
  dataSource: null,
  status: "no_data",
};

const defaultHealthRefresh = {
  lastRefreshStartedAt: null,
  lastRefreshFinishedAt: null,
  lastNativeReadStartedAt: null,
  lastNativeReadFinishedAt: null,
  refreshDurationMs: null,
  usedCache: true,
  cacheAgeMs: null,
  cacheReason: null,
  queryMode: null,
  skippedQueryReason: null,
  skippedDueToCooldown: false,
  nativeReadReason: null,
  rateLimitedUntil: null,
  cooldownRemainingMs: 0,
  queryCount: 0,
  pagesRead: 0,
  maxPages: null,
  quotaExceeded: false,
  truncatedQueries: [],
  dataFreshness: "unknown",
  reason: null,
  errors: [],
};

const defaultSleep = {
  minutes: 0,
  quality: 3,
  date: new Date().toISOString().slice(0, 10),
  bed: "23:30",
  wake: "07:00",
  notes: "",
  week: [],
  month: [],
  weekRaw: [],
  stages: [],
  dataSource: null,
  status: "no_data",
};

const HealthContext = createContext(null);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(Number(value) || 0);
}

function timeToMinutes(value) {
  const [hours, minutes] = String(value || "00:00").split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

function sleepDurationFromTimes(bed, wake) {
  const bedMinutes = timeToMinutes(bed);
  let wakeMinutes = timeToMinutes(wake);
  if (wakeMinutes <= bedMinutes) wakeMinutes += 24 * 60;
  return clamp(wakeMinutes - bedMinutes, 0, 14 * 60);
}

function localDateTimeFromDateAndTime(dateKey, timeValue) {
  const date = String(dateKey || localDateKey());
  const time = String(timeValue || "00:00").slice(0, 5);
  const value = new Date(`${date}T${time}:00`);
  return Number.isFinite(value.getTime()) ? value : new Date();
}

function manualSleepEntryFromPatch(patch = {}) {
  const date = patch.date || localDateKey();
  const startClock = patch.startTime || patch.bed || "23:30";
  const endClock = patch.endTime || patch.wake || "07:00";
  const start = localDateTimeFromDateAndTime(date, startClock);
  const end = localDateTimeFromDateAndTime(date, endClock);
  if (end.getTime() <= start.getTime()) end.setDate(end.getDate() + 1);
  const minutes = clamp(Math.round((end.getTime() - start.getTime()) / 60000), 0, 14 * 60);
  if (minutes <= 0) return null;
  const explicitKind = String(patch.sleepKind || patch.kind || patch.type || "").toLowerCase();
  const sleepKind = explicitKind === "fragment" || minutes < 20
    ? "fragment"
    : explicitKind === "nap" || minutes < 120
      ? "nap"
      : "night";
  return normalizeSleepSessionEntry({
    date,
    sleepDate: date,
    canonicalDate: date,
    start: start.toISOString(),
    end: end.toISOString(),
    minutes,
    sleepKind,
    sourcePackage: "manual",
    sourceName: "Ручной ввод",
    notes: patch.notes || patch.comment || "",
    quality: Number(patch.quality || 4),
    manual: true,
  });
}

export function formatSleepDuration(minutes) {
  const hours = Math.floor((Number(minutes) || 0) / 60);
  const mins = round(minutes) % 60;
  return `${hours}ч ${String(mins).padStart(2, "0")}м`;
}

function emptyHistory() {
  return {
    week: lastDays(7).map((day) => ({ ...day, steps: 0, calories: 0, activeCalories: 0, totalCalories: 0, heart: 0 })),
    month: Array.from({ length: 30 }, (_, index) => ({ label: String(index + 1), steps: 0, calories: 0 })),
  };
}

function emptyMetric(goal) {
  return {
    today: 0,
    goal,
    hourly: [],
    week: [],
    month: [],
    weekRaw: [],
    monthRaw: [],
    dataSource: null,
    status: "no_data",
  };
}

function localDateKey(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(value.getTime())) return localDateKey(new Date());
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDateFromKey(dateKey) {
  const [year, month, day] = String(dateKey || "").split("-").map(Number);
  const value = new Date(year || 1970, (month || 1) - 1, day || 1, 12, 0, 0, 0);
  return Number.isFinite(value.getTime()) ? value : null;
}

function addLocalDays(dateKey, days) {
  const value = localDateFromKey(dateKey);
  if (!value) return "";
  value.setDate(value.getDate() + Number(days || 0));
  return localDateKey(value);
}

function diffLocalDays(fromDateKey, toDateKey = localDateKey()) {
  const from = localDateFromKey(fromDateKey);
  const to = localDateFromKey(toDateKey);
  if (!from || !to) return 0;
  return Math.floor((to.getTime() - from.getTime()) / 86400000);
}

function normalizeMenstrualProfile(input = {}) {
  const lastPeriodStartDate = String(input.lastPeriodStartDate || input.last_period_start_date || input.periodStartDate || "").slice(0, 10);
  const cycleLengthDays = clamp(Number(input.cycleLengthDays || input.cycle_length_days || input.cycleLength || input.length || 28), 21, 45);
  const periodLengthDays = clamp(Number(input.periodLengthDays || input.period_length_days || input.periodLength || 5), 2, 10);
  const lutealPhaseLengthDays = clamp(Number(input.lutealPhaseLengthDays || input.luteal_phase_length_days || 14), 10, 18);
  const hasValidDate = Boolean(lastPeriodStartDate && localDateFromKey(lastPeriodStartDate));
  return {
    lastPeriodStartDate: hasValidDate ? lastPeriodStartDate : "",
    cycleLengthDays,
    periodLengthDays,
    lutealPhaseLengthDays,
    configured: hasValidDate,
    dataSource: hasValidDate ? (input.dataSource || input.data_source || "manual") : null,
  };
}

export function calculateMenstrualCycle(input = {}, todayKey = localDateKey()) {
  const profile = normalizeMenstrualProfile(input);
  if (!profile.configured) {
    return {
      ...profile,
      phase: null,
      phaseLabel: "",
      day: null,
      cycleDay: null,
      length: profile.cycleLengthDays,
      progress: 0,
      nextPeriodDate: "",
      daysUntilNextPeriod: null,
      ovulationDate: "",
      daysUntilOvulation: null,
      ovulationInDays: null,
      recommendation: "Добавьте дату начала последней менструации, чтобы FruitFit рассчитал цикл.",
    };
  }

  const daysSinceStart = Math.max(0, diffLocalDays(profile.lastPeriodStartDate, todayKey));
  const cyclesPassed = Math.floor(daysSinceStart / profile.cycleLengthDays);
  const currentCycleStart = addLocalDays(profile.lastPeriodStartDate, cyclesPassed * profile.cycleLengthDays);
  const cycleDay = (daysSinceStart % profile.cycleLengthDays) + 1;
  const ovulationDay = clamp(profile.cycleLengthDays - profile.lutealPhaseLengthDays, profile.periodLengthDays + 1, profile.cycleLengthDays - 7);
  const ovulationDate = addLocalDays(currentCycleStart, ovulationDay - 1);
  let nextPeriodDate = addLocalDays(profile.lastPeriodStartDate, cyclesPassed * profile.cycleLengthDays);
  if (diffLocalDays(todayKey, nextPeriodDate) <= 0) nextPeriodDate = addLocalDays(nextPeriodDate, profile.cycleLengthDays);
  const daysUntilNextPeriod = Math.max(0, diffLocalDays(todayKey, nextPeriodDate));
  const daysUntilOvulationRaw = diffLocalDays(todayKey, ovulationDate);
  const daysUntilOvulation = daysUntilOvulationRaw >= 0 ? daysUntilOvulationRaw : null;

  let phase = "luteal";
  let phaseLabel = "Лютеиновая фаза";
  if (cycleDay <= profile.periodLengthDays) {
    phase = "menstrual";
    phaseLabel = "Менструальная фаза";
  } else if (cycleDay >= ovulationDay - 1 && cycleDay <= ovulationDay + 1) {
    phase = "ovulatory";
    phaseLabel = "Овуляторное окно";
  } else if (cycleDay < ovulationDay - 1) {
    phase = "follicular";
    phaseLabel = "Фолликулярная фаза";
  }

  const recommendations = {
    menstrual: "Можно снизить интенсивность и оставить лёгкую тренировку, растяжку или прогулку.",
    follicular: "Обычно это удобное время для постепенного повышения нагрузки, если восстановление хорошее.",
    ovulatory: "Можно тренироваться в обычном режиме, но следить за техникой и ощущениями.",
    luteal: "Лучше внимательнее следить за восстановлением, сном и уровнем утомления.",
  };

  return {
    ...profile,
    phase,
    phaseLabel,
    day: cycleDay,
    cycleDay,
    length: profile.cycleLengthDays,
    progress: Math.round((cycleDay / profile.cycleLengthDays) * 100),
    ovulationDay,
    ovulationDate,
    daysUntilOvulation,
    ovulationInDays: daysUntilOvulation,
    nextPeriodDate,
    daysUntilNextPeriod,
    recommendation: recommendations[phase],
  };
}

function readHealthHistory() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = readHealthContainer(currentUserId(), null)?.localHistory || [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function writeHealthHistory(entry) {
  if (typeof window === "undefined") return [entry];
  const userId = currentUserId();
  if (!userId) return [entry];
  const date = entry.date || localDateKey();
  const current = readHealthHistory().filter((item) => item?.date && item.date !== date);
  const next = [...current, { ...entry, date }]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(-45);
  const health = readHealthContainer(userId, {}) || {};
  writeHealthContainer({ ...health, localHistory: next }, userId);
  return next;
}

function historySeries(history = [], field, days = 7) {
  const today = new Date();
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (days - 1 - index));
    const key = localDateKey(date);
    const item = history.find((entry) => entry.date === key);
    return round(item?.[field] || 0);
  });
}

function overlayCalendarHistory(series = [], historyValues = [], todayValue = 0) {
  const todayKey = localDateKey();
  const numericToday = round(todayValue || 0);
  return lastDays(7).map((day, index) => {
    const historyValue = round(historyValues[index] || 0);
    if (historyValue > 0) return historyValue;
    if (day.date === todayKey && numericToday > 0) return numericToday;
    return round(series[index] || 0);
  });
}

function hasPositiveSeries(values = []) {
  return asArray(values).some((value) => Number(value || 0) > 0);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function positiveNumbers(values = []) {
  return asArray(values)
    .map((value) => Number(value || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function averagePositive(values = []) {
  const numbers = positiveNumbers(values);
  if (!numbers.length) return 0;
  return round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length);
}

function sumPositive(values = []) {
  return round(positiveNumbers(values).reduce((sum, value) => sum + value, 0));
}

function isLegacyCanonicalStrategy(value) {
  const strategy = String(value || "").toLowerCase();
  return LEGACY_CANONICAL_STRATEGIES.has(strategy)
    || strategy.includes("auto_google_fit")
    || strategy.includes("median_cluster")
    || strategy.includes("suspicioushigh");
}

function sleepSessionFingerprint(session = {}) {
  const start = timestampMs(session.start || session.startTime || session.date) || 0;
  const end = timestampMs(session.end || session.endTime || session.finish || session.finishTime) || 0;
  const minutes = round(session.minutes || (start && end ? (end - start) / 60000 : 0));
  return `${Math.round(start / 60000)}|${Math.round(end / 60000)}|${minutes}`;
}

function sleepSessionQuality(session = {}) {
  const manualBonus = session.manual || session.sourcePackage === "manual" ? 1000000 : 0;
  return manualBonus + asArray(session.stages).length * 10000 + Number(session.minutes || 0);
}

function dedupeSleepSessionsForCanonical(sessions = []) {
  const byKey = new Map();
  asArray(sessions).forEach((session) => {
    const minutes = Number(session?.minutes || 0);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    const key = sleepSessionFingerprint(session);
    const current = byKey.get(key);
    if (!current || sleepSessionQuality(session) > sleepSessionQuality(current)) {
      byKey.set(key, session);
    }
  });
  return Array.from(byKey.values())
    .sort((a, b) => (timestampMs(a.start || a.end) || 0) - (timestampMs(b.start || b.end) || 0));
}

function canonicalSleepMinutesFromState(sleep = {}) {
  const dedupedSessions = dedupeSleepSessionsForCanonical(sleep.sessions || []);
  const todaySessions = dedupedSessions.filter((session) => isSameLocalDay(session.end || session.start || session.date));
  const todayMinutes = todaySessions.reduce((sum, session) => sum + Number(session.minutes || 0), 0);
  const aggregateMinutes = Number(sleep.aggregateMinutes || 0);
  if (aggregateMinutes > 0 && todayMinutes > 0 && aggregateMinutes >= todayMinutes * 1.5) return round(todayMinutes);
  if (aggregateMinutes > 0) return round(aggregateMinutes);
  const aggregateToday = (sleep.samples || [])
    .filter((sample) => isSameLocalDay(sample.end || sample.start || sample.date))
    .reduce((sum, sample) => sum + Number(sample.value || sample.minutes || 0), 0);
  if (aggregateToday > 0 && todayMinutes > 0 && aggregateToday >= todayMinutes * 1.5) return round(todayMinutes);
  if (aggregateToday > 0) return round(aggregateToday);
  if (todayMinutes > 0) return round(todayMinutes);
  const latest = latestSleepSession(dedupedSessions);
  return round(latest?.minutes || sleep.minutes || 0);
}

function sanitizeCanonicalHealthState(state = {}) {
  const steps = { ...(state.steps || {}) };
  const calories = { ...(state.calories || {}) };
  const sleep = { ...(state.sleep || {}) };

  const stepsLegacy = isLegacyCanonicalStrategy(steps.selectedSourceStrategy)
    || isLegacyCanonicalStrategy(steps.autoStrategy)
    || isLegacyCanonicalStrategy(steps.aggregateStrategy);
  if (stepsLegacy) {
    Object.assign(steps, {
      today: 0,
      hourly: [],
      sourceName: "Health Connect aggregate",
      sourcePackage: null,
      selectedSourceReason: "Legacy source-selected value ignored; waiting for Health Connect aggregate.",
      selectedSourceStrategy: "health_connect_aggregate_required",
      autoStrategy: null,
      suspiciousSources: [],
      suspiciousHighSources: [],
      rejectedSources: [],
      suspiciousReason: null,
      rawTotal: 0,
      aggregateStrategy: "health_connect_aggregate_required",
      dataSource: null,
      status: "no_data",
    });
  }

  const caloriesLegacy = isLegacyCanonicalStrategy(calories.selectedSourceStrategy)
    || isLegacyCanonicalStrategy(calories.aggregateStrategy);
  if (caloriesLegacy) {
    Object.assign(calories, {
      today: 0,
      activeToday: 0,
      hourly: [],
      sourceName: "Health Connect aggregate",
      sourcePackage: null,
      selectedSourceReason: "Legacy calorie source-selected value ignored; waiting for Health Connect aggregate.",
      selectedSourceStrategy: "health_connect_aggregate_required",
      suspiciousSources: [],
      rejectedSources: [],
      suspicious: false,
      suspiciousReason: null,
      rawActiveToday: null,
      convertedActiveToday: null,
      recordsToday: 0,
      samplesToday: 0,
      dataSource: null,
      status: "no_data",
    });
  }

  const manualSleepEntries = dedupeManualSleepEntries(asArray(sleep.manualSleepEntries));
  const dedupedSleepSessions = normalizeSleepEntriesForDisplay([
    ...manualSleepEntries,
    ...asArray(sleep.sessions),
    ...asArray(sleep.naps),
    ...asArray(sleep.fragments),
  ]);
  const sleepTimeline = buildCanonicalSleepTimeline(dedupedSleepSessions);
  const todaySleepDay = sleepTimeline.days.find((day) => day.date === localDateKey()) || sleepTimeline.days.slice(-1)[0] || null;
  const legacyTrackerSleepWithoutEvidence = Number(state.healthSchemaVersion || 0) < HEALTH_CANONICAL_SCHEMA_VERSION
    && sleep.dataSource === "tracker"
    && !dedupedSleepSessions.length
    && !Number(sleep.aggregateMinutes || 0)
    && !asArray(sleep.samples).length;
  const canonicalSleepMinutes = legacyTrackerSleepWithoutEvidence ? 0 : round(todaySleepDay?.totalMinutes || canonicalSleepMinutesFromState({ ...sleep, sessions: dedupedSleepSessions }));
  Object.assign(sleep, {
    sessions: dedupedSleepSessions,
    canonicalTimeline: sleepTimeline.days,
    mainSleepSessions: sleepTimeline.mainSleepSessions,
    naps: sleepTimeline.naps,
    fragments: sleepTimeline.fragments,
    shortFragmentsUnder2h: dedupedSleepSessions.filter((session) => Number(session.minutes || 0) < 120),
    manualSleepEntries,
    nightMinutes: round(todaySleepDay?.nightMinutes || 0),
    napMinutes: round(todaySleepDay?.napMinutes || 0),
    fragmentMinutes: round(todaySleepDay?.fragmentMinutes || 0),
    latestNap: sleepTimeline.latestNap || sleep.latestNap || null,
    minutes: canonicalSleepMinutes,
    latestSleep: sleepTimeline.latestSleep || sleep.latestSleep || null,
    dataSource: legacyTrackerSleepWithoutEvidence ? null : sleep.dataSource,
    status: legacyTrackerSleepWithoutEvidence ? "no_data" : sleep.status,
  });
  if (dedupedSleepSessions.length && Array.isArray(sleep.week)) {
    sleep.week = buildSleepWeekFromTimeline(sleepTimeline);
    sleep.weekRaw = sleep.week.map((item) => round(item.minutes));
  }

  return {
    ...state,
    healthSchemaVersion: HEALTH_CANONICAL_SCHEMA_VERSION,
    steps,
    calories,
    sleep,
  };
}

function sleepWeekMinutes(sleep = {}) {
  if (asArray(sleep.weekRaw).length) return positiveNumbers(sleep.weekRaw);
  if (asArray(sleep.week).length) return positiveNumbers(asArray(sleep.week).map((item) => item?.minutes));
  return [];
}

function heartHistoryValues(heart = {}, key = "avg") {
  return positiveNumbers(asArray(heart.history7d).map((item) => item?.[key]));
}

function makeEmptyHealth(saved = {}) {
  const resetTrackerCache = Number(saved.healthSchemaVersion || 0) < HEALTH_CANONICAL_SCHEMA_VERSION;
  const savedSleep = resetTrackerCache && saved.sleep?.dataSource === "tracker" ? {} : (saved.sleep || {});
  const savedHeart = resetTrackerCache && saved.heart_rate?.dataSource === "tracker" ? {} : (saved.heart_rate || {});
  const sleep = { ...defaultSleep, ...savedSleep };
  const heart = { ...defaultHeart, ...savedHeart };
  const cycle = calculateMenstrualCycle({ ...defaultCycle, ...(saved.cycle || {}) });
  const data = {
    healthSchemaVersion: saved.healthSchemaVersion || 0,
    generatedAt: saved.generatedAt || new Date().toISOString(),
    dataSource: saved.dataSource || null,
    providerState: saved.providerState || "not_supported",
    providerSource: saved.providerSource || "web",
    providerMessage: saved.providerMessage || "Трекер не подключён",
    rateLimitedUntil: resetTrackerCache ? null : saved.rateLimitedUntil || null,
    lastRateLimitAt: resetTrackerCache ? null : saved.lastRateLimitAt || null,
    lastSuccessfulNativeReadAt: resetTrackerCache ? null : saved.lastSuccessfulNativeReadAt || null,
    cacheAgeMs: resetTrackerCache ? null : saved.cacheAgeMs ?? null,
    cacheReason: resetTrackerCache ? null : saved.cacheReason || null,
    preferredStepSourcePackage: saved.preferredStepSourcePackage || (typeof window !== "undefined" ? localStorage.getItem("fruitfit.health.preferredSourcePackage") || "" : ""),
    steps: !resetTrackerCache && saved.steps?.dataSource ? { ...emptyMetric(10000), ...saved.steps } : emptyMetric(saved.steps?.goal || 10000),
    calories: !resetTrackerCache && saved.calories?.dataSource ? { ...emptyMetric(650), ...saved.calories } : emptyMetric(saved.calories?.goal || 650),
    sleep,
    heart_rate: heart,
    workouts: !resetTrackerCache && saved.workouts?.dataSource ? { recentWorkouts: 0, recentLoad: 0, status: "no_data", ...saved.workouts } : {
      recentWorkouts: 0,
      recentLoad: 0,
      dataSource: null,
      status: "no_data",
    },
    recovery: {
      subjectiveFatigue: saved.recovery?.subjectiveFatigue || 0,
      dataSource: saved.recovery?.dataSource || null,
      status: saved.recovery?.status || "no_data",
    },
    healthRefresh: resetTrackerCache ? { ...defaultHealthRefresh } : { ...defaultHealthRefresh, ...(saved.healthRefresh || {}) },
    localHistory: resetTrackerCache ? [] : Array.isArray(saved.localHistory) ? saved.localHistory : [],
    history7d: resetTrackerCache ? { steps: [], calories: [], heartRate: [], sleep: [] } : saved.history7d || { steps: [], calories: [], heartRate: [], sleep: [] },
    cycle,
    activity_history: !resetTrackerCache && saved.activity_history?.week?.length ? saved.activity_history : emptyHistory(),
  };
  const sanitized = sanitizeCanonicalHealthState(data);
  return { ...sanitized, readiness: calculateReadiness(sanitized) };
}

function recoveryStatus(score) {
  if (score == null) return "Нет данных";
  if (score >= 80) return "Хорошее восстановление";
  if (score >= 60) return "Обычная нагрузка";
  if (score >= 40) return "Снизить нагрузку";
  return "Низкое восстановление";
}

function calculateRecoveryReadiness(data = {}) {
  const sleep = data.sleep || {};
  const heart = data.heart_rate || {};
  const timeline = buildCanonicalSleepTimeline(sleep);
  const days = timeline.days || [];
  const today = days.find((day) => day.date === localDateKey()) || days.slice(-1)[0] || {};
  const latestNight = [...days].reverse().find((day) => Number(day.nightMinutes || 0) > 0) || {};
  const sleepLastNightMinutes = round(latestNight.nightMinutes || 0);
  const sleep7dAverageMinutes = averagePositive(days.map((day) => Number(day.nightMinutes || 0)));
  const napsTodayMinutes = round(today.napMinutes || 0);
  const heartAvg24h = Number(heart.avg24h || 0) || null;
  const heartAvg7d = Number(heart.avg7d || 0)
    || averagePositive(asArray(heart.history7d).map((item) => item?.avg || item?.latestBpm || 0))
    || null;
  const heartRange24h = heart.range24h || heart.dayRange || [heart.min24h || null, heart.max24h || null];
  const heartRange7d = heart.range7d || [null, null];
  const stepsToday = Number(data.steps?.today || 0) || 0;
  const stepsAverage7d = averagePositive(asArray(data.steps?.weekRaw).length ? data.steps.weekRaw : data.steps?.week);
  const hasData = Boolean(timeline.entries.length || sleep.dataSource || heart.dataSource || data.steps?.dataSource || data.workouts?.dataSource);

  if (!hasData) {
    return {
      score: null,
      status: "Нет данных",
      recommendation: "Подключите трекер или внесите сон вручную.",
      dataSource: null,
      factors: [
        { id: "sleepLastNight", label: "Сон прошлой ночи", value: "нет данных", score: null, impact: 0 },
        { id: "pulse", label: "Пульс за сутки", value: "нет данных", score: null, impact: 0 },
        { id: "activity", label: "Активность", value: "нет данных", score: null, impact: 0 },
      ],
      sleepLastNightMinutes: 0,
      sleep7dAverageMinutes: 0,
      napsTodayMinutes: 0,
      heartAvg24h,
      heartAvg7d,
      heartRange24h,
      heartRange7d,
      stepsToday,
      activityStatus: "no_data",
      dataCompleteness: 0,
    };
  }

  let score = 70;
  const factors = [];

  let sleepImpact = -10;
  let sleepFactorScore = 45;
  if (sleepLastNightMinutes >= 420) {
    sleepImpact = 15;
    sleepFactorScore = 100;
  } else if (sleepLastNightMinutes >= 360) {
    sleepImpact = 5;
    sleepFactorScore = 75;
  } else if (sleepLastNightMinutes >= 300) {
    sleepImpact = -10;
    sleepFactorScore = 45;
  } else if (sleepLastNightMinutes > 0) {
    sleepImpact = -25;
    sleepFactorScore = 20;
  }
  score += sleepImpact;
  factors.push({
    id: "sleepLastNight",
    label: "Сон прошлой ночи",
    value: sleepLastNightMinutes ? formatSleepDuration(sleepLastNightMinutes) : "нет данных",
    score: sleepFactorScore,
    impact: sleepImpact,
  });

  let sleepAverageImpact = 0;
  if (sleep7dAverageMinutes >= 420) sleepAverageImpact = 10;
  else if (sleep7dAverageMinutes > 0 && sleep7dAverageMinutes < 360) sleepAverageImpact = -10;
  score += sleepAverageImpact;
  factors.push({
    id: "sleep7d",
    label: "Средний сон 7д",
    value: sleep7dAverageMinutes ? formatSleepDuration(sleep7dAverageMinutes) : "нет данных",
    score: sleep7dAverageMinutes >= 420 ? 100 : sleep7dAverageMinutes >= 360 ? 70 : sleep7dAverageMinutes > 0 ? 40 : 45,
    impact: sleepAverageImpact,
  });

  let napImpact = 0;
  if (napsTodayMinutes >= 20 && napsTodayMinutes <= 90) napImpact = 5;
  else if (napsTodayMinutes > 120) napImpact = -5;
  score += napImpact;
  if (napsTodayMinutes > 0) {
    factors.push({
      id: "naps",
      label: "Дремы сегодня",
      value: formatSleepDuration(napsTodayMinutes),
      score: napImpact > 0 ? 85 : napImpact < 0 ? 55 : 70,
      impact: napImpact,
    });
  }

  let heartImpact = 0;
  if (heartAvg24h && heartAvg7d) {
    const diff = heartAvg24h - heartAvg7d;
    if (diff >= 8) heartImpact = -15;
    else if (diff >= 4) heartImpact = -7;
    else if (diff < -2 && sleepLastNightMinutes >= 420) heartImpact = 5;
  }
  score += heartImpact;
  factors.push({
    id: "pulse",
    label: "Пульс за сутки",
    value: heartAvg24h ? `${heartRange24h?.[0] || "?"}-${heartRange24h?.[1] || "?"} уд/мин` : "нет данных",
    score: heartImpact >= 5 ? 90 : heartImpact === 0 ? 70 : heartImpact === -7 ? 55 : 35,
    impact: heartImpact,
  });

  const poorSleep = sleepLastNightMinutes > 0 && sleepLastNightMinutes < 360;
  const highActivity = stepsToday && stepsAverage7d && stepsToday > stepsAverage7d * 1.6;
  const activityImpact = highActivity && poorSleep ? -10 : 0;
  score += activityImpact;
  const activityStatus = activityImpact < 0 ? "high_activity_with_poor_sleep" : stepsToday > 0 ? "moderate_or_ok" : "no_steps_data";
  factors.push({
    id: "activity",
    label: "Активность",
    value: stepsToday ? `${stepsToday.toLocaleString("ru-RU")} шагов` : "нет данных",
    score: activityImpact < 0 ? 45 : 70,
    impact: activityImpact,
  });

  const finalScore = clamp(round(score), 0, 100);
  const dataCompleteness = round(([
    sleepLastNightMinutes > 0,
    sleep7dAverageMinutes > 0,
    Boolean(heartAvg24h),
    Boolean(heartAvg7d),
    stepsToday > 0,
  ].filter(Boolean).length / 5) * 100);

  return {
    score: finalScore,
    status: recoveryStatus(finalScore),
    recommendation: getRecoveryRecommendation(finalScore),
    dataSource: "canonical_sleep_timeline",
    factors,
    sleepLastNightMinutes,
    sleep7dAverageMinutes,
    napsTodayMinutes,
    heartAvg24h,
    heartAvg7d,
    heartRange24h,
    heartRange7d,
    stepsToday,
    activityStatus,
    dataCompleteness,
  };
}

function getRecoveryRecommendation(score) {
  if (score == null) return "Подключите трекер или внесите сон вручную.";
  if (score >= 80) return "Восстановление хорошее. Можно тренироваться полноценно.";
  if (score >= 60) return "Нормальное состояние. Подходит обычная тренировка без перегруза.";
  if (score >= 40) return "Восстановление среднее. Лучше снизить объём или интенсивность.";
  return "Восстановление низкое. Лучше лёгкая активность, техника, прогулка или отдых.";
}

export function calculateReadiness(data) {
  return calculateRecoveryReadiness(data);
  const sleep = data.sleep || {};
  const heart = data.heart_rate || {};
  const hasTrackerData = Boolean(
    sleep.dataSource ||
    heart.dataSource ||
    data.steps?.dataSource ||
    data.calories?.dataSource ||
    data.workouts?.dataSource
  );

  if (!hasTrackerData) {
    return {
      score: null,
      recommendation: "Подключите трекер или внесите сон вручную, чтобы рассчитать восстановление.",
      dataSource: null,
      factors: [
        { id: "sleep", label: "Сон", value: sleep.dataSource ? formatSleepDuration(sleep.minutes) : "нет данных", score: null },
        { id: "pulse", label: "Пульс покоя", value: heart.dataSource ? `${heart.resting || 0} уд/мин` : "нет данных", score: null },
        { id: "activity", label: "Активность", value: data.steps?.dataSource ? `${data.steps.today || 0} шагов` : "нет данных", score: null },
        { id: "calories", label: "Активные калории", value: data.calories?.dataSource ? `${data.calories.today || 0} ккал` : "нет данных", score: null },
      ],
    };
  }

  const sleepAverage7d = averagePositive(sleepWeekMinutes(sleep));
  const sleepForScore = sleepAverage7d || sleep.minutes || 0;
  const sleepScore = sleep.dataSource
    ? clamp((sleepForScore / 480) * 70 + (sleep.quality || 1) * 6, 0, 100)
    : 45;
  const min24h = Number(heart.min24h || heart.range24h?.[0] || 0) || 0;
  const max24h = Number(heart.max24h || heart.range24h?.[1] || 0) || 0;
  const avg24h = Number(heart.avg24h || 0) || 0;
  const historyMin = averagePositive(heartHistoryValues(heart, "min"));
  const historyAvg = averagePositive(heartHistoryValues(heart, "avg"));
  const resting = min24h || historyMin || heart.resting || heart.baselineResting || 60;
  const baseline = heart.baselineResting || historyMin || resting;
  const pulseRange = min24h && max24h ? max24h - min24h : 0;
  const pulseAverage = avg24h || historyAvg || heart.avgWorkout || resting;
  const restingPenalty = Math.max(0, resting - baseline) * 4;
  const rangePenalty = Math.max(0, pulseRange - 75) * 0.35;
  const averagePenalty = Math.max(0, pulseAverage - 95) * 0.8;
  const pulseScore = heart.dataSource ? clamp(100 - restingPenalty - rangePenalty - averagePenalty, 20, 100) : 55;
  const stepsToday = data.steps?.today || 0;
  const stepsAverage7d = averagePositive(asArray(data.steps?.weekRaw).length ? data.steps.weekRaw : data.steps?.week);
  const steps = stepsAverage7d || stepsToday;
  const caloriesToday = data.calories?.today || 0;
  const caloriesAverage7d = averagePositive(asArray(data.calories?.weekRaw).length ? data.calories.weekRaw : data.calories?.week);
  const calories = caloriesAverage7d || caloriesToday;
  const activityScore = data.steps?.dataSource ? clamp(100 - Math.abs(steps - 8500) / 95, 25, 100) : 55;
  const caloriesScore = data.calories?.dataSource ? clamp(100 - Math.abs(calories - 430) / 6, 20, 100) : 55;
  const score = clamp(round(sleepScore * 0.38 + pulseScore * 0.24 + activityScore * 0.22 + caloriesScore * 0.16), 0, 100);

  return {
    score,
    recommendation: getRecommendation(score),
    dataSource: "tracker_or_manual",
    factors: [
      { id: "sleep", label: "Сон", value: sleep.dataSource ? formatSleepDuration(sleepForScore) : "нет данных", score: round(sleepScore) },
      { id: "pulse", label: "Пульс 24ч", value: heart.dataSource ? `${resting}/${pulseAverage}/${max24h || "?"} уд/мин` : "нет данных", score: round(pulseScore) },
      { id: "activity", label: "Активность", value: data.steps?.dataSource ? `${steps.toLocaleString("ru-RU")} шагов/день` : "нет данных", score: round(activityScore) },
      { id: "calories", label: "Активные калории", value: data.calories?.dataSource ? `${calories} ккал/день` : "нет данных", score: round(caloriesScore) },
    ],
  };
}

function getRecommendation(score) {
  if (score == null) return "Подключите трекер или внесите сон вручную.";
  if (score >= 85) return "Можно тренироваться полноценно.";
  if (score >= 70) return "Нормальная нагрузка, без лишнего добивания.";
  if (score >= 50) return "Лучше умеренная тренировка: снизить объём или интенсивность.";
  if (score >= 30) return "Сегодня лучше лёгкая активность, техника, прогулка или мобилити.";
  return "Тяжёлую нагрузку лучше не планировать, сделайте упор на восстановление.";
}

export function createHealthSnapshot(_scenario = "empty", _range = "week", previous = null) {
  return makeEmptyHealth(previous || {});
}

function loadHealthData() {
  if (typeof window === "undefined") return makeEmptyHealth();
  try {
    const saved = readHealthContainer(currentUserId(), null);
    if (saved && typeof saved === "object") {
      return makeEmptyHealth(saved);
    }
  } catch (_) {
    // Ignore corrupt local data.
  }
  return makeEmptyHealth();
}

function timestampMs(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function healthCacheAgeMs(state = {}, now = Date.now()) {
  const stamp = timestampMs(state.lastSuccessfulNativeReadAt)
    || timestampMs(state.healthRefresh?.lastNativeReadFinishedAt)
    || timestampMs(state.lastFruitFitRefreshAt);
  if (!stamp) return null;
  return Math.max(0, now - stamp);
}

function healthCooldownRemainingMs(state = {}, now = Date.now()) {
  const until = timestampMs(state.rateLimitedUntil);
  if (!until) return 0;
  return Math.max(0, until - now);
}

function metricCacheAgeMs(metric = {}, state = {}, now = Date.now()) {
  const stamp = timestampMs(metric?.lastNativeReadAt)
    || timestampMs(metric?.lastHistoryReadAt)
    || timestampMs(state?.lastSuccessfulNativeReadAt)
    || timestampMs(state?.healthRefresh?.lastNativeReadFinishedAt);
  if (!stamp) return null;
  return Math.max(0, now - stamp);
}

function metricHasHistoryCache(metric = {}, kind = "metric") {
  if (kind === "steps" || kind === "calories") {
    return hasPositiveSeries(metric.weekRaw || [])
      || hasPositiveSeries(metric.monthRaw || []);
  }
  if (kind === "heart") {
    return hasPositiveSeries(metric.weekRaw || [])
      || hasPositiveSeries(asArray(metric.history7d).map((item) => item?.avg || item?.latestBpm || 0));
  }
  if (kind === "sleep") {
    return hasPositiveSeries(metric.weekRaw) || asArray(metric.week).some((item) => Number(item?.minutes || 0) > 0);
  }
  if (kind === "workouts") return Number(metric.recentWorkouts || metric.recentLoad || 0) > 0;
  return metricHasCache(metric, kind);
}

function canUseMetricCache(state = {}, metricKey, kind, ttlMs, { history = false, now = Date.now() } = {}) {
  const metric = state?.[metricKey] || {};
  const hasCache = history ? metricHasHistoryCache(metric, kind) : metricHasCache(metric, kind);
  if (!hasCache) return false;
  const age = metricCacheAgeMs(metric, state, now);
  return age != null && age < ttlMs;
}

function rateLimitUntilIso(now = Date.now()) {
  return new Date(now + HEALTH_RATE_LIMIT_COOLDOWN_MS).toISOString();
}

function isRateLimitedResult(result) {
  return result?.state === healthProviderStates.RATE_LIMITED || isHealthRateLimitError(result);
}

function hasRateLimitedResult(results = []) {
  return asArray(results).some(isRateLimitedResult);
}

function metricHasCache(metric = {}, kind = "metric") {
  if (!metric) return false;
  if (metric.dataSource) return true;
  if (kind === "steps" || kind === "calories") {
    return Number(metric.today || metric.activeToday || 0) > 0
      || hasPositiveSeries(metric.week || [])
      || hasPositiveSeries(metric.month || []);
  }
  if (kind === "heart") {
    return Number(metric.latestBpm || metric.avg24h || metric.min24h || metric.max24h || 0) > 0
      || hasPositiveSeries(metric.hourly || [])
      || hasPositiveSeries(metric.weekRaw || [])
      || hasPositiveSeries(asArray(metric.history7d).map((item) => item?.avg || item?.latestBpm || 0));
  }
  if (kind === "sleep") {
    return Number(metric.minutes || 0) > 0 || hasPositiveSeries(metric.weekRaw) || asArray(metric.week).some((item) => Number(item?.minutes || 0) > 0);
  }
  if (kind === "workouts") {
    return Number(metric.recentWorkouts || metric.recentLoad || 0) > 0;
  }
  return Boolean(metric.dataSource);
}

function rateLimitedWidgetState(metric = {}, kind = "metric") {
  return metricHasCache(metric, kind) ? "using_cache" : "temporarily_unavailable";
}

function withRateLimitedMetric(metric = {}, kind = "metric") {
  return {
    ...metric,
    status: "rate_limited",
    widgetState: rateLimitedWidgetState(metric, kind),
    rateLimited: true,
  };
}

function cachedMetricResult(kind, range, metric = {}, extra = {}) {
  const base = {
    state: metricHasCache(metric, kind) || metricHasHistoryCache(metric, kind) ? healthProviderStates.CONNECTED : healthProviderStates.NO_DATA,
    range,
    skipped: true,
    skippedReason: "metric_cache_fresh",
    recordsCount: 0,
    recordsRawCount: 0,
    samplesCount: 0,
    queryCount: 0,
    pagesRead: 0,
    maxPages: null,
    truncated: false,
    quotaExceeded: false,
    sources: metric.sources || [],
    samples: [],
    source: metric.sourceName || metric.latestSourceName || nativeHealthFallbackName(),
    sourceName: metric.sourceName || metric.latestSourceName || null,
    sourcePackage: metric.sourcePackage || metric.latestSourcePackage || null,
    ...extra,
  };
  return base;
}

function cachedStepsResult(range, metric = {}) {
  return cachedMetricResult("steps", range, metric, {
    total: range === "today" ? metric.today || 0 : 0,
    rawTotal: range === "today" ? metric.rawTotal || metric.today || 0 : 0,
    selectedSourcePackage: null,
    selectedSourceName: "Health Connect aggregate",
    aggregateStrategy: "health_connect_aggregate",
  });
}

function cachedCaloriesResult(range, metric = {}) {
  return cachedMetricResult("calories", range, metric, {
    active: range === "today" ? metric.activeToday ?? metric.today ?? null : null,
    convertedActive: range === "today" ? metric.convertedActiveToday ?? metric.activeToday ?? metric.today ?? null : null,
    rawActive: range === "today" ? metric.rawActiveToday ?? null : null,
    rawUnit: metric.rawUnit || null,
    unit: metric.unit || "kcal",
    total: range === "today" ? metric.totalToday ?? null : null,
    aggregateStrategy: "health_connect_aggregate",
    selectedSourceStrategy: "health_connect_aggregate",
  });
}

function cachedHeartResult(range, metric = {}) {
  return cachedMetricResult("heart", range, metric, {
    min: range === "week" ? metric.range7d?.[0] || null : metric.min24h || metric.range24h?.[0] || null,
    avg: range === "week" ? metric.avg7d || null : metric.avg24h || null,
    max: range === "week" ? metric.range7d?.[1] || null : metric.max24h || metric.range24h?.[1] || null,
    latestBpm: metric.latestBpm || null,
    latestTimestamp: metric.latestTimestamp || null,
    latestAgeMinutes: metric.ageMinutes ?? null,
    latestSourcePackage: metric.latestSourcePackage || metric.sourcePackage || null,
    latestSourceName: metric.latestSourceName || metric.sourceName || null,
    recordsCount: range === "week" ? metric.records7d || 0 : metric.records24h || 0,
    recordsRawCount: range === "week" ? metric.records7d || 0 : metric.records24h || 0,
    samplesCount: range === "week" ? metric.samples7d || 0 : metric.samples24h || 0,
  });
}

function cachedSleepResult(range, metric = {}) {
  return cachedMetricResult("sleep", range, metric, {
    minutes: metric.minutes || 0,
    sessions: metric.sessions || [],
    fragments: metric.fragments || [],
    latestSleep: metric.latestSleep || null,
  });
}

function cachedWorkoutsResult(range, metric = {}) {
  return cachedMetricResult("workouts", range, metric, {
    sessions: [],
  });
}

function buildRateLimitHealthState(previous = makeEmptyHealth(), options = {}) {
  const now = options.now || Date.now();
  const nowIso = new Date(now).toISOString();
  const cacheAgeMs = healthCacheAgeMs(previous, now);
  const rateLimitedUntil = options.rateLimitedUntil || previous.rateLimitedUntil || rateLimitUntilIso(now);
  const cooldownMs = Math.max(0, timestampMs(rateLimitedUntil) - now);
  const cacheReason = options.skippedDueToCooldown ? "rate_limit_cooldown" : "rate_limit";
  const next = {
    ...previous,
    generatedAt: nowIso,
    lastFruitFitRefreshAt: nowIso,
    providerState: healthProviderStates.RATE_LIMITED,
    providerSource: previous.providerSource || "Health Connect",
    providerMessage: "Health Connect refresh quota is temporarily limited.",
    rateLimitedUntil,
    lastRateLimitAt: options.skippedDueToCooldown ? (previous.lastRateLimitAt || nowIso) : nowIso,
    cacheAgeMs,
    cacheReason,
    steps: withRateLimitedMetric(previous.steps, "steps"),
    calories: withRateLimitedMetric(previous.calories, "calories"),
    heart_rate: {
      ...withRateLimitedMetric(previous.heart_rate, "heart"),
      freshness: "rate_limited",
      displayMode: metricHasCache(previous.heart_rate, "heart") ? (previous.heart_rate?.displayMode || "range_today") : "temporarily_unavailable",
      displayReason: metricHasCache(previous.heart_rate, "heart")
        ? "Health Connect rate-limited; showing cached heart-rate snapshot"
        : "Health Connect rate-limited and no cached heart-rate snapshot is available",
    },
    sleep: withRateLimitedMetric(previous.sleep, "sleep"),
    workouts: withRateLimitedMetric(previous.workouts, "workouts"),
    recovery: {
      ...(previous.recovery || {}),
      status: "rate_limited",
      widgetState: rateLimitedWidgetState(previous.recovery, "metric"),
    },
    healthRefresh: {
      ...defaultHealthRefresh,
      ...(previous.healthRefresh || {}),
      lastRefreshStartedAt: options.lastRefreshStartedAt || previous.healthRefresh?.lastRefreshStartedAt || nowIso,
      lastRefreshFinishedAt: options.lastRefreshFinishedAt || nowIso,
      lastNativeReadStartedAt: options.lastNativeReadStartedAt || previous.healthRefresh?.lastNativeReadStartedAt || null,
      lastNativeReadFinishedAt: options.lastNativeReadFinishedAt || previous.healthRefresh?.lastNativeReadFinishedAt || null,
      refreshDurationMs: options.refreshDurationMs ?? previous.healthRefresh?.refreshDurationMs ?? null,
      usedCache: true,
      cacheAgeMs,
      cacheReason,
      queryMode: options.queryMode || previous.healthRefresh?.queryMode || HEALTH_QUERY_MODES.DASHBOARD,
      skippedQueryReason: options.skippedQueryReason || cacheReason,
      skippedDueToCooldown: Boolean(options.skippedDueToCooldown),
      nativeReadReason: options.nativeReadReason || null,
      rateLimitedUntil,
      cooldownRemainingMs: cooldownMs,
      queryCount: options.queryStats?.queryCount ?? previous.healthRefresh?.queryCount ?? 0,
      pagesRead: options.queryStats?.pagesRead ?? previous.healthRefresh?.pagesRead ?? 0,
      maxPages: options.queryStats?.maxPages ?? previous.healthRefresh?.maxPages ?? null,
      quotaExceeded: true,
      truncatedQueries: options.queryStats?.truncatedQueries || previous.healthRefresh?.truncatedQueries || [],
      dataFreshness: metricHasCache(previous.steps, "steps") || metricHasCache(previous.heart_rate, "heart") || metricHasCache(previous.sleep, "sleep")
        ? "rate_limited_using_cache"
        : "rate_limited_no_cache",
      reason: options.reason || previous.healthRefresh?.reason || "health-refresh",
      errors: options.errors || previous.healthRefresh?.errors || [],
    },
  };
  const sanitized = sanitizeCanonicalHealthState(next);
  return { ...sanitized, readiness: calculateReadiness(sanitized) };
}

function buildCacheHitHealthState(previous = makeEmptyHealth(), options = {}) {
  const now = options.now || Date.now();
  const nowIso = new Date(now).toISOString();
  const cacheAgeMs = healthCacheAgeMs(previous, now);
  const cooldownMs = healthCooldownRemainingMs(previous, now);
  const dataFreshness = options.dataFreshness || (cooldownMs > 0 ? "rate_limited_using_cache" : "fresh_cache");
  const next = {
    ...previous,
    generatedAt: nowIso,
    lastFruitFitRefreshAt: nowIso,
    cacheAgeMs,
    cacheReason: options.cacheReason || (cooldownMs > 0 ? "rate_limit_cooldown" : "fresh_cache"),
    healthRefresh: {
      ...defaultHealthRefresh,
      ...(previous.healthRefresh || {}),
      lastRefreshStartedAt: options.lastRefreshStartedAt || nowIso,
      lastRefreshFinishedAt: options.lastRefreshFinishedAt || nowIso,
      refreshDurationMs: options.refreshDurationMs ?? 0,
      usedCache: true,
      cacheAgeMs,
      cacheReason: options.cacheReason || (cooldownMs > 0 ? "rate_limit_cooldown" : "fresh_cache"),
      queryMode: options.queryMode || HEALTH_QUERY_MODES.DASHBOARD,
      skippedQueryReason: options.skippedQueryReason || (cooldownMs > 0 ? "rate_limit_cooldown" : "fresh_cache"),
      skippedDueToCooldown: Boolean(options.skippedDueToCooldown || cooldownMs > 0),
      nativeReadReason: null,
      rateLimitedUntil: previous.rateLimitedUntil || null,
      cooldownRemainingMs: cooldownMs,
      queryCount: 0,
      pagesRead: 0,
      maxPages: previous.healthRefresh?.maxPages ?? null,
      quotaExceeded: cooldownMs > 0,
      truncatedQueries: [],
      dataFreshness,
      reason: options.reason || "health-refresh",
      errors: options.errors || [],
    },
  };
  const sanitized = sanitizeCanonicalHealthState(next);
  return { ...sanitized, readiness: calculateReadiness(sanitized) };
}

function dayIndexFromDate(value) {
  const date = value ? new Date(value) : new Date();
  const day = date.getDay();
  return day === 0 ? 6 : day - 1;
}

function sampleDateKey(sample = {}) {
  const direct = sample.date || sample.key || sample.day;
  if (typeof direct === "string" && /^\d{4}-\d{2}-\d{2}/.test(direct)) return direct.slice(0, 10);
  return localDateKey(sample.start || sample.time || sample.end || Date.now());
}

function buildSeriesFromSamples(samples = [], range = "week", valueKey = "value") {
  if (range === "today") {
    const hourly = Array.from({ length: 24 }, () => 0);
    samples.forEach((sample) => {
      const date = new Date(sample.start || sample.time || sample.end || Date.now());
      hourly[date.getHours()] += Number(sample[valueKey] || 0);
    });
    return hourly;
  }
  const length = range === "month" ? 30 : 7;
  const series = Array.from({ length }, () => 0);
  samples.forEach((sample) => {
    const diffDays = diffLocalDays(sampleDateKey(sample));
    const index = length - 1 - diffDays;
    if (index >= 0 && index < length) series[index] += Number(sample[valueKey] || 0);
  });
  return series;
}

function buildAverageSeriesFromSamples(samples = [], range = "week", valueKey = "value") {
  const length = range === "month" ? 30 : 7;
  const totals = Array.from({ length }, () => 0);
  const counts = Array.from({ length }, () => 0);
  samples.forEach((sample) => {
    const value = Number(sample[valueKey] || 0);
    if (!Number.isFinite(value) || value <= 0) return;
    const date = new Date(sample.start || sample.time || sample.end || Date.now());
    const diffDays = diffLocalDays(localDateKey(date));
    const index = length - 1 - diffDays;
    if (index < 0 || index >= length) return;
    totals[index] += value;
    counts[index] += 1;
  });
  return totals.map((total, index) => (counts[index] ? round(total / counts[index]) : 0));
}

function healthQueryWindow(range = "today", at = new Date()) {
  const end = new Date(at);
  const start = new Date(at);
  if (range === "last15min") {
    start.setTime(end.getTime() - 15 * 60 * 1000);
  } else if (range === "last24h") {
    start.setTime(end.getTime() - 24 * 60 * 60 * 1000);
  } else if (range === "week") {
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 6);
  } else if (range === "month") {
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 29);
  } else {
    start.setHours(0, 0, 0, 0);
  }
  return { range, queryStart: start.toISOString(), queryEnd: end.toISOString() };
}

function heartSamples(result = {}) {
  return (result?.samples || [])
    .map((sample) => ({
      ...sample,
      value: Number(sample.value || 0),
    }))
    .filter((sample) => sample.value > 0 && sample.time);
}

function buildHeartSourceCounts(samples = []) {
  const counts = new Map();
  samples.forEach((sample) => {
    const sourcePackage = sample.sourcePackage || "unknown";
    const current = counts.get(sourcePackage) || { sourcePackage, sourceName: sourceLabel({ sourcePackage }), samplesCount: 0 };
    current.samplesCount += 1;
    counts.set(sourcePackage, current);
  });
  return Array.from(counts.values()).sort((a, b) => b.samplesCount - a.samplesCount);
}

function heartResultHasData(result = {}) {
  return Boolean(
    Number(result?.samplesCount || 0) > 0
    || Number(result?.aggregateSamplesCount || 0) > 0
    || Number(result?.latestBpm || 0) > 0
    || Number(result?.min || 0) > 0
    || Number(result?.avg || 0) > 0
    || Number(result?.max || 0) > 0
    || heartSamples(result).length > 0
  );
}

function heartDisplayInfo({ heart24h = {}, heartWeek = {}, freshness = {}, permissionGranted = true } = {}) {
  if (!permissionGranted) {
    return {
      displayMode: "no_data",
      displayReason: "heartRate permission is missing",
    };
  }
  if (heartResultHasData(heart24h)) {
    return {
      displayMode: "range_today",
      displayReason: "last24h HeartRateRecord samples found; showing min/avg/max and latest sample",
    };
  }
  if (heartResultHasData(heartWeek)) {
    return {
      displayMode: "latest_only",
      displayReason: "no HeartRateRecord samples in last24h; showing latest sample from 7d history",
    };
  }
  return {
    displayMode: "no_data",
    displayReason: freshness?.status === "no_data"
      ? "no HeartRateRecord samples returned for last15min/last24h/week"
      : "heart-rate data is unavailable for display",
  };
}

function buildHeartHistory7d(samples = []) {
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    const key = localDateKey(date);
    return {
      date: key,
      label: weekLabels[dayIndexFromDate(date)],
      values: [],
      latestBpm: null,
      latestTimestamp: null,
      countBySourcePackage: new Map(),
    };
  });
  const byDate = new Map(days.map((day) => [day.date, day]));

  heartSamples({ samples }).forEach((sample) => {
    const day = byDate.get(localDateKey(sample.time));
    if (!day) return;
    day.values.push(sample.value);
    const sourcePackage = sample.sourcePackage || "unknown";
    day.countBySourcePackage.set(sourcePackage, (day.countBySourcePackage.get(sourcePackage) || 0) + 1);
    if (!day.latestTimestamp || new Date(sample.time) > new Date(day.latestTimestamp)) {
      day.latestTimestamp = sample.time;
      day.latestBpm = sample.value;
    }
  });

  return days.map((day) => {
    const values = day.values;
    const countBySourcePackage = Array.from(day.countBySourcePackage.entries()).map(([sourcePackage, samplesCount]) => ({
      sourcePackage,
      sourceName: sourceLabel({ sourcePackage }),
      samplesCount,
    }));
    return {
      date: day.date,
      label: day.label,
      samplesCount: values.length,
      min: values.length ? Math.min(...values) : null,
      avg: values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
      max: values.length ? Math.max(...values) : null,
      latestBpm: day.latestBpm,
      latestTimestamp: day.latestTimestamp,
      countBySourcePackage,
    };
  });
}

function buildHeartQueryDiagnostic(range, result = {}) {
  const samples = heartSamples(result);
  const latest = latestHeartSampleFromResults([{ samples }]);
  return {
    ...healthQueryWindow(range),
    state: result?.state || null,
    skipped: Boolean(result?.skipped),
    skippedReason: result?.skippedReason || null,
    recordsCount: Number(result?.recordsCount || 0),
    recordsRawCount: Number(result?.recordsRawCount ?? result?.recordsCount ?? 0),
    samplesCount: Number(result?.samplesCount || samples.length || 0),
    countBySourcePackage: (result?.sources || []).length ? result.sources : buildHeartSourceCounts(samples),
    latestRecordTimestamp: result?.latestTimestamp || null,
    latestSampleTimestamp: latest?.time || result?.latestTimestamp || null,
    latestBpm: latest ? Number(latest.value) : result?.latestBpm || null,
    min: result?.min || null,
    avg: result?.avg || null,
    max: result?.max || null,
    reasonIfEmpty: samples.length ? null : result?.message || "No HeartRateRecord samples returned for query window",
  };
}

function deriveHeartResult(range, sourceResult = {}, predicate, skippedReason = "derived_from_cached_heart_read") {
  const samples = heartSamples(sourceResult).filter(predicate);
  const values = samples.map((sample) => sample.value).filter(Boolean);
  const latest = latestHeartSampleFromResults([{ samples }]);
  return {
    ...sourceResult,
    state: values.length ? healthProviderStates.CONNECTED : healthProviderStates.NO_DATA,
    range,
    skipped: true,
    skippedReason,
    derivedFromRange: sourceResult.range || null,
    queryCount: 0,
    pagesRead: 0,
    maxPages: sourceResult.maxPages ?? null,
    truncated: false,
    quotaExceeded: false,
    recordsCount: values.length ? (sourceResult.recordsCount || 0) : 0,
    recordsRawCount: values.length ? (sourceResult.recordsRawCount ?? sourceResult.recordsCount ?? 0) : 0,
    samplesCount: samples.length,
    min: values.length ? Math.min(...values) : null,
    avg: values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
    max: values.length ? Math.max(...values) : null,
    latestBpm: latest ? Number(latest.value) : null,
    latestTimestamp: latest?.time || null,
    latestAgeMinutes: latest?.time ? minutesSince(latest.time) : null,
    latestSourcePackage: latest?.sourcePackage || null,
    latestSourceName: latest ? sourceLabel(latest) : null,
    sources: buildHeartSourceCounts(samples),
    samples,
    message: values.length ? "Derived from one Health Connect heart-rate read." : "No derived heart-rate samples for this window.",
  };
}

function deriveHeartLast24h(sourceResult = {}) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return deriveHeartResult("last24h", sourceResult, (sample) => timestampMs(sample.time) >= cutoff, "derived_from_one_heart_read");
}

function deriveHeartToday(sourceResult = {}) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const startMs = start.getTime();
  return deriveHeartResult("today", sourceResult, (sample) => timestampMs(sample.time) >= startMs, "derived_from_one_heart_read");
}

function deriveHeartLast15min(sourceResult = {}) {
  const cutoff = Date.now() - 15 * 60 * 1000;
  return deriveHeartResult("last15min", sourceResult, (sample) => timestampMs(sample.time) >= cutoff, "derived_from_one_heart_read");
}

function healthQueryErrors(entries = []) {
  return entries
    .filter((entry) => entry?.result?.state === healthProviderStates.ERROR || entry?.result?.state === healthProviderStates.RATE_LIMITED)
    .map((entry) => ({
      query: entry.query,
      range: entry.result?.range || entry.range || null,
      source: entry.result?.source || "Health Connect",
      message: entry.result?.message || "Health Connect query failed",
      errorCode: entry.result?.errorCode || null,
      state: entry.result?.state || null,
      recordType: entry.result?.recordType || null,
      pageIndex: entry.result?.pageIndex ?? null,
      pageTokenUsed: entry.result?.pageTokenUsed ?? null,
    }));
}

function healthQueryStats(entries = []) {
  const readEntries = entries.filter((entry) => !entry?.result?.skipped);
  const pagesRead = readEntries.reduce((sum, entry) => sum + Number(entry?.result?.pagesRead || 0), 0);
  const maxPagesValues = readEntries.map((entry) => Number(entry?.result?.maxPages || 0)).filter(Boolean);
  const truncatedQueries = readEntries
    .filter((entry) => entry?.result?.truncated)
    .map((entry) => entry.query);
  return {
    queryCount: readEntries.reduce((sum, entry) => sum + Number(entry?.result?.queryCount || 1), 0),
    pagesRead,
    maxPages: maxPagesValues.length ? Math.max(...maxPagesValues) : null,
    quotaExceeded: readEntries.some((entry) => Boolean(entry?.result?.quotaExceeded) || isRateLimitedResult(entry?.result)),
    truncatedQueries,
  };
}

function buildMetricHistory7d(samples = [], valueKey = "value") {
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    return {
      date: localDateKey(date),
      label: weekLabels[dayIndexFromDate(date)],
      value: 0,
      recordsCount: 0,
    };
  });
  const byDate = new Map(days.map((day) => [day.date, day]));
  (samples || []).forEach((sample) => {
    const date = sampleDateKey(sample);
    const day = byDate.get(date);
    if (!day) return;
    day.value += Number(sample[valueKey] || 0) || 0;
    day.recordsCount += 1;
  });
  return days.map((day) => ({ ...day, value: round(day.value) }));
}

function mergeSourceLists(...lists) {
  const sources = new Map();
  lists.flat().filter(Boolean).forEach((source) => {
    const key = source.sourcePackage || source.sourceName || source.source || JSON.stringify(source);
    sources.set(key, { ...sources.get(key), ...source });
  });
  return Array.from(sources.values());
}

function canReadNativeData(state) {
  return state === healthProviderStates.CONNECTED
    || state === healthProviderStates.PARTIALLY_GRANTED
    || state === healthProviderStates.NO_DATA;
}

function canAttemptNativeRead(state) {
  return state !== healthProviderStates.NOT_SUPPORTED
    && state !== healthProviderStates.NOT_INSTALLED;
}

function selectedSourceSamples(result) {
  const samples = result?.samples || [];
  const selected = result?.selectedSourcePackage;
  if (!selected) return samples;
  return samples.filter((sample) => sample.sourcePackage === selected);
}

function mainSleepSessions(result) {
  return dedupeSleepSessionsForCanonical(result?.sessions || []).filter((session) => Number(session.minutes || 0) >= 120);
}

function localTimeText(value) {
  const date = new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function sleepDurationMinutes(session = {}) {
  const explicit = Number(session.minutes ?? session.durationMinutes ?? session.value ?? 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const start = timestampMs(session.start || session.startTime);
  const end = timestampMs(session.end || session.endTime);
  if (!start || !end || end <= start) return 0;
  return (end - start) / 60000;
}

function sleepOverlapsNightWindow(session = {}) {
  const start = new Date(session.start || session.startTime || session.date || Date.now());
  const end = new Date(session.end || session.endTime || session.start || Date.now());
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return false;
  const startHour = start.getHours();
  const endHour = end.getHours();
  return startHour >= 18 || startHour < 8 || endHour <= 11;
}

function classifySleepSessionKind(session = {}) {
  const explicit = String(session.sleepKind || session.kind || "").toLowerCase();
  if (["night", "nap", "fragment"].includes(explicit)) return explicit;
  const minutes = sleepDurationMinutes(session);
  if (minutes > 0 && minutes < 20) return "fragment";
  if (minutes >= 120 && sleepOverlapsNightWindow(session)) return "night";
  return "nap";
}

function normalizeSleepSessionEntry(session = {}) {
  const startTime = session.startTime || session.start || session.date || null;
  const endTime = session.endTime || session.end || session.finish || startTime;
  const durationMinutes = round(sleepDurationMinutes({ ...session, start: startTime, end: endTime }));
  if (!durationMinutes) return null;
  const sourcePackage = session.sourcePackage || session.selectedSourcePackage || null;
  const sourceName = sourceLabel({
    sourcePackage,
    sourceName: session.sourceName || session.selectedSourceName || session.source,
  });
  const sleepKind = classifySleepSessionKind({ ...session, start: startTime, end: endTime, minutes: durationMinutes });
  const canonicalDate = session.sleepDate || session.canonicalDate || (session.manual && session.date)
    || sleepSessionDateKey({ ...session, start: startTime, end: endTime });
  return {
    ...session,
    start: startTime,
    end: endTime,
    startTime,
    endTime,
    startLocal: startTime ? localTimeText(startTime) : "",
    endLocal: endTime ? localTimeText(endTime) : "",
    durationMinutes,
    minutes: durationMinutes,
    value: durationMinutes,
    sourcePackage,
    sourceName,
    sleepKind,
    sleepDate: canonicalDate,
    canonicalDate,
    date: canonicalDate,
  };
}

function normalizeSleepEntriesForDisplay(sessions = []) {
  return dedupeSleepSessionsForCanonical(sessions)
    .map(normalizeSleepSessionEntry)
    .filter(Boolean)
    .sort((a, b) => (timestampMs(a.start || a.end) || 0) - (timestampMs(b.start || b.end) || 0));
}

function sleepDateKeyForManualEntry(entry = {}) {
  return entry.canonicalDate || entry.sleepDate || entry.date || sleepSessionDateKey(entry);
}

function isManualSleepEntry(entry = {}) {
  return Boolean(entry.manual || entry.sourcePackage === "manual");
}

function dedupeManualSleepEntries(entries = []) {
  const byDate = new Map();
  normalizeSleepEntriesForDisplay(entries).forEach((entry) => {
    if (!isManualSleepEntry(entry)) return;
    const date = sleepDateKeyForManualEntry(entry);
    if (!date) return;
    byDate.set(date, { ...entry, date, canonicalDate: date, sleepDate: date, manual: true, sourcePackage: "manual", sourceName: "Ручная запись" });
  });
  return Array.from(byDate.values())
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
}

function replaceManualSleepEntryForDate(entries = [], entry = null) {
  if (!entry) return dedupeManualSleepEntries(entries);
  const date = sleepDateKeyForManualEntry(entry);
  if (!date) return dedupeManualSleepEntries(entries);
  return dedupeManualSleepEntries([
    ...dedupeManualSleepEntries(entries).filter((item) => sleepDateKeyForManualEntry(item) !== date),
    { ...entry, date, canonicalDate: date, sleepDate: date },
  ]);
}

function sleepTotalsByKind(entries = []) {
  return entries.reduce((totals, entry) => {
    const minutes = Number(entry.minutes || entry.durationMinutes || 0);
    if (!Number.isFinite(minutes) || minutes <= 0) return totals;
    totals.totalMinutes += minutes;
    if (entry.sleepKind === "night") totals.nightMinutes += minutes;
    else if (entry.sleepKind === "fragment") totals.fragmentMinutes += minutes;
    else totals.napMinutes += minutes;
    return totals;
  }, { totalMinutes: 0, nightMinutes: 0, napMinutes: 0, fragmentMinutes: 0 });
}

function lastDays(count = 7) {
  const today = new Date();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today);
    date.setHours(12, 0, 0, 0);
    date.setDate(today.getDate() - (count - 1 - index));
    return {
      date: localDateKey(date),
      label: weekLabels[dayIndexFromDate(date)],
      dateLabel: `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}`,
    };
  });
}

function sleepEntryPriority(entry = {}) {
  const manualBonus = entry.manual || entry.sourcePackage === "manual" ? 100 : 0;
  if (entry.sleepKind === "night") return manualBonus + 70;
  if (entry.sleepKind === "nap") return manualBonus + 30;
  return manualBonus + 10;
}

function buildCanonicalSleepTimeline(sleepOrEntries = {}) {
  const entries = Array.isArray(sleepOrEntries)
    ? normalizeSleepEntriesForDisplay(sleepOrEntries)
    : normalizeSleepEntriesForDisplay([
      ...asArray(sleepOrEntries.manualSleepEntries),
      ...asArray(sleepOrEntries.sessions),
      ...asArray(sleepOrEntries.naps),
      ...asArray(sleepOrEntries.fragments),
    ]);
  const days = lastDays(7).map((day) => ({
    ...day,
    entries: [],
    mainSleep: null,
    naps: [],
    fragments: [],
    nightMinutes: 0,
    napMinutes: 0,
    fragmentMinutes: 0,
    totalMinutes: 0,
    hasManualNight: false,
    sourceName: null,
  }));
  const byDate = new Map(days.map((day) => [day.date, day]));

  entries.forEach((entry) => {
    const date = entry.canonicalDate || entry.sleepDate || entry.date || sleepSessionDateKey(entry);
    const day = byDate.get(date);
    if (!day) return;
    day.entries.push(entry);
  });

  days.forEach((day) => {
    const manualEntries = day.entries.filter(isManualSleepEntry);
    const effectiveEntries = manualEntries.length ? manualEntries : day.entries;
    day.entries = effectiveEntries;
    const nights = effectiveEntries.filter((entry) => entry.sleepKind === "night");
    const manualNights = nights.filter((entry) => entry.manual || entry.sourcePackage === "manual");
    const candidates = manualNights.length ? manualNights : nights;
    const mainSleep = [...candidates].sort((a, b) => {
      const priorityDiff = sleepEntryPriority(b) - sleepEntryPriority(a);
      if (priorityDiff) return priorityDiff;
      const minutesDiff = Number(b.minutes || 0) - Number(a.minutes || 0);
      if (minutesDiff) return minutesDiff;
      return (timestampMs(b.end || b.start) || 0) - (timestampMs(a.end || a.start) || 0);
    })[0] || null;
    day.mainSleep = mainSleep;
    day.hasManualNight = Boolean(mainSleep && (mainSleep.manual || mainSleep.sourcePackage === "manual"));
    day.naps = effectiveEntries.filter((entry) => entry.sleepKind === "nap");
    day.fragments = effectiveEntries.filter((entry) => entry.sleepKind === "fragment");
    day.nightMinutes = round(mainSleep?.minutes || 0);
    day.napMinutes = round(day.naps.reduce((sum, entry) => sum + Number(entry.minutes || 0), 0));
    day.fragmentMinutes = round(day.fragments.reduce((sum, entry) => sum + Number(entry.minutes || 0), 0));
    day.totalMinutes = round(day.nightMinutes + day.napMinutes + day.fragmentMinutes);
    day.sourceName = mainSleep?.sourceName || day.naps[0]?.sourceName || day.fragments[0]?.sourceName || null;
  });

  return {
    days,
    entries,
    mainSleepSessions: days.map((day) => day.mainSleep).filter(Boolean),
    naps: days.flatMap((day) => day.naps),
    fragments: days.flatMap((day) => day.fragments),
    latestSleep: latestSleepSession(entries),
    latestNap: latestSleepSession(days.flatMap((day) => day.naps)),
  };
}

function buildSleepHistory7dFromTimeline(timeline = {}) {
  return (timeline.days || []).map((day) => ({
    date: day.date,
    label: day.label,
    value: round(day.totalMinutes),
    minutes: round(day.totalMinutes),
    nightMinutes: round(day.nightMinutes),
    napMinutes: round(day.napMinutes),
    fragmentMinutes: round(day.fragmentMinutes),
    recordsCount: day.entries.length,
    hasManualNight: day.hasManualNight,
  }));
}

function buildSleepWeekFromTimeline(timeline = {}) {
  return (timeline.days || []).map((day) => ({
    day: day.label,
    label: day.label,
    date: day.date,
    minutes: round(day.totalMinutes),
    nightMinutes: round(day.nightMinutes),
    napMinutes: round(day.napMinutes),
    quality: day.totalMinutes > 0 ? 4 : 0,
    hasManualNight: day.hasManualNight,
  }));
}

function sleepSessionDateKey(session = {}) {
  return localDateKey(session.canonicalDate || session.sleepDate || session.date || session.end || session.start || new Date());
}

function latestSleepSession(sessions = []) {
  return [...sessions]
    .filter((session) => Number(session?.minutes || 0) > 0 && (session?.end || session?.start))
    .sort((a, b) => (timestampMs(a.end || a.start) || 0) - (timestampMs(b.end || b.start) || 0))
    .slice(-1)[0] || null;
}

function sourceLabel(source) {
  const packageName = source?.selectedSourcePackage || source?.sourcePackage || "";
  const sourceName = source?.selectedSourceName || source?.sourceName || source?.source || "";
  const rawPackage = String(packageName || "").toLowerCase();
  const rawName = String(sourceName || "").toLowerCase();
  const raw = `${rawPackage} ${rawName} ${typeof source === "string" ? source : ""}`.toLowerCase();
  if (raw.includes("com.xiaomi.wearable") || raw.includes("mi fitness")) return "Mi Fitness";
  if (raw.includes("com.sec.android.app.shealth") || raw.includes("samsung")) return "Samsung Health";
  if (raw.includes("com.huami.watch.hmwatchmanager") || raw.includes("zepp") || raw.includes("amazfit")) return "Zepp / Amazfit";
  if (raw.includes("com.google.android.apps.fitness") || raw.includes("google fit")) return "Google Fit";
  if (raw.includes("whoop")) return "WHOOP";
  if (raw.includes("apple") || raw.includes("healthkit")) return "Apple Health";
  if (nativeHealthFallbackName() === "Apple Health" && (raw.includes("health connect") || rawPackage === "android" || raw.includes("aggregate"))) return "Apple Health";
  const hasSpecificPackage = rawPackage && rawPackage !== "android" && !rawPackage.includes("aggregate");
  if (!hasSpecificPackage && (rawPackage === "android" || rawName.includes("health connect aggregate"))) return "Health Connect aggregate";
  const label = sourceName && !rawName.includes("aggregate") ? sourceName : packageName || sourceName;
  return label || (typeof source === "string" && source ? source : nativeHealthFallbackName());
}

function dataSourceName(result, fallback = nativeHealthFallbackName()) {
  return sourceLabel({
    sourcePackage: result?.selectedSourcePackage || result?.sourcePackage || null,
    sourceName: result?.selectedSourceName || result?.sourceName || result?.source || fallback,
  });
}

function latestHeartSample(result) {
  return latestHeartSampleFromResults([result]);
}

function latestHeartSampleFromResults(results = [], preferredPackage = "") {
  const samples = results.flatMap((result) => result?.samples || [])
    .filter((sample) => Number(sample.value || 0) > 0 && sample.time)
    .sort((a, b) => new Date(a.time) - new Date(b.time));
  if (!samples.length) return null;

  const preferred = String(preferredPackage || "").toLowerCase();
  if (preferred) {
    const preferredSamples = samples.filter((sample) => String(sample.sourcePackage || "").toLowerCase() === preferred);
    const latestPreferred = preferredSamples[preferredSamples.length - 1] || null;
    const preferredAge = minutesSince(latestPreferred?.time);
    if (latestPreferred && preferredAge != null && preferredAge <= 360) return latestPreferred;
  }

  return samples[samples.length - 1] || null;
}

function heartStatusFor(recentResult, todayResult) {
  if (isRateLimitedResult(recentResult) || isRateLimitedResult(todayResult)) {
    return "rate_limited";
  }
  if (recentResult?.state === healthProviderStates.PERMISSIONS_REQUIRED || todayResult?.state === healthProviderStates.PERMISSIONS_REQUIRED) {
    return "permission_required";
  }
  if ((recentResult?.samples || []).length > 0) return "connected";
  if ((todayResult?.samples || []).length > 0) return "stale";
  return "no_data";
}

function preferredHealthSourceOptions() {
  if (typeof window === "undefined") return {};
  const preferredSourcePackage = localStorage.getItem("fruitfit.health.preferredSourcePackage") || "";
  return preferredSourcePackage ? { preferredSourcePackage } : {};
}

function sourceTotal(source) {
  return Number(source?.convertedValue ?? source?.convertedActive ?? source?.total ?? source?.value ?? 0) || 0;
}

function sourcePackageKey(source = {}) {
  return String(source?.selectedSourcePackage || source?.sourcePackage || source?.packageName || "").toLowerCase();
}

function isAggregateSource(source = {}) {
  const sourcePackage = sourcePackageKey(source);
  const sourceName = String(source?.selectedSourceName || source?.sourceName || source?.source || "").toLowerCase();
  return !sourcePackage
    || sourcePackage === "android"
    || sourcePackage === "unknown"
    || sourcePackage.includes("healthconnect")
    || sourceName.includes("health connect aggregate")
    || sourceName === "android";
}

function sourceTrustRank(source = {}) {
  if (isAggregateSource(source)) return 10;
  const raw = `${sourcePackageKey(source)} ${String(source?.sourceName || "").toLowerCase()}`;
  if (raw.includes("apple health") || raw.includes("apple.healthkit")) return 10;
  if (raw.includes("apple watch")) return 18;
  if (raw.includes("com.google.android.apps.fitness") || raw.includes("google fit")) return 20;
  if (raw.includes("com.sec.android.app.shealth") || raw.includes("samsung")) return 21;
  if (raw.includes("com.xiaomi.wearable") || raw.includes("mi fitness")) return 30;
  if (raw.includes("com.huami") || raw.includes("zepp") || raw.includes("amazfit")) return 31;
  if (raw.includes("fitbit")) return 32;
  if (raw.includes("whoop")) return 33;
  if (raw.includes("garmin")) return 34;
  if (raw.includes("oura")) return 35;
  return 50;
}

function sourceKind(source = {}) {
  const raw = `${sourcePackageKey(source)} ${String(source?.sourceName || source?.source || "").toLowerCase()}`;
  if (raw.includes("apple watch")) return "apple_watch";
  if (raw.includes("whoop")) return "whoop";
  if (raw.includes("garmin")) return "garmin";
  if (raw.includes("oura")) return "oura";
  if (raw.includes("com.google.android.apps.fitness") || raw.includes("google fit")) return "google_fit";
  if (isAggregateSource(source)) return "android";
  if (raw.includes("com.xiaomi.wearable") || raw.includes("mi fitness") || raw.includes("xiaomi")) return "mi_fitness";
  if (raw.includes("com.huami") || raw.includes("zepp") || raw.includes("amazfit")) return "zepp";
  if (raw.includes("fitbit")) return "fitbit";
  if (raw.includes("com.sec.android.app.shealth") || raw.includes("samsung")) return "samsung";
  if (raw.includes("apple") || raw.includes("healthkit")) return "apple";
  return "other";
}

function sourceMatchesPreference(source = {}, preference = "") {
  const value = String(preference || "").toLowerCase();
  if (!value) return false;
  if (sourcePackageKey(source) === value) return true;
  const kind = sourceKind(source);
  if (value === "android" && kind === "android") return true;
  if (value.includes("google") && kind === "google_fit") return true;
  if ((value.includes("xiaomi") || value.includes("mi_fitness") || value.includes("mi-fitness")) && kind === "mi_fitness") return true;
  if ((value.includes("huami") || value.includes("zepp") || value.includes("amazfit")) && kind === "zepp") return true;
  if (value.includes("fitbit") && kind === "fitbit") return true;
  if ((value.includes("watch") || value.includes("apple_watch")) && kind === "apple_watch") return true;
  if (value.includes("whoop") && kind === "whoop") return true;
  if (value.includes("garmin") && kind === "garmin") return true;
  if (value.includes("oura") && kind === "oura") return true;
  if ((value.includes("samsung") || value.includes("shealth")) && kind === "samsung") return true;
  if ((value.includes("apple") || value.includes("healthkit")) && kind === "apple") return true;
  return false;
}

function sourceDebugName(source = {}) {
  return source?.sourcePackage || source?.selectedSourcePackage || source?.sourceName || source?.source || "aggregate";
}

function medianPositive(values = []) {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function sourceSuspicion(source, sources = [], options = {}) {
  const total = sourceTotal(source);
  const reasons = [];
  if (options.metric === "steps" && options.range === "today" && total > 50000) {
    reasons.push("steps over 50000/day");
  } else if (options.metric === "steps" && options.range === "today") {
    const plausibleValues = sources.map(sourceTotal).filter((value) => Number.isFinite(value) && value > 0 && value <= 50000);
    const minPlausible = plausibleValues.length ? Math.min(...plausibleValues) : 0;
    const hasUnder12000 = plausibleValues.some((value) => value < 12000);
    const google = sources.find((item) => sourceKind(item) === "google_fit");
    const googleValue = sourceTotal(google);
    const highKinds = new Set(["android", "fitbit", "mi_fitness", "zepp"]);
    const highCluster = sources
      .filter((item) => highKinds.has(sourceKind(item)))
      .map(sourceTotal)
      .filter((value) => Number.isFinite(value) && value > 0);
    const highClusterMedian = medianPositive(highCluster);
    const highClusterTight = highCluster.length >= 2
      && highClusterMedian > 0
      && highCluster.every((value) => Math.abs(value - highClusterMedian) / highClusterMedian <= 0.12);

    if (total > 20000 && hasUnder12000) {
      reasons.push("suspiciousHigh: over 20000 while another plausible source is under 12000");
    }
    if (minPlausible > 0 && total >= minPlausible * 3) {
      reasons.push(`suspiciousHigh: ${round(total)} is 3x+ higher than minimum plausible ${round(minPlausible)}`);
    }
    if (googleValue > 0 && highClusterTight && highKinds.has(sourceKind(source)) && total >= googleValue * 2.2) {
      reasons.push("suspiciousHigh: high android/Fitbit/Mi cluster while Google Fit is much lower");
    }
  }
  if (options.metric === "calories" && options.range === "today" && total > 4000) {
    reasons.push("active calories over 4000/day");
  }
  const comparableSources = sources.filter((item) => sourceDebugName(item) !== sourceDebugName(source));
  const median = medianPositive((comparableSources.length ? comparableSources : sources).map(sourceTotal));
  const multiplier = options.suspiciousMultiplier || 2.5;
  if (options.metric !== "steps" && median > 0 && total > median * multiplier) {
    reasons.push(`source total ${round(total)} is over ${multiplier}x peer median ${round(median)}`);
  }
  return reasons.length ? reasons.join("; ") : null;
}

function suspiciousSourceReport(sources = [], options = {}) {
  return sources
    .map((source) => {
      const reason = sourceSuspicion(source, sources, options);
      return reason ? {
        sourcePackage: source.sourcePackage || null,
        sourceName: sourceLabel(source),
        total: sourceTotal(source),
        reason,
      } : null;
    })
    .filter(Boolean);
}

function sourceByKind(sources = [], kind) {
  return sources.find((source) => sourceKind(source) === kind) || null;
}

function sourceIsPlausible(source = {}) {
  const total = sourceTotal(source);
  return Number.isFinite(total) && total > 0 && total <= 50000;
}

function conservativeStepsSelection(sources = [], preferredSourcePackage = "", options = {}) {
  const suspiciousHighSources = suspiciousSourceReport(sources, { ...options, metric: "steps", range: "today" });
  const suspiciousHighPackages = new Set(suspiciousHighSources.map((source) => String(source.sourcePackage || "").toLowerCase()).filter(Boolean));
  const allSources = sources.map((source) => ({
    sourcePackage: source.sourcePackage || null,
    sourceName: sourceLabel(source),
    kind: sourceKind(source),
    total: sourceTotal(source),
  }));
  const rejectedSources = suspiciousHighSources.map((source) => ({ ...source, rejected: true }));
  const preferred = preferredSourcePackage
    ? sources.find((source) => sourceMatchesPreference(source, preferredSourcePackage))
    : null;

  if (preferred && sourceIsPlausible(preferred)) {
    return {
      selectedSourcePackage: preferred.sourcePackage || null,
      selectedSourceName: sourceLabel(preferred),
      selectedSourceReason: `User selected ${sourceLabel(preferred)}; using it because the source exists and is plausible.`,
      selectedSourceStrategy: "preferred_user_source",
      autoStrategy: "manual_preferred_source",
      selectedTotal: sourceTotal(preferred),
      sources,
      allSources,
      suspiciousSources: suspiciousHighSources,
      suspiciousHighSources,
      rejectedSources: [],
      suspiciousReason: null,
    };
  }

  const googleFit = sourceByKind(sources, "google_fit");
  if (sourceIsPlausible(googleFit)) {
    return {
      selectedSourcePackage: googleFit.sourcePackage || null,
      selectedSourceName: sourceLabel(googleFit),
      selectedSourceReason: "Legacy diagnostic source selection; Health Connect aggregate should override dashboard totals.",
      selectedSourceStrategy: "legacy_source_diagnostics",
      autoStrategy: "legacy_source_diagnostics",
      selectedTotal: sourceTotal(googleFit),
      sources,
      allSources,
      suspiciousSources: suspiciousHighSources,
      suspiciousHighSources,
      rejectedSources,
      suspiciousReason: suspiciousHighSources.map((source) => `${source.sourcePackage || source.sourceName}: ${source.reason}`).join("; ") || null,
    };
  }

  const android = sourceByKind(sources, "android");
  if (sourceIsPlausible(android) && !suspiciousHighPackages.has(String(android?.sourcePackage || "").toLowerCase())) {
    return {
      selectedSourcePackage: android.sourcePackage || null,
      selectedSourceName: sourceLabel(android),
      selectedSourceReason: "Auto selected Android / phone because Google Fit was unavailable and Android was not suspiciousHigh.",
      selectedSourceStrategy: "auto_android_phone",
      autoStrategy: "android_if_not_suspicious_high",
      selectedTotal: sourceTotal(android),
      sources,
      allSources,
      suspiciousSources: suspiciousHighSources,
      suspiciousHighSources,
      rejectedSources,
      suspiciousReason: suspiciousHighSources.map((source) => `${source.sourcePackage || source.sourceName}: ${source.reason}`).join("; ") || null,
    };
  }

  const fallbackKinds = ["samsung", "mi_fitness", "zepp", "fitbit", "android", "other"];
  const fallback = fallbackKinds
    .map((kind) => sourceByKind(sources, kind))
    .find((source) => sourceIsPlausible(source))
    || sources.find(sourceIsPlausible)
    || sources[0];

  return {
    selectedSourcePackage: fallback?.sourcePackage || null,
    selectedSourceName: sourceLabel(fallback),
    selectedSourceReason: "Auto fallback selected the first plausible available source; high sources are diagnostics-only unless manually selected.",
    selectedSourceStrategy: "auto_conservative_fallback",
    autoStrategy: "fallback_no_google_or_safe_android",
    selectedTotal: sourceTotal(fallback),
    sources,
    allSources,
    suspiciousSources: suspiciousHighSources,
    suspiciousHighSources,
    rejectedSources,
    suspiciousReason: suspiciousHighSources.map((source) => `${source.sourcePackage || source.sourceName}: ${source.reason}`).join("; ") || null,
  };
}

function isHealthConnectAggregateResult(result = {}) {
  const strategy = String(result?.aggregateStrategy || result?.selectedSourceStrategy || "").toLowerCase();
  return strategy === "health_connect_aggregate"
    || strategy === "health_connect_sleep_aggregate"
    || strategy === "deduped_raw_sleep_sessions"
    || strategy === "deduped_raw_sleep_sessions_over_duplicate_aggregate"
    || result?.selectedSourceName === "Health Connect aggregate";
}

function isAppleHealthAggregateResult(result = {}) {
  const strategy = String(result?.aggregateStrategy || result?.selectedSourceStrategy || "").toLowerCase();
  const sourceText = `${String(result?.source || "")} ${String(result?.selectedSourceName || "")} ${String(result?.selectedSourcePackage || "")}`.toLowerCase();
  return strategy === "apple_health_aggregate"
    || sourceText.includes("apple health")
    || sourceText.includes("apple.healthkit")
    || sourceText.includes("healthkit");
}

function appleHealthAggregateSelection(result = {}, options = {}) {
  const selectedTotal = aggregateMetricTotal(result, options.metric);
  const sources = (result?.sources || []).filter((source) => source?.sourcePackage || source?.sourceName);
  const preferredSourcePackage = options.preferredSourcePackage || "";
  const preferredSource = preferredSourcePackage
    ? sources.find((source) => sourceMatchesPreference(source, preferredSourcePackage))
    : null;

  if (preferredSource && sourceTotal(preferredSource) > 0) {
    return {
      selectedSourcePackage: preferredSource.sourcePackage || null,
      selectedSourceName: sourceLabel(preferredSource),
      selectedSourceReason: `User selected ${sourceLabel(preferredSource)}; using Apple Health samples from this source.`,
      selectedSourceStrategy: "apple_health_preferred_source",
      selectedTotal: sourceTotal(preferredSource),
      sources,
      allSources: sources,
      suspiciousSources: [],
      suspiciousHighSources: [],
      rejectedSources: [],
      autoStrategy: "manual_preferred_source",
      suspiciousReason: null,
      dashboardSourcePackage: preferredSource.sourcePackage || null,
      dashboardSourceName: sourceLabel(preferredSource),
      dashboardValidationStatus: "preferred_source",
      aggregateRejectedReason: null,
      dashboardValueSource: preferredSource.sourcePackage || null,
      dashboardValueReason: "user_preferred_apple_health_source",
    };
  }

  return {
    selectedSourcePackage: null,
    selectedSourceName: "Apple Health",
    selectedSourceReason: "Apple Health aggregate selected; choose a source to use only Apple Watch/Fitbit/Garmin/WHOOP/Oura samples when available.",
    selectedSourceStrategy: "apple_health_aggregate",
    selectedTotal,
    sources,
    allSources: sources,
    suspiciousSources: [],
    suspiciousHighSources: [],
    rejectedSources: [],
    autoStrategy: "apple_health_aggregate",
    suspiciousReason: null,
    dashboardSourcePackage: "apple.healthkit",
    dashboardSourceName: "Apple Health",
    dashboardValidationStatus: "aggregate_valid",
    aggregateRejectedReason: null,
    dashboardValueSource: "apple_health_aggregate",
    dashboardValueReason: "apple_health_aggregate",
  };
}

const DASHBOARD_SOURCE_PRIORITY = [
  "com.xiaomi.wearable",
  "com.huami.watch.hmwatchmanager",
  "com.google.android.apps.fitness",
];

function aggregateMetricTotal(result = {}, metric = "") {
  if (metric === "calories") return Number(result?.active ?? result?.total ?? 0) || 0;
  if (metric === "sleep") return Number(result?.minutes ?? result?.total ?? 0) || 0;
  return Number(result?.total ?? result?.active ?? result?.minutes ?? 0) || 0;
}

function aggregateValidation(result = {}, options = {}) {
  const metric = options.metric || "";
  const steps = Number(result?.total ?? 0) || 0;
  const activeCalories = Number(result?.active ?? result?.convertedActive ?? 0) || 0;
  const totalCalories = Number(result?.total ?? result?.convertedTotal ?? 0) || 0;
  if (metric === "calories" && activeCalories > 0 && totalCalories > 0 && activeCalories > totalCalories) {
    return {
      status: "aggregate_rejected",
      reason: "active_calories_gt_total_calories",
    };
  }
  return { status: "aggregate_valid", reason: null };
}

function dashboardSourcePriority(source = {}) {
  const key = sourcePackageKey(source);
  const exactIndex = DASHBOARD_SOURCE_PRIORITY.indexOf(key);
  if (exactIndex >= 0) return exactIndex;
  const kind = sourceKind(source);
  if (kind === "mi_fitness") return 0;
  if (kind === "zepp") return 1;
  if (kind === "google_fit") return 2;
  return 999;
}

function sourceValidation(source = {}, result = {}, options = {}) {
  const metric = options.metric || "";
  const total = sourceTotal(source);
  if (!Number.isFinite(total) || total <= 0) {
    return { ok: false, reason: "source_empty" };
  }
  if (metric === "calories") {
    const totalCalories = Number(result?.total ?? result?.convertedTotal ?? 0) || 0;
    if (totalCalories > 0 && total > totalCalories) {
      return { ok: false, reason: "source_active_gt_total_calories" };
    }
  }
  return { ok: true, reason: null };
}

function trustedDashboardSource(result = {}, options = {}) {
  const sources = (result?.sources || []).filter((source) => source?.sourcePackage || source?.sourceName);
  const rejected = [];
  const trusted = sources
    .filter((source) => dashboardSourcePriority(source) < 999)
    .sort((a, b) => dashboardSourcePriority(a) - dashboardSourcePriority(b));

  for (const source of trusted) {
    const validation = sourceValidation(source, result, options);
    if (validation.ok) return { source, rejected };
    rejected.push({
      sourcePackage: source.sourcePackage || null,
      sourceName: sourceLabel(source),
      total: sourceTotal(source),
      reason: validation.reason,
      rejected: true,
    });
  }
  return { source: null, rejected };
}

function healthConnectAggregateSelection(result = {}, options = {}) {
  const selectedTotal = aggregateMetricTotal(result, options.metric);
  const dataOrigins = Array.isArray(result?.dataOrigins) ? result.dataOrigins : [];
  const validation = aggregateValidation(result, options);
  const trusted = trustedDashboardSource(result, options);
  const preferredSourcePackage = options.preferredSourcePackage || "";
  const preferredSource = preferredSourcePackage
    ? (result?.sources || []).find((source) => sourceMatchesPreference(source, preferredSourcePackage))
    : null;
  const filteredSourcePackage = result?.selectedSourcePackage || "";

  if (preferredSource && sourceTotal(preferredSource) > 0) {
    return {
      selectedSourcePackage: preferredSource.sourcePackage || null,
      selectedSourceName: sourceLabel(preferredSource),
      selectedSourceReason: `User selected ${sourceLabel(preferredSource)}; using this source for today and history when daily source data is available.`,
      selectedSourceStrategy: "preferred_user_source",
      selectedTotal: sourceTotal(preferredSource),
      sources: result?.sources || [],
      allSources: dataOrigins.length ? dataOrigins : (result?.sources || []),
      suspiciousSources: [],
      suspiciousHighSources: [],
      rejectedSources: trusted.rejected,
      autoStrategy: "manual_preferred_source",
      suspiciousReason: null,
      dashboardSourcePackage: preferredSource.sourcePackage || null,
      dashboardSourceName: sourceLabel(preferredSource),
      dashboardValidationStatus: "preferred_source",
      aggregateRejectedReason: null,
      dashboardValueSource: preferredSource.sourcePackage || null,
      dashboardValueReason: "user_preferred_source",
    };
  }

  if (filteredSourcePackage && sourceMatchesPreference({ sourcePackage: filteredSourcePackage }, preferredSourcePackage)) {
    return {
      selectedSourcePackage: filteredSourcePackage,
      selectedSourceName: sourceLabel({ sourcePackage: filteredSourcePackage, sourceName: result?.selectedSourceName }),
      selectedSourceReason: `User selected ${sourceLabel({ sourcePackage: filteredSourcePackage, sourceName: result?.selectedSourceName })}; Health Connect returned aggregate buckets filtered by this source.`,
      selectedSourceStrategy: result?.selectedSourceStrategy || "health_connect_aggregate_data_origin_filter",
      selectedTotal,
      sources: result?.sources || [],
      allSources: dataOrigins.length ? dataOrigins : (result?.sources || []),
      suspiciousSources: [],
      suspiciousHighSources: [],
      rejectedSources: trusted.rejected,
      autoStrategy: "manual_preferred_source",
      suspiciousReason: null,
      dashboardSourcePackage: filteredSourcePackage,
      dashboardSourceName: sourceLabel({ sourcePackage: filteredSourcePackage, sourceName: result?.selectedSourceName }),
      dashboardValidationStatus: "preferred_source",
      aggregateRejectedReason: null,
      dashboardValueSource: filteredSourcePackage,
      dashboardValueReason: "user_preferred_data_origin_filter",
    };
  }

  if ((options.metric === "steps" || options.metric === "calories") && !validation.reason) {
    return {
      selectedSourcePackage: null,
      selectedSourceName: "Health Connect aggregate",
      selectedSourceReason: "Health Connect aggregate is the primary value; source-specific raw records are diagnostics only after exact dedupe.",
      selectedSourceStrategy: result?.aggregateStrategy || "health_connect_aggregate",
      selectedTotal,
      sources: result?.sources || [],
      allSources: dataOrigins.length ? dataOrigins : (result?.sources || []),
      suspiciousSources: [],
      suspiciousHighSources: [],
      rejectedSources: trusted.rejected,
      autoStrategy: "health_connect_aggregate",
      suspiciousReason: null,
      dashboardSourcePackage: null,
      dashboardSourceName: "Health Connect aggregate",
      dashboardValidationStatus: "aggregate_valid",
      aggregateRejectedReason: null,
      dashboardValueSource: "health_connect_aggregate",
      dashboardValueReason: "aggregate_bucket_values_match_health_connect",
    };
  }

  if (trusted.source) {
    return {
      selectedSourcePackage: trusted.source.sourcePackage || null,
      selectedSourceName: sourceLabel(trusted.source),
      selectedSourceReason: "Dashboard uses the first trusted Health Connect source by priority: Mi Fitness, Zepp/Amazfit, Google Fit; aggregate remains diagnostic.",
      selectedSourceStrategy: "trusted_source_priority",
      selectedTotal: sourceTotal(trusted.source),
      sources: result?.sources || [],
      allSources: dataOrigins.length ? dataOrigins : (result?.sources || []),
      suspiciousSources: [],
      suspiciousHighSources: [],
      rejectedSources: trusted.rejected,
      autoStrategy: "source_aware_priority",
      suspiciousReason: null,
      dashboardSourcePackage: trusted.source.sourcePackage || null,
      dashboardSourceName: sourceLabel(trusted.source),
      dashboardValidationStatus: "trusted_source",
      aggregateRejectedReason: validation.reason,
      dashboardValueSource: trusted.source.sourcePackage || null,
      dashboardValueReason: "trusted_source_after_exact_dedupe",
    };
  }

  if (validation.reason) {
    return {
      selectedSourcePackage: null,
      selectedSourceName: "Health Connect aggregate",
      selectedSourceReason: `Health Connect aggregate rejected: ${validation.reason}; no trusted source passed validation.`,
      selectedSourceStrategy: "aggregate_rejected_no_valid_source",
      selectedTotal: 0,
      sources: result?.sources || [],
      allSources: dataOrigins.length ? dataOrigins : (result?.sources || []),
      suspiciousSources: [],
      suspiciousHighSources: [],
      rejectedSources: trusted.rejected,
      autoStrategy: "source_aware_priority",
      suspiciousReason: validation.reason,
      dashboardSourcePackage: null,
      dashboardSourceName: "Health Connect aggregate",
      dashboardValidationStatus: "aggregate_rejected",
      aggregateRejectedReason: validation.reason,
      dashboardValueSource: null,
      dashboardValueReason: "aggregate_rejected_no_valid_source",
    };
  }

  return {
    selectedSourcePackage: null,
    selectedSourceName: "Health Connect aggregate",
    selectedSourceReason: "No trusted source breakdown was available, and Health Connect aggregate passed validation.",
    selectedSourceStrategy: result?.aggregateStrategy || "health_connect_aggregate",
    selectedTotal,
    sources: result?.sources || [],
    allSources: dataOrigins.length ? dataOrigins : (result?.sources || []),
    suspiciousSources: [],
    suspiciousHighSources: [],
    rejectedSources: trusted.rejected,
    autoStrategy: "health_connect_aggregate",
    suspiciousReason: null,
    dashboardSourcePackage: null,
    dashboardSourceName: "Health Connect aggregate",
    dashboardValidationStatus: "aggregate_valid",
    aggregateRejectedReason: null,
    dashboardValueSource: "health_connect_aggregate",
    dashboardValueReason: "aggregate_passed_validation",
  };
}

function selectBestSource(result, preferredSourcePackage = "", options = {}) {
  if (isHealthConnectAggregateResult(result)) {
    return healthConnectAggregateSelection(result, { ...options, preferredSourcePackage });
  }

  if (isAppleHealthAggregateResult(result) && (options.metric === "steps" || options.metric === "calories")) {
    return appleHealthAggregateSelection(result, { ...options, preferredSourcePackage });
  }

  if (options.metric === "steps" || options.metric === "calories") {
    return {
      selectedSourcePackage: null,
      selectedSourceName: "Health Connect aggregate",
      selectedSourceReason: "No canonical Health Connect aggregate result; source-selected values are diagnostics only.",
      selectedSourceStrategy: "health_connect_aggregate_required",
      selectedTotal: 0,
      sources: result?.sources || [],
      allSources: result?.sources || [],
      suspiciousSources: [],
      suspiciousHighSources: [],
      rejectedSources: [],
      autoStrategy: null,
      suspiciousReason: null,
    };
  }

  const sources = (result?.sources || []).filter((source) => source?.sourcePackage || source?.sourceName);
  if (!sources.length) {
    return {
      selectedSourcePackage: result?.selectedSourcePackage || null,
      selectedSourceName: sourceLabel({
        sourcePackage: result?.selectedSourcePackage || result?.sourcePackage || null,
        sourceName: result?.selectedSourceName || result?.sourceName || result?.source || "Health Connect aggregate",
      }),
      selectedSourceReason: result?.selectedSourcePackage ? "native selected source from cached snapshot" : "Health Connect aggregate/no source breakdown",
      selectedSourceStrategy: result?.selectedSourcePackage ? "native_cached_selection" : "aggregate_no_breakdown",
      selectedTotal: Number(result?.total || result?.active || 0) || 0,
      sources,
      suspiciousSources: [],
      suspiciousHighSources: [],
      rejectedSources: [],
      allSources: [],
      autoStrategy: null,
      suspiciousReason: null,
    };
  }

  if (options.metric === "steps") {
    return conservativeStepsSelection(sources, preferredSourcePackage, options);
  }

  const suspiciousSources = suspiciousSourceReport(sources, options);
  const suspiciousPackages = new Set(suspiciousSources.map((source) => String(source.sourcePackage || "").toLowerCase()).filter(Boolean));
  const saneSources = sources.filter((source) => !suspiciousPackages.has(String(source.sourcePackage || "").toLowerCase()));
  const candidates = saneSources.length ? saneSources : sources;
  const suspiciousReason = suspiciousSources.length
    ? suspiciousSources.map((source) => `${source.sourcePackage || source.sourceName || "unknown"}: ${source.reason}`).join("; ")
    : null;
  const clusterMedian = medianPositive(candidates.map(sourceTotal));
  const closeToCluster = candidates.filter((source) => {
    const total = sourceTotal(source);
    if (!clusterMedian || !total) return true;
    return Math.abs(total - clusterMedian) / clusterMedian <= 0.35;
  });
  const cluster = closeToCluster.length ? closeToCluster : candidates;
  const rejectedSources = suspiciousSources.map((source) => ({ ...source, rejected: true }));
  const preferred = preferredSourcePackage
    ? candidates.find((source) => sourcePackageKey(source) === preferredSourcePackage.toLowerCase())
    : null;

  if (preferred) {
    return {
      selectedSourcePackage: preferred.sourcePackage || null,
      selectedSourceName: sourceLabel(preferred),
      selectedSourceReason: `user preferred source ${preferred.sourcePackage || preferred.sourceName} selected; sanity passed`,
      selectedSourceStrategy: "preferred_user_source",
      selectedTotal: sourceTotal(preferred),
      sources,
      suspiciousSources,
      rejectedSources,
      suspiciousReason,
    };
  }

  const aggregate = candidates.find(isAggregateSource);
  if (aggregate) {
    const aggregateTotal = sourceTotal(aggregate);
    const agreed = !clusterMedian || !aggregateTotal || Math.abs(aggregateTotal - clusterMedian) / clusterMedian <= 0.25;
    if (agreed) {
      return {
        selectedSourcePackage: aggregate.sourcePackage || null,
        selectedSourceName: sourceLabel(aggregate),
        selectedSourceReason: `Health Connect aggregate/android selected because it agrees with source cluster median ${round(clusterMedian)}`,
        selectedSourceStrategy: "aggregate_consensus",
        selectedTotal: aggregateTotal,
        sources,
        suspiciousSources,
        rejectedSources,
        suspiciousReason,
      };
    }
  }

  const selected = [...cluster].sort((a, b) => {
    const distanceA = Math.abs(sourceTotal(a) - clusterMedian);
    const distanceB = Math.abs(sourceTotal(b) - clusterMedian);
    if (distanceA !== distanceB) return distanceA - distanceB;
    return sourceTrustRank(a) - sourceTrustRank(b);
  })[0] || candidates[0];

  return {
    selectedSourcePackage: selected.sourcePackage || null,
    selectedSourceName: sourceLabel(selected),
    selectedSourceReason: suspiciousReason
      ? `selected nearest sane cluster source to median ${round(clusterMedian)}; suspicious sources rejected`
      : `selected source nearest cluster median ${round(clusterMedian)} using trust priority`,
    selectedSourceStrategy: "legacy_source_cluster_diagnostics",
    selectedTotal: sourceTotal(selected),
    sources,
    suspiciousSources,
    rejectedSources,
    suspiciousReason,
  };
}

function samplesForSelectedSource(result, selection) {
  const aggregateSamples = result?.samples || [];
  const sourceSamples = result?.sourceSamples || aggregateSamples;
  if (!selection?.selectedSourcePackage) return aggregateSamples;
  return sourceSamples.filter((sample) => String(sample.sourcePackage || "").toLowerCase() === String(selection.selectedSourcePackage).toLowerCase());
}

function sourceDailyRowsForSelectedSource(result, selection) {
  const selectedPackage = selection?.selectedSourcePackage || "";
  const sourceDaily = result?.sourceDaily;
  if (!selectedPackage || !sourceDaily || typeof sourceDaily !== "object") return [];
  const directRows = sourceDaily[selectedPackage];
  if (Array.isArray(directRows)) return directRows;
  const matchedKey = Object.keys(sourceDaily).find((key) => sourceMatchesPreference({ sourcePackage: key }, selectedPackage));
  return matchedKey && Array.isArray(sourceDaily[matchedKey]) ? sourceDaily[matchedKey] : [];
}

function metricRowsForSelectedSource(result, selection) {
  if (!selection?.selectedSourcePackage) return result?.samples || [];
  const sourceDailyRows = sourceDailyRowsForSelectedSource(result, selection);
  if (sourceDailyRows.length) return sourceDailyRows;
  if (result?.selectedSourcePackage && sourceMatchesPreference(result, selection.selectedSourcePackage)) {
    return result?.samples || [];
  }
  return samplesForSelectedSource(result, selection);
}

function minutesSince(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.round((Date.now() - timestamp) / 60000));
}

function agoText(minutes) {
  if (minutes == null) return "нет данных";
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} ч ${rest} мин назад` : `${hours} ч назад`;
}

function heartFreshness(timestamp) {
  const ageMinutes = minutesSince(timestamp);
  if (ageMinutes == null) return { status: "no_data", ageMinutes: null, label: "нет данных" };
  if (ageMinutes <= 60) return { status: "fresh", ageMinutes, label: "fresh" };
  if (ageMinutes <= 360) return { status: "today", ageMinutes, label: "today" };
  if (ageMinutes <= 1440) return { status: "old_today", ageMinutes, label: "old_today" };
  return { status: "stale", ageMinutes, label: "stale" };
}

function heartWidgetStatus(freshness, hasHeart) {
  if (!hasHeart) return "no_data";
  if (freshness === "fresh" || freshness === "today" || freshness === "old_today") return "connected";
  return "stale";
}

function isSameLocalDay(value, date = new Date()) {
  if (!value) return false;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return false;
  return parsed.getFullYear() === date.getFullYear()
    && parsed.getMonth() === date.getMonth()
    && parsed.getDate() === date.getDate();
}

function estimateActiveCalories({ steps = 0, distanceMeters = 0, weightKg = 75, workouts = [] } = {}) {
  const safeWeight = Number(weightKg) > 0 ? Number(weightKg) : 75;
  const stepCount = Math.max(0, Number(steps) || 0);
  const normalizedDistance = normalizeDistanceMetersForEstimate(distanceMeters, stepCount);
  const stepEstimate = stepCount > 0 ? stepCount * safeWeight * 0.00042 : 0;
  const distanceEstimate = normalizedDistance > 0 ? (normalizedDistance / 1000) * safeWeight * 0.53 : 0;
  let movementEstimate = stepEstimate;
  if (distanceEstimate > 0 && stepEstimate > 0) {
    movementEstimate = clamp(distanceEstimate, stepEstimate * 0.75, stepEstimate * 1.35);
  } else if (distanceEstimate > 0) {
    movementEstimate = distanceEstimate;
  }
  const todaysWorkouts = (workouts || []).filter((session) => isSameLocalDay(session.start || session.startTime || session.date));
  const workoutEstimate = todaysWorkouts.reduce((sum, session) => {
    const explicitCalories = normalizeCaloriesValue(session.activeCalories || session.calories || session.energy || 0);
    if (explicitCalories > 0) return sum + explicitCalories;
    if (stepCount > 0 || normalizedDistance > 0) return sum;
    const start = new Date(session.start || session.startTime || session.date).getTime();
    const end = new Date(session.end || session.endTime || session.finish || session.finishTime).getTime();
    const minutes = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, (end - start) / 60000) : 0;
    return sum + Math.min(minutes * 4.2, 650);
  }, 0);
  return round(movementEstimate + workoutEstimate);
}

function normalizeDistanceMetersForEstimate(value, steps = 0) {
  let meters = Number(value || 0);
  if (!Number.isFinite(meters) || meters <= 0) return 0;
  if (meters > 100000) meters /= 1000;
  if (steps > 0) meters = Math.min(meters, steps * 1.2);
  return meters;
}

function profileForCalories(extra = {}) {
  let profile = {};
  try {
    profile = loadProfile();
  } catch (_) {
    profile = {};
  }
  return { ...profile, ...extra };
}

function estimateRestingCalories(profileLike = {}) {
  const profile = profileForCalories(profileLike);
  const gender = profile.gender === "male" ? "male" : "female";
  const age = clamp(Number(profile.age) || 30, 12, 90);
  const height = clamp(Number(profile.height) || 170, 120, 230);
  const weight = clamp(Number(profile.weight || profile.weightKg || profile.profileWeightKg) || 70, 35, 250);
  const bmr = 10 * weight + 6.25 * height - 5 * age + (gender === "male" ? 5 : -161);
  return round(clamp(bmr, 1000, 2600));
}

function splitCalorieValues({ caloriesResult = {}, estimatedActive = 0, profile = {}, stepsToday = 0 } = {}) {
  const restingCalories = estimateRestingCalories(profile);
  const nativeActiveRaw = normalizeCaloriesValue(caloriesResult.active);
  const nativeTotalRaw = normalizeCaloriesValue(caloriesResult.total);
  const activeGreaterThanTotal = nativeActiveRaw > 0 && nativeTotalRaw > 0 && nativeActiveRaw > nativeTotalRaw;
  const suspicious = activeGreaterThanTotal || (nativeActiveRaw > 5000 && Number(stepsToday || 0) < 1000);
  const nativeTotalLooksDaily = nativeTotalRaw >= restingCalories * 0.55;
  const nativeActive = activeGreaterThanTotal ? 0 : (nativeActiveRaw || (!nativeActiveRaw && nativeTotalRaw && !nativeTotalLooksDaily ? nativeTotalRaw : 0));
  const activeCalories = round(nativeActive || estimatedActive || 0);
  const totalCalories = round(nativeTotalLooksDaily ? nativeTotalRaw : (activeCalories > 0 ? restingCalories + activeCalories : 0));
  return {
    activeCalories,
    restingCalories,
    totalCalories,
    nativeActive,
    nativeTotal: nativeTotalLooksDaily ? nativeTotalRaw : 0,
    isEstimatedActive: !nativeActive && activeCalories > 0,
    totalWasEstimated: !nativeTotalLooksDaily && activeCalories > 0,
    suspicious,
    suspiciousReason: activeGreaterThanTotal
      ? "active calories are greater than total calories"
      : (suspicious ? "active calories are unusually high while steps are very low" : null),
  };
}

function sanitizedCalorieResult(caloriesResult = {}, range = "today", preferredSourcePackage = "") {
  if (isHealthConnectAggregateResult(caloriesResult) || isAppleHealthAggregateResult(caloriesResult)) {
    const selection = selectBestSource(caloriesResult, preferredSourcePackage, { metric: "calories", range });
    const selectedSamples = metricRowsForSelectedSource(caloriesResult, selection);
    const selectedTotal = round(selection.selectedTotal || 0);
    const aggregateTotal = Number(caloriesResult.total || caloriesResult.convertedTotal || 0) || 0;
    return {
      ...caloriesResult,
      active: selectedTotal,
      convertedActive: selectedTotal,
      total: aggregateTotal,
      samples: selectedSamples,
      suspiciousSources: [],
      suspiciousReason: selection.suspiciousReason || caloriesResult.suspiciousReason || null,
      discardedSuspiciousSources: selection.rejectedSources || [],
      rejectedSources: selection.rejectedSources || [],
      selectedSourcePackage: selection.selectedSourcePackage || null,
      selectedSourceName: selection.selectedSourceName,
      selectedSourceReason: selection.selectedSourceReason,
      selectedSourceStrategy: selection.selectedSourceStrategy,
      dashboardSourcePackage: selection.dashboardSourcePackage || null,
      dashboardSourceName: selection.dashboardSourceName,
      dashboardValidationStatus: selection.dashboardValidationStatus,
      aggregateRejectedReason: selection.aggregateRejectedReason,
      dashboardValueSource: selection.dashboardValueSource || null,
      dashboardValueReason: selection.dashboardValueReason || null,
      caloriesValidationStatus: selection.aggregateRejectedReason ? "invalid" : "valid",
      caloriesRejectedReason: selection.aggregateRejectedReason || null,
    };
  }

  const sources = (caloriesResult.sources || []).filter((source) => source?.sourcePackage || source?.sourceName);
  if (!sources.length) {
    return {
      ...caloriesResult,
      suspiciousSources: caloriesResult.suspiciousSources || [],
      suspiciousReason: caloriesResult.suspiciousReason || null,
      discardedSuspiciousSources: [],
    };
  }

  const selection = selectBestSource(caloriesResult, preferredSourcePackage, { metric: "calories", range });
  const selectedTotal = round(selection.selectedTotal || caloriesResult.active || 0);
  const selectedSamples = metricRowsForSelectedSource(caloriesResult, selection);
  return {
    ...caloriesResult,
    active: selectedTotal,
    convertedActive: selectedTotal,
    total: 0,
    sources,
    samples: selectedSamples,
    selectedSourcePackage: selection.selectedSourcePackage || null,
    selectedSourceName: selection.selectedSourceName || null,
    selectedSourceReason: selection.selectedSourceReason,
    selectedSourceStrategy: selection.selectedSourceStrategy,
    dashboardSourcePackage: selection.dashboardSourcePackage || selection.selectedSourcePackage || null,
    dashboardSourceName: selection.dashboardSourceName || selection.selectedSourceName || null,
    dashboardValidationStatus: selection.dashboardValidationStatus || "trusted_source",
    aggregateRejectedReason: selection.aggregateRejectedReason || null,
    dashboardValueSource: selection.dashboardValueSource || selection.selectedSourcePackage || null,
    dashboardValueReason: selection.dashboardValueReason || null,
    caloriesValidationStatus: selection.aggregateRejectedReason ? "invalid" : "valid",
    caloriesRejectedReason: selection.aggregateRejectedReason || null,
    suspiciousSources: selection.suspiciousSources || [],
    suspiciousReason: selection.suspiciousReason || null,
    discardedSuspiciousSources: selection.rejectedSources || [],
    rejectedSources: selection.rejectedSources || [],
  };
}

function normalizeCaloriesValue(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return round(number);
}

function metricHistoryMap(items = [], valueKeys = ["value"]) {
  const map = new Map();
  (items || []).forEach((item) => {
    const date = String(item?.date || item?.day || "").slice(0, 10);
    if (!date) return;
    const value = valueKeys.reduce((result, key) => {
      if (result !== null) return result;
      const number = Number(item?.[key]);
      return Number.isFinite(number) ? number : null;
    }, null);
    const recordsCount = Number(item?.recordsCount || item?.samplesCount || item?.count || 0) || 0;
    const next = {
      label: item?.label || item?.dayLabel || weekLabels[dayIndexFromDate(localDateFromKey(date))],
      value: round(value || 0),
      recordsCount,
    };
    const current = map.get(date);
    if (!current || next.recordsCount > current.recordsCount || next.value > current.value) {
      map.set(date, next);
    }
  });
  return map;
}

function metricHistoryHasData(map) {
  return Array.from(map.values()).some((item) => item.recordsCount > 0 || Number(item.value || 0) > 0);
}

function metricValueForDate(map, hasDateBoundData, date, fallback = 0) {
  const item = map.get(date);
  if (item && (item.recordsCount > 0 || Number(item.value || 0) > 0)) return round(item.value);
  return hasDateBoundData ? 0 : round(fallback || 0);
}

function metricHistoryFromCalendarSeries(values = [], sourceItems = [], valueKeys = ["value"]) {
  const sourceByDate = metricHistoryMap(sourceItems, valueKeys);
  return lastDays(7).map((day, index) => {
    const source = sourceByDate.get(day.date);
    const value = round(values[index] || source?.value || 0);
    return {
      date: day.date,
      label: source?.label || day.label,
      dateLabel: day.dateLabel,
      value,
      recordsCount: Number(source?.recordsCount || 0) || (value > 0 ? 1 : 0),
    };
  });
}

function buildActivityHistory(stepWeek = [], calorieWeek = [], totalCalorieWeek = [], heartWeek = [], historySteps = [], historyCalories = []) {
  const calendarDays = lastDays(7);
  const stepHistoryByDate = metricHistoryMap(historySteps, ["value", "steps"]);
  const calorieHistoryByDate = metricHistoryMap(historyCalories, ["value", "activeCalories", "calories"]);
  const hasDateBoundSteps = metricHistoryHasData(stepHistoryByDate);
  const hasDateBoundCalories = metricHistoryHasData(calorieHistoryByDate);
  return {
    week: calendarDays.map((calendarDay, index) => {
      const sameDateHistory = historySteps.find((item) => item?.date === calendarDay.date);
      const historyDay = sameDateHistory || (historySteps[index]?.date === calendarDay.date ? historySteps[index] : {}) || {};
      const label = historyDay.label || calorieHistoryByDate.get(calendarDay.date)?.label || calendarDay.label;
      const steps = metricValueForDate(stepHistoryByDate, hasDateBoundSteps, calendarDay.date, stepWeek[index]);
      const activeCalories = metricValueForDate(calorieHistoryByDate, hasDateBoundCalories, calendarDay.date, calorieWeek[index]);
      const totalCalories = round(totalCalorieWeek[index] || 0);
      const suspicious = steps > 40000 || (activeCalories > 0 && totalCalories > 0 && activeCalories > totalCalories);
      return {
        date: calendarDay.date,
        label,
        dateLabel: calendarDay.dateLabel,
        steps,
        calories: activeCalories,
        activeCalories,
        totalCalories,
        heart: round(heartWeek[index] || 0),
        suspicious,
        suspiciousReason: suspicious
          ? [steps > 40000 ? "steps_gt_40000" : null, activeCalories > totalCalories && totalCalories > 0 ? "active_calories_gt_total" : null].filter(Boolean).join("; ")
          : null,
      };
    }),
    month: Array.from({ length: 30 }, (_, index) => ({
      label: String(index + 1),
      steps: 0,
      calories: 0,
      activeCalories: 0,
      totalCalories: 0,
      heart: 0,
    })),
  };
}

function buildSleepWeek(sessions = []) {
  return buildSleepWeekFromTimeline(buildCanonicalSleepTimeline(sessions));
}

async function readNativeHealthSnapshot(previous, options = {}) {
  const queryMode = options.queryMode || HEALTH_QUERY_MODES.DASHBOARD;
  const isDashboardMode = queryMode === HEALTH_QUERY_MODES.DASHBOARD;
  const isHistory7dMode = queryMode === HEALTH_QUERY_MODES.HISTORY_7D;
  const includeMonthHistory = queryMode === HEALTH_QUERY_MODES.HISTORY;
  const forceNative = Boolean(options.force);
  const nowMs = Date.now();
  const stepSourceOptions = preferredHealthSourceOptions();
  const skipped = (range, extra = {}) => ({
    state: healthProviderStates.NO_DATA,
    range,
    skipped: true,
    skippedReason: "dashboard_light",
    recordsCount: 0,
    recordsRawCount: 0,
    samplesCount: 0,
    sources: [],
    samples: [],
    ...extra,
  });
  const resultWasRead = (result) => Boolean(result)
    && !result.skipped
    && result.state !== healthProviderStates.ERROR
    && result.state !== healthProviderStates.RATE_LIMITED;
  let availability;
  let stepsToday;
  let stepsWeek;
  let stepsMonth;
  let caloriesToday;
  let caloriesWeek;
  let caloriesMonth;
  let distanceToday;
  let heartRecent;
  let heartToday;
  let heart24h;
  let heartWeek;
  let sleepWeek;
  let workoutsWeek;

  const useStepsTodayCache = !forceNative && canUseMetricCache(previous, "steps", "steps", HEALTH_METRIC_TTL_MS.steps, { now: nowMs });
  const useStepsHistoryCache = !forceNative && !isDashboardMode && !isHistory7dMode && canUseMetricCache(previous, "steps", "steps", HEALTH_METRIC_TTL_MS.steps, { history: true, now: nowMs });
  const useCaloriesTodayCache = !forceNative && canUseMetricCache(previous, "calories", "calories", HEALTH_METRIC_TTL_MS.calories, { now: nowMs });
  const useCaloriesHistoryCache = !forceNative && !isDashboardMode && !isHistory7dMode && canUseMetricCache(previous, "calories", "calories", HEALTH_METRIC_TTL_MS.calories, { history: true, now: nowMs });
  const useHeartDashboardCache = !forceNative && isDashboardMode && canUseMetricCache(previous, "heart_rate", "heart", HEALTH_METRIC_TTL_MS.heartRate, { now: nowMs });
  const useHeartHistoryCache = !forceNative && !isDashboardMode && canUseMetricCache(previous, "heart_rate", "heart", HEALTH_METRIC_TTL_MS.heartRate, { history: true, now: nowMs });
  const useSleepCache = !forceNative && canUseMetricCache(previous, "sleep", "sleep", HEALTH_METRIC_TTL_MS.sleep, { history: true, now: nowMs });
  const useWorkoutsCache = !forceNative && !isDashboardMode && canUseMetricCache(previous, "workouts", "workouts", HEALTH_METRIC_TTL_MS.workouts, { now: nowMs });

  if (isDashboardMode) {
    [availability, stepsToday, caloriesToday, heart24h, sleepWeek] = await Promise.all([
      getHealthAvailability(),
      useStepsTodayCache ? Promise.resolve(cachedStepsResult("today", previous.steps)) : getSteps("today", stepSourceOptions),
      useCaloriesTodayCache ? Promise.resolve(cachedCaloriesResult("today", previous.calories)) : getCalories("today", stepSourceOptions),
      useHeartDashboardCache ? Promise.resolve(cachedHeartResult("last24h", previous.heart_rate)) : getHeartRate("last24h"),
      useSleepCache ? Promise.resolve(cachedSleepResult("last24h", previous.sleep)) : getSleep("last24h"),
    ]);
    stepsWeek = skipped("week");
    stepsMonth = skipped("month");
    caloriesWeek = skipped("week");
    caloriesMonth = skipped("month");
    distanceToday = skipped("today", { meters: null });
    heartRecent = deriveHeartLast15min(heart24h);
    heartToday = deriveHeartToday(heart24h);
    heartWeek = skipped("week");
    if (!heartResultHasData(heart24h) && nativeHealthDisplayName(availability?.source) === "Apple Health") {
      heartWeek = await getHeartRate("week");
    }
    workoutsWeek = skipped("week", { sessions: [] });
  } else {
    [availability, stepsToday, stepsWeek, stepsMonth, caloriesToday, caloriesWeek, caloriesMonth, heart24h, heartWeek, sleepWeek, workoutsWeek] = await Promise.all([
      getHealthAvailability(),
      useStepsTodayCache ? Promise.resolve(cachedStepsResult("today", previous.steps)) : getSteps("today", stepSourceOptions),
      useStepsHistoryCache ? Promise.resolve(cachedStepsResult("week", previous.steps)) : getSteps("week", stepSourceOptions),
      includeMonthHistory ? (useStepsHistoryCache ? Promise.resolve(cachedStepsResult("month", previous.steps)) : getSteps("month", stepSourceOptions)) : Promise.resolve(skipped("month", { skippedReason: isHistory7dMode ? "first_sync_30d_deferred" : "history_month_skipped" })),
      useCaloriesTodayCache ? Promise.resolve(cachedCaloriesResult("today", previous.calories)) : getCalories("today", stepSourceOptions),
      useCaloriesHistoryCache ? Promise.resolve(cachedCaloriesResult("week", previous.calories)) : getCalories("week", stepSourceOptions),
      includeMonthHistory ? (useCaloriesHistoryCache ? Promise.resolve(cachedCaloriesResult("month", previous.calories)) : getCalories("month", stepSourceOptions)) : Promise.resolve(skipped("month", { skippedReason: isHistory7dMode ? "first_sync_30d_deferred" : "history_month_skipped" })),
      useHeartHistoryCache ? Promise.resolve(cachedHeartResult("last24h", previous.heart_rate)) : getHeartRate("last24h"),
      useHeartHistoryCache ? Promise.resolve(cachedHeartResult("week", previous.heart_rate)) : getHeartRate("week"),
      useSleepCache ? Promise.resolve(cachedSleepResult("week", previous.sleep)) : getSleep("week"),
      useWorkoutsCache ? Promise.resolve(cachedWorkoutsResult("week", previous.workouts)) : getExerciseSessions("week"),
    ]);
    distanceToday = skipped("today", { meters: null });
    heartRecent = deriveHeartLast15min(heart24h);
    heartToday = deriveHeartToday(heart24h);
  }

  const queryEntries = [
    { query: "steps.today", range: "today", result: stepsToday },
    { query: "steps.week", range: "week", result: stepsWeek },
    { query: "steps.month", range: "month", result: stepsMonth },
    { query: "calories.today", range: "today", result: caloriesToday },
    { query: "calories.week", range: "week", result: caloriesWeek },
    { query: "calories.month", range: "month", result: caloriesMonth },
    { query: "distance.today", range: "today", result: distanceToday },
    { query: "heartRate.last15min", range: "last15min", result: heartRecent },
    { query: "heartRate.today", range: "today", result: heartToday },
    { query: "heartRate.last24h", range: "last24h", result: heart24h },
    { query: "heartRate.week", range: "week", result: heartWeek },
    { query: "sleep.week", range: "week", result: sleepWeek },
    { query: "workouts.week", range: "week", result: workoutsWeek },
  ];
  const queryStats = healthQueryStats(queryEntries);
  if (hasRateLimitedResult(queryEntries.map((entry) => entry.result))) {
    console.warn("[FruitFit health refresh] rate limited, reusing cached state", { queryMode });
    return buildRateLimitHealthState(previous, {
      now: Date.now(),
      queryMode,
      reason: options.reason || "native-read",
      nativeReadReason: options.reason || "native-read",
      errors: healthQueryErrors(queryEntries),
      queryStats,
    });
  }

  const preferredPackage = stepSourceOptions.preferredSourcePackage || "";
  const stepSelectionToday = selectBestSource(stepsToday, preferredPackage, { metric: "steps", range: "today" });
  const stepSelectionWeek = selectBestSource(stepsWeek, preferredPackage, { metric: "steps", range: "week" });
  const stepSelectionMonth = selectBestSource(stepsMonth, preferredPackage, { metric: "steps", range: "month" });
  const calorieSelectionWeek = selectBestSource(caloriesWeek, preferredPackage, { metric: "calories", range: "week" });
  const calorieSelectionMonth = selectBestSource(caloriesMonth, preferredPackage, { metric: "calories", range: "month" });
  const stepSamplesToday = metricRowsForSelectedSource(stepsToday, stepSelectionToday);
  const stepSamplesWeek = metricRowsForSelectedSource(stepsWeek, stepSelectionWeek);
  const stepSamplesMonth = metricRowsForSelectedSource(stepsMonth, stepSelectionMonth);
  const calorieSamplesWeek = metricRowsForSelectedSource(caloriesWeek, calorieSelectionWeek);
  const calorieSamplesMonth = metricRowsForSelectedSource(caloriesMonth, calorieSelectionMonth);
  const stepsWeekWasRead = resultWasRead(stepsWeek);
  const stepsMonthWasRead = resultWasRead(stepsMonth);
  const caloriesWeekWasRead = resultWasRead(caloriesWeek);
  const caloriesMonthWasRead = resultWasRead(caloriesMonth);
  const heartWeekWasRead = resultWasRead(heartWeek);
  const workoutsWeekWasRead = resultWasRead(workoutsWeek);
  const stepsWeekRaw = stepsWeekWasRead && stepSamplesWeek.length ? buildSeriesFromSamples(stepSamplesWeek, "week") : (previous.steps?.weekRaw || []);
  const stepsMonthRaw = stepsMonthWasRead && stepSamplesMonth.length ? buildSeriesFromSamples(stepSamplesMonth, "month") : (previous.steps?.monthRaw || []);
  const caloriesWeekRaw = caloriesWeekWasRead && calorieSamplesWeek.length ? buildSeriesFromSamples(calorieSamplesWeek, "week") : (previous.calories?.weekRaw || []);
  const caloriesMonthRaw = caloriesMonthWasRead && calorieSamplesMonth.length ? buildSeriesFromSamples(calorieSamplesMonth, "month") : (previous.calories?.monthRaw || []);
  const caloriesWeekTotalRaw = caloriesWeekWasRead && (caloriesWeek.totalSamples || []).length ? buildSeriesFromSamples(caloriesWeek.totalSamples || [], "week") : (previous.calories?.weekTotalRaw || []);
  const caloriesMonthTotalRaw = caloriesMonthWasRead && (caloriesMonth.totalSamples || []).length ? buildSeriesFromSamples(caloriesMonth.totalSamples || [], "month") : (previous.calories?.monthTotalRaw || []);
  const heartRateWeekRaw = heartWeekWasRead && (heartWeek.samples || []).length ? buildAverageSeriesFromSamples(heartWeek.samples || [], "week") : (previous.heart_rate?.weekRaw || []);
  const rawSleepSessions = dedupeSleepSessionsForCanonical(sleepWeek.sessions || []);
  const sleepAggregateSamples = (sleepWeek.samples || [])
    .map((sample) => ({ ...sample, value: Number(sample.value || sample.minutes || 0) }))
    .filter((sample) => sample.value > 0);
  const sleepAggregateSessions = sleepAggregateSamples.map((sample) => ({
    start: sample.start,
    end: sample.end || sample.start,
    minutes: sample.value,
    sourcePackage: sample.sourcePackage || null,
    sourceName: sample.sourceName || "Health Connect aggregate",
  }));
  const previousManualSleepEntries = normalizeSleepEntriesForDisplay(previous.sleep?.manualSleepEntries || []);
  const nativeSleepEntries = normalizeSleepEntriesForDisplay(rawSleepSessions.length ? rawSleepSessions : sleepAggregateSessions);
  const sleepEntries = normalizeSleepEntriesForDisplay([...previousManualSleepEntries, ...nativeSleepEntries]);
  const sleepTimeline = buildCanonicalSleepTimeline(sleepEntries);
  const sleepMainSessions = sleepTimeline.mainSleepSessions;
  const sleepNapSessions = sleepTimeline.naps;
  const sleepFragmentSessions = sleepTimeline.fragments;
  const sleepShortUnder2h = sleepEntries.filter((session) => Number(session.minutes || 0) < 120);
  const sleepTotals = sleepTotalsByKind(sleepEntries);
  const sleepWeekRaw = sleepTimeline.days.length ? sleepTimeline.days.map((item) => round(item.totalMinutes)) : [];
  const sleepHistory7d = sleepEntries.length ? buildSleepHistory7dFromTimeline(sleepTimeline) : (previous.history7d?.sleep || []);
  const todaySleepHistory = sleepHistory7d.find((entry) => entry.date === localDateKey()) || null;
  const todaySleepSessions = sleepEntries.filter((session) => sleepSessionDateKey(session) === localDateKey());
  const todaySleepDay = sleepTimeline.days.find((day) => day.date === localDateKey()) || null;
  const latestNativeSleep = latestSleepSession(sleepEntries);
  const todayNativeSleep = todaySleepSessions.length ? {
    ...latestSleepSession(todaySleepSessions),
    minutes: todaySleepSessions.reduce((sum, session) => sum + Number(session.minutes || 0), 0),
  } : null;
  const historyTodaySleep = Number(todaySleepHistory?.value || todaySleepHistory?.minutes || 0) > 0
    ? { minutes: Number(todaySleepHistory.value || todaySleepHistory.minutes || 0), start: todaySleepHistory.date, end: todaySleepHistory.date }
    : null;
  const sleepDisplaySession = historyTodaySleep || todayNativeSleep || latestNativeSleep || sleepWeek.latestSleep || null;
  const stepWeek = stepsWeekRaw.length ? stepsWeekRaw : (previous.steps?.week || Array.from({ length: 7 }, () => 0));
  const stepMonth = stepsMonthRaw.length ? stepsMonthRaw : (previous.steps?.month || Array.from({ length: 30 }, () => 0));
  const allSleepSessions = sleepEntries;
  const sleepToday = sleepDisplaySession || allSleepSessions[allSleepSessions.length - 1] || null;
  const recentHeartSample = latestHeartSampleFromResults([heartRecent, heartToday, heart24h, heartWeek], preferredPackage);
  const heartFresh = heartFreshness(recentHeartSample?.time || heartRecent.latestTimestamp || heart24h.latestTimestamp || heartWeek.latestTimestamp || (isDashboardMode ? previous.heart_rate?.latestTimestamp : null));
  const heartTodaySamples = heartSamples(heartToday);
  const heart24hSamples = heartSamples(heart24h);
  const heartWeekSamples = heartSamples(heartWeek);
  const heartValues = heartTodaySamples.map((sample) => sample.value).filter(Boolean);
  const heart24hValues = heart24hSamples.map((sample) => sample.value).filter(Boolean);
  const heartWeekValues = heartWeekSamples.map((sample) => sample.value).filter(Boolean);
  const recentHeartValues = heartSamples(heartRecent).map((sample) => sample.value).filter(Boolean);
  const heartDisplay = heartDisplayInfo({
    heart24h,
    heartWeek,
    freshness: heartFresh,
    permissionGranted: availability.permissionStatus?.heartRate !== false,
  });
  const heartHistory7d = heartWeekWasRead ? buildHeartHistory7d(heartWeekSamples) : (previous.heart_rate?.history7d || previous.history7d?.heartRate || []);
  const healthConnectReadable = canReadNativeData(availability.state);
  const stepsPermissionGranted = healthConnectReadable && availability.permissionStatus?.steps !== false;
  const hasSteps = stepsToday.state === healthProviderStates.CONNECTED
    || Number(stepSelectionToday.selectedTotal || stepsToday.total) > 0
    || (stepsToday.samples || []).length > 0
    || Boolean(stepSelectionToday.selectedSourcePackage);
  const hasStepValue = Number(stepSelectionToday.selectedTotal || stepsToday.total || 0) > 0;
  const stepsConnectedEmptyToday = !hasStepValue
    && stepsPermissionGranted
    && healthConnectReadable
    && stepsToday.state !== healthProviderStates.PERMISSIONS_REQUIRED
    && stepsToday.state !== healthProviderStates.ERROR
    && stepsToday.state !== healthProviderStates.RATE_LIMITED;
  const stepsStatus = hasStepValue ? "connected" : (stepsConnectedEmptyToday ? "connected_empty_today" : (stepsToday.state === healthProviderStates.PERMISSIONS_REQUIRED || !stepsPermissionGranted ? "permission_required" : "no_data"));
  const workouts = workoutsWeekWasRead ? (workoutsWeek.sessions || []) : [];
  const calorieProfile = profileForCalories(previous);
  const estimatedCalories = estimateActiveCalories({
    steps: stepSelectionToday.selectedTotal || stepsToday.total || 0,
    distanceMeters: distanceToday.meters || 0,
    weightKg: calorieProfile.weight || previous.profileWeightKg || previous.weightKg || 75,
    workouts,
  });
  const selectedStepsToday = stepSelectionToday.selectedTotal || stepsToday.total || 0;
  const caloriesTodaySafe = sanitizedCalorieResult(caloriesToday, "today", preferredPackage);
  const calorieSplit = splitCalorieValues({
    caloriesResult: caloriesTodaySafe,
    estimatedActive: estimatedCalories,
    profile: calorieProfile,
    stepsToday: selectedStepsToday,
  });
  const caloriesTodayValue = calorieSplit.activeCalories;
  const nativeCaloriesWeek = Array.from({ length: 7 }, (_, index) => round(normalizeCaloriesValue(caloriesWeekRaw[index]) || 0));
  const nativeCaloriesMonth = Array.from({ length: 30 }, (_, index) => round(normalizeCaloriesValue(caloriesMonthRaw[index]) || 0));
  const nativeTotalCaloriesWeek = Array.from({ length: 7 }, (_, index) => round(normalizeCaloriesValue(caloriesWeekTotalRaw[index]) || 0));
  const nativeTotalCaloriesMonth = Array.from({ length: 30 }, (_, index) => round(normalizeCaloriesValue(caloriesMonthTotalRaw[index]) || 0));
  const stepsTodayValue = round(selectedStepsToday);
  const history = writeHealthHistory({
    date: localDateKey(),
    steps: stepsTodayValue,
    activeCalories: calorieSplit.activeCalories,
    restingCalories: calorieSplit.restingCalories,
    totalCalories: calorieSplit.totalCalories,
  });
  const historyStepWeek = historySeries(history, "steps", 7);
  const historyStepMonth = historySeries(history, "steps", 30);
  const historyCaloriesWeek = historySeries(history, "activeCalories", 7);
  const historyCaloriesMonth = historySeries(history, "activeCalories", 30);
  const historyTotalCaloriesWeek = historySeries(history, "totalCalories", 7);
  const resolvedStepWeek = overlayCalendarHistory(hasPositiveSeries(stepWeek) ? stepWeek.map(round) : historyStepWeek, historyStepWeek, stepsTodayValue);
  const resolvedStepMonth = hasPositiveSeries(stepMonth) ? stepMonth.map(round) : historyStepMonth;
  const resolvedCaloriesWeek = overlayCalendarHistory(hasPositiveSeries(nativeCaloriesWeek) ? nativeCaloriesWeek.map(round) : historyCaloriesWeek, historyCaloriesWeek, calorieSplit.activeCalories);
  const resolvedCaloriesMonth = hasPositiveSeries(nativeCaloriesMonth) ? nativeCaloriesMonth.map(round) : historyCaloriesMonth;
  const resolvedTotalCaloriesWeek = overlayCalendarHistory(nativeTotalCaloriesWeek, historyTotalCaloriesWeek, calorieSplit.totalCalories);
  const hasCalories = caloriesTodaySafe.state === healthProviderStates.CONNECTED
    || caloriesTodayValue > 0
    || (caloriesTodaySafe.samples || []).length > 0
    || Number(caloriesTodaySafe.recordsCount || 0) > 0;
  const caloriesEstimated = calorieSplit.isEstimatedActive;
  const hasRecentHeart = recentHeartValues.length > 0;
  const hasHeartToday = heartValues.length > 0;
  const hasCachedHeart = (isDashboardMode || useHeartHistoryCache) && metricHasCache(previous.heart_rate, "heart");
  const hasAnyHeart = Boolean(
    recentHeartSample
    || heartRecent.latestBpm
    || heartToday.latestBpm
    || heart24h.latestBpm
    || heartWeek.latestBpm
    || heartRecent.samplesCount
    || heartToday.samplesCount
    || heart24h.samplesCount
    || heartWeek.samplesCount
    || heart24h.aggregateSamplesCount
    || heartWeek.aggregateSamplesCount
    || heart24h.min
    || heart24h.avg
    || heart24h.max
    || heartWeek.min
    || heartWeek.avg
    || heartWeek.max
    || (heartRecent.samples || []).length
    || (heart24h.samples || []).length
    || (heartWeek.samples || []).length
    || hasCachedHeart
  );
  const hasSleep = sleepAggregateSamples.length > 0 || sleepEntries.length > 0 || allSleepSessions.length > 0 || Boolean(sleepDisplaySession);
  const hasWorkouts = workouts.length > 0;
  const heartLatestTimestamp = recentHeartSample?.time || heartRecent.latestTimestamp || heartToday.latestTimestamp || heart24h.latestTimestamp || heartWeek.latestTimestamp || (hasCachedHeart ? previous.heart_rate?.latestTimestamp : null);
  const heartLatestBpm = recentHeartSample ? Number(recentHeartSample.value) : heartRecent.latestBpm || heartToday.latestBpm || heart24h.latestBpm || heartWeek.latestBpm || (hasCachedHeart ? previous.heart_rate?.latestBpm : null);
  const heartLatestSourcePackage = recentHeartSample?.sourcePackage || heartRecent.latestSourcePackage || heartToday.latestSourcePackage || heart24h.latestSourcePackage || heartWeek.latestSourcePackage || (hasCachedHeart ? previous.heart_rate?.latestSourcePackage : null);
  const heartLatestSourceName = sourceLabel({ sourcePackage: heartLatestSourcePackage, sourceName: recentHeartSample?.sourceName || heartRecent.latestSourceName || heartToday.latestSourceName || heart24h.latestSourceName || heartWeek.latestSourceName || (hasCachedHeart ? previous.heart_rate?.latestSourceName : null) });
  const hasHeart24h = heart24hValues.length > 0 || Number(heart24h.aggregateSamplesCount || 0) > 0 || Number(heart24h.min || heart24h.avg || heart24h.max || 0) > 0;
  const heart24hMin = hasHeart24h ? (heart24h.min || (heart24hValues.length ? Math.min(...heart24hValues) : null)) : (hasCachedHeart ? (previous.heart_rate?.min24h || previous.heart_rate?.range24h?.[0] || null) : null);
  const heart24hMax = hasHeart24h ? (heart24h.max || (heart24hValues.length ? Math.max(...heart24hValues) : null)) : (hasCachedHeart ? (previous.heart_rate?.max24h || previous.heart_rate?.range24h?.[1] || null) : null);
  const heart24hAvg = hasHeart24h ? (heart24h.avg || (heart24hValues.length ? round(heart24hValues.reduce((sum, value) => sum + value, 0) / heart24hValues.length) : null)) : (hasCachedHeart ? previous.heart_rate?.avg24h || null : null);
  const heart24hRange = heart24hMin && heart24hMax ? [heart24hMin, heart24hMax] : [null, null];
  const hasHeartWeekAggregate = Number(heartWeek.aggregateSamplesCount || 0) > 0 || Number(heartWeek.min || heartWeek.avg || heartWeek.max || 0) > 0;
  const heartWeekRange = heartWeekValues.length || hasHeartWeekAggregate ? [heartWeek.min || (heartWeekValues.length ? Math.min(...heartWeekValues) : null), heartWeek.max || (heartWeekValues.length ? Math.max(...heartWeekValues) : null)] : (heartWeekWasRead ? [null, null] : (previous.heart_rate?.range7d || [null, null]));
  const nativeHistory7d = {
    steps: stepsWeekWasRead && stepSamplesWeek.length ? buildMetricHistory7d(stepSamplesWeek) : (previous.history7d?.steps || []),
    calories: caloriesWeekWasRead && calorieSamplesWeek.length ? buildMetricHistory7d(calorieSamplesWeek) : (previous.history7d?.calories || []),
    heartRate: heartHistory7d,
    sleep: sleepHistory7d,
  };
  const nextHistory7d = {
    ...nativeHistory7d,
    steps: metricHistoryFromCalendarSeries(resolvedStepWeek, nativeHistory7d.steps, ["value", "steps"]),
    calories: metricHistoryFromCalendarSeries(resolvedCaloriesWeek, nativeHistory7d.calories, ["value", "activeCalories", "calories"]),
  };
  const nowIso = new Date().toISOString();

  const next = {
    ...previous,
    generatedAt: nowIso,
    lastFruitFitRefreshAt: nowIso,
    dataSource: canReadNativeData(availability.state) ? "tracker" : previous.dataSource,
    providerState: availability.state,
    providerSource: availability.source,
    providerMessage: availability.message,
    preferredStepSourcePackage: preferredPackage || "",
    rateLimitedUntil: null,
    cacheAgeMs: 0,
    cacheReason: null,
    lastSuccessfulNativeReadAt: queryStats.queryCount > 0 ? nowIso : previous.lastSuccessfulNativeReadAt || null,
    steps: {
      ...previous.steps,
      lastNativeReadAt: stepsToday.skipped && stepsWeek.skipped && stepsMonth.skipped ? previous.steps?.lastNativeReadAt || null : nowIso,
      lastHistoryReadAt: stepsWeekWasRead || stepsMonthWasRead ? nowIso : previous.steps?.lastHistoryReadAt || null,
      today: stepsTodayValue,
      hourly: buildSeriesFromSamples(stepSamplesToday, "today"),
      week: resolvedStepWeek,
      month: resolvedStepMonth,
      weekRaw: stepsWeekRaw,
      monthRaw: stepsMonthRaw,
      sourceName: stepSelectionToday.selectedSourceName,
      sourcePackage: stepSelectionToday.selectedSourcePackage || null,
      preferredSource: preferredPackage || "auto",
      selectedSourceReason: stepSelectionToday.selectedSourceReason,
      selectedSourceStrategy: stepSelectionToday.selectedSourceStrategy,
      dashboardSourcePackage: stepSelectionToday.dashboardSourcePackage || stepSelectionToday.selectedSourcePackage || null,
      dashboardSourceName: stepSelectionToday.dashboardSourceName || stepSelectionToday.selectedSourceName || null,
      dashboardValidationStatus: stepSelectionToday.dashboardValidationStatus || null,
      aggregateRejectedReason: stepSelectionToday.aggregateRejectedReason || null,
      dashboardValueSource: stepSelectionToday.dashboardValueSource || null,
      dashboardValueReason: stepSelectionToday.dashboardValueReason || null,
      autoStrategy: stepSelectionToday.autoStrategy || null,
      sources: stepsToday.sources || [],
      allSources: stepSelectionToday.allSources || stepsToday.sources || [],
      suspiciousSources: stepSelectionToday.suspiciousSources || [],
      suspiciousHighSources: stepSelectionToday.suspiciousHighSources || [],
      rejectedSources: stepSelectionToday.rejectedSources || [],
      suspiciousReason: stepSelectionToday.suspiciousReason || null,
      rawTotal: stepsToday.rawTotal || 0,
      rawSourceTotal: stepsToday.rawSourceTotal ?? null,
      uniqueTotal: stepsToday.uniqueTotal ?? null,
      recordsCountRaw: stepsToday.recordsCountRaw ?? null,
      recordsCountUnique: stepsToday.recordsCountUnique ?? null,
      duplicateRows: stepsToday.duplicateRows ?? null,
      maxRepeat: stepsToday.maxRepeat ?? null,
      dedupeApplied: Boolean(stepsToday.dedupeApplied),
      aggregateStrategy: stepsToday.aggregateStrategy || "health_connect_aggregate",
      dataSource: hasSteps || stepsConnectedEmptyToday ? "tracker" : null,
      status: stepsStatus,
      widgetState: stepsStatus === "connected_empty_today" ? "connected_empty" : stepsStatus,
      emptyReason: stepsStatus === "connected_empty_today" ? "today_zero_after_midnight_or_waiting_for_tracker_sync" : null,
    },
    calories: {
      ...previous.calories,
      lastNativeReadAt: caloriesToday.skipped && caloriesWeek.skipped && caloriesMonth.skipped ? previous.calories?.lastNativeReadAt || null : nowIso,
      lastHistoryReadAt: caloriesWeekWasRead || caloriesMonthWasRead ? nowIso : previous.calories?.lastHistoryReadAt || null,
      today: caloriesTodayValue,
      activeToday: calorieSplit.activeCalories,
      restingToday: calorieSplit.restingCalories,
      totalToday: calorieSplit.totalCalories,
      hourly: buildSeriesFromSamples(caloriesTodaySafe.samples || caloriesToday.samples, "today"),
      week: resolvedCaloriesWeek,
      month: resolvedCaloriesMonth,
      weekRaw: caloriesWeekRaw,
      monthRaw: caloriesMonthRaw,
      weekTotalRaw: caloriesWeekTotalRaw,
      monthTotalRaw: caloriesMonthTotalRaw,
      totalWeek: hasPositiveSeries(nativeTotalCaloriesWeek) ? nativeTotalCaloriesWeek : (previous.calories?.totalWeek || []),
      totalMonth: hasPositiveSeries(nativeTotalCaloriesMonth) ? nativeTotalCaloriesMonth : (previous.calories?.totalMonth || []),
      rawActiveToday: caloriesTodaySafe.rawActive || null,
      rawUnit: caloriesTodaySafe.rawUnit || null,
      convertedActiveToday: caloriesTodaySafe.convertedActive ?? caloriesTodaySafe.active ?? null,
      unit: caloriesTodaySafe.unit || "kcal",
      recordsToday: caloriesTodaySafe.recordsCount || (caloriesTodaySafe.samples || []).length || 0,
      samplesToday: (caloriesTodaySafe.samples || []).length,
      sources: caloriesTodaySafe.sources || [],
      suspiciousSources: caloriesTodaySafe.suspiciousSources || [],
      rejectedSources: caloriesTodaySafe.rejectedSources || caloriesTodaySafe.discardedSuspiciousSources || [],
      suspicious: Boolean(calorieSplit.suspicious || caloriesTodaySafe.suspiciousReason),
      suspiciousReason: [calorieSplit.suspiciousReason, caloriesTodaySafe.suspiciousReason].filter(Boolean).join("; ") || null,
      sourceName: caloriesEstimated ? "Оценка активности" : dataSourceName(caloriesTodaySafe),
      selectedSourceReason: caloriesEstimated
        ? "active calories missing, estimated from steps/distance/workouts; total = resting BMR + active"
        : (caloriesTodaySafe.selectedSourceReason || (calorieSplit.totalWasEstimated ? "Health Connect active calories; total = resting BMR + active" : "Health Connect active and total calories")),
      selectedSourceStrategy: caloriesTodaySafe.selectedSourceStrategy || (caloriesEstimated ? "estimated_from_activity" : "native_active_calories"),
      sourcePackage: caloriesTodaySafe.selectedSourcePackage || null,
      dashboardSourcePackage: caloriesTodaySafe.dashboardSourcePackage || caloriesTodaySafe.selectedSourcePackage || null,
      dashboardSourceName: caloriesTodaySafe.dashboardSourceName || caloriesTodaySafe.selectedSourceName || null,
      dashboardValidationStatus: caloriesTodaySafe.dashboardValidationStatus || null,
      aggregateRejectedReason: caloriesTodaySafe.aggregateRejectedReason || null,
      dashboardValueSource: caloriesTodaySafe.dashboardValueSource || null,
      dashboardValueReason: caloriesTodaySafe.dashboardValueReason || null,
      caloriesValidationStatus: caloriesTodaySafe.caloriesValidationStatus || (caloriesTodaySafe.aggregateRejectedReason ? "invalid" : "valid"),
      caloriesRejectedReason: caloriesTodaySafe.caloriesRejectedReason || caloriesTodaySafe.aggregateRejectedReason || null,
      rawSourceTotal: caloriesTodaySafe.rawSourceTotal ?? null,
      uniqueTotal: caloriesTodaySafe.uniqueTotal ?? null,
      recordsCountRaw: caloriesTodaySafe.recordsCountRaw ?? null,
      recordsCountUnique: caloriesTodaySafe.recordsCountUnique ?? null,
      duplicateRows: caloriesTodaySafe.duplicateRows ?? null,
      maxRepeat: caloriesTodaySafe.maxRepeat ?? null,
      dedupeApplied: Boolean(caloriesTodaySafe.dedupeApplied),
      isEstimated: caloriesEstimated,
      totalWasEstimated: calorieSplit.totalWasEstimated,
      dataSource: hasCalories ? "tracker" : null,
      status: hasCalories ? ((calorieSplit.suspicious || caloriesTodaySafe.suspiciousReason) ? "suspicious" : (caloriesEstimated ? "estimated" : "connected")) : caloriesToday.state === healthProviderStates.PERMISSIONS_REQUIRED ? "permission_required" : "no_data",
    },
    heart_rate: {
      ...previous.heart_rate,
      lastNativeReadAt: heart24h.skipped && heartWeek.skipped ? previous.heart_rate?.lastNativeReadAt || null : nowIso,
      lastHistoryReadAt: heartWeekWasRead ? nowIso : previous.heart_rate?.lastHistoryReadAt || null,
      current: heartFresh.status === "fresh" ? Number(heartLatestBpm || 0) : null,
      latestBpm: heartLatestBpm,
      resting: heart24hMin,
      baselineResting: previous.heart_rate.baselineResting || heartWeek.min || heart24hMin || previous.heart_rate.resting,
      avgWorkout: heart24hAvg,
      dayRange: hasHeart24h ? heart24hRange : [null, null],
      range24h: heart24hRange,
      avg24h: heart24hAvg,
      min24h: heart24hMin,
      max24h: heart24hMax,
      range7d: heartWeekRange,
      avg7d: heartWeekWasRead
        ? (heartWeek.avg || (heartWeekValues.length ? round(heartWeekValues.reduce((sum, value) => sum + value, 0) / heartWeekValues.length) : null))
        : (previous.heart_rate?.avg7d || null),
      hourly: heart24hValues.length ? heart24hValues : (heartValues.length ? heartValues : (hasCachedHeart ? previous.heart_rate?.hourly || [] : [])),
      weekRaw: heartRateWeekRaw,
      history7d: heartHistory7d,
      sourceName: heartLatestSourceName,
      sourcePackage: heartLatestSourcePackage,
      latestSourcePackage: heartLatestSourcePackage,
      latestSourceName: heartLatestSourceName,
      latestTimestamp: heartLatestTimestamp,
      freshness: heartFresh.status,
      ageMinutes: heartFresh.ageMinutes,
      updatedAgoText: agoText(heartFresh.ageMinutes),
      displayMode: hasHeart24h || heartWeekWasRead ? heartDisplay.displayMode : (hasCachedHeart ? previous.heart_rate?.displayMode || heartDisplay.displayMode : heartDisplay.displayMode),
      displayReason: hasHeart24h || heartWeekWasRead ? heartDisplay.displayReason : (hasCachedHeart ? "Refresh kept cached heart-rate snapshot because no new samples were requested or returned" : heartDisplay.displayReason),
      recordsToday: heartToday.skipped ? (previous.heart_rate?.recordsToday || 0) : (heartToday.recordsCount || 0),
      records24h: heart24h.recordsCount || 0,
      records7d: heartWeekWasRead ? (heartWeek.recordsCount || 0) : (previous.heart_rate?.records7d || 0),
      samplesToday: heartToday.skipped ? (previous.heart_rate?.samplesToday || 0) : (heartToday.samplesCount || heartValues.length),
      samples24h: heart24h.samplesCount || heart24hValues.length,
      samples7d: heartWeekWasRead ? (heartWeek.samplesCount || (heartWeek.samples || []).length) : (previous.heart_rate?.samples7d || 0),
      sources: mergeSourceLists(heart24h.sources || [], heartToday.sources || [], heartWeek.sources || [], previous.heart_rate?.sources || []),
      queryDiagnostics: {
        last15min: buildHeartQueryDiagnostic("last15min", heartRecent),
        today: buildHeartQueryDiagnostic("today", heartToday),
        last24h: buildHeartQueryDiagnostic("last24h", heart24h),
        week: buildHeartQueryDiagnostic("week", heartWeek),
      },
      dataSource: hasAnyHeart ? "tracker" : null,
      status: availability.permissionStatus?.heartRate === false
        ? "permission_required"
        : (hasAnyHeart ? heartWidgetStatus(heartFresh.status, hasAnyHeart) : heartStatusFor(heartRecent, heartToday)),
      message: hasAnyHeart
        ? (heartFresh.status === "fresh" ? "Данные пульса актуальны" : `Последний пульс обновлен ${agoText(heartFresh.ageMinutes)}`)
        : (heartWeek.message || heart24h.message || heartToday.message),
    },
    sleep: {
      ...previous.sleep,
      lastNativeReadAt: sleepWeek.skipped ? previous.sleep?.lastNativeReadAt || null : nowIso,
      lastHistoryReadAt: sleepWeek.skipped ? previous.sleep?.lastHistoryReadAt || null : nowIso,
      minutes: hasSleep ? round(todaySleepDay?.totalMinutes || sleepToday?.minutes || 0) : previous.sleep.minutes,
      aggregateMinutes: Number(sleepWeek.aggregateMinutes || 0) || previous.sleep.aggregateMinutes || 0,
      quality: hasSleep ? 4 : previous.sleep.quality,
      week: sleepEntries.length ? buildSleepWeekFromTimeline(sleepTimeline) : previous.sleep.week,
      weekRaw: sleepWeekRaw.length ? sleepWeekRaw : previous.sleep.weekRaw,
      samples: sleepAggregateSamples.length ? sleepAggregateSamples : (previous.sleep.samples || []),
      stages: sleepToday?.stages || previous.sleep.stages,
      fragments: sleepFragmentSessions,
      naps: sleepNapSessions,
      mainSleepSessions: sleepMainSessions,
      shortFragmentsUnder2h: sleepShortUnder2h,
      manualSleepEntries: previousManualSleepEntries,
      canonicalTimeline: sleepTimeline.days,
      nightMinutes: round(todaySleepDay?.nightMinutes || 0),
      napMinutes: round(todaySleepDay?.napMinutes || 0),
      fragmentMinutes: round(todaySleepDay?.fragmentMinutes || 0),
      latestNap: sleepTimeline.latestNap || null,
      latestSleep: sleepDisplaySession,
      sessions: sleepEntries,
      sourceName: dataSourceName(sleepWeek),
      dataSource: hasSleep ? "tracker" : previous.sleep.dataSource,
      status: hasSleep ? "connected" : sleepWeek.state === healthProviderStates.PERMISSIONS_REQUIRED ? "permission_required" : "no_data",
    },
    workouts: workoutsWeekWasRead ? {
      lastNativeReadAt: nowIso,
      recentWorkouts: (workoutsWeek.sessions || []).length,
      recentLoad: (workoutsWeek.sessions || []).length,
      dataSource: hasWorkouts ? "tracker" : null,
      status: hasWorkouts ? "connected" : "no_data",
    } : {
      ...(previous.workouts || {}),
    },
    healthRefresh: {
      ...defaultHealthRefresh,
      ...(previous.healthRefresh || {}),
      queryMode,
      queryCount: queryStats.queryCount,
      pagesRead: queryStats.pagesRead,
      maxPages: queryStats.maxPages,
      quotaExceeded: queryStats.quotaExceeded,
      truncatedQueries: queryStats.truncatedQueries,
    },
    localHistory: history,
    history7d: nextHistory7d,
    activity_history: buildActivityHistory(resolvedStepWeek, resolvedCaloriesWeek, resolvedTotalCaloriesWeek, heartRateWeekRaw, nextHistory7d.steps, nextHistory7d.calories),
  };
  return { ...next, readiness: calculateReadiness(next) };
}

export function HealthProvider({ children }) {
  const [health, setHealth] = useState(loadHealthData);
  const [availability, setAvailability] = useState({
    state: health.providerState || "not_supported",
    source: health.providerSource || "web",
    message: health.providerMessage || "Трекер не подключён",
  });
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const healthRef = useRef(health);
  const syncPromiseRef = useRef(null);
  const syncStartedAtRef = useRef(0);
  const lastSyncFinishedAtRef = useRef(0);
  const nativeCommitSeqRef = useRef(0);

  useEffect(() => {
    healthRef.current = health;
  }, [health]);

  useEffect(() => {
    function resetHealthForUser() {
      syncPromiseRef.current = null;
      syncStartedAtRef.current = 0;
      nativeCommitSeqRef.current += 1;
      const next = loadHealthData();
      healthRef.current = next;
      setHealth(next);
      setSyncError("");
      setAvailability({
        state: next.providerState || "not_supported",
        source: next.providerSource || "web",
        message: next.providerMessage || "Трекер не подключён",
      });
    }
    window.addEventListener("fruitfit:health-reset", resetHealthForUser);
    window.addEventListener("fruitfit:auth-updated", resetHealthForUser);
    return () => {
      window.removeEventListener("fruitfit:health-reset", resetHealthForUser);
      window.removeEventListener("fruitfit:auth-updated", resetHealthForUser);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    function syncServerCycleForCurrentUser() {
      if (!currentUserId()) return;
      fetchMenstrualCycle().then((cycle) => {
        if (cancelled || !cycle?.lastPeriodStartDate) return;
        const computed = calculateMenstrualCycle(cycle);
        setHealth((current) => {
          const localDate = current.cycle?.lastPeriodStartDate || "";
          if (localDate && localDate >= computed.lastPeriodStartDate) return current;
          return { ...current, cycle: computed };
        });
      }).catch(() => {});
    }
    syncServerCycleForCurrentUser();
    window.addEventListener("fruitfit:auth-updated", syncServerCycleForCurrentUser);
    return () => {
      cancelled = true;
      window.removeEventListener("fruitfit:auth-updated", syncServerCycleForCurrentUser);
    };
  }, []);

  const syncNativeHealth = useCallback(async ({ force = false, reason = "ui", queryMode = HEALTH_QUERY_MODES.DASHBOARD, bypassCooldown = false } = {}) => {
    const now = Date.now();
    const currentHealth = healthRef.current || loadHealthData();
    const inFlightAge = now - (syncStartedAtRef.current || 0);
    const cacheAgeMs = healthCacheAgeMs(currentHealth, now);

    if (syncPromiseRef.current && !force && inFlightAge < 45_000) return syncPromiseRef.current;
    if (syncPromiseRef.current && force && inFlightAge < 1_500) return syncPromiseRef.current;

    if (syncPromiseRef.current && (force || inFlightAge >= 45_000)) {
      syncPromiseRef.current = null;
      syncStartedAtRef.current = 0;
    }

    const cooldownMs = healthCooldownRemainingMs(currentHealth, now);
    if (cooldownMs > 0 && !bypassCooldown) {
      const refreshStartedAt = new Date(now).toISOString();
      const next = buildRateLimitHealthState(currentHealth, {
        now,
        queryMode,
        reason,
        skippedDueToCooldown: true,
        skippedQueryReason: "rate_limit_cooldown",
        lastRefreshStartedAt: refreshStartedAt,
        lastRefreshFinishedAt: refreshStartedAt,
        refreshDurationMs: 0,
      });
      healthRef.current = next;
      setSyncError("");
      setHealth(next);
      console.info("[FruitFit health refresh] skipped native read during rate-limit cooldown", { reason, queryMode, cooldownRemainingMs: cooldownMs });
      return {
        state: healthProviderStates.RATE_LIMITED,
        usedCache: true,
        cacheAgeMs: next.cacheAgeMs,
        rateLimitedUntil: next.rateLimitedUntil,
        cooldownRemainingMs: cooldownMs,
        message: "Health Connect cooldown is active.",
      };
    }

    const wantsHistorySnapshot = queryMode === HEALTH_QUERY_MODES.HISTORY_7D || queryMode === HEALTH_QUERY_MODES.HISTORY;
    const previousQueryMode = currentHealth.healthRefresh?.queryMode || null;
    const freshSnapshotMatchesQueryMode = !wantsHistorySnapshot || previousQueryMode === queryMode;
    if (!force && freshSnapshotMatchesQueryMode && cacheAgeMs != null && cacheAgeMs < HEALTH_REFRESH_CACHE_MS) {
      const refreshStartedAt = new Date(now).toISOString();
      const next = buildCacheHitHealthState(currentHealth, {
        now,
        queryMode,
        reason,
        cacheReason: "fresh_cache",
        skippedQueryReason: "fresh_cache_under_3m",
        lastRefreshStartedAt: refreshStartedAt,
        lastRefreshFinishedAt: refreshStartedAt,
        refreshDurationMs: 0,
      });
      healthRef.current = next;
      setSyncError("");
      setHealth(next);
      console.info("[FruitFit health refresh] throttled, using fresh cache", { reason, queryMode, cacheAgeMs });
      return {
        state: currentHealth.providerState || healthProviderStates.CONNECTED,
        usedCache: true,
        cacheAgeMs,
        message: "Fresh cached health snapshot reused.",
      };
    }

    const commitSeq = ++nativeCommitSeqRef.current;
    syncStartedAtRef.current = now;
    syncPromiseRef.current = (async () => {
      const refreshStartedAt = new Date(now).toISOString();
      console.info("[FruitFit health refresh] refresh started", { force, reason, queryMode });
      setSyncing(true);
      setSyncError("");
      const checkedAt = new Date().toISOString();
      const nextAvailability = await getHealthAvailability();
      setAvailability(nextAvailability);
      setHealth((current) => ({
        ...current,
        providerState: nextAvailability.state,
        providerSource: nextAvailability.source,
        providerMessage: nextAvailability.message,
        lastFruitFitRefreshAt: checkedAt,
        healthRefresh: {
          ...defaultHealthRefresh,
          ...(current.healthRefresh || {}),
          lastRefreshStartedAt: refreshStartedAt,
          lastRefreshFinishedAt: null,
          lastNativeReadStartedAt: null,
          lastNativeReadFinishedAt: null,
          refreshDurationMs: null,
          usedCache: true,
          cacheAgeMs: healthCacheAgeMs(current, now),
          cacheReason: "refreshing",
          queryMode,
          skippedQueryReason: null,
          skippedDueToCooldown: false,
          nativeReadReason: reason,
          rateLimitedUntil: current.rateLimitedUntil || null,
          cooldownRemainingMs: healthCooldownRemainingMs(current, now),
          dataFreshness: "refreshing",
          reason,
          errors: [],
        },
      }));
      if (!canAttemptNativeRead(nextAvailability.state)) {
        const refreshFinishedAt = new Date().toISOString();
        setHealth((current) => ({
          ...current,
          healthRefresh: {
            ...defaultHealthRefresh,
            ...(current.healthRefresh || {}),
            lastRefreshStartedAt: refreshStartedAt,
            lastRefreshFinishedAt: refreshFinishedAt,
            refreshDurationMs: Date.now() - now,
            usedCache: true,
            cacheAgeMs: healthCacheAgeMs(current, Date.now()),
            cacheReason: "native_unavailable",
            queryMode,
            skippedQueryReason: nextAvailability.state,
            skippedDueToCooldown: false,
            nativeReadReason: null,
            rateLimitedUntil: current.rateLimitedUntil || null,
            cooldownRemainingMs: healthCooldownRemainingMs(current, Date.now()),
            dataFreshness: nextAvailability.state,
            reason,
            errors: [],
          },
        }));
        console.info("[FruitFit health refresh] refresh finished", { state: nextAvailability.state, skippedNativeRead: true });
        return nextAvailability;
      }

      const nativeReadStartedAt = new Date().toISOString();
      console.info("[FruitFit health refresh] native health read started", { state: nextAvailability.state, reason, queryMode });
      const snapshot = await readNativeHealthSnapshot(healthRef.current || loadHealthData(), { queryMode, reason, force });
      const nativeReadFinishedAt = new Date().toISOString();
      if (commitSeq === nativeCommitSeqRef.current) {
        const refreshFinishedAt = new Date().toISOString();
        const wasRateLimited = snapshot.providerState === healthProviderStates.RATE_LIMITED;
        const wasCacheOnly = !wasRateLimited && Number(snapshot.healthRefresh?.queryCount || 0) === 0;
        const committedSnapshotRaw = {
          ...snapshot,
          lastFruitFitRefreshAt: checkedAt,
          lastSuccessfulNativeReadAt: wasRateLimited || wasCacheOnly ? snapshot.lastSuccessfulNativeReadAt : nativeReadFinishedAt,
          rateLimitedUntil: wasRateLimited ? snapshot.rateLimitedUntil : null,
          cacheAgeMs: wasRateLimited || wasCacheOnly ? healthCacheAgeMs(snapshot, Date.now()) : 0,
          cacheReason: wasRateLimited ? snapshot.cacheReason : (wasCacheOnly ? "metric_ttl_cache" : null),
          healthRefresh: {
            ...defaultHealthRefresh,
            ...(snapshot.healthRefresh || {}),
            lastRefreshStartedAt: refreshStartedAt,
            lastRefreshFinishedAt: refreshFinishedAt,
            lastNativeReadStartedAt: nativeReadStartedAt,
            lastNativeReadFinishedAt: nativeReadFinishedAt,
            refreshDurationMs: Date.now() - now,
            usedCache: wasRateLimited || wasCacheOnly,
            cacheAgeMs: wasRateLimited || wasCacheOnly ? healthCacheAgeMs(snapshot, Date.now()) : 0,
            cacheReason: wasRateLimited ? snapshot.cacheReason : (wasCacheOnly ? "metric_ttl_cache" : null),
            queryMode,
            skippedQueryReason: wasRateLimited ? (snapshot.healthRefresh?.skippedQueryReason || "rate_limit") : null,
            skippedDueToCooldown: false,
            nativeReadReason: reason,
            rateLimitedUntil: wasRateLimited ? snapshot.rateLimitedUntil : null,
            cooldownRemainingMs: wasRateLimited ? healthCooldownRemainingMs(snapshot, Date.now()) : 0,
            dataFreshness: wasRateLimited
              ? (snapshot.healthRefresh?.dataFreshness || "rate_limited_using_cache")
              : wasCacheOnly
                ? "metric_ttl_cache"
              : (snapshot.heart_rate?.displayMode === "no_data" ? "native_read_no_heart_records" : "native_read"),
            reason,
            errors: wasRateLimited ? (snapshot.healthRefresh?.errors || []) : [],
          },
        };
        const committedSnapshotSanitized = sanitizeCanonicalHealthState(committedSnapshotRaw);
        const committedSnapshot = { ...committedSnapshotSanitized, readiness: calculateReadiness(committedSnapshotSanitized) };
        healthRef.current = committedSnapshot;
        setHealth(committedSnapshot);
        console.info("[FruitFit health refresh] health store updated", {
          checkedAt,
          providerState: snapshot.providerState,
          heartSource: snapshot.heart_rate?.sourceName || null,
          stepsSource: snapshot.steps?.sourceName || null,
          caloriesSource: snapshot.calories?.sourceName || null,
          sleepSource: snapshot.sleep?.sourceName || null,
          usedCache: wasRateLimited,
          queryMode,
        });
        if (wasRateLimited) {
          return {
            state: healthProviderStates.RATE_LIMITED,
            usedCache: true,
            cacheAgeMs: committedSnapshot.cacheAgeMs,
            rateLimitedUntil: committedSnapshot.rateLimitedUntil,
            cooldownRemainingMs: committedSnapshot.healthRefresh?.cooldownRemainingMs || 0,
            message: "Health Connect rate limit reached; cached snapshot reused.",
          };
        }
      }
      return nextAvailability;
    })().catch((error) => {
      if (isHealthRateLimitError(error)) {
        const refreshFinishedAt = new Date().toISOString();
        const next = buildRateLimitHealthState(healthRef.current || loadHealthData(), {
          now: Date.now(),
          queryMode,
          reason,
          nativeReadReason: reason,
          lastRefreshFinishedAt: refreshFinishedAt,
          refreshDurationMs: Date.now() - now,
          errors: [{ message: error?.message || "Health Connect rate limit reached.", code: error?.code || error?.errorCode || null }],
        });
        healthRef.current = next;
        setSyncError("");
        setHealth(next);
        return {
          state: healthProviderStates.RATE_LIMITED,
          usedCache: true,
          cacheAgeMs: next.cacheAgeMs,
          rateLimitedUntil: next.rateLimitedUntil,
          cooldownRemainingMs: next.healthRefresh?.cooldownRemainingMs || 0,
          message: "Health Connect rate limit reached; cached snapshot reused.",
        };
      }
      const message = error?.message || "Не удалось обновить Health Connect.";
      const refreshFinishedAt = new Date().toISOString();
      setSyncError(message);
      setHealth((current) => ({
        ...current,
        lastFruitFitRefreshAt: new Date().toISOString(),
        lastHealthSyncError: message,
        healthRefresh: {
          ...defaultHealthRefresh,
          ...(current.healthRefresh || {}),
          lastRefreshFinishedAt: refreshFinishedAt,
          refreshDurationMs: Date.now() - now,
          usedCache: true,
          cacheAgeMs: healthCacheAgeMs(current, Date.now()),
          cacheReason: "error",
          queryMode,
          skippedQueryReason: "native_error",
          skippedDueToCooldown: false,
          nativeReadReason: reason,
          rateLimitedUntil: current.rateLimitedUntil || null,
          cooldownRemainingMs: healthCooldownRemainingMs(current, Date.now()),
          dataFreshness: "error",
          reason,
          errors: [message],
        },
      }));
      return { state: healthProviderStates.ERROR, source: "Health Connect", message };
    }).finally(() => {
      if (commitSeq === nativeCommitSeqRef.current) {
        setSyncing(false);
        syncPromiseRef.current = null;
        syncStartedAtRef.current = 0;
        lastSyncFinishedAtRef.current = Date.now();
      }
      console.info("[FruitFit health refresh] refresh finished", { reason, queryMode });
    });

    return syncPromiseRef.current;
  }, []);

  useEffect(() => {
    let alive = true;
    getHealthAvailability().then((next) => {
      if (!alive) return;
      setAvailability(next);
      setHealth((current) => {
        const updated = {
          ...current,
          providerState: next.state,
          providerSource: next.source,
          providerMessage: next.message,
        };
        const sanitized = sanitizeCanonicalHealthState(updated);
        return { ...sanitized, readiness: calculateReadiness(sanitized) };
      });
      if (canReadNativeData(next.state)) syncNativeHealth();
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!canReadNativeData(availability.state)) return undefined;

    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      syncNativeHealth();
    };
    const intervalId = window.setInterval(refresh, 4 * 60 * 1000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const onFocus = () => refresh();
    let appStateHandle = null;

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    window.Capacitor?.Plugins?.App?.addListener?.("appStateChange", ({ isActive }) => {
      if (isActive) refresh();
    }).then((handle) => {
      appStateHandle = handle;
    }).catch(() => {});

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      appStateHandle?.remove?.();
    };
  }, [availability.state, syncNativeHealth]);

  useEffect(() => {
    const sanitized = sanitizeCanonicalHealthState(health);
    if (currentUserId()) writeHealthContainer(sanitized);
    window.dispatchEvent(new CustomEvent("fruitfit:health-updated", { detail: sanitized }));
  }, [health]);

  const commit = useCallback((updater) => {
    setHealth((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      const sanitized = sanitizeCanonicalHealthState(next);
      return { ...sanitized, readiness: calculateReadiness(sanitized) };
    });
  }, []);

  const setHeartCondition = useCallback((condition) => {
    commit((current) => ({
      ...current,
      heart_rate: {
        ...current.heart_rate,
        condition,
        dataSource: current.heart_rate?.dataSource || null,
      },
    }));
  }, [commit]);

  const updateSleepManual = useCallback((patch) => {
    commit((current) => {
      const entry = manualSleepEntryFromPatch(patch);
      if (!entry) return current;
      const manualEntries = replaceManualSleepEntryForDate(current.sleep?.manualSleepEntries || [], entry);
      const previousEntries = normalizeSleepEntriesForDisplay(current.sleep?.sessions || []).filter((session) => !isManualSleepEntry(session));
      const entries = normalizeSleepEntriesForDisplay([...previousEntries, ...manualEntries]);
      const timeline = buildCanonicalSleepTimeline(entries);
      const week = buildSleepWeekFromTimeline(timeline);
      const todayDay = timeline.days.find((day) => day.date === localDateKey()) || null;
      const latest = timeline.latestSleep;
      const nextSleepManual = {
        ...current.sleep,
        ...patch,
        date: patch.date || current.sleep?.date || localDateKey(),
        bed: patch.bed || patch.startTime || current.sleep?.bed || "23:30",
        wake: patch.wake || patch.endTime || current.sleep?.wake || "07:00",
        quality: patch.quality ? clamp(Number(patch.quality), 1, 5) : (current.sleep?.quality || 4),
        notes: patch.notes || patch.comment || current.sleep?.notes || "",
        dataSource: "manual",
        sourceName: "Ручной ввод",
        status: "connected",
        sessions: entries,
        canonicalTimeline: timeline.days,
        mainSleepSessions: timeline.mainSleepSessions,
        naps: timeline.naps,
        fragments: timeline.fragments,
        shortFragmentsUnder2h: entries.filter((session) => Number(session.minutes || 0) < 120),
        manualSleepEntries: manualEntries,
        latestSleep: latest,
        latestNap: timeline.latestNap || current.sleep?.latestNap || null,
        minutes: round(todayDay?.totalMinutes || 0),
        nightMinutes: round(todayDay?.nightMinutes || 0),
        napMinutes: round(todayDay?.napMinutes || 0),
        fragmentMinutes: round(todayDay?.fragmentMinutes || 0),
        week,
        weekRaw: week.map((item) => round(item.minutes)),
      };
      return {
        ...current,
        sleep: nextSleepManual,
        history7d: {
          ...(current.history7d || {}),
          sleep: buildSleepHistory7dFromTimeline(timeline),
        },
        dataSource: "manual",
      };
      const nextSleep = { ...current.sleep, ...patch, dataSource: "manual", sourceName: "Ручной ввод", status: "connected" };
      if (patch.bed || patch.wake) nextSleep.minutes = sleepDurationFromTimes(nextSleep.bed, nextSleep.wake);
      if (patch.quality) nextSleep.quality = clamp(Number(patch.quality), 1, 5);
      const legacyWeek = nextSleep.week?.length ? nextSleep.week : weekLabels.map((day) => ({ day, minutes: 0, quality: 0 }));
      legacyWeek[legacyWeek.length - 1] = {
        ...legacyWeek[legacyWeek.length - 1],
        date: nextSleep.date || new Date().toISOString().slice(0, 10),
        minutes: nextSleep.minutes,
        quality: Number(nextSleep.quality) || 3,
      };
      return { ...current, sleep: { ...nextSleep, week: legacyWeek }, dataSource: "manual" };
    });
  }, [commit]);

  const updateCycle = useCallback((patch) => {
    const nextCycle = calculateMenstrualCycle({
      ...(healthRef.current?.cycle || {}),
      ...patch,
      dataSource: "manual",
    });
    commit((current) => ({
      ...current,
      cycle: nextCycle,
    }));
    saveMenstrualCycle(nextCycle).catch((error) => {
      console.info("[FruitFit health] menstrual cycle saved locally only", error?.message || error);
    });
  }, [commit]);

  const requestConnection = useCallback(async () => {
    const refreshStartedAt = new Date().toISOString();
    const refreshStartedMs = Date.now();
    setSyncing(true);
    try {
      const permissionResult = await requestHealthPermissions();
      setAvailability(permissionResult);
      setHealth((current) => ({
        ...current,
        providerState: permissionResult.state,
        providerSource: permissionResult.source,
        providerMessage: canReadNativeData(permissionResult.state)
          ? `${nativeHealthDisplayName(permissionResult.source)} подключён. Данные загружаются постепенно.`
          : permissionResult.message,
        healthRefresh: {
          ...defaultHealthRefresh,
          ...(current.healthRefresh || {}),
          lastRefreshStartedAt: refreshStartedAt,
          lastRefreshFinishedAt: null,
          usedCache: true,
          cacheAgeMs: healthCacheAgeMs(current, refreshStartedMs),
          cacheReason: "permission_request",
          queryMode: HEALTH_QUERY_MODES.DASHBOARD,
          skippedQueryReason: null,
          skippedDueToCooldown: false,
          nativeReadReason: "connect",
          rateLimitedUntil: current.rateLimitedUntil || null,
          cooldownRemainingMs: healthCooldownRemainingMs(current, refreshStartedMs),
          dataFreshness: "progressive_sync_pending",
          reason: "connect",
          errors: [],
        },
      }));
      if (canReadNativeData(permissionResult.state)) {
        const commitSeq = ++nativeCommitSeqRef.current;
        const nativeReadStartedAt = new Date().toISOString();
        const snapshot = await readNativeHealthSnapshot(healthRef.current || loadHealthData(), { queryMode: HEALTH_QUERY_MODES.DASHBOARD, reason: "connect_first_snapshot" });
        const nativeReadFinishedAt = new Date().toISOString();
        if (commitSeq === nativeCommitSeqRef.current) {
          const wasRateLimited = snapshot.providerState === healthProviderStates.RATE_LIMITED;
          const wasCacheOnly = !wasRateLimited && Number(snapshot.healthRefresh?.queryCount || 0) === 0;
          const committedSnapshot = {
            ...snapshot,
            lastSuccessfulNativeReadAt: wasRateLimited || wasCacheOnly ? snapshot.lastSuccessfulNativeReadAt : nativeReadFinishedAt,
            rateLimitedUntil: wasRateLimited ? snapshot.rateLimitedUntil : null,
            cacheAgeMs: wasRateLimited || wasCacheOnly ? healthCacheAgeMs(snapshot, Date.now()) : 0,
            cacheReason: wasRateLimited ? snapshot.cacheReason : (wasCacheOnly ? "metric_ttl_cache" : null),
            healthRefresh: {
              ...defaultHealthRefresh,
              ...(snapshot.healthRefresh || {}),
              lastRefreshStartedAt: refreshStartedAt,
              lastRefreshFinishedAt: new Date().toISOString(),
              lastNativeReadStartedAt: nativeReadStartedAt,
              lastNativeReadFinishedAt: nativeReadFinishedAt,
              refreshDurationMs: Date.now() - refreshStartedMs,
              usedCache: wasRateLimited || wasCacheOnly,
              cacheAgeMs: wasRateLimited || wasCacheOnly ? healthCacheAgeMs(snapshot, Date.now()) : 0,
              cacheReason: wasRateLimited ? snapshot.cacheReason : (wasCacheOnly ? "metric_ttl_cache" : null),
              queryMode: HEALTH_QUERY_MODES.DASHBOARD,
              skippedQueryReason: wasRateLimited ? (snapshot.healthRefresh?.skippedQueryReason || "rate_limit") : null,
              skippedDueToCooldown: false,
              nativeReadReason: "connect_first_snapshot",
              rateLimitedUntil: wasRateLimited ? snapshot.rateLimitedUntil : null,
              cooldownRemainingMs: wasRateLimited ? healthCooldownRemainingMs(snapshot, Date.now()) : 0,
              dataFreshness: wasRateLimited
                ? (snapshot.healthRefresh?.dataFreshness || "rate_limited_using_cache")
                : wasCacheOnly
                  ? "metric_ttl_cache"
                : (snapshot.heart_rate?.displayMode === "no_data" ? "progressive_sync_started_no_heart_records" : "progressive_sync_started"),
              reason: "connect",
              errors: wasRateLimited ? (snapshot.healthRefresh?.errors || []) : [],
            },
          };
          healthRef.current = committedSnapshot;
          setHealth(committedSnapshot);
          if (!wasRateLimited) {
            window.setTimeout(() => {
              syncNativeHealth({
                force: true,
                reason: "connect_deferred_history_7d",
                queryMode: HEALTH_QUERY_MODES.HISTORY_7D,
                bypassCooldown: true,
              }).catch((error) => {
                console.info("[FruitFit health refresh] deferred 7d sync failed", error?.message || error);
              });
            }, 2500);
          }
        }
      } else {
        setHealth((current) => ({
          ...current,
          healthRefresh: {
            ...defaultHealthRefresh,
            ...(current.healthRefresh || {}),
            lastRefreshStartedAt: refreshStartedAt,
            lastRefreshFinishedAt: new Date().toISOString(),
            refreshDurationMs: Date.now() - refreshStartedMs,
            usedCache: true,
            cacheAgeMs: healthCacheAgeMs(current, Date.now()),
            cacheReason: "native_unavailable",
            queryMode: HEALTH_QUERY_MODES.DASHBOARD,
            skippedQueryReason: permissionResult.state,
            skippedDueToCooldown: false,
            nativeReadReason: null,
            rateLimitedUntil: current.rateLimitedUntil || null,
            cooldownRemainingMs: healthCooldownRemainingMs(current, Date.now()),
            dataFreshness: permissionResult.state,
            reason: "connect",
            errors: [],
          },
        }));
      }
      if (permissionResult.state === healthProviderStates.PERMISSIONS_REQUIRED) {
        await openHealthSettings();
      }
      return permissionResult;
    } catch (error) {
      if (isHealthRateLimitError(error)) {
        const next = buildRateLimitHealthState(healthRef.current || loadHealthData(), {
          now: Date.now(),
          queryMode: HEALTH_QUERY_MODES.DASHBOARD,
          reason: "connect",
          nativeReadReason: "connect",
          refreshDurationMs: Date.now() - refreshStartedMs,
          errors: [{ message: error?.message || "Health Connect rate limit reached.", code: error?.code || error?.errorCode || null }],
        });
        healthRef.current = next;
        setSyncError("");
        setHealth(next);
        return {
          state: healthProviderStates.RATE_LIMITED,
          source: "Health Connect",
          message: "Health Connect rate limit reached; cached snapshot reused.",
        };
      }
      const message = error?.message || `Не удалось подключить ${nativeHealthFallbackName()}.`;
      setSyncError(message);
      setHealth((current) => ({
        ...current,
        healthRefresh: {
          ...defaultHealthRefresh,
          ...(current.healthRefresh || {}),
          lastRefreshStartedAt: refreshStartedAt,
          lastRefreshFinishedAt: new Date().toISOString(),
          refreshDurationMs: Date.now() - refreshStartedMs,
          usedCache: true,
          cacheAgeMs: healthCacheAgeMs(current, Date.now()),
          cacheReason: "error",
          queryMode: HEALTH_QUERY_MODES.DASHBOARD,
          skippedQueryReason: "connect_error",
          skippedDueToCooldown: false,
          nativeReadReason: "connect",
          rateLimitedUntil: current.rateLimitedUntil || null,
          cooldownRemainingMs: healthCooldownRemainingMs(current, Date.now()),
          dataFreshness: "progressive_sync_error",
          reason: "connect",
          errors: [message],
        },
      }));
      return { state: healthProviderStates.ERROR, source: "Health Connect", message };
    } finally {
      setSyncing(false);
    }
  }, [syncNativeHealth]);

  const buildHealthDebugReport = useCallback(async () => {
    const stepSourceOptions = preferredHealthSourceOptions();
    const now = new Date();
    const deviceDiagnostics = await getDeviceDiagnostics();
    const clientErrors = [
      ...loadClientErrorLog(),
      ...(typeof window !== "undefined" && Array.isArray(window[CLIENT_ERROR_BUFFER_KEY]) ? window[CLIENT_ERROR_BUFFER_KEY] : []),
    ].slice(-50);
    const snapshotHealth = sanitizeCanonicalHealthState(healthRef.current || health || loadHealthData());
    const snapshotHeart = snapshotHealth.heart_rate || {};
    const snapshotSteps = snapshotHealth.steps || {};
    const snapshotCalories = snapshotHealth.calories || {};
    const snapshotSleep = snapshotHealth.sleep || {};
    const snapshotWorkouts = snapshotHealth.workouts || {};
    const debugSkipped = {
      skipped: true,
      skippedReason: "debug_snapshot_no_native_read",
      message: "Debug export uses the last cached FruitFit health snapshot and does not start a Health Connect native read.",
    };
    const nextAvailability = {
      state: snapshotHealth.providerState || availability.state || healthProviderStates.NO_DATA,
      source: snapshotHealth.providerSource || availability.source || "Health Connect",
      message: snapshotHealth.providerMessage || availability.message || null,
      permissionStatus: availability.permissionStatus || {},
    };
    const heartState = snapshotHeart.status === "rate_limited" || snapshotHealth.providerState === healthProviderStates.RATE_LIMITED
      ? healthProviderStates.RATE_LIMITED
      : (snapshotHeart.dataSource ? healthProviderStates.CONNECTED : healthProviderStates.NO_DATA);
    const heart15 = { state: healthProviderStates.NO_DATA, range: "last15min", recordsCount: 0, samplesCount: 0, sources: [], samples: [], ...debugSkipped };
    const heartToday = {
      state: heartState,
      range: "today",
      recordsCount: snapshotHeart.recordsToday || 0,
      samplesCount: snapshotHeart.samplesToday || 0,
      sources: snapshotHeart.sources || [],
      samples: [],
      latestBpm: snapshotHeart.latestBpm || null,
      latestTimestamp: snapshotHeart.latestTimestamp || null,
      latestSourcePackage: snapshotHeart.latestSourcePackage || null,
      latestSourceName: snapshotHeart.latestSourceName || null,
      ...debugSkipped,
    };
    const heart24 = {
      state: heartState,
      range: "last24h",
      recordsCount: snapshotHeart.records24h || 0,
      samplesCount: snapshotHeart.samples24h || 0,
      sources: snapshotHeart.sources || [],
      samples: [],
      min: snapshotHeart.min24h || snapshotHeart.range24h?.[0] || null,
      avg: snapshotHeart.avg24h || null,
      max: snapshotHeart.max24h || snapshotHeart.range24h?.[1] || null,
      latestBpm: snapshotHeart.latestBpm || null,
      latestTimestamp: snapshotHeart.latestTimestamp || null,
      latestAgeMinutes: snapshotHeart.ageMinutes ?? null,
      latestSourcePackage: snapshotHeart.latestSourcePackage || null,
      latestSourceName: snapshotHeart.latestSourceName || null,
      ...debugSkipped,
    };
    const heart7 = {
      state: heartState,
      range: "week",
      recordsCount: snapshotHeart.records7d || 0,
      samplesCount: snapshotHeart.samples7d || 0,
      sources: snapshotHeart.sources || [],
      samples: [],
      min: snapshotHeart.range7d?.[0] || null,
      avg: snapshotHeart.avg7d || null,
      max: snapshotHeart.range7d?.[1] || null,
      latestBpm: snapshotHeart.latestBpm || null,
      latestTimestamp: snapshotHeart.latestTimestamp || null,
      latestSourcePackage: snapshotHeart.latestSourcePackage || null,
      latestSourceName: snapshotHeart.latestSourceName || null,
      ...debugSkipped,
    };
    const stepsToday = {
      state: snapshotSteps.status === "rate_limited" ? healthProviderStates.RATE_LIMITED : (snapshotSteps.dataSource ? healthProviderStates.CONNECTED : healthProviderStates.NO_DATA),
      range: "today",
      total: snapshotSteps.today || 0,
      rawTotal: snapshotSteps.rawTotal || snapshotSteps.today || 0,
      selectedSourcePackage: snapshotSteps.sourcePackage || null,
      selectedSourceName: snapshotSteps.sourceName || null,
      aggregateStrategy: String(snapshotSteps.aggregateStrategy || "").includes("health_connect") ? snapshotSteps.aggregateStrategy : "health_connect_aggregate",
      recordsCount: snapshotSteps.recordsToday || 0,
      sources: snapshotSteps.sources || [],
      samples: [],
      ...debugSkipped,
    };
    const stepsWeek = { state: stepsToday.state, range: "week", sources: snapshotSteps.sources || [], samples: [], ...debugSkipped };
    const caloriesToday = {
      state: snapshotCalories.status === "rate_limited" ? healthProviderStates.RATE_LIMITED : (snapshotCalories.dataSource ? healthProviderStates.CONNECTED : healthProviderStates.NO_DATA),
      range: "today",
      active: snapshotCalories.activeToday ?? snapshotCalories.today ?? null,
      total: snapshotCalories.totalToday ?? null,
      rawActive: snapshotCalories.rawActiveToday ?? null,
      rawUnit: snapshotCalories.rawUnit || null,
      convertedActive: snapshotCalories.convertedActiveToday ?? snapshotCalories.today ?? null,
      unit: snapshotCalories.unit || "kcal",
      aggregateStrategy: "health_connect_aggregate",
      recordsCount: snapshotCalories.recordsToday || 0,
      sources: snapshotCalories.sources || [],
      samples: [],
      ...debugSkipped,
    };
    const caloriesWeek = { state: caloriesToday.state, range: "week", sources: snapshotCalories.sources || [], samples: [], ...debugSkipped };
    const snapshotSleepSessions = (snapshotSleep.sessions || []).filter((session) => Number(session?.minutes || 0) > 0 && (session?.start || session?.end));
    const snapshotSleepFragments = (snapshotSleep.fragments || []).filter((session) => Number(session?.minutes || 0) > 0 && (session?.start || session?.end));
    const latestSleepHistory = (snapshotHealth.history7d?.sleep || []).filter((item) => Number(item?.value ?? item?.minutes ?? 0) > 0).slice(-1)[0] || null;
    const sleepSummaryMinutes = Number(snapshotSleep.minutes || latestSleepHistory?.value || latestSleepHistory?.minutes || 0) || 0;
    const sleepWeek = {
      state: snapshotSleep.status === "rate_limited" ? healthProviderStates.RATE_LIMITED : (snapshotSleep.dataSource ? healthProviderStates.CONNECTED : healthProviderStates.NO_DATA),
      range: "week",
      minutes: sleepSummaryMinutes,
      sessions: snapshotSleepSessions,
      fragments: snapshotSleepFragments,
      latestSleep: snapshotSleepSessions.slice(-1)[0] || null,
      ...debugSkipped,
    };
    const workoutsWeek = {
      state: snapshotWorkouts.status === "rate_limited" ? healthProviderStates.RATE_LIMITED : (snapshotWorkouts.dataSource ? healthProviderStates.CONNECTED : healthProviderStates.NO_DATA),
      range: "week",
      sessions: [],
      ...debugSkipped,
    };
    const weightLatest = { state: healthProviderStates.NO_DATA, range: "month", value: null, samples: [], ...debugSkipped };
    const latest = latestHeartSampleFromResults([heart15, heartToday, heart24, heart7], stepSourceOptions.preferredSourcePackage || "");
    const stepSelection = selectBestSource(stepsToday, stepSourceOptions.preferredSourcePackage || "", { metric: "steps", range: "today" });
    const heartFresh = heartFreshness(latest?.time || heart24.latestTimestamp || null);
    const heartPermissionGranted = nextAvailability.permissionStatus?.heartRate !== false;
    const heartDisplay = heartDisplayInfo({
      heart24h: heart24,
      heartWeek: heart7,
      freshness: heartFresh,
      permissionGranted: heartPermissionGranted,
    });
    const stepsDebugTotal = Number(stepSelection.selectedTotal || stepsToday.total || 0) || 0;
    const sleepDebugSessions = mainSleepSessions(sleepWeek);
    const calorieProfile = profileForCalories(snapshotHealth);
    const estimatedCaloriesDebug = estimateActiveCalories({
      steps: stepsDebugTotal,
      weightKg: calorieProfile.weight || snapshotHealth.profileWeightKg || snapshotHealth.weightKg || 75,
      workouts: workoutsWeek.sessions || [],
    });
    const caloriesTodaySafeDebug = sanitizedCalorieResult(caloriesToday, "today", stepSourceOptions.preferredSourcePackage || "");
    const calorieSplitDebug = splitCalorieValues({
      caloriesResult: caloriesTodaySafeDebug,
      estimatedActive: estimatedCaloriesDebug,
      profile: calorieProfile,
      stepsToday: stepsDebugTotal,
    });
    const activeCaloriesDebug = calorieSplitDebug.activeCalories;
    const caloriesEstimatedDebug = calorieSplitDebug.isEstimatedActive;
    const latestHeartBpmDebug = latest ? Number(latest.value) : heart24.latestBpm || heart7.latestBpm || null;
    const latestHeartTimestampDebug = latest?.time || heart24.latestTimestamp || heart7.latestTimestamp || null;
    const latestHeartSourcePackageDebug = latest?.sourcePackage || heart24.latestSourcePackage || heart7.latestSourcePackage || null;
    const latestHeartSourceNameDebug = sourceLabel({ sourcePackage: latestHeartSourcePackageDebug, sourceName: latest?.sourceName || heart24.latestSourceName || heart7.latestSourceName });
    const heartHistory7d = buildHeartHistory7d(heartSamples(heart7));
    const queryErrors = healthQueryErrors([
      { query: "heartRate.last15min", range: "last15min", result: heart15 },
      { query: "heartRate.today", range: "today", result: heartToday },
      { query: "heartRate.last24h", range: "last24h", result: heart24 },
      { query: "heartRate.week", range: "week", result: heart7 },
      { query: "steps.today", range: "today", result: stepsToday },
      { query: "steps.week", range: "week", result: stepsWeek },
      { query: "calories.today", range: "today", result: caloriesToday },
      { query: "calories.week", range: "week", result: caloriesWeek },
      { query: "sleep.week", range: "week", result: sleepWeek },
      { query: "workouts.week", range: "week", result: workoutsWeek },
      { query: "weight.month", range: "month", result: weightLatest },
    ]);
    const healthRefreshDebug = snapshotHealth.healthRefresh || defaultHealthRefresh;
    const manualSleep = snapshotHealth.sleep?.dataSource === "manual" ? snapshotHealth.sleep : null;
    const latestNativeSleep = (sleepWeek.sessions || []).slice(-1)[0] || null;
    const sleepMinutesDebug = sleepDebugSessions[sleepDebugSessions.length - 1]?.minutes
      || latestNativeSleep?.minutes
      || manualSleep?.minutes
      || sleepSummaryMinutes
      || 0;
    const debugCooldownRemainingMs = healthCooldownRemainingMs(snapshotHealth, now.getTime());
    const debugRateLimited = snapshotHealth.providerState === healthProviderStates.RATE_LIMITED
      || debugCooldownRemainingMs > 0
      || snapshotHeart.status === "rate_limited"
      || snapshotSteps.status === "rate_limited"
      || snapshotCalories.status === "rate_limited"
      || snapshotSleep.status === "rate_limited";
    const debugWidgetState = (metric, kind, fallback) => {
      const status = metric?.widgetState || metric?.status || fallback;
      if (RATE_LIMITED_WIDGET_STATUSES.has(status) || status === "rate_limited") {
        return metric?.widgetState || rateLimitedWidgetState(metric, kind);
      }
      return fallback;
    };
    const heartWidgetStateDebug = debugRateLimited
      ? debugWidgetState(snapshotHeart, "heart", "rate_limited")
      : (heartDisplay.displayMode === "no_data" ? "no_data" : heartWidgetStatus(heartFresh.status, true));
  const stepsDebugPermissionGranted = canReadNativeData(nextAvailability.state) && nextAvailability.permissionStatus?.steps !== false;
    const stepsDebugConnectedEmpty = stepsDebugTotal <= 0
      && stepsDebugPermissionGranted
      && canReadNativeData(nextAvailability.state)
      && stepsToday.state !== healthProviderStates.PERMISSIONS_REQUIRED
      && stepsToday.state !== healthProviderStates.ERROR
      && stepsToday.state !== healthProviderStates.RATE_LIMITED;
    const stepDetailValues = snapshotSteps.weekRaw?.length ? snapshotSteps.weekRaw : snapshotSteps.week || [];
    const calorieDetailValues = snapshotCalories.weekRaw?.length ? snapshotCalories.weekRaw : snapshotCalories.week || [];
    const heartDashboardRange = heart24.min && heart24.max ? "last24h" : (heart7.min && heart7.max ? "week_history" : "latest_only");
    const sleepDashboardRange = sleepWeek.sessions?.some((session) => sleepSessionDateKey(session) === localDateKey()) || latestSleepHistory?.date === localDateKey()
      ? "today"
      : "latest_history";
    return {
      fileName: `fruitfit_health_debug_${now.toISOString().slice(0, 16).replace("T", "_").replace(":", "-")}.json`,
      app: {
        appVersion: "FruitFit local",
        buildNumber: null,
        platform: window.Capacitor?.getPlatform?.() || "web",
        userAgent: navigator.userAgent,
        androidVersion: navigator.userAgent.match(/Android\s+([^;]+)/i)?.[1] || null,
        webViewVersion: navigator.userAgent.match(/(?:Chrome|CriOS)\/([0-9.]+)/i)?.[1] || null,
        lastScreen: window.location?.hash || window.location?.pathname || null,
        lastAction: healthRefreshDebug.reason || healthRefreshDebug.nativeReadReason || null,
        recentClientErrors: clientErrors.slice(-10),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timestampNow: now.toISOString(),
      },
      deviceDiagnostics,
      healthConnect: {
        isHealthConnectAvailable: nextAvailability.state !== healthProviderStates.NOT_SUPPORTED,
        isHealthConnectInstalled: nextAvailability.state !== healthProviderStates.NOT_INSTALLED,
        healthConnectSdkStatus: nextAvailability.state,
        permissionsGranted: Object.entries(nextAvailability.permissionStatus || {}).filter(([, value]) => value).map(([key]) => key),
        permissionsMissing: Object.entries(nextAvailability.permissionStatus || {}).filter(([, value]) => !value).map(([key]) => key),
        message: nextAvailability.message,
      },
      rateLimit: {
        rateLimitedUntil: snapshotHealth.rateLimitedUntil || healthRefreshDebug.rateLimitedUntil || null,
        cooldownRemainingMs: debugCooldownRemainingMs,
        usedCache: true,
        cacheAgeMs: healthCacheAgeMs(snapshotHealth, now.getTime()),
        queryMode: HEALTH_QUERY_MODES.DEBUG_SNAPSHOT,
        skippedDueToCooldown: debugCooldownRemainingMs > 0,
        nativeReadReason: "none_debug_snapshot_only",
        queryCount: healthRefreshDebug.queryCount || 0,
        pagesRead: healthRefreshDebug.pagesRead || 0,
        maxPages: healthRefreshDebug.maxPages ?? null,
        quotaExceeded: Boolean(healthRefreshDebug.quotaExceeded || debugRateLimited),
      },
      sources: {
        detectedSources: mergeSourceLists(stepsToday.sources || [], heart24.sources || [], heart7.sources || [], caloriesToday.sources || []),
        selectedPreferredSource: stepSourceOptions.preferredSourcePackage || null,
        selectedSource: stepSelection.selectedSourcePackage,
        selectedSourceReason: stepSelection.selectedSourceReason,
        selectedSourceStrategy: stepSelection.selectedSourceStrategy,
        dashboardSourcePackage: stepSelection.dashboardSourcePackage || snapshotSteps.dashboardSourcePackage || null,
        dashboardSourceName: stepSelection.dashboardSourceName || snapshotSteps.dashboardSourceName || null,
        dashboardValidationStatus: stepSelection.dashboardValidationStatus || snapshotSteps.dashboardValidationStatus || null,
        aggregateRejectedReason: stepSelection.aggregateRejectedReason || snapshotSteps.aggregateRejectedReason || null,
        autoStrategy: stepSelection.autoStrategy || null,
        rejectedSources: stepSelection.rejectedSources || [],
        suspiciousHighSources: stepSelection.suspiciousHighSources || [],
        suspiciousSources: stepSelection.suspiciousSources || [],
        allSources: stepSelection.allSources || stepsToday.sources || [],
        sourcePriority: ["Mi Fitness", "Zepp / Amazfit", "Google Fit", "Health Connect aggregate if validation passes"],
      },
      heartRate: {
        permissionGranted: heartPermissionGranted,
        permissionMissing: !heartPermissionGranted,
        displayMode: heartDisplay.displayMode,
        displayReason: heartDisplay.displayReason,
        dashboardValue: latestHeartBpmDebug,
        dashboardRange: heartDashboardRange,
        detailValue: latestHeartBpmDebug,
        detailRange: heartDashboardRange,
        selectedSourceStrategy: "latest_sample_from_last24h_then_week_snapshot",
        rejectedSources: [],
        suspiciousSources: [],
        recordsLast15Min: heart15.recordsCount || 0,
        recordsToday: heartToday.recordsCount || 0,
        recordsLast24h: heart24.recordsCount || 0,
        recordsLast7d: heart7.recordsCount || 0,
        recordsRawLast24h: heart24.recordsRawCount ?? heart24.recordsCount ?? 0,
        recordsRawLast7d: heart7.recordsRawCount ?? heart7.recordsCount ?? 0,
        samplesToday: heartToday.samplesCount || (heartToday.samples || []).length || 0,
        samplesLast24h: heart24.samplesCount || (heart24.samples || []).length || 0,
        samplesLast7d: heart7.samplesCount || (heart7.samples || []).length || 0,
        latestBpm: latestHeartBpmDebug,
        latestTimestamp: latestHeartTimestampDebug,
        latestAgeMinutes: heartFresh.ageMinutes ?? heart24.latestAgeMinutes ?? null,
        freshness: heartFresh,
        latestSourcePackage: latestHeartSourcePackageDebug,
        sourcePackage: latestHeartSourcePackageDebug,
        latestSourceName: latestHeartSourceNameDebug,
        min24h: heart24.min || null,
        avg24h: heart24.avg || null,
        max24h: heart24.max || null,
        countBySourcePackage24h: heart24.sources || buildHeartSourceCounts(heartSamples(heart24)),
        countBySourcePackage7d: heart7.sources || buildHeartSourceCounts(heartSamples(heart7)),
        queries: {
          last15min: buildHeartQueryDiagnostic("last15min", heart15),
          today: buildHeartQueryDiagnostic("today", heartToday),
          last24h: buildHeartQueryDiagnostic("last24h", heart24),
          week: buildHeartQueryDiagnostic("week", heart7),
        },
        queryErrors: queryErrors.filter((item) => item.query?.startsWith("heartRate.")),
        sampleRecordsLast10: ((heart24.samples || []).length ? heart24.samples : heart7.samples || []).slice(-10),
        history7d: snapshotHealth.history7d?.heartRate || snapshotHeart.history7d || heartHistory7d,
        reasonIfEmpty: ((heart24.samples || []).length || (heart7.samples || []).length) ? null : heart7.message || heart24.message || "Источник не передал данные пульса",
      },
      steps: {
        permissionGranted: Boolean(nextAvailability.permissionStatus?.steps),
        preferredSource: stepSourceOptions.preferredSourcePackage || "auto",
        aggregateToday: stepsDebugTotal,
        dashboardValue: stepsDebugTotal,
        dashboardRange: "today",
        detailValue: sumPositive(stepDetailValues),
        detailRange: stepDetailValues.length ? "week" : "today",
        finalDashboardValue: stepsDebugTotal,
        rawAggregateToday: stepsToday.rawTotal || 0,
        unit: "count",
        recordsToday: stepsToday.recordsCount || stepsToday.samples?.length || 0,
        sampleRecordsToday: stepsToday.samples?.length || 0,
        sourcesToday: stepsToday.sources || [],
        valuesBySource: stepsToday.sources || [],
        allSources: stepSelection.allSources || stepsToday.sources || [],
        selectedSource: stepSelection.selectedSourcePackage || stepsToday.selectedSourcePackage || null,
        dashboardSourcePackage: stepSelection.dashboardSourcePackage || snapshotSteps.dashboardSourcePackage || null,
        dashboardSourceName: stepSelection.dashboardSourceName || snapshotSteps.dashboardSourceName || null,
        dashboardValidationStatus: stepSelection.dashboardValidationStatus || snapshotSteps.dashboardValidationStatus || null,
        aggregateRejectedReason: stepSelection.aggregateRejectedReason || snapshotSteps.aggregateRejectedReason || null,
        dashboardValueSource: stepSelection.dashboardValueSource || snapshotSteps.dashboardValueSource || null,
        dashboardValueReason: stepSelection.dashboardValueReason || snapshotSteps.dashboardValueReason || null,
        rawSourceTotal: snapshotSteps.rawSourceTotal ?? stepsToday.rawSourceTotal ?? null,
        uniqueTotal: snapshotSteps.uniqueTotal ?? stepsToday.uniqueTotal ?? null,
        recordsCountRaw: snapshotSteps.recordsCountRaw ?? stepsToday.recordsCountRaw ?? null,
        recordsCountUnique: snapshotSteps.recordsCountUnique ?? stepsToday.recordsCountUnique ?? null,
        duplicateRows: snapshotSteps.duplicateRows ?? stepsToday.duplicateRows ?? null,
        maxRepeat: snapshotSteps.maxRepeat ?? stepsToday.maxRepeat ?? null,
        dedupeApplied: Boolean(snapshotSteps.dedupeApplied || stepsToday.dedupeApplied),
        selectedSourceReason: stepSelection.selectedSourceReason,
        selectedSourceStrategy: stepSelection.selectedSourceStrategy || snapshotSteps.selectedSourceStrategy || null,
        autoStrategy: stepSelection.autoStrategy || snapshotSteps.autoStrategy || null,
        suspiciousSources: stepSelection.suspiciousSources || snapshotSteps.suspiciousSources || [],
        suspiciousHighSources: stepSelection.suspiciousHighSources || snapshotSteps.suspiciousHighSources || [],
        rejectedSources: stepSelection.rejectedSources || snapshotSteps.rejectedSources || [],
        suspiciousReason: stepSelection.suspiciousReason || snapshotSteps.suspiciousReason || null,
        dedupeResult: stepsToday.aggregateStrategy || null,
      },
      sleep: {
        permissionGranted: Boolean(nextAvailability.permissionStatus?.sleep),
        dashboardValue: sleepMinutesDebug,
        dashboardRange: sleepDashboardRange,
        detailValue: sleepMinutesDebug,
        detailRange: sleepDashboardRange,
        selectedSourceStrategy: "today_or_latest_sleep_session_then_history_today",
        rejectedSources: [],
        suspiciousSources: [],
        sessionsLast7d: (snapshotHealth.sleep?.sessions || sleepWeek.sessions || []).slice(-20),
        sessions: (snapshotHealth.sleep?.sessions || sleepWeek.sessions || []).slice(-20),
        mainSleepSessions: (snapshotHealth.sleep?.mainSleepSessions || sleepDebugSessions).slice(-10),
        naps: (snapshotHealth.sleep?.naps || []).slice(-10),
        fragments: (snapshotHealth.sleep?.fragments || []).slice(-10),
        shortFragmentsUnder2h: (snapshotHealth.sleep?.shortFragmentsUnder2h || sleepWeek.fragments || []).slice(-10),
        latestSleep: snapshotHealth.sleep?.latestSleep || (sleepWeek.sessions || []).slice(-1)[0] || null,
        latestNap: snapshotHealth.sleep?.latestNap || null,
        sourcePackage: snapshotHealth.sleep?.latestSleep?.sourcePackage || (sleepWeek.sessions || []).slice(-1)[0]?.sourcePackage || null,
        manualSleepEntries: (snapshotHealth.sleep?.manualSleepEntries || (snapshotHealth.sleep?.dataSource === "manual" ? [snapshotHealth.sleep] : [])).slice(-14),
        reasonIfEmpty: (sleepWeek.sessions || []).length ? null : (sleepSummaryMinutes > 0 ? "Using cached sleep summary; no raw sleep sessions in snapshot." : sleepWeek.message || "Нет данных сна"),
      },
      recovery: {
        score: snapshotHealth.readiness?.score ?? null,
        status: snapshotHealth.readiness?.status || null,
        recommendation: snapshotHealth.readiness?.recommendation || null,
        factors: snapshotHealth.readiness?.factors || [],
        sleepLastNightMinutes: snapshotHealth.readiness?.sleepLastNightMinutes || 0,
        sleep7dAverageMinutes: snapshotHealth.readiness?.sleep7dAverageMinutes || 0,
        napsTodayMinutes: snapshotHealth.readiness?.napsTodayMinutes || 0,
        heartAvg24h: snapshotHealth.readiness?.heartAvg24h || null,
        heartAvg7d: snapshotHealth.readiness?.heartAvg7d || null,
        heartRange24h: snapshotHealth.readiness?.heartRange24h || [],
        heartRange7d: snapshotHealth.readiness?.heartRange7d || [],
        stepsToday: snapshotHealth.readiness?.stepsToday || 0,
        activityStatus: snapshotHealth.readiness?.activityStatus || null,
        dataCompleteness: snapshotHealth.readiness?.dataCompleteness || 0,
      },
      calories: {
        permissionGranted: Boolean(nextAvailability.permissionStatus?.calories),
        activeCaloriesToday: activeCaloriesDebug,
        dashboardValue: activeCaloriesDebug,
        dashboardRange: "today_active",
        detailValue: sumPositive(calorieDetailValues) || activeCaloriesDebug,
        detailRange: calorieDetailValues.length ? "week_active" : "today_active",
        rawActiveCaloriesToday: caloriesTodaySafeDebug.rawActive || null,
        rawUnit: caloriesTodaySafeDebug.rawUnit || null,
        convertedActiveCaloriesToday: caloriesTodaySafeDebug.convertedActive ?? caloriesTodaySafeDebug.active ?? null,
        convertedUnit: caloriesTodaySafeDebug.unit || "kcal",
        restingCaloriesToday: calorieSplitDebug.restingCalories,
        totalCaloriesToday: calorieSplitDebug.totalCalories || null,
        suspicious: Boolean(calorieSplitDebug.suspicious || caloriesTodaySafeDebug.suspiciousReason),
        suspiciousReason: [calorieSplitDebug.suspiciousReason, caloriesTodaySafeDebug.suspiciousReason, snapshotCalories.suspiciousReason].filter(Boolean).join("; ") || null,
        suspiciousSources: caloriesTodaySafeDebug.suspiciousSources || snapshotCalories.suspiciousSources || [],
        rejectedSources: caloriesTodaySafeDebug.rejectedSources || snapshotCalories.rejectedSources || [],
        discardedSuspiciousSources: caloriesTodaySafeDebug.discardedSuspiciousSources || [],
        selectedSource: caloriesTodaySafeDebug.selectedSourcePackage || snapshotCalories.sourcePackage || null,
        dashboardSourcePackage: caloriesTodaySafeDebug.dashboardSourcePackage || snapshotCalories.dashboardSourcePackage || null,
        dashboardSourceName: caloriesTodaySafeDebug.dashboardSourceName || snapshotCalories.dashboardSourceName || null,
        dashboardValidationStatus: caloriesTodaySafeDebug.dashboardValidationStatus || snapshotCalories.dashboardValidationStatus || null,
        aggregateRejectedReason: caloriesTodaySafeDebug.aggregateRejectedReason || snapshotCalories.aggregateRejectedReason || null,
        dashboardValueSource: caloriesTodaySafeDebug.dashboardValueSource || snapshotCalories.dashboardValueSource || null,
        dashboardValueReason: caloriesTodaySafeDebug.dashboardValueReason || snapshotCalories.dashboardValueReason || null,
        caloriesValidationStatus: caloriesTodaySafeDebug.caloriesValidationStatus || snapshotCalories.caloriesValidationStatus || null,
        caloriesRejectedReason: caloriesTodaySafeDebug.caloriesRejectedReason || snapshotCalories.caloriesRejectedReason || null,
        rawSourceTotal: caloriesTodaySafeDebug.rawSourceTotal ?? snapshotCalories.rawSourceTotal ?? null,
        uniqueTotal: caloriesTodaySafeDebug.uniqueTotal ?? snapshotCalories.uniqueTotal ?? null,
        recordsCountRaw: caloriesTodaySafeDebug.recordsCountRaw ?? snapshotCalories.recordsCountRaw ?? null,
        recordsCountUnique: caloriesTodaySafeDebug.recordsCountUnique ?? snapshotCalories.recordsCountUnique ?? null,
        duplicateRows: caloriesTodaySafeDebug.duplicateRows ?? snapshotCalories.duplicateRows ?? null,
        maxRepeat: caloriesTodaySafeDebug.maxRepeat ?? snapshotCalories.maxRepeat ?? null,
        dedupeApplied: Boolean(caloriesTodaySafeDebug.dedupeApplied || snapshotCalories.dedupeApplied),
        selectedSourceReason: caloriesTodaySafeDebug.selectedSourceReason || snapshotCalories.selectedSourceReason || null,
        selectedSourceStrategy: caloriesTodaySafeDebug.selectedSourceStrategy || snapshotCalories.selectedSourceStrategy || null,
        isEstimatedFromSteps: caloriesEstimatedDebug,
        totalWasEstimatedFromBmr: calorieSplitDebug.totalWasEstimated,
        estimateReason: caloriesEstimatedDebug ? "active calories missing, estimated from steps" : null,
        recordsToday: caloriesTodaySafeDebug.recordsCount || caloriesTodaySafeDebug.samples?.length || 0,
        sampleRecordsToday: caloriesTodaySafeDebug.samples?.length || 0,
        sourcesToday: caloriesTodaySafeDebug.sources || [],
        valuesBySource: caloriesTodaySafeDebug.sources || [],
        samplesToday: (caloriesTodaySafeDebug.samples || []).map((sample) => ({
          start: sample.start,
          end: sample.end,
          rawValue: sample.rawValue ?? sample.value ?? null,
          rawUnit: sample.rawUnit || caloriesTodaySafeDebug.rawUnit || null,
          convertedValue: sample.convertedValue ?? sample.value ?? null,
          convertedUnit: sample.convertedUnit || caloriesTodaySafeDebug.unit || "kcal",
          sourcePackage: sample.sourcePackage || null,
        })),
        reasonIfEmpty: (caloriesTodaySafeDebug.samples || []).length ? null : caloriesTodaySafeDebug.message || "Нет данных калорий",
      },
      workouts: {
        permissionGranted: Boolean(nextAvailability.permissionStatus?.workouts),
        workoutsLast7d: (workoutsWeek.sessions || []).slice(-20),
        latestWorkout: (workoutsWeek.sessions || []).slice(-1)[0] || null,
        sourcePackage: (workoutsWeek.sessions || []).slice(-1)[0]?.sourcePackage || null,
      },
      weight: {
        permissionGranted: Boolean(nextAvailability.permissionStatus?.weight),
        latestWeight: weightLatest.value || null,
        latestTimestamp: (weightLatest.samples || []).slice(-1)[0]?.time || null,
        sourcePackage: (weightLatest.samples || []).slice(-1)[0]?.sourcePackage || null,
      },
      history7d: {
        heartRate: snapshotHealth.history7d?.heartRate || heartHistory7d,
      steps: snapshotHealth.history7d?.steps || buildMetricHistory7d(metricRowsForSelectedSource(stepsWeek, selectBestSource(stepsWeek, stepSourceOptions.preferredSourcePackage || "", { metric: "steps", range: "week" }))),
        calories: snapshotHealth.history7d?.calories || buildMetricHistory7d(metricRowsForSelectedSource(caloriesWeek, selectBestSource(caloriesWeek, stepSourceOptions.preferredSourcePackage || "", { metric: "calories", range: "week" }))),
        sleep: snapshotHealth.history7d?.sleep || buildMetricHistory7d((sleepWeek.sessions || []).map((session) => ({
          start: session.start,
          value: session.minutes,
        }))),
        workouts: buildMetricHistory7d((workoutsWeek.sessions || []).map((session) => ({
          start: session.start,
          value: 1,
        }))),
      },
      healthRefresh: {
        ...defaultHealthRefresh,
        ...healthRefreshDebug,
        usedCache: true,
        cacheAgeMs: healthCacheAgeMs(snapshotHealth, now.getTime()),
        cacheReason: "debug_snapshot_no_native_read",
        queryMode: HEALTH_QUERY_MODES.DEBUG_SNAPSHOT,
        skippedQueryReason: "debug_snapshot_no_native_read",
        skippedDueToCooldown: debugCooldownRemainingMs > 0,
        nativeReadReason: "none_debug_snapshot_only",
        rateLimitedUntil: snapshotHealth.rateLimitedUntil || healthRefreshDebug.rateLimitedUntil || null,
        cooldownRemainingMs: debugCooldownRemainingMs,
        currentDebugBuiltAt: now.toISOString(),
      },
      widgetStates: {
        heartRateWidgetState: heartWidgetStateDebug,
        stepsWidgetState: debugRateLimited ? debugWidgetState(snapshotSteps, "steps", "rate_limited") : (stepsDebugTotal > 0 ? "connected" : (stepsDebugConnectedEmpty ? "connected_empty" : snapshotHealth.steps?.status || "no_data")),
        sleepWidgetState: debugRateLimited ? debugWidgetState(snapshotSleep, "sleep", "rate_limited") : (sleepDebugSessions.length > 0 || (sleepWeek.sessions || []).length > 0 || manualSleep?.minutes || sleepSummaryMinutes > 0 ? "connected" : snapshotHealth.sleep?.status || "no_data"),
        caloriesWidgetState: debugRateLimited ? debugWidgetState(snapshotCalories, "calories", "rate_limited") : (activeCaloriesDebug > 0 ? ((calorieSplitDebug.suspicious || caloriesTodaySafeDebug.suspiciousReason) ? "suspicious" : (caloriesEstimatedDebug ? "estimated" : "connected")) : snapshotHealth.calories?.status || "no_data"),
        recoveryWidgetState: debugRateLimited ? "using_cache" : (latestHeartBpmDebug || sleepMinutesDebug || stepsDebugTotal ? "partial_data" : "no_data"),
      },
      errors: {
        lastHealthConnectError: [nextAvailability, heart15, heartToday, heart24, heart7, stepsToday, stepsWeek, caloriesToday, caloriesWeek, sleepWeek, workoutsWeek, weightLatest]
          .filter((item) => item?.state === healthProviderStates.ERROR || item?.state === healthProviderStates.RATE_LIMITED)
          .map((item) => ({ source: item.source, message: item.message, code: item.errorCode || null })),
        exceptions: clientErrors,
        lastNativeCrash: deviceDiagnostics?.lastNativeCrash || null,
        failedQueries: queryErrors,
        permissionRequestErrors: [],
      },
    };
  }, [availability, health]);

  const value = useMemo(() => ({
    health,
    availability,
    syncing,
    syncError,
    requestConnection,
    syncNativeHealth,
    buildHealthDebugReport,
    setHeartCondition,
    updateSleepManual,
    updateCycle,
  }), [availability, buildHealthDebugReport, health, requestConnection, setHeartCondition, syncError, syncNativeHealth, syncing, updateCycle, updateSleepManual]);

  return <HealthContext.Provider value={value}>{children}</HealthContext.Provider>;
}

export function useHealth() {
  const context = useContext(HealthContext);
  if (!context) throw new Error("useHealth must be used inside HealthProvider");
  return context;
}
