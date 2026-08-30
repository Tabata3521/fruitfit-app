import { useEffect, useMemo, useRef, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, Check, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Clock, Leaf, History, Lock, MoreHorizontal, Pause, Play, RotateCcw, User, Volume2, VolumeX, X } from "lucide-react";
import BottomNavigation from "../components/BottomNavigation";
import ExerciseList from "../components/ExerciseList";
import ExerciseMedia from "../components/ExerciseMedia";
import IconButton from "../components/IconButton";
import MuscleWorkBlock from "../components/MuscleWorkBlock";
import ProgramRestrictions from "../components/ProgramRestrictions";
import { buildClientReportScores, ClientReportSliders, normalizeClientReportScores } from "../components/ClientReportSliders";
import { isWorkoutUnlocked, LOCKED_WORKOUT_MESSAGE, originalWorkoutIndex, visibleWorkoutsForAccess } from "../data/accessRules";
import { APP_STORE_REVIEW } from "../config/appStoreReview";
import { getAuthToken, submitTrainerReport } from "../data/authStore";
import { readHealthContainer, readWorkoutHistoryField, writeWorkoutHistoryField } from "../data/dataContainers";
import { useHealth } from "../data/healthStore";
import { currentUserId } from "../data/userScopedCache";
import { getExerciseAlternatives } from "../data/exerciseAlternatives";
import { assignMuscleTemplate } from "../data/muscleTemplates";
import { programRestrictionState } from "../data/programRestrictions";
import { programSummaryTitle } from "../data/programPresentation";
import { getExerciseWeight, saveExerciseWeight } from "../utils/exerciseWeights";
import { markWorkoutCompleted } from "../data/workoutCompletion";
import {
  activeWorkoutSession,
  abandonWorkoutSession,
  completeWorkoutSession,
  createWorkoutSession,
  deleteWorkoutSession,
  migrateLegacyWorkoutSession,
  reconcileWorkoutSession,
  saveWorkoutSession,
  stableExerciseId,
  timerRemainingSeconds,
  updateWorkoutSession,
  workoutSessionForWorkout,
} from "../data/workoutSessions";
import { flushWorkoutSessionSync, scheduleWorkoutSessionSync } from "../services/workoutSessionSync";
import { trackAnalyticsEvent } from "../services/attribution";
import { cycleIdentity, cycleScopedWorkoutKey, legacyStateBelongsToCycle, withWorkoutCycle } from "../data/workoutCycle";

const SET_TARGET_SECONDS = 30;
const REST_SECONDS = 90;
const EXERCISE_REPLACEMENTS_FIELD = "exerciseReplacements";
const WORKOUT_REPORTS_FIELD = "workoutReports";
const WORKOUT_SESSION_PROGRESS_KEY = "fruitfit.workout.sessionProgress";

function loadDurableWorkoutSession(workout, program, cycle = {}) {
  const userId = currentUserId();
  if (!userId) return null;
  const migrated = migrateLegacyWorkoutSession({ workout, program, userId, cycle });
  const existing = migrated || workoutSessionForWorkout(workout.workout_id, userId, cycle);
  if (existing) {
    const reconciled = reconcileWorkoutSession(existing, { workout, program, userId, cycle });
    return saveWorkoutSession(reconciled, { activate: reconciled.status === "active", userId });
  }
  const active = activeWorkoutSession(userId, cycle);
  const created = createWorkoutSession({
    workout,
    program,
    userId,
    cycle,
    status: active && active.workout_id !== String(workout.workout_id || "") ? "paused" : "active",
  });
  return saveWorkoutSession(created, { activate: created.status === "active", userId });
}

function completedExerciseIds(session = {}) {
  return new Set(
    Object.values(session.exercises || {})
      .filter((exercise) => exercise.status === "completed")
      .map((exercise) => exercise.exercise_id),
  );
}

function selectedExerciseIndex(session, exercises = []) {
  const selectedId = String(session?.selected_exercise_id || "");
  const index = exercises.findIndex((exercise, itemIndex) => stableExerciseId(exercise, itemIndex) === selectedId);
  return index >= 0 ? index : 0;
}

function completedSetCount(session, exerciseId) {
  return (session?.exercises?.[exerciseId]?.sets || []).filter((set) => set.completed).length;
}

function trackWorkoutStartedOnce(session, program) {
  if (!session?.session_id) return;
  const marker = `fruitfit.analytics.workoutStarted:${session.session_id}`;
  try {
    if (localStorage.getItem(marker) === "1") return;
    localStorage.setItem(marker, "1");
  } catch (_) {
    // The backend event id still protects against request retries.
  }
  trackAnalyticsEvent("workout_started", {
    screen: "workout",
    workoutId: session.workout_id,
    programId: session.program_id || program?.course?.course_id || program?.course?.id || "",
  }).catch(() => {});
}

function exerciseMuscleMapFields(exercise = {}, meta = {}) {
  const assetPath = exercise.muscle_map_asset_path
    || exercise.muscleMapAssetPath
    || exercise.muscle_map_url
    || exercise.muscleMapUrl
    || meta.muscle_map_asset_path
    || meta.muscleMapAssetPath
    || meta.muscle_map_url
    || meta.muscleMapUrl
    || "";
  const label = exercise.muscle_map_label
    || exercise.muscleMapLabel
    || meta.muscle_map_label
    || meta.muscleMapLabel
    || "";
  const key = exercise.muscle_map_key
    || exercise.muscleMapKey
    || meta.muscle_map_key
    || meta.muscleMapKey
    || label;
  const version = exercise.muscle_map_version
    || exercise.muscleMapVersion
    || meta.muscle_map_version
    || meta.muscleMapVersion
    || "";
  const revision = exercise.muscle_map_revision
    || exercise.muscleMapRevision
    || meta.muscle_map_revision
    || meta.muscleMapRevision
    || version;
  const hash = exercise.muscle_map_hash
    || exercise.muscleMapHash
    || meta.muscle_map_hash
    || meta.muscleMapHash
    || revision;
  const updatedAt = exercise.muscle_map_updated_at
    || exercise.muscleMapUpdatedAt
    || meta.muscle_map_updated_at
    || meta.muscleMapUpdatedAt
    || hash;

  return {
    muscle_map_asset_path: assetPath,
    muscleMapAssetPath: assetPath,
    muscle_map_url: exercise.muscle_map_url || exercise.muscleMapUrl || meta.muscle_map_url || meta.muscleMapUrl || assetPath,
    muscleMapUrl: exercise.muscleMapUrl || exercise.muscle_map_url || meta.muscleMapUrl || meta.muscle_map_url || assetPath,
    muscle_map_label: label,
    muscleMapLabel: label,
    muscle_map_key: key,
    muscleMapKey: key,
    muscle_map_version: version,
    muscleMapVersion: version,
    muscle_map_revision: revision,
    muscleMapRevision: revision,
    muscle_map_hash: hash,
    muscleMapHash: hash,
    muscle_map_updated_at: updatedAt,
    muscleMapUpdatedAt: updatedAt,
  };
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function exerciseMeta(exercise) {
  return [
    exercise?.sets ? `${exercise.sets} подхода` : "",
    exercise?.reps ? `${exercise.reps} повторений` : "",
    exercise?.weight || "",
  ].filter(Boolean).join(" • ");
}

function readWorkoutHistoryMap(field) {
  const value = readWorkoutHistoryField(field, undefined, {});
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function readReplacements(workoutId, cycle = {}) {
  try {
    const map = readWorkoutHistoryMap(EXERCISE_REPLACEMENTS_FIELD);
    const id = String(workoutId || "");
    const scopedKey = cycleScopedWorkoutKey(id, cycle);
    const hasCycle = Boolean(cycle?.cycleId || cycle?.subscriptionCycleId || cycle?.subscription_cycle_id || cycle?.cycleNumber || cycle?.subscriptionCycleNumber || cycle?.subscription_cycle_number || cycle?.accessFrom);
    let value = map[scopedKey] || (!hasCycle ? map[id] : null) || null;
    const legacy = map[id];
    if (!value && legacy && legacyStateBelongsToCycle(legacy, cycle)) {
      value = withWorkoutCycle({ ...legacy, migratedFromLegacy: true }, cycle);
      writeWorkoutHistoryField(EXERCISE_REPLACEMENTS_FIELD, { ...map, [scopedKey]: value });
    }
    value ||= {};
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (_) {
    return {};
  }
}

function saveReplacements(workoutId, replacements, cycle = {}) {
  const key = String(workoutId || "").trim();
  if (!key) return {};
  const map = readWorkoutHistoryMap(EXERCISE_REPLACEMENTS_FIELD);
  const scopedKey = cycleScopedWorkoutKey(key, cycle);
  const value = withWorkoutCycle({
    ...(replacements && typeof replacements === "object" ? replacements : {}),
    updatedAt: new Date().toISOString(),
  }, cycle);
  const next = { ...map, [scopedKey]: value };
  writeWorkoutHistoryField(EXERCISE_REPLACEMENTS_FIELD, next);
  return next[scopedKey];
}

function workoutSessionKey(workoutId, cycle = {}) {
  return `${WORKOUT_SESSION_PROGRESS_KEY}:${cycleScopedWorkoutKey(workoutId, cycle)}`;
}

function readWorkoutSessionProgress(workoutId, cycle = {}) {
  try {
    const raw = sessionStorage.getItem(workoutSessionKey(workoutId, cycle));
    const data = raw ? JSON.parse(raw) : null;
    if (!data || data.workoutId !== String(workoutId || "")) return null;
    return data;
  } catch (_) {
    return null;
  }
}

function writeWorkoutSessionProgress(workoutId, state, cycle = {}) {
  try {
    sessionStorage.setItem(workoutSessionKey(workoutId, cycle), JSON.stringify(withWorkoutCycle({
      ...state,
      workoutId: String(workoutId || ""),
      savedAt: Date.now(),
    }, cycle)));
  } catch (_) {}
}

function restoreCompletedSet(value) {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item >= 0));
}

function restoredNumber(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(numeric, max));
}

function restoredPhase(value) {
  return ["idle", "prestart", "work", "workPaused", "restReady", "rest", "restPaused", "done"].includes(value) ? value : "idle";
}

function readWorkoutReport(workoutId, cycle = {}) {
  try {
    const map = readWorkoutHistoryMap(WORKOUT_REPORTS_FIELD);
    const id = String(workoutId || "");
    const scopedKey = cycleScopedWorkoutKey(id, cycle);
    const hasCycle = Boolean(cycle?.cycleId || cycle?.subscriptionCycleId || cycle?.subscription_cycle_id || cycle?.cycleNumber || cycle?.subscriptionCycleNumber || cycle?.subscription_cycle_number || cycle?.accessFrom);
    const scoped = map[scopedKey] || (!hasCycle ? map[id] : null);
    if (scoped) return scoped;
    const legacy = map[id];
    if (!legacy || !legacyStateBelongsToCycle(legacy, cycle)) return null;
    const migrated = withWorkoutCycle({ ...legacy, migratedFromLegacy: true }, cycle);
    writeWorkoutHistoryField(WORKOUT_REPORTS_FIELD, { ...map, [scopedKey]: migrated });
    return migrated;
  } catch (_) {
    return null;
  }
}

