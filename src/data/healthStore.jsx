import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  getCalories,
  getDistance,
  getExerciseSessions,
  getHealthAvailability,
  getHeartRate,
  getSleep,
  getSteps,
  getWeight,
  healthProviderStates,
  openHealthSettings,
  requestHealthPermissions,
} from "../services/health/healthProvider";
import { loadProfile } from "./profileStore";

export const HEALTH_STORAGE_KEY = "fruitfit.health";
const HEALTH_HISTORY_KEY = "fruitfit.health.history";

const weekLabels = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const defaultCycle = {
  phase: "Фолликулярная",
  day: 5,
  length: 28,
  ovulationInDays: 9,
  dataSource: "manual",
};

const defaultHeart = {
  current: null,
  resting: null,
  baselineResting: null,
  avgWorkout: null,
  dayRange: [null, null],
  hourly: [],
  condition: "нет",
  dataSource: null,
  status: "no_data",
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

export function formatSleepDuration(minutes) {
  const hours = Math.floor((Number(minutes) || 0) / 60);
  const mins = round(minutes) % 60;
  return `${hours}ч ${String(mins).padStart(2, "0")}м`;
}

function emptyHistory() {
  return {
    week: weekLabels.map((label) => ({ label, steps: 0, calories: 0 })),
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

function readHealthHistory() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(HEALTH_HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function writeHealthHistory(entry) {
  if (typeof window === "undefined") return [entry];
  const date = entry.date || localDateKey();
  const current = readHealthHistory().filter((item) => item?.date && item.date !== date);
  const next = [...current, { ...entry, date }]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(-45);
  localStorage.setItem(HEALTH_HISTORY_KEY, JSON.stringify(next));
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

function hasPositiveSeries(values = []) {
  return values.some((value) => Number(value || 0) > 0);
}

function makeEmptyHealth(saved = {}) {
  const sleep = { ...defaultSleep, ...(saved.sleep || {}) };
  const heart = { ...defaultHeart, ...(saved.heart_rate || {}) };
  const cycle = { ...defaultCycle, ...(saved.cycle || {}) };
  const data = {
    generatedAt: saved.generatedAt || new Date().toISOString(),
    dataSource: saved.dataSource || null,
    providerState: saved.providerState || "not_supported",
    providerSource: saved.providerSource || "web",
    providerMessage: saved.providerMessage || "Трекер не подключён",
    steps: saved.steps?.dataSource ? { ...emptyMetric(10000), ...saved.steps } : emptyMetric(saved.steps?.goal || 10000),
    calories: saved.calories?.dataSource ? { ...emptyMetric(650), ...saved.calories } : emptyMetric(saved.calories?.goal || 650),
    sleep,
    heart_rate: heart,
    workouts: saved.workouts?.dataSource ? { recentWorkouts: 0, recentLoad: 0, status: "no_data", ...saved.workouts } : {
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
    cycle,
    activity_history: saved.activity_history?.week?.length ? saved.activity_history : emptyHistory(),
  };
  return { ...data, readiness: calculateReadiness(data) };
}

export function calculateReadiness(data) {
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

  const sleepScore = sleep.dataSource
    ? clamp((sleep.minutes / 480) * 70 + (sleep.quality || 1) * 6, 0, 100)
    : 45;
  const resting = heart.resting || heart.baselineResting || 60;
  const baseline = heart.baselineResting || resting;
  const pulseScore = heart.dataSource ? clamp(100 - Math.max(0, resting - baseline) * 5, 20, 100) : 55;
  const steps = data.steps?.today || 0;
  const calories = data.calories?.today || 0;
  const activityScore = data.steps?.dataSource ? clamp(100 - Math.abs(steps - 8500) / 95, 25, 100) : 55;
  const caloriesScore = data.calories?.dataSource ? clamp(100 - Math.abs(calories - 430) / 6, 20, 100) : 55;
  const score = clamp(round(sleepScore * 0.38 + pulseScore * 0.24 + activityScore * 0.22 + caloriesScore * 0.16), 0, 100);

  return {
    score,
    recommendation: getRecommendation(score),
    dataSource: "tracker_or_manual",
    factors: [
      { id: "sleep", label: "Сон", value: sleep.dataSource ? formatSleepDuration(sleep.minutes) : "нет данных", score: round(sleepScore) },
      { id: "pulse", label: "Пульс покоя", value: heart.dataSource ? `${resting} уд/мин` : "нет данных", score: round(pulseScore) },
      { id: "activity", label: "Активность", value: data.steps?.dataSource ? `${steps.toLocaleString("ru-RU")} шагов` : "нет данных", score: round(activityScore) },
      { id: "calories", label: "Активные калории", value: data.calories?.dataSource ? `${calories} ккал` : "нет данных", score: round(caloriesScore) },
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
    const saved = JSON.parse(localStorage.getItem(HEALTH_STORAGE_KEY) || "null");
    if (saved && typeof saved === "object") return makeEmptyHealth(saved);
  } catch (_) {
    // Ignore corrupt local data.
  }
  return makeEmptyHealth();
}

function dayIndexFromDate(value) {
  const date = value ? new Date(value) : new Date();
  const day = date.getDay();
  return day === 0 ? 6 : day - 1;
}

function buildSeriesFromSamples(samples = [], range = "week", valueKey = "value") {
  if (range === "today") {
    const hourly = Array.from({ length: 24 }, () => 0);
    samples.forEach((sample) => {
      const date = new Date(sample.start || sample.time || Date.now());
      hourly[date.getHours()] += Number(sample[valueKey] || 0);
    });
    return hourly;
  }
  const length = range === "month" ? 30 : 7;
  const series = Array.from({ length }, () => 0);
  const today = new Date();
  samples.forEach((sample) => {
    const date = new Date(sample.start || sample.time || Date.now());
    const diffDays = Math.floor((new Date(today.toDateString()) - new Date(date.toDateString())) / 86400000);
    const index = length - 1 - diffDays;
    if (index >= 0 && index < length) series[index] += Number(sample[valueKey] || 0);
  });
  return series;
}

function canReadNativeData(state) {
  return state === healthProviderStates.CONNECTED || state === healthProviderStates.PARTIALLY_GRANTED;
}

function selectedSourceSamples(result) {
  const samples = result?.samples || [];
  const selected = result?.selectedSourcePackage;
  if (!selected) return samples;
  return samples.filter((sample) => sample.sourcePackage === selected);
}

function mainSleepSessions(result) {
  return (result?.sessions || []).filter((session) => Number(session.minutes || 0) >= 120);
}

function sourceLabel(source) {
  const raw = String(source?.selectedSourceName || source?.sourceName || source?.selectedSourcePackage || source?.sourcePackage || source?.source || source || "").toLowerCase();
  if (raw.includes("com.xiaomi.wearable") || raw.includes("mi fitness")) return "Mi Fitness";
  if (raw.includes("com.sec.android.app.shealth") || raw.includes("samsung")) return "Samsung Health";
  if (raw.includes("com.huami.watch.hmwatchmanager") || raw.includes("zepp") || raw.includes("amazfit")) return "Zepp / Amazfit";
  if (raw.includes("com.google.android.apps.fitness") || raw.includes("google fit")) return "Google Fit";
  if (raw === "android" || raw.includes("health connect aggregate")) return "Health Connect aggregate";
  return source?.selectedSourceName || source?.sourceName || source?.selectedSourcePackage || source?.sourcePackage || source?.source || source || "Health Connect";
}

function dataSourceName(result, fallback = "Health Connect") {
  return sourceLabel(result?.sourceName || result?.sourcePackage || result?.source || fallback);
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
    if (latestPreferred && preferredAge != null && preferredAge <= 30) return latestPreferred;
  }

  return samples[samples.length - 1] || null;
}

function heartStatusFor(recentResult, todayResult) {
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
  return Number(source?.total ?? source?.value ?? 0) || 0;
}

function selectBestSource(result, preferredSourcePackage = "") {
  const sources = (result?.sources || []).filter((source) => source?.sourcePackage || source?.sourceName);
  if (!sources.length) {
    return {
      selectedSourcePackage: result?.selectedSourcePackage || null,
      selectedSourceName: sourceLabel(result?.sourceName || result?.sourcePackage || result?.source || "Health Connect aggregate"),
      selectedSourceReason: result?.selectedSourcePackage ? "preferred source from native layer" : "aggregate",
      selectedTotal: Number(result?.total || result?.active || 0) || 0,
      sources,
    };
  }

  const ranked = [...sources].sort((a, b) => sourceTotal(b) - sourceTotal(a));
  const max = ranked[0];
  const maxTotal = sourceTotal(max);
  const preferred = preferredSourcePackage
    ? sources.find((source) => String(source.sourcePackage || "").toLowerCase() === preferredSourcePackage.toLowerCase())
    : null;

  if (preferred) {
    const preferredTotal = sourceTotal(preferred);
    if (preferredTotal < maxTotal * 0.2 && maxTotal > 500) {
      return {
        selectedSourcePackage: max.sourcePackage || null,
        selectedSourceName: sourceLabel(max),
        selectedSourceReason: `${preferred.sourceName || preferred.sourcePackage} stale/partial, выбран источник с максимальными данными`,
        selectedTotal: maxTotal,
        sources,
      };
    }
    return {
      selectedSourcePackage: preferred.sourcePackage || null,
      selectedSourceName: sourceLabel(preferred),
      selectedSourceReason: "preferred source",
      selectedTotal: preferredTotal,
      sources,
    };
  }

  return {
    selectedSourcePackage: max.sourcePackage || null,
    selectedSourceName: sourceLabel(max),
    selectedSourceReason: "highest total / freshest available data",
    selectedTotal: maxTotal,
    sources,
  };
}

function samplesForSelectedSource(result, selection) {
  const samples = result?.samples || [];
  if (!selection?.selectedSourcePackage) return samples;
  const filtered = samples.filter((sample) => String(sample.sourcePackage || "").toLowerCase() === String(selection.selectedSourcePackage).toLowerCase());
  return filtered.length ? filtered : samples;
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
  if (ageMinutes <= 10) return { status: "fresh", ageMinutes, label: "fresh" };
  if (ageMinutes <= 30) return { status: "aging", ageMinutes, label: "aging" };
  return { status: "stale", ageMinutes, label: "stale" };
}

function heartWidgetStatus(freshness, hasHeart) {
  if (!hasHeart) return "no_data";
  if (freshness === "fresh" || freshness === "aging") return "connected";
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

function splitCalorieValues({ caloriesResult = {}, estimatedActive = 0, profile = {} } = {}) {
  const restingCalories = estimateRestingCalories(profile);
  const nativeActiveRaw = normalizeCaloriesValue(caloriesResult.active);
  const nativeTotalRaw = normalizeCaloriesValue(caloriesResult.total);
  const nativeTotalLooksDaily = nativeTotalRaw >= restingCalories * 0.55;
  const nativeActive = nativeActiveRaw || (!nativeActiveRaw && nativeTotalRaw && !nativeTotalLooksDaily ? nativeTotalRaw : 0);
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
  };
}

function normalizeCaloriesValue(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return round(number > 50000 ? number / 1000 : number);
}

function buildActivityHistory(stepWeek = [], calorieWeek = []) {
  return {
    week: weekLabels.map((label, index) => ({
      label,
      steps: round(stepWeek[index]),
      calories: round(calorieWeek[index]),
    })),
    month: Array.from({ length: 30 }, (_, index) => ({
      label: String(index + 1),
      steps: 0,
      calories: 0,
    })),
  };
}

function buildSleepWeek(sessions = []) {
  const week = weekLabels.map((day) => ({ day, minutes: 0, quality: 0 }));
  sessions.forEach((session) => {
    const index = dayIndexFromDate(session.start);
    week[index].minutes += Number(session.minutes || 0);
    week[index].quality = 4;
  });
  return week;
}

async function readNativeHealthSnapshot(previous) {
  const stepSourceOptions = preferredHealthSourceOptions();
  const [availability, stepsToday, stepsWeek, stepsMonth, caloriesToday, caloriesWeek, caloriesMonth, distanceToday, heartRecent, heartToday, heart24h, heartWeek, sleepWeek, workoutsWeek] = await Promise.all([
    getHealthAvailability(),
    getSteps("today", stepSourceOptions),
    getSteps("week", stepSourceOptions),
    getSteps("month", stepSourceOptions),
    getCalories("today"),
    getCalories("week"),
    getCalories("month"),
    getDistance("today"),
    getHeartRate("last15min"),
    getHeartRate("today"),
    getHeartRate("last24h"),
    getHeartRate("week"),
    getSleep("week"),
    getExerciseSessions("week"),
  ]);

  const preferredPackage = stepSourceOptions.preferredSourcePackage || "";
  const stepSelectionToday = selectBestSource(stepsToday, preferredPackage);
  const stepSelectionWeek = selectBestSource(stepsWeek, preferredPackage);
  const stepSelectionMonth = selectBestSource(stepsMonth, preferredPackage);
  const stepSamplesToday = samplesForSelectedSource(stepsToday, stepSelectionToday);
  const stepSamplesWeek = samplesForSelectedSource(stepsWeek, stepSelectionWeek);
  const stepSamplesMonth = samplesForSelectedSource(stepsMonth, stepSelectionMonth);
  const stepWeek = buildSeriesFromSamples(stepSamplesWeek, "week");
  const stepMonth = buildSeriesFromSamples(stepSamplesMonth, "month");
  const calorieWeekRaw = buildSeriesFromSamples(caloriesWeek.samples, "week");
  const calorieMonthRaw = buildSeriesFromSamples(caloriesMonth.samples, "month");
  const sleepSessions = mainSleepSessions(sleepWeek);
  const allSleepSessions = sleepWeek.sessions || [];
  const sleepToday = sleepSessions[sleepSessions.length - 1] || sleepWeek.latestSleep || allSleepSessions[allSleepSessions.length - 1] || null;
  const recentHeartSample = latestHeartSampleFromResults([heartRecent, heartToday, heart24h, heartWeek], preferredPackage);
  const heartFresh = heartFreshness(recentHeartSample?.time || heartRecent.latestTimestamp || heart24h.latestTimestamp || heartWeek.latestTimestamp);
  const heartValues = (heartToday.samples || []).map((sample) => Number(sample.value || 0)).filter(Boolean);
  const recentHeartValues = (heartRecent.samples || []).map((sample) => Number(sample.value || 0)).filter(Boolean);
  const hasSteps = stepsToday.state === healthProviderStates.CONNECTED
    || Number(stepSelectionToday.selectedTotal || stepsToday.total) > 0
    || (stepsToday.samples || []).length > 0
    || Boolean(stepSelectionToday.selectedSourcePackage);
  const workouts = workoutsWeek.sessions || [];
  const calorieProfile = profileForCalories(previous);
  const estimatedCalories = estimateActiveCalories({
    steps: stepSelectionToday.selectedTotal || stepsToday.total || 0,
    distanceMeters: distanceToday.meters || 0,
    weightKg: calorieProfile.weight || previous.profileWeightKg || previous.weightKg || 75,
    workouts,
  });
  const calorieSplit = splitCalorieValues({ caloriesResult: caloriesToday, estimatedActive: estimatedCalories, profile: calorieProfile });
  const caloriesTodayValue = calorieSplit.activeCalories;
  const estimatedCaloriesWeek = caloriesWeekRaw.map((value, index) => round(
    normalizeCaloriesValue(value) || estimateActiveCalories({
      steps: stepWeek[index] || 0,
      weightKg: calorieProfile.weight || previous.profileWeightKg || previous.weightKg || 75,
    }),
  ));
  const stepsTodayValue = round(stepSelectionToday.selectedTotal || stepsToday.total);
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
  const resolvedStepWeek = hasPositiveSeries(stepWeek) ? stepWeek.map(round) : historyStepWeek;
  const resolvedStepMonth = hasPositiveSeries(stepMonth) ? stepMonth.map(round) : historyStepMonth;
  const resolvedCaloriesWeek = hasPositiveSeries(estimatedCaloriesWeek) ? estimatedCaloriesWeek.map(round) : historyCaloriesWeek;
  const resolvedCaloriesMonth = hasPositiveSeries(calorieMonthRaw) ? calorieMonthRaw.map(round) : historyCaloriesMonth;
  const hasCalories = caloriesToday.state === healthProviderStates.CONNECTED
    || caloriesTodayValue > 0
    || (caloriesToday.samples || []).length > 0
    || Number(caloriesToday.recordsCount || 0) > 0;
  const caloriesEstimated = calorieSplit.isEstimatedActive;
  const hasRecentHeart = recentHeartValues.length > 0;
  const hasHeartToday = heartValues.length > 0;
  const hasAnyHeart = Boolean(
    recentHeartSample
    || heartRecent.latestBpm
    || heartToday.latestBpm
    || heart24h.latestBpm
    || heartWeek.latestBpm
    || heartRecent.recordsCount
    || heartToday.recordsCount
    || heart24h.recordsCount
    || heartWeek.recordsCount
    || (heartRecent.samples || []).length
    || (heart24h.samples || []).length
    || (heartWeek.samples || []).length
  );
  const hasSleep = sleepSessions.length > 0 || allSleepSessions.length > 0 || Boolean(sleepWeek.latestSleep);
  const hasWorkouts = workouts.length > 0;
  const heartLatestTimestamp = recentHeartSample?.time || heartRecent.latestTimestamp || heartToday.latestTimestamp || heart24h.latestTimestamp || heartWeek.latestTimestamp || null;
  const heartLatestBpm = recentHeartSample ? Number(recentHeartSample.value) : heartRecent.latestBpm || heartToday.latestBpm || heart24h.latestBpm || heartWeek.latestBpm || null;

  const next = {
    ...previous,
    generatedAt: new Date().toISOString(),
    lastFruitFitRefreshAt: new Date().toISOString(),
    dataSource: canReadNativeData(availability.state) ? "tracker" : previous.dataSource,
    providerState: availability.state,
    providerSource: availability.source,
    providerMessage: availability.message,
    steps: {
      ...previous.steps,
      today: stepsTodayValue,
      hourly: buildSeriesFromSamples(stepSamplesToday, "today"),
      week: resolvedStepWeek,
      month: resolvedStepMonth,
      sourceName: stepSelectionToday.selectedSourceName,
      sourcePackage: stepSelectionToday.selectedSourcePackage || null,
      selectedSourceReason: stepSelectionToday.selectedSourceReason,
      sources: stepsToday.sources || [],
      rawTotal: stepsToday.rawTotal || 0,
      aggregateStrategy: stepsToday.aggregateStrategy || "health_connect_records",
      dataSource: hasSteps ? "tracker" : null,
      status: hasSteps ? "connected" : stepsToday.state === healthProviderStates.PERMISSIONS_REQUIRED ? "permission_required" : "no_data",
    },
    calories: {
      ...previous.calories,
      today: caloriesTodayValue,
      activeToday: calorieSplit.activeCalories,
      restingToday: calorieSplit.restingCalories,
      totalToday: calorieSplit.totalCalories,
      hourly: buildSeriesFromSamples(caloriesToday.samples, "today"),
      week: resolvedCaloriesWeek,
      month: resolvedCaloriesMonth,
      sourceName: caloriesEstimated ? "Оценка активности" : dataSourceName(caloriesToday),
      selectedSourceReason: caloriesEstimated
        ? "active calories missing, estimated from steps/distance/workouts; total = resting BMR + active"
        : (calorieSplit.totalWasEstimated ? "Health Connect active calories; total = resting BMR + active" : "Health Connect active and total calories"),
      isEstimated: caloriesEstimated,
      totalWasEstimated: calorieSplit.totalWasEstimated,
      dataSource: hasCalories ? "tracker" : null,
      status: hasCalories ? (caloriesEstimated ? "estimated" : "connected") : caloriesToday.state === healthProviderStates.PERMISSIONS_REQUIRED ? "permission_required" : "no_data",
    },
    heart_rate: {
      ...previous.heart_rate,
      current: heartFresh.status === "fresh" ? Number(heartLatestBpm || 0) : null,
      latestBpm: heartLatestBpm,
      resting: hasHeartToday ? heartToday.min : previous.heart_rate.resting,
      baselineResting: previous.heart_rate.baselineResting || heartToday.min || previous.heart_rate.resting,
      avgWorkout: hasHeartToday ? heartToday.avg : previous.heart_rate.avgWorkout,
      dayRange: hasHeartToday ? [heartToday.min, heartToday.max] : previous.heart_rate.dayRange,
      hourly: heartValues,
      sourceName: sourceLabel(recentHeartSample || (hasRecentHeart ? heartRecent : heartToday)),
      sourcePackage: recentHeartSample?.sourcePackage || heartRecent.latestSourcePackage || heartToday.latestSourcePackage || heart24h.latestSourcePackage || null,
      latestTimestamp: heartLatestTimestamp,
      freshness: heartFresh.status,
      ageMinutes: heartFresh.ageMinutes,
      updatedAgoText: agoText(heartFresh.ageMinutes),
      recordsToday: heartToday.recordsCount || 0,
      records24h: heart24h.recordsCount || 0,
      records7d: heartWeek.recordsCount || 0,
      samplesToday: heartToday.samplesCount || heartValues.length,
      samples7d: heartWeek.samplesCount || (heartWeek.samples || []).length,
      sources: heartToday.sources || heartWeek.sources || [],
      dataSource: hasAnyHeart ? "tracker" : null,
      status: hasAnyHeart ? heartWidgetStatus(heartFresh.status, hasAnyHeart) : heartStatusFor(heartRecent, heartToday),
      message: hasAnyHeart
        ? (heartFresh.status === "fresh" ? "Данные пульса актуальны" : `Последний пульс обновлен ${agoText(heartFresh.ageMinutes)}`)
        : heartToday.message,
    },
    sleep: {
      ...previous.sleep,
      minutes: hasSleep ? round(sleepToday?.minutes || sleepWeek.minutes || 0) : previous.sleep.minutes,
      quality: hasSleep ? 4 : previous.sleep.quality,
      week: hasSleep ? buildSleepWeek(sleepSessions) : previous.sleep.week,
      stages: sleepToday?.stages || previous.sleep.stages,
      fragments: sleepWeek.fragments || [],
      sourceName: dataSourceName(sleepWeek),
      dataSource: hasSleep ? "tracker" : previous.sleep.dataSource,
      status: hasSleep ? "connected" : sleepWeek.state === healthProviderStates.PERMISSIONS_REQUIRED ? "permission_required" : "no_data",
    },
    workouts: {
      recentWorkouts: (workoutsWeek.sessions || []).length,
      recentLoad: (workoutsWeek.sessions || []).length,
      dataSource: hasWorkouts ? "tracker" : null,
      status: hasWorkouts ? "connected" : "no_data",
    },
    activity_history: buildActivityHistory(resolvedStepWeek, resolvedCaloriesWeek),
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
  const healthRef = useRef(health);
  const syncPromiseRef = useRef(null);
  const nativeCommitSeqRef = useRef(0);

  useEffect(() => {
    healthRef.current = health;
  }, [health]);

  const syncNativeHealth = useCallback(async () => {
    if (syncPromiseRef.current) return syncPromiseRef.current;

    const commitSeq = ++nativeCommitSeqRef.current;
    syncPromiseRef.current = (async () => {
      setSyncing(true);
      const nextAvailability = await getHealthAvailability();
      setAvailability(nextAvailability);
      setHealth((current) => ({
        ...current,
        providerState: nextAvailability.state,
        providerSource: nextAvailability.source,
        providerMessage: nextAvailability.message,
        lastFruitFitRefreshAt: new Date().toISOString(),
      }));
      if (!canReadNativeData(nextAvailability.state)) return nextAvailability;

      const snapshot = await readNativeHealthSnapshot(healthRef.current || loadHealthData());
      if (commitSeq === nativeCommitSeqRef.current) {
        setHealth(snapshot);
      }
      return nextAvailability;
    })().finally(() => {
      if (commitSeq === nativeCommitSeqRef.current) setSyncing(false);
      syncPromiseRef.current = null;
    });

    return syncPromiseRef.current;
  }, []);

  useEffect(() => {
    let alive = true;
    getHealthAvailability().then((next) => {
      if (!alive) return;
      setAvailability(next);
      setHealth((current) => ({
        ...current,
        providerState: next.state,
        providerSource: next.source,
        providerMessage: next.message,
      }));
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
    localStorage.setItem(HEALTH_STORAGE_KEY, JSON.stringify(health));
    window.dispatchEvent(new CustomEvent("fruitfit:health-updated", { detail: health }));
  }, [health]);

  const commit = useCallback((updater) => {
    setHealth((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      return { ...next, readiness: calculateReadiness(next) };
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
      const nextSleep = { ...current.sleep, ...patch, dataSource: "manual", sourceName: "Ручной ввод", status: "connected" };
      if (patch.bed || patch.wake) nextSleep.minutes = sleepDurationFromTimes(nextSleep.bed, nextSleep.wake);
      if (patch.quality) nextSleep.quality = clamp(Number(patch.quality), 1, 5);
      const week = nextSleep.week?.length ? nextSleep.week : weekLabels.map((day) => ({ day, minutes: 0, quality: 0 }));
      week[week.length - 1] = {
        ...week[week.length - 1],
        date: nextSleep.date || new Date().toISOString().slice(0, 10),
        minutes: nextSleep.minutes,
        quality: Number(nextSleep.quality) || 3,
      };
      return { ...current, sleep: { ...nextSleep, week }, dataSource: "manual" };
    });
  }, [commit]);

  const updateCycle = useCallback((patch) => {
    commit((current) => ({
      ...current,
      cycle: {
        ...current.cycle,
        ...patch,
        dataSource: "manual",
      },
    }));
  }, [commit]);

  const requestConnection = useCallback(async () => {
    setSyncing(true);
    try {
      const permissionResult = await requestHealthPermissions();
      setAvailability(permissionResult);
      setHealth((current) => ({
        ...current,
        providerState: permissionResult.state,
        providerSource: permissionResult.source,
        providerMessage: permissionResult.message,
      }));
      if (canReadNativeData(permissionResult.state)) {
        const commitSeq = ++nativeCommitSeqRef.current;
        const snapshot = await readNativeHealthSnapshot(healthRef.current || loadHealthData());
        if (commitSeq === nativeCommitSeqRef.current) setHealth(snapshot);
      }
      if (permissionResult.state === healthProviderStates.PERMISSIONS_REQUIRED) {
        await openHealthSettings();
      }
      return permissionResult;
    } finally {
      setSyncing(false);
    }
  }, []);

  const buildHealthDebugReport = useCallback(async () => {
    const commitSeq = ++nativeCommitSeqRef.current;
    const stepSourceOptions = preferredHealthSourceOptions();
    const now = new Date();
    const [
      nextAvailability,
      heart15,
      heart24,
      heart7,
      stepsToday,
      caloriesToday,
      sleepWeek,
      workoutsWeek,
      weightLatest,
    ] = await Promise.all([
      getHealthAvailability(),
      getHeartRate("last15min"),
      getHeartRate("last24h"),
      getHeartRate("week"),
      getSteps("today", stepSourceOptions),
      getCalories("today"),
      getSleep("week"),
      getExerciseSessions("week"),
      getWeight("month"),
    ]);
    const latest = latestHeartSampleFromResults([heart15, heart24, heart7], stepSourceOptions.preferredSourcePackage || "");
    const stepSelection = selectBestSource(stepsToday, stepSourceOptions.preferredSourcePackage || "");
    const heart24Values = (heart24.samples || []).map((sample) => Number(sample.value || 0)).filter(Boolean);
    const heartFresh = heartFreshness(latest?.time || heart24.latestTimestamp || null);
    const stepsDebugTotal = Number(stepSelection.selectedTotal || stepsToday.total || 0) || 0;
    const sleepDebugSessions = mainSleepSessions(sleepWeek);
    const calorieProfile = profileForCalories(health);
    const estimatedCaloriesDebug = estimateActiveCalories({
      steps: stepsDebugTotal,
      weightKg: calorieProfile.weight || health.profileWeightKg || health.weightKg || 75,
      workouts: workoutsWeek.sessions || [],
    });
    const calorieSplitDebug = splitCalorieValues({
      caloriesResult: caloriesToday,
      estimatedActive: estimatedCaloriesDebug,
      profile: calorieProfile,
    });
    const activeCaloriesDebug = calorieSplitDebug.activeCalories;
    const caloriesEstimatedDebug = calorieSplitDebug.isEstimatedActive;
    const historyDebug = writeHealthHistory({
      date: localDateKey(),
      steps: stepsDebugTotal,
      activeCalories: calorieSplitDebug.activeCalories,
      restingCalories: calorieSplitDebug.restingCalories,
      totalCalories: calorieSplitDebug.totalCalories,
    });
    const historyStepWeekDebug = historySeries(historyDebug, "steps", 7);
    const historyCaloriesWeekDebug = historySeries(historyDebug, "activeCalories", 7);
    const latestHeartBpmDebug = latest ? Number(latest.value) : heart24.latestBpm || heart7.latestBpm || null;
    const latestHeartTimestampDebug = latest?.time || heart24.latestTimestamp || heart7.latestTimestamp || null;
    const manualSleep = health.sleep?.dataSource === "manual" ? health.sleep : null;
    const latestNativeSleep = (sleepWeek.sessions || []).slice(-1)[0] || null;
    const sleepMinutesDebug = sleepDebugSessions[sleepDebugSessions.length - 1]?.minutes
      || latestNativeSleep?.minutes
      || manualSleep?.minutes
      || 0;
    const sleepWeekForUi = sleepDebugSessions.length
      ? buildSleepWeek(sleepDebugSessions)
      : manualSleep?.week || health.sleep?.week || weekLabels.map((day) => ({ day, minutes: 0, quality: 0 }));
    if (commitSeq === nativeCommitSeqRef.current) {
      setHealth((current) => {
        const next = {
        ...current,
        providerState: nextAvailability.state,
        providerSource: nextAvailability.source,
        providerMessage: nextAvailability.message,
        lastFruitFitRefreshAt: new Date().toISOString(),
        steps: {
          ...current.steps,
          today: round(stepsDebugTotal || current.steps?.today || 0),
          week: historyStepWeekDebug,
          sourceName: sourceLabel(stepSelection),
          sourcePackage: stepSelection.selectedSourcePackage || stepsToday.selectedSourcePackage || current.steps?.sourcePackage || null,
          selectedSourceReason: stepSelection.selectedSourceReason,
          sources: stepsToday.sources || current.steps?.sources || [],
          dataSource: stepsDebugTotal > 0 ? "tracker" : current.steps?.dataSource || null,
          status: stepsDebugTotal > 0 ? "connected" : current.steps?.status || "no_data",
        },
        calories: {
          ...current.calories,
          today: round(activeCaloriesDebug || current.calories?.today || 0),
          activeToday: round(activeCaloriesDebug || current.calories?.activeToday || 0),
          restingToday: round(calorieSplitDebug.restingCalories || current.calories?.restingToday || 0),
          totalToday: round(calorieSplitDebug.totalCalories || current.calories?.totalToday || 0),
          week: historyCaloriesWeekDebug,
          sourceName: caloriesEstimatedDebug ? "Оценка активности" : dataSourceName(caloriesToday),
          selectedSourceReason: caloriesEstimatedDebug
            ? "active calories missing, estimated from steps/distance/workouts; total = resting BMR + active"
            : (calorieSplitDebug.totalWasEstimated ? "Health Connect active calories; total = resting BMR + active" : "Health Connect active and total calories"),
          isEstimated: caloriesEstimatedDebug,
          totalWasEstimated: calorieSplitDebug.totalWasEstimated,
          dataSource: activeCaloriesDebug > 0 ? "tracker" : current.calories?.dataSource || null,
          status: activeCaloriesDebug > 0 ? (caloriesEstimatedDebug ? "estimated" : "connected") : current.calories?.status || "no_data",
        },
        heart_rate: {
          ...current.heart_rate,
          current: heartFresh.status === "fresh" ? latestHeartBpmDebug : null,
          latestBpm: latestHeartBpmDebug || current.heart_rate?.latestBpm || null,
          resting: heart24.min || current.heart_rate?.resting || null,
          baselineResting: current.heart_rate?.baselineResting || heart24.min || current.heart_rate?.resting || null,
          avgWorkout: heart24.avg || current.heart_rate?.avgWorkout || null,
          dayRange: [heart24.min || current.heart_rate?.dayRange?.[0] || null, heart24.max || current.heart_rate?.dayRange?.[1] || null],
          hourly: heart24Values.length ? heart24Values : current.heart_rate?.hourly || [],
          sourceName: sourceLabel(latest || heart24),
          sourcePackage: latest?.sourcePackage || heart24.latestSourcePackage || current.heart_rate?.sourcePackage || null,
          latestTimestamp: latestHeartTimestampDebug || current.heart_rate?.latestTimestamp || null,
          freshness: heartFresh.status,
          ageMinutes: heartFresh.ageMinutes,
          updatedAgoText: agoText(heartFresh.ageMinutes),
          records24h: heart24.recordsCount || current.heart_rate?.records24h || 0,
          records7d: heart7.recordsCount || current.heart_rate?.records7d || 0,
          sources: heart24.sources || heart7.sources || current.heart_rate?.sources || [],
          dataSource: latestHeartBpmDebug || heart24.recordsCount || heart7.recordsCount ? "tracker" : current.heart_rate?.dataSource || null,
          status: latestHeartBpmDebug || heart24.recordsCount || heart7.recordsCount ? heartWidgetStatus(heartFresh.status, true) : current.heart_rate?.status || "no_data",
        },
        sleep: {
          ...current.sleep,
          minutes: round(sleepMinutesDebug || current.sleep?.minutes || 0),
          quality: manualSleep?.quality || current.sleep?.quality || 3,
          week: sleepWeekForUi,
          stages: latestNativeSleep?.stages || current.sleep?.stages || [],
          fragments: sleepWeek.fragments || current.sleep?.fragments || [],
          sourceName: manualSleep ? "Ручной ввод" : dataSourceName(sleepWeek),
          dataSource: sleepMinutesDebug > 0 ? (manualSleep ? "manual" : "tracker") : current.sleep?.dataSource || null,
          status: sleepMinutesDebug > 0 ? "connected" : current.sleep?.status || "no_data",
        },
        workouts: {
          recentWorkouts: (workoutsWeek.sessions || []).length,
          recentLoad: (workoutsWeek.sessions || []).length,
          latestWorkout: (workoutsWeek.sessions || []).slice(-1)[0] || current.workouts?.latestWorkout || null,
          dataSource: (workoutsWeek.sessions || []).length ? "tracker" : current.workouts?.dataSource || null,
          status: (workoutsWeek.sessions || []).length ? "connected" : current.workouts?.status || "no_data",
        },
      };
        return { ...next, readiness: calculateReadiness(next) };
      });
    }
    return {
      fileName: `fruitfit_health_debug_${now.toISOString().slice(0, 16).replace("T", "_").replace(":", "-")}.json`,
      app: {
        appVersion: "FruitFit local",
        buildNumber: null,
        platform: window.Capacitor?.getPlatform?.() || "web",
        userAgent: navigator.userAgent,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timestampNow: now.toISOString(),
      },
      healthConnect: {
        isHealthConnectAvailable: nextAvailability.state !== healthProviderStates.NOT_SUPPORTED,
        isHealthConnectInstalled: nextAvailability.state !== healthProviderStates.NOT_INSTALLED,
        healthConnectSdkStatus: nextAvailability.state,
        permissionsGranted: Object.entries(nextAvailability.permissionStatus || {}).filter(([, value]) => value).map(([key]) => key),
        permissionsMissing: Object.entries(nextAvailability.permissionStatus || {}).filter(([, value]) => !value).map(([key]) => key),
        message: nextAvailability.message,
      },
      sources: {
        detectedSources: stepsToday.sources || heart24.sources || caloriesToday.sources || [],
        selectedPreferredSource: stepSourceOptions.preferredSourcePackage || null,
        selectedSource: stepSelection.selectedSourcePackage,
        selectedSourceReason: stepSelection.selectedSourceReason,
        sourcePriority: ["Mi Fitness", "Zepp / Amazfit", "Google Fit", "Samsung Health", "Health Connect aggregate"],
      },
      heartRate: {
        permissionGranted: Boolean(nextAvailability.permissionStatus?.heartRate),
        recordsLast15Min: heart15.recordsCount || 0,
        recordsLast24h: heart24.recordsCount || 0,
        recordsLast7d: heart7.recordsCount || 0,
        latestBpm: latest ? Number(latest.value) : heart24.latestBpm || null,
        latestTimestamp: latest?.time || heart24.latestTimestamp || null,
        freshness: heartFresh,
        latestSourcePackage: latest?.sourcePackage || heart24.latestSourcePackage || null,
        min24h: heart24.min || null,
        avg24h: heart24.avg || null,
        max24h: heart24.max || null,
        sampleRecordsLast10: (heart24.samples || []).slice(-10),
        reasonIfEmpty: (heart24.samples || []).length ? null : heart24.message || "Источник не передал данные пульса",
      },
      steps: {
        permissionGranted: Boolean(nextAvailability.permissionStatus?.steps),
        aggregateToday: stepsDebugTotal,
        recordsToday: stepsToday.samples?.length || 0,
        sourcesToday: stepsToday.sources || [],
        valuesBySource: stepsToday.sources || [],
        selectedSource: stepSelection.selectedSourcePackage || stepsToday.selectedSourcePackage || null,
        selectedSourceReason: stepSelection.selectedSourceReason,
        dedupeResult: stepsToday.aggregateStrategy || null,
      },
      sleep: {
        permissionGranted: Boolean(nextAvailability.permissionStatus?.sleep),
        sessionsLast7d: sleepWeek.sessions || [],
        mainSleepSessions: sleepDebugSessions,
        shortFragmentsUnder2h: sleepWeek.fragments || [],
        latestSleep: (sleepWeek.sessions || []).slice(-1)[0] || null,
        sourcePackage: (sleepWeek.sessions || []).slice(-1)[0]?.sourcePackage || null,
        manualSleepEntries: health.sleep?.dataSource === "manual" ? health.sleep : null,
        reasonIfEmpty: (sleepWeek.sessions || []).length ? null : sleepWeek.message || "Нет данных сна",
      },
      calories: {
        permissionGranted: Boolean(nextAvailability.permissionStatus?.calories),
        activeCaloriesToday: activeCaloriesDebug,
        restingCaloriesToday: calorieSplitDebug.restingCalories,
        totalCaloriesToday: calorieSplitDebug.totalCalories || null,
        isEstimatedFromSteps: caloriesEstimatedDebug,
        totalWasEstimatedFromBmr: calorieSplitDebug.totalWasEstimated,
        estimateReason: caloriesEstimatedDebug ? "active calories missing, estimated from steps" : null,
        recordsToday: caloriesToday.samples?.length || 0,
        sourcesToday: caloriesToday.sources || [],
        valuesBySource: caloriesToday.sources || [],
        reasonIfEmpty: (caloriesToday.samples || []).length ? null : caloriesToday.message || "Нет данных калорий",
      },
      workouts: {
        permissionGranted: Boolean(nextAvailability.permissionStatus?.workouts),
        workoutsLast7d: workoutsWeek.sessions || [],
        latestWorkout: (workoutsWeek.sessions || []).slice(-1)[0] || null,
        sourcePackage: (workoutsWeek.sessions || []).slice(-1)[0]?.sourcePackage || null,
      },
      weight: {
        permissionGranted: Boolean(nextAvailability.permissionStatus?.weight),
        latestWeight: weightLatest.value || null,
        latestTimestamp: (weightLatest.samples || []).slice(-1)[0]?.time || null,
        sourcePackage: (weightLatest.samples || []).slice(-1)[0]?.sourcePackage || null,
      },
      widgetStates: {
        heartRateWidgetState: heartWidgetStatus(heartFresh.status, Boolean(latest || heart24.latestBpm)),
        stepsWidgetState: stepsDebugTotal > 0 ? "connected" : health.steps?.status || "no_data",
        sleepWidgetState: sleepDebugSessions.length > 0 || (sleepWeek.sessions || []).length > 0 || manualSleep?.minutes ? "connected" : health.sleep?.status || "no_data",
        caloriesWidgetState: activeCaloriesDebug > 0 ? (caloriesEstimatedDebug ? "estimated" : "connected") : health.calories?.status || "no_data",
        recoveryWidgetState: latestHeartBpmDebug || sleepMinutesDebug || stepsDebugTotal ? "partial_data" : "no_data",
      },
      errors: {
        lastHealthConnectError: [nextAvailability, heart15, heart24, heart7, stepsToday, caloriesToday, sleepWeek, workoutsWeek, weightLatest]
          .filter((item) => item?.state === healthProviderStates.ERROR)
          .map((item) => ({ source: item.source, message: item.message, code: item.errorCode || null })),
        exceptions: [],
        failedQueries: [],
        permissionRequestErrors: [],
      },
    };
  }, [health]);

  const value = useMemo(() => ({
    health,
    availability,
    syncing,
    requestConnection,
    syncNativeHealth,
    buildHealthDebugReport,
    setHeartCondition,
    updateSleepManual,
    updateCycle,
  }), [availability, buildHealthDebugReport, health, requestConnection, setHeartCondition, syncNativeHealth, syncing, updateCycle, updateSleepManual]);

  return <HealthContext.Provider value={value}>{children}</HealthContext.Provider>;
}

export function useHealth() {
  const context = useContext(HealthContext);
  if (!context) throw new Error("useHealth must be used inside HealthProvider");
  return context;
}