function saveWorkoutReport(workoutId, report, cycle = {}) {
  const key = String(workoutId || "").trim();
  if (!key) return null;
  const map = readWorkoutHistoryMap(WORKOUT_REPORTS_FIELD);
  const scopedKey = cycleScopedWorkoutKey(key, cycle);
  writeWorkoutHistoryField(WORKOUT_REPORTS_FIELD, { ...map, [scopedKey]: withWorkoutCycle(report || {}, cycle) });
  return report || null;
}

function initialReportScores(savedReport) {
  return normalizeClientReportScores(savedReport?.scores || savedReport || {
    selfFeeling: 7,
    strength: 7,
    sleepQuality: 7,
    workoutFeeling: 7,
  }, 7);
}

function trainerReportAuthExpired(error) {
  return Number(error?.status || 0) === 401
    || /unauthorized|invalid token|сессия/i.test(String(error?.message || ""));
}

function reportNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function workoutHealthSnapshot(health = {}) {
  const heart = health?.heart_rate || health?.heartRate || health?.heart || {};
  const steps = health?.steps || {};
  const calories = health?.calories || {};
  const sleep = health?.sleep || {};
  const latestBpm = reportNumber(heart.latestBpm ?? heart.current);
  return {
    summary: {
      latestBpm,
      stepsToday: reportNumber(steps.today),
      activeCaloriesToday: reportNumber(calories.activeToday ?? calories.today),
      sleepMinutes: reportNumber(sleep.minutes),
      providerSource: health.providerSource || "Apple Health",
      lastSyncAt: health.healthRefresh?.lastNativeReadFinishedAt || health.lastSuccessfulNativeReadAt || health.generatedAt || null,
    },
    heartRate: {
      latestBpm,
      latestTimestamp: heart.latestTimestamp || null,
      avg24h: reportNumber(heart.avg24h),
      min24h: reportNumber(heart.min24h ?? heart.range24h?.[0]),
      max24h: reportNumber(heart.max24h ?? heart.range24h?.[1]),
      sourceName: heart.latestSourceName || heart.sourceName || null,
      freshness: heart.freshness || null,
      status: heart.status || null,
    },
  };
}

function readFreshWorkoutHealth(health) {
  return readHealthContainer(currentUserId(), null) || health || {};
}

function pulseStatus(snapshot = {}) {
  const bpm = snapshot?.summary?.latestBpm;
  return bpm ? `${bpm} уд/мин` : "нет данных";
}

function SetTimer({ seconds, active, onStart, onComplete }) {
  const warning = seconds > SET_TARGET_SECONDS;
  const progress = Math.min(seconds / SET_TARGET_SECONDS, 1);

  return (
    <motion.section layout className="rounded-[22px] border border-appBorder bg-appDark p-4 text-white shadow-card">
      <div className="grid grid-cols-[88px_1fr] items-center gap-4">
        <div className="relative h-[88px] w-[88px]">
          <svg viewBox="0 0 96 96" className="-rotate-90">
            <circle cx="48" cy="48" r="38" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="8" />
            <motion.circle cx="48" cy="48" r="38" fill="none" stroke={warning ? "#FF6A4D" : "#DDF7B4"} strokeLinecap="round" strokeWidth="8" animate={{ pathLength: progress }} />
          </svg>
          <motion.div animate={warning ? { scale: [1, 1.035, 1] } : { scale: 1 }} transition={{ repeat: warning ? Infinity : 0, duration: 1.1 }} className="absolute inset-0 grid place-items-center text-center">
            <span className={`text-[20px] font-black ${warning ? "text-[#FF7A6B]" : "text-white"}`}>{formatTime(seconds)}</span>
          </motion.div>
        </div>
        <div>
          <p className={`text-[11px] font-bold uppercase ${warning ? "text-[#FF7A6B]" : "text-appGreen"}`}>
            {warning ? "Подход затянулся" : active ? "Время подхода" : "Готов к подходу"}
          </p>
          <p className="mt-1 text-[13px] text-white/64">цель: 00:30</p>
          <button type="button" onClick={active ? onComplete : onStart} className="mt-4 h-11 w-full rounded-full bg-appGreen text-[14px] font-bold text-[#181F19]">
            {active ? "Завершить подход" : "Старт подхода"}
          </button>
        </div>
      </div>
    </motion.section>
  );
}

function RestTimer({ seconds, phase, onStart, onToggle, onSkip }) {
  const running = phase === "rest";
  const ready = phase === "restReady";
  const progress = Math.max(0, seconds / REST_SECONDS);

  return (
    <motion.section layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-[22px] border border-appBorder bg-appCard p-4 shadow-sm">
      <div className="grid grid-cols-[72px_1fr_92px] items-center gap-3">
        <button type="button" onClick={ready ? onStart : onToggle} className="relative grid h-[72px] w-[72px] place-items-center rounded-full bg-appBg">
          <svg viewBox="0 0 80 80" className="-rotate-90">
            <circle cx="40" cy="40" r="31" fill="none" stroke="rgba(255,122,47,0.22)" strokeWidth="7" />
            <motion.circle cx="40" cy="40" r="31" fill="none" stroke="#FF7A2F" strokeLinecap="round" strokeWidth="7" animate={{ pathLength: progress }} />
          </svg>
          <span className="absolute text-appOrange">{running ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</span>
        </button>
        <div>
          <p className="text-[11px] font-bold uppercase text-appMuted">Отдых</p>
          <p className="mt-1 text-[28px] font-black text-appText">{formatTime(seconds)}</p>
          <p className="text-[11px] text-appMuted">из 01:30</p>
        </div>
        <button type="button" onClick={onSkip} className="h-9 rounded-full border border-appBorder bg-appBg px-3 text-[11px] font-semibold text-appOrange">
          {running ? "Пропустить" : "Готово"}
        </button>
      </div>
    </motion.section>
  );
}

function softBeep(kind = "tick", muted = false) {
  if (muted) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const frequencies = { start: 520, tick: 680, end: 360, rest: 460 };
    oscillator.frequency.value = frequencies[kind] || 520;
    oscillator.type = "sine";
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.16);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.18);
  } catch (_) {
    // Audio can be blocked until the first user gesture; the timer still works.
  }
}

function isStaticExercise(exercise) {
  const name = String(exercise?.exercise_name || exercise?.name || "").toLowerCase();
  return ["планка", "статик", "удерж", "изометр"].some((word) => name.includes(word));
}

function Stepper({ label, value, onChange, min = 1, max = 12, suffix = "" }) {
  const canDecrease = value > min;
  const canIncrease = value < max;
  return (
    <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.055] px-3 py-2">
      <span className="text-[11px] font-bold uppercase text-white/54">{label}</span>
      <div className="flex items-center gap-2">
        <button type="button" disabled={!canDecrease} onClick={() => onChange(Math.max(min, value - 1))} className="grid h-7 w-7 place-items-center rounded-full bg-white/10 text-white disabled:opacity-35">-</button>
        <span className="min-w-[58px] text-center text-[13px] font-black text-white">{value}{suffix}</span>
        <button type="button" disabled={!canIncrease} onClick={() => onChange(Math.min(max, value + 1))} className="grid h-7 w-7 place-items-center rounded-full bg-white/10 text-white disabled:opacity-35">+</button>
      </div>
    </div>
  );
}

function RestWheelPicker({ value, onChange }) {
  const minutes = Array.from({ length: 6 }, (_, index) => index);
  const seconds = Array.from({ length: 12 }, (_, index) => index * 5);
  const selectedMinute = Math.floor(value / 60);
  const selectedSecond = value % 60;
  const choose = (minute, second) => onChange(Math.max(5, minute * 60 + second));
  const dragProps = {
    onPointerDown: (event) => {
      const node = event.currentTarget;
      node.setPointerCapture?.(event.pointerId);
      node.dataset.dragY = String(event.clientY);
      node.dataset.dragScrollTop = String(node.scrollTop);
    },
    onPointerMove: (event) => {
      const node = event.currentTarget;
      if (!node.dataset.dragY) return;
      node.scrollTop = Number(node.dataset.dragScrollTop || 0) - (event.clientY - Number(node.dataset.dragY));
    },
    onPointerUp: (event) => {
      const node = event.currentTarget;
      node.releasePointerCapture?.(event.pointerId);
      delete node.dataset.dragY;
      delete node.dataset.dragScrollTop;
    },
    onPointerCancel: (event) => {
      const node = event.currentTarget;
      node.releasePointerCapture?.(event.pointerId);
      delete node.dataset.dragY;
      delete node.dataset.dragScrollTop;
    },
  };
  function scrollIndex(event, maxIndex) {
    return Math.max(0, Math.min(maxIndex, Math.round((event.currentTarget.scrollTop - 34) / 40)));
  }
  return (
    <div className="rounded-[18px] bg-white/[0.055] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase text-white/54">Отдых</span>
        <span className="text-[13px] font-black text-white">{formatTime(value)}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div {...dragProps} onScroll={(event) => choose(minutes[scrollIndex(event, minutes.length - 1)], selectedSecond)} className="no-scrollbar max-h-[120px] cursor-grab snap-y snap-mandatory overflow-y-auto rounded-[14px] bg-black/16 px-1 py-[34px] active:cursor-grabbing">
          {minutes.map((minute) => (
            <button key={minute} type="button" onClick={() => choose(minute, selectedSecond)} className={`mb-1 h-9 w-full snap-center rounded-xl text-[13px] font-black ${minute === selectedMinute ? "bg-appGreen text-[#181F19]" : "text-white/62"}`}>
              {minute} мин
            </button>
          ))}
        </div>
        <div {...dragProps} onScroll={(event) => choose(selectedMinute, seconds[scrollIndex(event, seconds.length - 1)])} className="no-scrollbar max-h-[120px] cursor-grab snap-y snap-mandatory overflow-y-auto rounded-[14px] bg-black/16 px-1 py-[34px] active:cursor-grabbing">
          {seconds.map((second) => (
            <button key={second} type="button" onClick={() => choose(selectedMinute, second)} className={`mb-1 h-9 w-full snap-center rounded-xl text-[13px] font-black ${second === selectedSecond ? "bg-appGreen text-[#181F19]" : "text-white/62"}`}>
              {String(second).padStart(2, "0")} сек
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function WorkoutReport({ workoutId, workoutTitle, workoutCycle = {} }) {
  const { health, syncNativeHealth } = useHealth();
  const savedReport = readWorkoutReport(workoutId, workoutCycle);
  const [report, setReport] = useState(() => initialReportScores(savedReport));
  const [saved, setSaved] = useState(Boolean(savedReport));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [serverStatus, setServerStatus] = useState(() => savedReport?.serverStatus || (savedReport?.serverReportId ? "sent" : ""));
  const normalizedScores = normalizeClientReportScores(report, 0);
  const hasScores = Object.values(normalizedScores).some((value) => Number(value || 0) > 0);
  const liveHealthSnapshot = workoutHealthSnapshot(health);
  const canSendToTrainer = Boolean(getAuthToken());
  const waitingForSend = serverStatus === "pending";

  function update(key, value) {
    setSaved(false);
    setStatus("");
    setServerStatus("");
    setReport((current) => ({ ...current, [key]: value }));
  }

  async function submit() {
    const scores = buildClientReportScores(report);
    const payload = {
      kind: "workout_checkin",
      source: "post-workout",
      submittedAt: new Date().toISOString(),
      scores,
      workout: {
        id: workoutId,
        title: workoutTitle || "",
      },
      noMedicalConclusions: true,
    };
    setSaving(true);
    try {
      let reportHealth = health;
      if (canSendToTrainer && syncNativeHealth) {
        setStatus("Готовим отчёт...");
        try {
          await syncNativeHealth({ force: true, reason: "post-workout-report-submit", queryMode: "history", bypassCooldown: true });
          await new Promise((resolve) => window.setTimeout(resolve, 60));
          reportHealth = readFreshWorkoutHealth(health);
        } catch (_) {
          reportHealth = readFreshWorkoutHealth(health);
        }
      }
      const healthSnapshot = workoutHealthSnapshot(reportHealth);
      const serverPayload = {
        ...payload,
        health: healthSnapshot,
        healthSummary: healthSnapshot.summary,
      };
      const localPayload = { ...serverPayload, saved_at: new Date().toISOString() };
      saveWorkoutReport(workoutId, { ...localPayload, serverStatus: canSendToTrainer ? "pending" : "local" }, workoutCycle);
      setReport(scores);
      setSaved(true);
      setServerStatus(canSendToTrainer ? "pending" : "local");
      if (!canSendToTrainer) {
        setStatus("Отчёт сохранён. Войди в аккаунт, чтобы отправить его мне.");
        return;
      }
      try {
        const item = await submitTrainerReport(serverPayload);
        saveWorkoutReport(workoutId, {
          ...localPayload,
          serverStatus: "sent",
          serverReportId: item?.id || null,
          sent_at: new Date().toISOString(),
        }, workoutCycle);
        setServerStatus("sent");
        setStatus("Отчёт отправлен.");
      } catch (sendError) {
        console.warn("[FruitFit Workout] trainer report submit failed", sendError);
        const authExpired = trainerReportAuthExpired(sendError);
        const nextServerStatus = authExpired ? "auth_required" : "pending";
        saveWorkoutReport(workoutId, {
          ...localPayload,
          serverStatus: nextServerStatus,
          serverError: sendError?.message || "send_failed",
          serverErrorStatus: sendError?.status || null,
        }, workoutCycle);
        setServerStatus(nextServerStatus);
        setStatus(authExpired
          ? "Сессия истекла. Войди заново, затем отправь отчёт."
          : "Отчёт сохранён. Нажми «Отправить ещё раз», когда связь восстановится.");
      }
    } catch (error) {
      console.warn("[FruitFit Workout] report save failed", error);
      saveWorkoutReport(workoutId, { ...payload, saved_at: new Date().toISOString() }, workoutCycle);
      setSaved(true);
      setStatus("Отчёт сохранён.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="workout-report-card mt-4 rounded-[20px] border border-appBorder p-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[13px] font-black text-appText">Отчёт после тренировки</p>
          <p className="text-[10px] font-bold text-appMuted">необязательно</p>
        </div>
        {saved && <span className="rounded-full bg-appGreen/35 px-2 py-1 text-[10px] font-black text-[#476B18]">{serverStatus === "sent" ? "Отправлен" : waitingForSend ? "Ожидает" : "Сохранён"}</span>}
      </div>

      <div className="mt-2">
        <ClientReportSliders values={report} onChange={update} compact disabled={saving} />
      </div>
      <p className="mt-2 rounded-2xl bg-appBg px-3 py-2 text-[11px] font-bold leading-4 text-appMuted">
        {liveHealthSnapshot.summary.latestBpm
          ? `Пульс учтён: ${pulseStatus(liveHealthSnapshot)}`
          : "Данные активности добавятся к отчёту, когда будут доступны."}
      </p>

      <button type="button" onClick={submit} disabled={!hasScores || saving} className="mt-2 h-10 w-full rounded-full bg-appGreen text-[12px] font-black text-[#181F19] disabled:bg-appBorder disabled:text-appMuted">
        {saving ? "Отправляем..." : canSendToTrainer ? (waitingForSend ? "Отправить ещё раз" : "Отправить отчёт") : "Сохранить отчёт"}
      </button>
      {status && <p className="mt-2 rounded-2xl bg-appBg px-3 py-2 text-[11px] font-bold leading-4 text-appMuted">{status}</p>}
    </section>
  );
}

function WorkRestTimer({
  exercise,
  phase,
  prestartSeconds,
  workSeconds,
  restSeconds,
  workDuration,
  restDuration,
  setTotal,
  currentSet,
  muted,
  onStartWork,
  onPause,
  onResume,
  onReset,
  onFinish,
  onWorkDurationChange,
  onRestDurationChange,
  onSetTotalChange,
  onMuteToggle,
}) {
  const running = phase === "work" || phase === "rest";
  const paused = phase === "workPaused" || phase === "restPaused";
  const done = phase === "done";
  const prestarting = phase === "prestart";
  const resting = phase === "rest" || phase === "restPaused";
  const working = phase === "work" || phase === "workPaused";
  const total = prestarting ? 3 : resting ? restDuration : workDuration;
  const value = prestarting ? prestartSeconds : resting ? restSeconds : workSeconds;
  const progress = total ? Math.max(0, Math.min(value / total, 1)) : 0;
  const staticMode = isStaticExercise(exercise);
  const label = paused ? "Пауза" : done ? "Готово" : prestarting ? "Старт" : resting ? "Отдых" : working ? "Работа" : "Готов";
  const ringColor = resting ? "#6CB6FF" : prestarting ? "#F0C84A" : value <= 10 && working ? "#F0C84A" : "#9BE85F";

  return (
    <motion.section layout className="rounded-[24px] border border-white/10 bg-[#111811] p-4 text-white shadow-card">
      <div className="grid grid-cols-[132px_1fr] items-center gap-4">
        <div className="relative h-[132px] w-[132px]">
          <svg viewBox="0 0 132 132" className="-rotate-90">
            <circle cx="66" cy="66" r="54" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="9" />
            <motion.circle cx="66" cy="66" r="54" fill="none" stroke={ringColor} strokeLinecap="round" strokeWidth="9" animate={{ pathLength: progress }} transition={{ duration: 0.65, ease: "easeInOut" }} />
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="text-[9px] font-black uppercase tracking-wide text-white/48">{label}</p>
              <p className="mt-1 text-[23px] font-black leading-none text-white">{formatTime(value)}</p>
              <p className="mt-1 text-[10px] leading-none text-white/46">подход {currentSet}/{setTotal}</p>
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[12px] font-bold uppercase text-appGreen">{staticMode ? "Статический режим" : "Силовой режим"}</p>
              <p className="mt-1 text-[12px] leading-4 text-white/58">Работа → отдых → следующий подход</p>
            </div>
            <button type="button" onClick={onMuteToggle} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-white/70">
              {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
            </button>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {[30, 45, 60].map((seconds) => (
              <button key={seconds} type="button" onClick={() => onWorkDurationChange(seconds)} className={`h-8 rounded-full text-[12px] font-bold ${workDuration === seconds ? "bg-appGreen text-[#181F19]" : "bg-white/9 text-white/66"}`}>
                {seconds}с
              </button>
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            {!running && !paused && !done && !prestarting && (
              <button type="button" onClick={onStartWork} className="h-11 flex-1 rounded-full bg-appGreen text-[14px] font-black text-[#181F19]">
                Начать работу
              </button>
            )}
            {running && (
              <button type="button" onClick={onPause} className="h-11 flex-1 rounded-full bg-appGreen text-[14px] font-black text-[#181F19]">
                Пауза
              </button>
            )}
            {prestarting && (
              <button type="button" onClick={onPause} className="h-11 flex-1 rounded-full bg-white/10 text-[14px] font-black text-white">
                Подготовка
              </button>
            )}
            {paused && (
              <button type="button" onClick={onResume} className="h-11 flex-1 rounded-full bg-appGreen text-[14px] font-black text-[#181F19]">
                Продолжить
              </button>
            )}
            {done && (
              <button type="button" onClick={onFinish} className="h-11 flex-1 rounded-full bg-appGreen text-[14px] font-black text-[#181F19]">
                Готово
              </button>
            )}
            <button type="button" onClick={onReset} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/10 text-white">
              <RotateCcw size={17} />
            </button>
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-2">
        <RestWheelPicker value={restDuration} onChange={onRestDurationChange} />
        <Stepper label="Подходы" value={setTotal} min={1} max={8} onChange={onSetTotalChange} />
      </div>
    </motion.section>
  );
}

function WeightInput({ exercise, setNumber, initialWeight, sessionValue, disabled = false, onValueChange }) {
  const saved = getExerciseWeight(exercise, setNumber);
  const [value, setValue] = useState(sessionValue ?? saved?.lastWeight ?? initialWeight ?? "");
  const [savedPulse, setSavedPulse] = useState(false);

  useEffect(() => {
    setValue(sessionValue ?? getExerciseWeight(exercise, setNumber)?.lastWeight ?? initialWeight ?? "");
  }, [exercise, initialWeight, sessionValue, setNumber]);

  function update(nextValue) {
    if (disabled) return;
    const clean = String(nextValue).replace(/[^\d.]/g, "");
    setValue(clean);
    onValueChange?.(clean === "" ? null : Number(clean));
    const entry = saveExerciseWeight(exercise, clean, setNumber);
    if (entry) {
      setSavedPulse(true);
      window.setTimeout(() => setSavedPulse(false), 900);
    }
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <button type="button" disabled={disabled} onClick={() => update(Math.max(0, Number(value || 0) - 2.5))} className="grid h-7 w-7 place-items-center rounded-full bg-appBg text-appMuted disabled:opacity-40">-</button>
      <label className={`flex h-8 w-[70px] items-center rounded-full border bg-appCard px-2 transition ${savedPulse ? "border-[#8BBE3D] shadow-glow" : "border-appBorder"}`}>
        <input disabled={disabled} aria-label={`Вес подход ${setNumber}`} value={value} onChange={(event) => update(event.target.value)} inputMode="decimal" className="min-w-0 flex-1 bg-transparent text-center text-[12px] font-bold text-appText outline-none disabled:opacity-50" />
        <span className="text-[10px] text-appMuted">кг</span>
      </label>
      <button type="button" disabled={disabled} onClick={() => update(Number(value || 0) + 2.5)} className="grid h-7 w-7 place-items-center rounded-full bg-appBg text-appMuted disabled:opacity-40">+</button>
    </div>
  );
}

function SetsTable({ current, exerciseState, setRows, completedSets, currentSet, disabled = false, onSetValueChange }) {
  const saved = getExerciseWeight(current);
  const initialWeight = current?.weight ? Number(String(current.weight).replace(/[^\d.]/g, "")) : "";

  return (
    <section className="sets-table-panel mt-4 rounded-[20px] border border-appBorder p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[12px] font-bold uppercase tracking-wide text-appMuted">Подходы</h3>
        {saved?.lastWeight && <span className="inline-flex items-center gap-1 rounded-full bg-appGreen/50 px-2 py-1 text-[10px] font-bold text-[#181F19]"><History size={11} /> последний вес</span>}
      </div>
      <div className="space-y-1">
        {setRows.map((set, index) => {
          const status = set <= completedSets ? "completed" : set === currentSet ? "current" : "upcoming";
          return (
            <div key={set} className={`sets-table-row grid grid-cols-[64px_64px_1fr_24px] items-center gap-2 rounded-xl px-2 py-2 text-[13px] ${index % 2 ? "sets-table-row-alt" : ""} ${status === "current" ? "sets-table-row-current" : ""}`}>
              <span className="font-semibold text-appText">Подход {set}</span>
              <label className="flex h-8 items-center rounded-full border border-appBorder bg-appCard px-2">
                <input
                  aria-label={`Повторения подход ${set}`}
                  disabled={disabled}
                  value={exerciseState?.sets?.[set - 1]?.reps ?? current.reps ?? ""}
                  onChange={(event) => onSetValueChange?.(set, { reps: event.target.value === "" ? null : Math.max(0, Number(event.target.value) || 0) })}
                  inputMode="numeric"
                  className="min-w-0 flex-1 bg-transparent text-center text-[12px] font-bold text-appText outline-none disabled:opacity-50"
                />
                <span className="text-[9px] text-appMuted">раз</span>
              </label>
              <WeightInput
                exercise={current}
                setNumber={set}
                initialWeight={initialWeight}
                sessionValue={exerciseState?.sets?.[set - 1]?.weight}
                disabled={disabled}
                onValueChange={(weight) => onSetValueChange?.(set, { weight })}
              />
              <span className={`grid h-5 w-5 place-items-center rounded-full ${status === "completed" ? "bg-appGreen text-[#181F19]" : "border border-appBorder"}`}>
                {status === "completed" && <Check size={13} />}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AlternativesModal({ exercise, reason, catalog, profile, onSelect, onClose }) {
  const alternative = getExerciseAlternatives(exercise, reason, catalog, profile);
  const metaLine = [alternative.muscleGroup, alternative.movementPattern, alternative.equipment].filter(Boolean).join(" • ");

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 grid place-items-end bg-black/34 px-3 pb-4">
        <motion.section initial={{ y: 28 }} animate={{ y: 0 }} exit={{ y: 28 }} className="w-full max-w-[369px] rounded-[28px] bg-appCard p-4 shadow-soft">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase text-appMuted">{alternative.reason}</p>
              <h2 className="mt-1 line-clamp-2 text-[20px] font-black text-appText">{exercise.exercise_name}</h2>
              <p className="mt-2 text-[12px] text-appMuted">{metaLine || "нужна ручная проверка"}</p>
            </div>
            <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-appBg text-appText"><X size={18} /></button>
          </div>

          <div className="mt-4 space-y-2">
            {alternative.alternatives.map((item, index) => (
              <button key={item.exercise_name} type="button" onClick={() => onSelect(item)} className="grid min-h-[60px] w-full grid-cols-[32px_1fr_24px] items-center gap-3 rounded-[18px] border border-appBorder bg-appBg px-3 text-left shadow-sm transition hover:border-appGreen/60 hover:bg-appGreen/10 active:scale-[0.99]">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-appGreen text-[12px] font-black text-[#181F19]">{index + 1}</span>
                <span className="text-[14px] font-bold text-appText">{item.exercise_name}</span>
                <ChevronRight size={17} className="text-appMuted" />
              </button>
            ))}
            {!alternative.alternatives.length && <p className="rounded-[16px] bg-appBg p-3 text-[13px] font-semibold text-appMuted">Нужна ручная замена: безопасного аналога в базе пока нет.</p>}
          </div>

          {alternative.cautionAlternatives?.length > 0 && (
            <div className="mt-4 rounded-[18px] border border-appOrange/30 bg-appOrange/10 p-3">
              <p className="text-[12px] font-black text-appText">Варианты с осторожностью</p>
              <p className="mt-1 text-[11px] leading-4 text-appMuted">Можно выполнять, если сейчас нет боли/дискомфорта. При дискомфорте выберите более безопасную замену.</p>
              <div className="mt-2 space-y-2">
                {alternative.cautionAlternatives.map((item) => (
                  <button key={item.exercise_name} type="button" onClick={() => onSelect(item)} className="w-full rounded-[14px] border border-appOrange/25 bg-appCard px-3 py-2 text-left text-[13px] font-bold text-appText transition hover:border-appOrange/60 active:scale-[0.99]">
                    {item.exercise_name}
                  </button>
                ))}
              </div>
            </div>
          )}

          
        </motion.section>
      </motion.div>
    </AnimatePresence>
  );
}

const warmupIcons = {
  neck: "/warmup-icons/neck.png",
  shoulders: "/warmup-icons/shoulders.png",
  shoulder: "/warmup-icons/shoulders.png",
  elbow: "/warmup-icons/elbow.png",
  pelvis: "/warmup-icons/pelvis.png",
  hip: "/warmup-icons/pelvis.png",
  knees: "/warmup-icons/knees.png",
  knee: "/warmup-icons/knees.png",
  ankle: "/warmup-icons/ankle.png",
};

function JointMotionIcon({ type, label }) {
  const src = warmupIcons[type];

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-[15px] border border-white/10 bg-black shadow-[0_10px_28px_rgba(0,0,0,0.22)]">
      {src ? (
        <img
          src={src}
          alt={label || ""}
          loading="lazy"
          className="h-full w-full object-contain"
        />
      ) : (
        <div className="grid h-full w-full place-items-center text-appGreen">
          <Activity size={22} />
        </div>
      )}
    </div>
  );
}


function WarmupBlock() {
  const [expanded, setExpanded] = useState(false);

  const text = {
    badge: "\u0420\u0430\u0437\u043c\u0438\u043d\u043a\u0430",
    duration: "5\u201310 \u043c\u0438\u043d",
    title: "\u041f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u043a\u0430 \u043a \u0442\u0440\u0435\u043d\u0438\u0440\u043e\u0432\u043a\u0435",
    description: "\u041b\u0435\u0433\u043a\u043e\u0435 \u043a\u0430\u0440\u0434\u0438\u043e \u0438 \u0441\u0443\u0441\u0442\u0430\u0432\u044b \u043f\u0435\u0440\u0435\u0434 \u043f\u0435\u0440\u0432\u044b\u043c \u043f\u043e\u0434\u0445\u043e\u0434\u043e\u043c.",
    section: "\u0421\u0443\u0441\u0442\u0430\u0432\u043d\u0430\u044f \u0440\u0430\u0437\u043c\u0438\u043d\u043a\u0430",
    sectionCaption: "\u041e\u0434\u0438\u043d \u0441\u043f\u043e\u043a\u043e\u0439\u043d\u044b\u0439 \u043a\u0440\u0443\u0433 \u0441\u0432\u0435\u0440\u0445\u0443 \u0432\u043d\u0438\u0437",
    zones: "6 \u0437\u043e\u043d",
    show: "\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u0440\u0430\u0437\u043c\u0438\u043d\u043a\u0443",
    hide: "\u0421\u043a\u0440\u044b\u0442\u044c \u0440\u0430\u0437\u043c\u0438\u043d\u043a\u0443",
  };

  const warmupJoints = [
    { label: "\u0428\u0435\u044f", reps: "8\u201310 \u043a\u0440\u0443\u0433\u043e\u0432", type: "neck" },
    { label: "\u041f\u043b\u0435\u0447\u0438", reps: "10 \u0440\u0430\u0437 \u0432 \u043a\u0430\u0436\u0434\u0443\u044e", type: "shoulders" },
    { label: "\u041b\u043e\u043a\u0442\u0438", reps: "10 \u043a\u0440\u0443\u0433\u043e\u0432", type: "elbow" },
    { label: "\u0422\u0430\u0437", reps: "8\u201310 \u043a\u0440\u0443\u0433\u043e\u0432", type: "pelvis" },
    { label: "\u041a\u043e\u043b\u0435\u043d\u0438", reps: "\u043c\u0430\u043b\u044b\u0439 \u043a\u0440\u0443\u0433", type: "knees" },
    { label: "\u0413\u043e\u043b\u0435\u043d\u043e\u0441\u0442\u043e\u043f", reps: "\u043a\u0430\u0436\u0434\u0430\u044f \u043d\u043e\u0433\u0430", type: "ankle" },
  ];

  const tips = [
    { icon: <Clock size={18} strokeWidth={2.4} />, label: "\u0421\u043f\u043e\u043a\u043e\u0439\u043d\u044b\u0439", caption: "\u0442\u0435\u043c\u043f" },
    { icon: <Leaf size={18} strokeWidth={2.4} />, label: "\u0411\u0435\u0437 \u0440\u0435\u0437\u043a\u0438\u0445", caption: "\u0434\u0432\u0438\u0436\u0435\u043d\u0438\u0439" },
    { icon: <Activity size={18} strokeWidth={2.4} />, label: "\u0414\u044b\u0448\u0438\u0442\u0435", caption: "\u0440\u043e\u0432\u043d\u043e" },
  ];

  const cardioNotes = [
    "\u041f\u0435\u0440\u0435\u0434 \u0442\u0440\u0435\u043d\u0438\u0440\u043e\u0432\u043a\u043e\u0439: 5\u201310 \u043c\u0438\u043d\u0443\u0442 \u043b\u0435\u0433\u043a\u043e\u0433\u043e \u043a\u0430\u0440\u0434\u0438\u043e.",
    "\u041f\u043e\u0441\u043b\u0435 \u0442\u0440\u0435\u043d\u0438\u0440\u043e\u0432\u043a\u0438: 5\u201310 \u043c\u0438\u043d\u0443\u0442 \u0437\u0430\u043c\u0438\u043d\u043a\u0438.",
    "\u0415\u0441\u043b\u0438 \u0446\u0435\u043b\u044c \u2014 \u043f\u043e\u0445\u0443\u0434\u0435\u043d\u0438\u0435: \u043c\u0438\u043d\u0438\u043c\u0443\u043c 20 \u043c\u0438\u043d\u0443\u0442 \u043a\u0430\u0440\u0434\u0438\u043e \u043f\u043e\u0441\u043b\u0435 \u0442\u0440\u0435\u043d\u0438\u0440\u043e\u0432\u043a\u0438 \u0441 \u043f\u043e\u0441\u0442\u0435\u043f\u0435\u043d\u043d\u044b\u043c \u0443\u0432\u0435\u043b\u0438\u0447\u0435\u043d\u0438\u0435\u043c \u0434\u043e 60 \u043c\u0438\u043d\u0443\u0442.",
  ];

  return (
    <div className="mt-4 overflow-hidden rounded-[28px] border border-appGreen/20 bg-[#07110A] shadow-[0_18px_46px_rgba(0,0,0,0.28)] transition-all duration-300">
      <div onClick={() => setExpanded(!expanded)} className="relative flex cursor-pointer select-none items-center gap-4 overflow-hidden p-4">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(221,247,180,0.16),transparent_34%),linear-gradient(135deg,rgba(221,247,180,0.08),transparent_52%)]" />
        <div className="relative grid h-[56px] w-[56px] shrink-0 place-items-center rounded-[22px] border border-appGreen/45 bg-appGreen/10 text-appGreen shadow-[0_0_28px_rgba(221,247,180,0.16)]">
          <Activity size={27} strokeWidth={2.35} />
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded-full bg-appGreen/18 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-appGreen">{text.badge}</span>
            <span className="text-[11px] font-black text-[#ECF8DE]">{text.duration}</span>
          </div>
          <h3 className="text-[18px] font-black leading-[1.05] tracking-tight text-[#F8FFE8] [text-shadow:0_1px_2px_rgba(0,0,0,0.55)]">{text.title}</h3>
          <p className="mt-1 max-w-[220px] text-[12px] font-bold leading-[1.35] text-[#DDEECF]">{text.description}</p>
        </div>
        <button type="button" className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.10] text-white transition-transform duration-300" style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}>
          <ChevronDown size={22} />
        </button>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="border-t border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(0,0,0,0.14))]">
            <div className="p-4 pb-5 pt-5">
              <div className="mb-4 flex items-end justify-between gap-3">
                <div>
                  <h4 className="text-[11px] font-black uppercase tracking-[0.18em] text-[#F8FFE8]">{text.section}</h4>
                  <p className="mt-1 text-[11px] font-bold text-[#DDEECF]">{text.sectionCaption}</p>
                </div>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-black text-appGreen">{text.zones}</span>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                {warmupJoints.map((joint, idx) => (
                  <motion.div key={joint.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.035, duration: 0.22 }} className="min-h-[122px] rounded-[20px] border border-white/14 bg-white/[0.07] p-2.5 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                    <JointMotionIcon type={joint.type} label={joint.label} />
                    <p className="mt-2.5 truncate text-[12px] font-black leading-tight tracking-tight text-[#F8FFE8] [text-shadow:0_1px_1px_rgba(0,0,0,0.45)]">{joint.label}</p>
                    <p className="mt-0.5 text-[10px] font-black uppercase leading-tight tracking-[0.02em] text-[#DDEECF] [text-shadow:0_1px_1px_rgba(0,0,0,0.45)]">{joint.reps}</p>
                  </motion.div>
                ))}
              </div>

              <div className="mt-5 grid grid-cols-3 gap-2.5 border-t border-white/10 pt-4">
                {tips.map((tip) => (
                  <div key={tip.label} className="rounded-[18px] bg-white/[0.07] px-2 py-3 text-center">
                    <div className="mx-auto grid h-8 w-8 place-items-center rounded-full bg-appGreen/12 text-appGreen">{tip.icon}</div>
                    <p className="mt-2 text-[10px] font-black uppercase leading-tight tracking-[0.04em] text-[#F8FFE8] [text-shadow:0_1px_1px_rgba(0,0,0,0.45)]">{tip.label}</p>
                    <p className="mt-0.5 text-[10px] font-bold leading-tight text-[#C9DAC0]">{tip.caption}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 space-y-2 rounded-[20px] border border-white/10 bg-white/[0.035] p-3">
                {cardioNotes.map((note) => (
                  <p key={note} className="text-[11px] font-bold leading-5 text-[#ECF8DE] [text-shadow:0_1px_1px_rgba(0,0,0,0.38)]">{note}</p>
                ))}
              </div>

              <button type="button" onClick={() => setExpanded(false)} className="mt-4 flex h-[50px] w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.035] text-[13px] font-black text-appGreen transition-all active:scale-[0.97]">
                {text.hide} <ChevronUp size={18} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function WorkoutScreen({ program, workout, profile, access, programAssignment, workoutCycle = {}, selectedWorkoutIndex = 0, mode = "workout", onBack, onNavigate, onSelectWorkout }) {
  const workoutCycleKey = cycleIdentity(workoutCycle);
  const [workoutSession, setWorkoutSession] = useState(() => loadDurableWorkoutSession(workout, program, workoutCycle));
  const [currentIndex, setCurrentIndex] = useState(() => selectedExerciseIndex(workoutSession, workout.exercises));
  const [completed, setCompleted] = useState(() => completedExerciseIds(workoutSession));
  const initialExerciseId = stableExerciseId(workout.exercises?.[currentIndex] || {}, currentIndex);
  const [completedSets, setCompletedSets] = useState(() => completedSetCount(workoutSession, initialExerciseId));
  const initialTimer = workoutSession?.timer || {};
  const [phase, setPhase] = useState(() => restoredPhase(initialTimer.phase));
  const [alternativeReason, setAlternativeReason] = useState("");
  const [setSeconds, setSetSeconds] = useState(() => restoredNumber(timerRemainingSeconds(initialTimer), SET_TARGET_SECONDS, 0, 3600));
  const [restSeconds, setRestSeconds] = useState(() => restoredNumber(timerRemainingSeconds(initialTimer), REST_SECONDS, 0, 3600));
  const [prestartSeconds, setPrestartSeconds] = useState(3);
  const [workDuration, setWorkDuration] = useState(() => restoredNumber(initialTimer.duration_seconds, SET_TARGET_SECONDS, 1, 3600));
  const [restDuration, setRestDuration] = useState(REST_SECONDS);
  const [timerSetTotal, setTimerSetTotal] = useState(() => Math.max(1, Number(workout.exercises?.[currentIndex]?.sets) || 1));
  const [timerEndsAt, setTimerEndsAt] = useState(initialTimer.ends_at || null);
  const [muted, setMuted] = useState(false);
  const [exerciseNotes, setExerciseNotes] = useState(() => workoutSession?.exercises?.[initialExerciseId]?.notes || "");
  const [activationConflict, setActivationConflict] = useState(null);
  const [draftMenuOpen, setDraftMenuOpen] = useState(false);
  const [replacements, setReplacements] = useState(() => readReplacements(workout.workout_id, workoutCycle));
  const skipExerciseTimerResetRef = useRef(Boolean(workoutSession));

  useEffect(() => {
    const nextSession = loadDurableWorkoutSession(workout, program, workoutCycle);
    const nextIndex = selectedExerciseIndex(nextSession, workout.exercises);
    const nextExerciseId = stableExerciseId(workout.exercises?.[nextIndex] || {}, nextIndex);
    const nextTimer = nextSession?.timer || {};
    const remaining = timerRemainingSeconds(nextTimer);
    setWorkoutSession(nextSession);
    setCurrentIndex(nextIndex);
    setCompleted(completedExerciseIds(nextSession));
    setCompletedSets(completedSetCount(nextSession, nextExerciseId));
    setPhase(remaining <= 0 && ["work", "rest", "prestart"].includes(nextTimer.phase) ? "done" : restoredPhase(nextTimer.phase));
    setSetSeconds(restoredNumber(remaining, SET_TARGET_SECONDS, 0, 3600));
    setRestSeconds(restoredNumber(remaining, REST_SECONDS, 0, 3600));
    setPrestartSeconds(nextTimer.phase === "prestart" ? Math.min(3, remaining) : 3);
    setWorkDuration(restoredNumber(nextTimer.duration_seconds, SET_TARGET_SECONDS, 1, 3600));
    setRestDuration(REST_SECONDS);
    setTimerSetTotal(Math.max(1, Number(workout.exercises?.[nextIndex]?.sets) || 1));
    setTimerEndsAt(nextTimer.ends_at || null);
    setExerciseNotes(nextSession?.exercises?.[nextExerciseId]?.notes || "");
    setReplacements(readReplacements(workout.workout_id, workoutCycle));
    skipExerciseTimerResetRef.current = Boolean(nextSession);
  }, [workout.workout_id, workoutCycleKey]);

  const displayExercises = useMemo(() => workout.exercises.map((exercise, index) => {
    const replacement = replacements[String(exercise.exercise_order)];
    return replacement ? {
      ...exercise,
      ...replacement,
      session_exercise_id: stableExerciseId(exercise, index),
      exercise_name: replacement.exercise_name || replacement.name || exercise.exercise_name,
      name: replacement.name || replacement.exercise_name || exercise.exercise_name,
      replacedFrom: exercise.exercise_name,
      sets: exercise.sets,
      reps: exercise.reps,
      weight: exercise.weight,
    } : { ...exercise, session_exercise_id: stableExerciseId(exercise, index) };
  }), [replacements, workout.exercises]);

  const current = displayExercises[currentIndex] || displayExercises[0];
  const currentExerciseId = stableExerciseId(current, currentIndex);
  const currentExerciseState = workoutSession?.exercises?.[currentExerciseId] || null;
  const baseSetTotal = Math.max(1, Math.min(Number(current?.sets) || 1, 8));
  const setTotal = Math.max(1, Math.min(Number(timerSetTotal) || baseSetTotal, 8));
  const currentSet = Math.min(completedSets + 1, setTotal);
  const progress = workoutSession?.progress?.percent || 0;
  const day = workout.lesson?.lesson_number || selectedWorkoutIndex + 1;
  const total = program?.workouts?.length || workout.lessons?.length || 1;
  const visibleWorkouts = useMemo(() => visibleWorkoutsForAccess(program?.workouts || [], access, profile, programAssignment), [access, profile, programAssignment, program?.workouts]);
  const visibleTotal = Math.max(1, visibleWorkouts.length || total);
  const currentVisibleIndex = visibleWorkouts.findIndex((item) => originalWorkoutIndex(program?.workouts || [], item) === selectedWorkoutIndex);
  const visibleSelectedIndex = currentVisibleIndex >= 0 ? currentVisibleIndex : Math.min(selectedWorkoutIndex, visibleTotal - 1);
  const meta = exerciseMeta(current);
  const muscleMapGender = profile?.gender === "male" || String(workout.course?.gender || "").toLowerCase().includes("муж") ? "male" : "female";
  const restrictionState = useMemo(
    () => programRestrictionState({ profile, course: workout.course, programAssignment }),
    [profile, programAssignment, workout.course],
  );
  const setRows = useMemo(() => Array.from({ length: setTotal }, (_, index) => index + 1), [setTotal]);
  const showRest = phase === "restReady" || phase === "rest" || phase === "restPaused";
  const sessionIsActive = workoutSession?.status === "active";
  const syncLabel = workoutSession?.sync_status === "offline"
    ? "Нет сети — сохранено на устройстве"
    : workoutSession?.sync_status === "syncing" || workoutSession?.sync_status === "pending"
      ? "Сохранение…"
      : workoutSession?.sync_status === "error" || workoutSession?.sync_status === "conflict"
        ? "Ошибка синхронизации"
        : "Сохранено";

  useEffect(() => {
    if (!workoutSession?.session_id || !currentExerciseId) return;
    const timestamp = new Date().toISOString();
    const next = updateWorkoutSession(workoutSession.session_id, (session) => {
      const exercise = session.exercises?.[currentExerciseId];
      if (!exercise) return session;
      const sets = exercise.sets.map((set, index) => ({
        ...set,
        completed: index < completedSets,
        reps: index < completedSets && set.reps == null
          ? (Number(String(current?.reps || "").match(/\d+/)?.[0]) || null)
          : set.reps,
        updated_at: index < completedSets ? timestamp : set.updated_at,
      }));
      const hadAction = completedSets > 0 || sets.some((set) => set.weight != null || set.reps != null) || Boolean(exerciseNotes);
      const exerciseStatus = completed.has(currentExerciseId)
        ? "completed"
        : exercise.status === "skipped"
          ? "skipped"
          : hadAction ? "in_progress" : "not_started";
      return {
        ...session,
        selected_exercise_id: currentExerciseId,
        last_opened_exercise_id: currentExerciseId,
        exercises: {
          ...session.exercises,
          [currentExerciseId]: {
            ...exercise,
            status: exerciseStatus,
            sets,
            notes: exerciseNotes,
            completed_at: exerciseStatus === "completed" ? (exercise.completed_at || timestamp) : null,
            updated_at: timestamp,
          },
        },
        timer: {
          phase,
          duration_seconds: phase.startsWith("rest") ? restDuration : workDuration,
          started_at: timerEndsAt ? new Date(new Date(timerEndsAt).getTime() - ((phase.startsWith("rest") ? restDuration : workDuration) * 1000)).toISOString() : null,
          ends_at: timerEndsAt,
          paused_at: phase.endsWith("Paused") ? timestamp : null,
          remaining_seconds: phase.startsWith("rest") ? restSeconds : phase === "prestart" ? prestartSeconds : setSeconds,
          exercise_id: currentExerciseId,
        },
      };
    }, { activate: sessionIsActive });
    if (next) {
      setWorkoutSession(next);
      scheduleWorkoutSessionSync(next.session_id, { userId: next.user_id });
    }
  }, [completed, completedSets, current?.reps, currentExerciseId, exerciseNotes, phase, prestartSeconds, restDuration, restSeconds, sessionIsActive, setSeconds, timerEndsAt, workDuration]);

  useEffect(() => {
    if (!workoutSession?.session_id) return undefined;
    const flush = () => flushWorkoutSessionSync(workoutSession.session_id, { userId: workoutSession.user_id }).catch(() => {});
    const restoreTimer = () => {
      const latest = workoutSessionForWorkout(workout.workout_id, workoutSession.user_id, workoutCycle);
      const timer = latest?.timer || {};
      const remaining = timerRemainingSeconds(timer);
      if (timer.phase === "rest") {
        setRestSeconds(remaining);
        setPhase(remaining > 0 ? "rest" : "idle");
      } else if (timer.phase === "work" || timer.phase === "prestart") {
        setSetSeconds(remaining);
        setPhase(remaining > 0 ? timer.phase : "done");
      }
      setTimerEndsAt(remaining > 0 ? timer.ends_at : null);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
      else restoreTimer();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    let appStateHandle;
    CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) flush();
      else restoreTimer();
    }).then((handle) => {
      appStateHandle = handle;
    }).catch(() => {});
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      appStateHandle?.remove?.();
      flush();
    };
  }, [workoutSession?.session_id, workoutSession?.user_id]);

  useEffect(() => {
    if (!workoutSession?.session_id) return undefined;
    const frame = window.requestAnimationFrame(() => {
      if (workoutSession.scroll_position > 0) window.scrollTo({ top: workoutSession.scroll_position, behavior: "auto" });
    });
    let timer;
    const persistScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        updateWorkoutSession(workoutSession.session_id, { scroll_position: Math.max(0, window.scrollY || 0) }, {
          userId: workoutSession.user_id,
          activate: workoutSession.status === "active",
        });
      }, 250);
    };
    window.addEventListener("scroll", persistScroll, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      window.removeEventListener("scroll", persistScroll);
    };
  }, [workoutSession?.session_id]);

  useEffect(() => {
    console.log("WorkoutScreen parsed data", JSON.stringify({
      selected_program_id: workout.program_id,
      selected_program_title: workout.course.display_name,
      total_workouts_in_program: program?.workouts?.length || workout.lessons?.length || 0,
      workout_id: workout.workout_id,
      first_10_exercise_name: displayExercises.slice(0, 10).map((exercise) => exercise.exercise_name),
    }));
  }, [displayExercises, program, workout]);

  useEffect(() => {
    if (!visibleWorkouts.length) return;
    if (visibleWorkouts.some((item) => item.workout_id === workout.workout_id)) return;
    const fallbackIndex = originalWorkoutIndex(program?.workouts || [], visibleWorkouts[visibleWorkouts.length - 1]);
    onSelectWorkout?.(fallbackIndex >= 0 ? fallbackIndex : visibleWorkouts.length - 1);
  }, [onSelectWorkout, visibleWorkouts, workout.workout_id]);

  useEffect(() => {
    if (skipExerciseTimerResetRef.current) {
      skipExerciseTimerResetRef.current = false;
      return;
    }
    const staticMode = isStaticExercise(current);
    const nextWork = staticMode ? Math.max(30, Math.min(workDuration || 30, 60)) : SET_TARGET_SECONDS;
    const nextRest = staticMode ? Math.max(30, Math.min(restDuration || 60, 90)) : REST_SECONDS;
    setTimerSetTotal(baseSetTotal);
    setWorkDuration(nextWork);
    setRestDuration(nextRest);
    setSetSeconds(nextWork);
    setRestSeconds(nextRest);
    setPrestartSeconds(3);
    setPhase("idle");
  }, [current?.exercise_order, current?.exercise_name]);

  useEffect(() => {
    if (phase !== "prestart") return undefined;
    const id = window.setInterval(() => {
      setPrestartSeconds((value) => {
        if (value <= 1) {
          window.clearInterval(id);
          softBeep("start", muted);
          setSetSeconds(workDuration);
          setTimerEndsAt(new Date(Date.now() + workDuration * 1000).toISOString());
          setPhase("work");
          return 3;
        }
        softBeep("tick", muted);
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase, muted, workDuration]);

  useEffect(() => {
    if (phase !== "work") return undefined;
    const id = window.setInterval(() => {
      setSetSeconds((value) => {
        if (value <= 1) {
          window.clearInterval(id);
          finishWorkInterval();
          return 0;
        }
        if (value === 11 || value <= 4) softBeep("tick", muted);
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase, muted]);

  useEffect(() => {
    if (phase !== "rest") return undefined;
    const id = window.setInterval(() => {
      setRestSeconds((value) => {
        if (value <= 1) {
          window.clearInterval(id);
          softBeep("rest", muted);
          setPhase("idle");
          setTimerEndsAt(null);
          return restDuration;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase, muted, restDuration]);

  function ensureActiveSession() {
    if (!workoutSession) return false;
    if (workoutSession.status === "completed") return false;
    if (workoutSession.status === "active") {
      trackWorkoutStartedOnce(workoutSession, program);
      return true;
    }
    const active = activeWorkoutSession(workoutSession.user_id, workoutCycle);
    if (active && active.session_id !== workoutSession.session_id) {
      setActivationConflict(active);
      return false;
    }
    const activated = updateWorkoutSession(workoutSession.session_id, { status: "active" }, {
      activate: true,
      userId: workoutSession.user_id,
    });
    setWorkoutSession(activated);
    scheduleWorkoutSessionSync(activated.session_id, { userId: activated.user_id, delay: 0 });
    trackWorkoutStartedOnce(activated, program);
    return true;
  }

  function updateCurrentSetValue(setNumber, patch) {
    if (!ensureActiveSession()) return;
    const next = updateWorkoutSession(workoutSession.session_id, (session) => {
      const exercise = session.exercises[currentExerciseId];
      if (!exercise) return session;
      const sets = exercise.sets.map((set, index) => (
        index === setNumber - 1
          ? { ...set, ...patch, updated_at: new Date().toISOString() }
          : set
      ));
      return {
        ...session,
        exercises: {
          ...session.exercises,
          [currentExerciseId]: { ...exercise, status: "in_progress", sets },
        },
      };
    }, { activate: true });
    setWorkoutSession(next);
    scheduleWorkoutSessionSync(next.session_id, { userId: next.user_id });
  }

  function updateExerciseNotes(value) {
    if (!ensureActiveSession()) return;
    setExerciseNotes(value);
    const next = updateWorkoutSession(workoutSession.session_id, (session) => ({
      ...session,
      exercises: {
        ...session.exercises,
        [currentExerciseId]: {
          ...session.exercises[currentExerciseId],
          status: value && session.exercises[currentExerciseId].status === "not_started"
            ? "in_progress"
            : session.exercises[currentExerciseId].status,
          notes: value,
          updated_at: new Date().toISOString(),
        },
      },
    }), { activate: true });
    setWorkoutSession(next);
    scheduleWorkoutSessionSync(next.session_id, { userId: next.user_id });
  }

  function saveReplacement(selected) {
    if (!ensureActiveSession()) return;
    const selectedMeta = selected.exercise_table_meta || selected.category || {};
    const selectedName = selected.exercise_name || selected.name;
    const selectedTemplate = assignMuscleTemplate({ ...selected, exercise_table_meta: selectedMeta });
    const replacement = {
      id: selected.id || selected.exercise_id || selected.tableId || selectedName,
      exercise_id: selected.exercise_id || selected.id || selected.tableId || selectedName,
      exercise_name: selectedName,
      name: selectedName,
      comment: selected.comment,
      raw_line: selected.raw_line,
      preview_url: selected.preview_url,
      thumbnail_url: selected.thumbnail_url,
      image_path: selected.image_path,
      video_url: selected.rf_video_url || selected.rfVideoUrl || selected.video_url || selected.media_url || null,
      rf_video_url: selected.rf_video_url || selected.rfVideoUrl || selected.rfVideoUrl || selected.video_url || null,
      youtube_url: selected.youtube_url || selected.youtubeUrl || null,
      media_url: selected.media_url || null,
      muscle_group: selected.muscle_group || selected.muscleGroup || selectedMeta.muscleGroup || "",
      muscleGroup: selected.muscleGroup || selectedMeta.muscleGroup || "",
      pattern: selected.pattern || selected.movementPattern || selectedMeta.movementPattern || "",
      movementPattern: selected.movementPattern || selectedMeta.movementPattern || "",
      target_zone: selected.target_zone || selected.targetZone || selectedMeta.targetZone || "",
      targetZone: selected.targetZone || selectedMeta.targetZone || "",
      restrictions: selected.restrictions || selectedMeta.restrictions || [],
      muscle_template_id: selectedTemplate.id,
      ...exerciseMuscleMapFields(selected, selectedMeta),
      exercise_table_meta: selected.exercise_table_meta || selectedMeta || null,
      replacement_id: selected.exercise_id || selected.id || selectedName,
    };
    const next = { ...replacements, [String(current.exercise_order)]: replacement };
    setReplacements(next);
    saveReplacements(workout.workout_id, next, workoutCycle);
    setAlternativeReason("");
  }

  function undoReplacement(exerciseOrder) {
    if (!ensureActiveSession()) return;
    const key = String(exerciseOrder);
    const next = { ...replacements };
    delete next[key];
    setReplacements(next);
    saveReplacements(workout.workout_id, next, workoutCycle);
    setAlternativeReason("");
  }

  function startSet() {
    if (!ensureActiveSession()) return;
    setSetSeconds(workDuration);
    setRestSeconds(restDuration);
    setPrestartSeconds(3);
    setTimerEndsAt(new Date(Date.now() + 3000).toISOString());
    softBeep("tick", muted);
    setPhase("prestart");
  }

  function finishExercise() {
    if (!ensureActiveSession()) return;
    if (completedSets < setTotal && !window.confirm(`Отмечено подходов: ${completedSets} из ${setTotal}. Завершить упражнение как есть?`)) return;
    const timestamp = new Date().toISOString();
    const saved = updateWorkoutSession(workoutSession.session_id, (session) => {
      const exercise = session.exercises[currentExerciseId];
      return {
        ...session,
        exercises: {
          ...session.exercises,
          [currentExerciseId]: {
            ...exercise,
            status: "completed",
            completed_at: timestamp,
            updated_at: timestamp,
            sets: exercise.sets.map((set, index) => ({
              ...set,
              completed: index < completedSets,
              updated_at: index < completedSets ? timestamp : set.updated_at,
            })),
          },
        },
      };
    }, { activate: true });
    setWorkoutSession(saved);
    setCompleted(completedExerciseIds(saved));
    scheduleWorkoutSessionSync(saved.session_id, { userId: saved.user_id });
    const nextIndex = displayExercises.findIndex((exercise, index) => (
      index > currentIndex && saved.exercises?.[stableExerciseId(exercise, index)]?.status !== "completed"
    ));
    if (nextIndex >= 0) setCurrentIndex(nextIndex);
    setCompletedSets(0);
    setSetSeconds(workDuration);
    setRestSeconds(restDuration);
    setPrestartSeconds(3);
    setAlternativeReason("");
    setPhase("idle");
    setTimerEndsAt(null);
  }

  function finishWorkInterval() {
    if (!ensureActiveSession()) return;
    const nextCompleted = completedSets + 1;
    setCompletedSets(nextCompleted);
    setSetSeconds(workDuration);
    setTimerEndsAt(null);
    softBeep("end", muted);
    if (nextCompleted >= setTotal) {
      setPhase("done");
    } else {
      setRestSeconds(restDuration);
      setTimerEndsAt(new Date(Date.now() + restDuration * 1000).toISOString());
      setPhase("rest");
    }
  }

  function completeSet() {
    if (phase !== "work" && phase !== "workPaused") return;
    finishWorkInterval();
  }

  function skipRest() {
    if (!ensureActiveSession()) return;
    setRestSeconds(restDuration);
    setPhase("idle");
    setTimerEndsAt(null);
  }

  function resetTimer() {
    if (!ensureActiveSession()) return;
    setSetSeconds(workDuration);
    setRestSeconds(restDuration);
    setPrestartSeconds(3);
    setPhase("idle");
    setTimerEndsAt(null);
  }

  function pauseTimer() {
    if (!ensureActiveSession()) return;
    setPhase((value) => (value === "work" ? "workPaused" : value === "rest" ? "restPaused" : value === "prestart" ? "idle" : value));
    setTimerEndsAt(null);
  }

  function resumeTimer() {
    if (!ensureActiveSession()) return;
    setPhase((value) => {
      const next = value === "workPaused" ? "work" : value === "restPaused" ? "rest" : value;
      const seconds = next === "rest" ? restSeconds : setSeconds;
      if (next === "work" || next === "rest") setTimerEndsAt(new Date(Date.now() + seconds * 1000).toISOString());
      return next;
    });
  }

  function changeWorkDuration(seconds) {
    if (!ensureActiveSession()) return;
    setWorkDuration(seconds);
    if (phase === "idle") setSetSeconds(seconds);
  }

  function changeRestDuration(seconds) {
    if (!ensureActiveSession()) return;
    setRestDuration(seconds);
    if (phase === "idle") setRestSeconds(seconds);
  }

  function jumpToExercise(exercise) {
    const index = displayExercises.findIndex((item) => item.exercise_order === exercise.exercise_order);
    if (index >= 0) {
      const nextExerciseId = stableExerciseId(displayExercises[index], index);
      setCurrentIndex(index);
      setCompletedSets(completedSetCount(workoutSession, nextExerciseId));
      setExerciseNotes(workoutSession?.exercises?.[nextExerciseId]?.notes || "");
    }
  }

  function goToPreviousExercise() {
    if (currentIndex <= 0) return;
    jumpToExercise(displayExercises[currentIndex - 1]);
  }

  function goToNextExercise() {
    const after = displayExercises.findIndex((exercise, index) => (
      index > currentIndex && workoutSession?.exercises?.[stableExerciseId(exercise, index)]?.status !== "completed"
    ));
    const before = after >= 0 ? -1 : displayExercises.findIndex((exercise, index) => (
      index < currentIndex && workoutSession?.exercises?.[stableExerciseId(exercise, index)]?.status !== "completed"
    ));
    const nextIndex = after >= 0 ? after : before;
    if (nextIndex >= 0) jumpToExercise(displayExercises[nextIndex]);
  }

  function skipCurrentExercise() {
    if (!ensureActiveSession()) return;
    const next = updateWorkoutSession(workoutSession.session_id, (session) => ({
      ...session,
      exercises: {
        ...session.exercises,
        [currentExerciseId]: {
          ...session.exercises[currentExerciseId],
          status: "skipped",
          skipped_at: new Date().toISOString(),
        },
      },
    }), { activate: true });
    setWorkoutSession(next);
    setCompleted((previous) => {
      const value = new Set(previous);
      value.delete(currentExerciseId);
      return value;
    });
    scheduleWorkoutSessionSync(next.session_id, { userId: next.user_id });
  }

  function finishWorkout() {
    if (!ensureActiveSession()) return;
    const incomplete = Object.values(workoutSession.exercises || {}).filter((exercise) => exercise.status !== "completed");
    if (incomplete.length && !window.confirm(`Осталось незавершённых упражнений: ${incomplete.length}. Завершить тренировку как есть?`)) return;
    const completedSession = completeWorkoutSession(workoutSession.session_id, { userId: workoutSession.user_id });
    setWorkoutSession(completedSession);
    markWorkoutCompleted(workout.workout_id, {
      title: workout.lesson?.lesson_title || "",
      exerciseCount: displayExercises.length,
      completedExerciseCount: completedSession.progress?.completed_exercises || 0,
      completedSetCount: completedSession.progress?.completed_sets || 0,
    }, workoutCycle, workoutSession.user_id);
    trackAnalyticsEvent("workout_completed", {
      screen: "workout",
      workoutId: completedSession.workout_id,
      programId: completedSession.program_id || program?.course?.course_id || program?.course?.id || "",
    }).catch(() => {});
    flushWorkoutSessionSync(completedSession.session_id, { userId: completedSession.user_id }).catch(() => {});
  }

  function restartWorkout() {
    if (!window.confirm("Удалить сохранённый прогресс этой тренировки и начать заново?")) return;
    deleteWorkoutSession(workoutSession.session_id, workoutSession.user_id);
    const fresh = createWorkoutSession({ workout, program, userId: workoutSession.user_id, status: "active", cycle: workoutCycle });
    const saved = saveWorkoutSession(fresh, { activate: true, userId: workoutSession.user_id });
    setWorkoutSession(saved);
    setCurrentIndex(0);
    setCompleted(new Set());
    setCompletedSets(0);
    setExerciseNotes("");
    setPhase("idle");
    setTimerEndsAt(null);
    setDraftMenuOpen(false);
  }

  function removeDraft() {
    if (!window.confirm("Удалить черновик этой тренировки? Это действие нельзя отменить.")) return;
    const abandoned = abandonWorkoutSession(workoutSession.session_id, { userId: workoutSession.user_id });
    flushWorkoutSessionSync(abandoned.session_id, { userId: abandoned.user_id }).catch(() => {});
    deleteWorkoutSession(workoutSession.session_id, workoutSession.user_id);
    setDraftMenuOpen(false);
    onBack?.();
  }

  function selectDay(index) {
    const nextVisibleIndex = Math.max(0, Math.min(index, visibleTotal - 1));
    const nextWorkout = visibleWorkouts[nextVisibleIndex];
    const nextIndex = originalWorkoutIndex(program?.workouts || [], nextWorkout);
    const safeIndex = nextIndex >= 0 ? nextIndex : nextVisibleIndex;
    if (!APP_STORE_REVIEW && !isWorkoutUnlocked(safeIndex, program?.workouts || total, access, profile, programAssignment)) {
      window.alert(LOCKED_WORKOUT_MESSAGE);
      return;
    }
    onSelectWorkout?.(safeIndex);
  }

  const timerNode = (
    <WorkRestTimer
      exercise={current}
      phase={phase}
      prestartSeconds={prestartSeconds}
      workSeconds={setSeconds}
      restSeconds={restSeconds}
      workDuration={workDuration}
      restDuration={restDuration}
      setTotal={setTotal}
      currentSet={currentSet}
      muted={muted}
      onStartWork={startSet}
      onPause={pauseTimer}
      onResume={resumeTimer}
      onReset={resetTimer}
      onFinish={finishExercise}
      onWorkDurationChange={changeWorkDuration}
      onRestDurationChange={changeRestDuration}
      onSetTotalChange={setTimerSetTotal}
      onMuteToggle={() => setMuted((value) => !value)}
    />
  );

  if (restrictionState.requiresAdaptation) {
    return (
      <main className="phone-shell safe-tab-screen">
        <div className="px-4 pb-4 pt-[max(14px,env(safe-area-inset-top))]">
          <header className="flex items-center justify-between">
            <IconButton label="Назад" onClick={onBack} className="h-10 w-10"><ChevronLeft size={22} /></IconButton>
            <h1 className="text-[18px] font-bold text-appText">Тренировка</h1>
            <div className="h-10 w-10" />
          </header>
          <section className="mt-5 rounded-[24px] border border-appBorder bg-appCard p-4 shadow-card">
            <h2 className="text-[22px] font-black leading-tight text-appText">Сначала нужна адаптация программы</h2>
            <ProgramRestrictions profile={profile} course={workout.course} programAssignment={programAssignment} />
          </section>
        </div>
        <BottomNavigation active="workouts" onNavigate={onNavigate} />
      </main>
    );
  }

  if (mode === "focus") {
    return (
      <main className="phone-shell bg-[#10160F] text-white">
        <div className="min-h-screen px-4 pb-[calc(22px+env(safe-area-inset-bottom))] pt-[max(14px,env(safe-area-inset-top))]">
          <header className="flex items-center justify-between">
            <IconButton label="Закрыть" onClick={onBack} className="h-10 w-10 border-white/10 bg-white/10 text-white"><X size={20} /></IconButton>
            <div className="w-40 text-center">
              <p className="text-[12px] text-white/75">Упражнение {currentIndex + 1} из {displayExercises.length}</p>
              <div className="mt-2 h-1.5 rounded-full bg-white/12"><motion.div className="h-full rounded-full bg-appGreen" animate={{ width: `${progress}%` }} /></div>
            </div>
            <div className="h-10 w-10" />
          </header>
          <section className="mt-5">
            <h1 className="line-clamp-2 text-[25px] font-black leading-[1.08]">{current.exercise_name}</h1>
            {meta && <p className="mt-2 text-[14px] text-white/75">{meta}</p>}
            <ExerciseMedia exercise={current} className="mt-4 h-[236px] w-full rounded-[20px]" />
            <MuscleWorkBlock exercise={current} gender={muscleMapGender} className="mt-4" />
          </section>
          <div className="mt-4">{timerNode}</div>
          <SetsTable current={current} exerciseState={currentExerciseState} setRows={setRows} completedSets={completedSets} currentSet={currentSet} disabled={!sessionIsActive} onSetValueChange={updateCurrentSetValue} />
        </div>
      </main>
    );
  }

  return (
    <main className="phone-shell safe-tab-screen">
      <div className="px-4 pb-4 pt-[max(14px,env(safe-area-inset-top))]">
        <header className="flex items-center justify-between">
          <IconButton label="Назад" onClick={onBack} className="h-10 w-10"><ChevronLeft size={22} /></IconButton>
          <h1 className="text-[18px] font-bold text-appText">Тренировка</h1>
          <IconButton label="Еще" onClick={() => setDraftMenuOpen(true)} className="h-10 w-10"><MoreHorizontal size={20} /></IconButton>
        </header>

        <section className="mt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="line-clamp-2 text-[26px] font-black leading-[1.08] text-appText">{workout.lesson.lesson_title}</h2>
              <p className="mt-2 text-[13px] leading-5 text-appMuted">{programSummaryTitle(profile, workout.course)}</p>
              <ProgramRestrictions profile={profile} course={workout.course} programAssignment={programAssignment} compact />
            </div>
            <span className="shrink-0 rounded-full bg-appGreen/55 px-3 py-1.5 text-[12px] font-semibold text-[#181F19]">День {visibleSelectedIndex + 1}/{visibleTotal}</span>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <span className="text-[13px] text-appMuted">Прогресс</span>
            <div className="h-1.5 flex-1 rounded-full bg-[#E6E6DF]"><motion.div className="h-full rounded-full bg-[#8BBE3D]" animate={{ width: `${progress}%` }} /></div>
            <span className="text-[13px] font-bold text-appText">{progress}%</span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 px-1 text-[11px] font-semibold text-appMuted">
            <span>{workoutSession?.progress?.completed_exercises || 0} из {workoutSession?.progress?.total_exercises || displayExercises.length} упражнений</span>
            <span>{syncLabel}</span>
          </div>
          {workoutSession?.program_update && (
            <div className="mt-3 rounded-[16px] border border-appBorder bg-appCard px-3 py-2 text-[12px] leading-5 text-appMuted">
              Программа была обновлена. Сохранённый прогресс оставлен у прежних упражнений, новые добавлены как невыполненные.
            </div>
          )}
          {workoutSession?.conflict && (
            <div className="mt-3 rounded-[16px] border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[12px] leading-5 text-appText">
              На другом устройстве найдена более новая версия тренировки. Данные этого устройства сохранены и не будут удалены автоматически.
            </div>
          )}
          {!sessionIsActive && (
            <button type="button" onClick={ensureActiveSession} className="mt-3 h-11 w-full rounded-full bg-appGreen text-[13px] font-black text-[#181F19]">
              Начать или продолжить эту тренировку
            </button>
          )}
          <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto pb-1">
            <button type="button" onClick={() => selectDay(visibleSelectedIndex - 1)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-appCard text-appMuted shadow-sm"><ChevronLeft size={17} /></button>
            {visibleWorkouts.map((item, index) => {
              const sourceIndex = originalWorkoutIndex(program?.workouts || [], item);
              const safeSourceIndex = sourceIndex >= 0 ? sourceIndex : index;
              const locked = !APP_STORE_REVIEW && !isWorkoutUnlocked(safeSourceIndex, program?.workouts || total, access, profile, programAssignment);
              return (
                <button key={item.workout_id} type="button" onClick={() => selectDay(index)} className={`inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-[12px] font-bold ${locked ? "bg-appCard/70 text-appMuted opacity-70" : index === visibleSelectedIndex ? "bg-appDark text-appGreen" : "bg-appCard text-appMuted"}`}>
                  {locked && <Lock size={12} />}
                  День {index + 1}
                </button>
              );
            })}
            <button type="button" onClick={() => selectDay(visibleSelectedIndex + 1)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-appCard text-appMuted shadow-sm"><ChevronRight size={17} /></button>
          </div>
        </section>

        <WarmupBlock />

        <motion.section layout className="mt-4 rounded-[22px] bg-appDark p-4 text-white shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase text-appGreen"><span className="h-2 w-2 rounded-full bg-appGreen" /> Сейчас</div>
            <span className="text-[11px] text-white/55">подход {currentSet}/{setTotal}</span>
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={`${current.exercise_order}-${current.exercise_name}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
              <h3 className="line-clamp-2 text-[22px] font-black leading-[1.12]">{current.exercise_name}</h3>
              {current.replacedFrom && (
                <div className="mt-2 flex items-center justify-between gap-3 rounded-full bg-appGreen/10 px-3 py-2">
                  <p className="min-w-0 truncate text-[11px] font-semibold text-appGreen">замена вместо: {current.replacedFrom}</p>
                  <button
                    type="button"
                    onClick={() => undoReplacement(current.exercise_order)}
                    className="shrink-0 rounded-full bg-appGreen px-3 py-1 text-[11px] font-black text-[#181F19]"
                  >
                    Вернуть
                  </button>
                </div>
              )}
              {meta && <p className="mt-2 text-[13px] text-white/76">{meta}</p>}
              <ExerciseMedia exercise={current} className="mt-3 h-[164px] w-full rounded-[18px]" />
              <MuscleWorkBlock exercise={current} gender={muscleMapGender} className="mt-3" />
            </motion.div>
          </AnimatePresence>
        </motion.section>

        <section className="mt-3 rounded-[20px] border border-appBorder bg-appCard/86 p-3 shadow-sm">
          <div className="grid grid-cols-1 gap-2">
            {[["replace", "Заменить упражнение"]].map(([id, label]) => (
              <button key={id} type="button" onClick={() => setAlternativeReason(id)} className="exercise-replace-button min-h-11 rounded-[16px] px-3 text-[12px] font-black transition active:scale-[0.98]">
                <RotateCcw size={15} />
                {label}
              </button>
            ))}
          </div>
        </section>

        <div className="mt-3">{timerNode}</div>
        <SetsTable current={current} exerciseState={currentExerciseState} setRows={setRows} completedSets={completedSets} currentSet={currentSet} disabled={!sessionIsActive} onSetValueChange={updateCurrentSetValue} />
        <section className="mt-3 rounded-[18px] border border-appBorder bg-appCard p-3">
          <label className="text-[12px] font-bold text-appMuted" htmlFor="workout-exercise-note">Заметка к упражнению</label>
          <textarea
            id="workout-exercise-note"
            value={exerciseNotes}
            disabled={!sessionIsActive}
            onChange={(event) => updateExerciseNotes(event.target.value)}
            placeholder="Самочувствие, техника, рабочий вес"
            className="mt-2 min-h-[72px] w-full resize-none rounded-[14px] border border-appBorder bg-appBg px-3 py-2 text-[13px] text-appText outline-none focus:border-appGreen disabled:opacity-50"
          />
          <div className="mt-2 grid grid-cols-3 gap-2">
            <button type="button" disabled={currentIndex <= 0} onClick={goToPreviousExercise} className="h-10 rounded-full border border-appBorder text-[11px] font-bold text-appMuted disabled:opacity-35">Назад</button>
            <button type="button" disabled={!sessionIsActive} onClick={skipCurrentExercise} className="h-10 rounded-full border border-appBorder text-[11px] font-bold text-appMuted disabled:opacity-45">Пропустить</button>
            <button type="button" onClick={goToNextExercise} className="h-10 rounded-full bg-appDark text-[11px] font-bold text-appGreen">Следующее</button>
          </div>
          <button type="button" disabled={!sessionIsActive} onClick={finishExercise} className="mt-2 h-10 w-full rounded-full bg-appGreen text-[12px] font-black text-[#181F19] disabled:opacity-45">Завершить упражнение</button>
        </section>
        <ExerciseList exercises={displayExercises} currentIndex={currentIndex} exerciseStates={workoutSession?.exercises || {}} getExerciseId={stableExerciseId} superset={workout.hasSupersetData ? workout.superset : []} onExerciseClick={jumpToExercise} />
        <button type="button" onClick={finishWorkout} disabled={workoutSession?.status === "completed"} className="mt-4 h-[52px] w-full rounded-full bg-appGreen text-[14px] font-black text-[#181F19] disabled:opacity-45">
          {workoutSession?.status === "completed" ? "Тренировка завершена" : "Завершить тренировку"}
        </button>
        <WorkoutReport key={`${workoutCycleKey}:${workout.workout_id}`} workoutId={workout.workout_id} workoutTitle={workout.lesson?.lesson_title} workoutCycle={workoutCycle} />
      </div>
      {alternativeReason && <AlternativesModal exercise={current} reason={alternativeReason} catalog={program.exerciseCatalog} profile={profile} onSelect={saveReplacement} onClose={() => setAlternativeReason("")} />}
      {activationConflict && (
        <div className="fixed inset-0 z-[70] grid place-items-end bg-black/45 px-3 pb-[max(16px,env(safe-area-inset-bottom))]">
          <section className="w-full max-w-[390px] rounded-[24px] bg-appCard p-4 shadow-soft">
            <h2 className="text-[19px] font-black text-appText">Уже идёт другая тренировка</h2>
            <p className="mt-2 text-[13px] leading-5 text-appMuted">{activationConflict.workout_title || "Текущая тренировка"} сохранена и может быть продолжена.</p>
            <div className="mt-4 space-y-2">
              <button type="button" onClick={() => {
                const activeWorkoutIndex = program?.workouts?.findIndex(
                  (item) => String(item.workout_id) === activationConflict.workout_id,
                );
                setActivationConflict(null);
                if (activeWorkoutIndex >= 0) onSelectWorkout?.(activeWorkoutIndex);
              }} className="h-12 w-full rounded-full bg-appDark text-[13px] font-black text-appGreen">Продолжить текущую тренировку</button>
              <button type="button" onClick={() => {
                const activated = saveWorkoutSession({ ...workoutSession, status: "active" }, { activate: true, userId: workoutSession.user_id });
                setWorkoutSession(activated);
                setActivationConflict(null);
                scheduleWorkoutSessionSync(activated.session_id, { userId: activated.user_id, delay: 0 });
              }} className="h-12 w-full rounded-full bg-appGreen text-[13px] font-black text-[#181F19]">Сохранить текущую и начать другую</button>
              <button type="button" onClick={() => setActivationConflict(null)} className="h-11 w-full rounded-full border border-appBorder text-[13px] font-bold text-appMuted">Отмена</button>
            </div>
          </section>
        </div>
      )}
      {draftMenuOpen && (
        <div className="fixed inset-0 z-[70] grid place-items-end bg-black/45 px-3 pb-[max(16px,env(safe-area-inset-bottom))]">
          <section className="w-full max-w-[390px] rounded-[24px] bg-appCard p-4 shadow-soft">
            <h2 className="text-[19px] font-black text-appText">Черновик тренировки</h2>
            <p className="mt-2 text-[13px] text-appMuted">Прогресс сохранён на устройстве и синхронизируется с аккаунтом.</p>
            <div className="mt-4 space-y-2">
              <button type="button" onClick={() => setDraftMenuOpen(false)} className="h-12 w-full rounded-full bg-appGreen text-[13px] font-black text-[#181F19]">Продолжить</button>
              <button type="button" onClick={restartWorkout} className="h-12 w-full rounded-full border border-appBorder text-[13px] font-bold text-appText">Начать заново</button>
              <button type="button" onClick={removeDraft} className="h-12 w-full rounded-full border border-red-400/35 text-[13px] font-bold text-red-500">Удалить черновик</button>
              <button type="button" onClick={() => setDraftMenuOpen(false)} className="h-10 w-full text-[13px] font-bold text-appMuted">Отмена</button>
            </div>
          </section>
        </div>
      )}
      <BottomNavigation active="workouts" onNavigate={onNavigate} />
    </main>
  );
}
