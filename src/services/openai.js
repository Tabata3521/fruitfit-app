import { appInfo, normalizeApiUrl } from "./appInfo";
import { postJson } from "./nativeHttp";
import { getAuthToken, saveAuthUser } from "../data/authStore";

const API_BASE_URL = normalizeApiUrl(import.meta.env.VITE_FRUITFIT_API_URL || appInfo.api.productionApi);
const AI_COACH_ENDPOINT = `${API_BASE_URL}/api/coach`;
const AI_UNAVAILABLE_MESSAGE = "AI-помощник временно недоступен. Попробуйте позже.";
const AI_LOGIN_REQUIRED_MESSAGE = "Войдите в аккаунт, чтобы пользоваться AI Coach.";
const AI_LIMIT_REACHED_MESSAGE = "Лимит сообщений исчерпан. Для продолжения общения с тренером нужна полная программа.";

export async function askFruitFitCoach(message, options = {}) {
  const content = String(message || "").trim();
  const token = getAuthToken();

  if (!token) {
    throw new Error(AI_LOGIN_REQUIRED_MESSAGE);
  }
  if (!content) {
    throw new Error("Введите сообщение для AI Coach.");
  }

  const messages = normalizeCoachMessages(options.messages, content);
  const context = normalizeCoachContext(options.context);
  const selectedWorkoutId = String(options.selectedWorkoutId || context.selectedWorkoutId || "").trim();
  const selectedWorkoutTitle = String(options.selectedWorkoutTitle || context.selectedWorkoutTitle || "").trim();
  const messageForBackend = withSelectedWorkoutHint(content, context, selectedWorkoutId, selectedWorkoutTitle);
  const requestPayload = {
    message: messageForBackend,
    messages,
    context,
    selectedWorkoutId,
    selectedWorkoutTitle,
  };
  if (typeof window !== "undefined") {
    window.__fruitfitLastCoachPayload = requestPayload;
    console.info("[FruitFit Coach UI] COACH_REQUEST_PAYLOAD", {
      selectedWorkoutId: requestPayload.selectedWorkoutId || null,
      selectedWorkoutTitle: requestPayload.selectedWorkoutTitle || null,
      selectedWorkoutExerciseCount: requestPayload.context?.selectedWorkout?.exercises?.length || 0,
      userSelectedWorkoutWinsForThisRequest: Boolean(requestPayload.context?.userSelectedWorkoutWinsForThisRequest),
      workoutSelectionConflict: requestPayload.context?.workoutSelectionConflict ? {
        selectedPropConflicts: Boolean(requestPayload.context.workoutSelectionConflict.selectedPropConflicts),
        serverWorkoutConflicts: Boolean(requestPayload.context.workoutSelectionConflict.serverWorkoutConflicts),
      } : null,
      hasNutritionTarget: Boolean(requestPayload.context?.nutritionTarget),
      nutritionCalories: requestPayload.context?.nutritionTarget?.calories || null,
      healthSnapshot: requestPayload.context?.healthSnapshot ? {
        hasSteps: Boolean(requestPayload.context.healthSnapshot.steps),
        hasSleep: Boolean(requestPayload.context.healthSnapshot.sleep),
        hasCalories: Boolean(requestPayload.context.healthSnapshot.calories),
        hasHeartRate: Boolean(requestPayload.context.healthSnapshot.heartRate),
        freshness: requestPayload.context.healthSnapshot.freshness || null,
        lastSyncAt: requestPayload.context.healthSnapshot.lastSyncAt || null,
      } : null,
    });
  }
  let response;
  try {
    response = await postWithRetry(AI_COACH_ENDPOINT, requestPayload, {
      retries: 0,
      timeoutMs: 70000,
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (error) {
    console.error("[FruitFit Coach UI] Network error", {
      endpoint: AI_COACH_ENDPOINT,
      message: error?.message || "network error",
    });
    throw new Error(AI_UNAVAILABLE_MESSAGE);
  }

  const data = response.data || {};
  if (!response.ok) {
    const code = data?.error?.code || data?.code || data?.errorCode;
    if (response.status === 401) {
      saveAuthUser(null);
      throw new Error("Сессия истекла. Войдите снова, чтобы продолжить общение с тренером.");
    }
    if (response.status === 429 || code === "AI_DAILY_LIMIT_REACHED") {
      throw new Error(AI_LIMIT_REACHED_MESSAGE);
    }
    console.error("[FruitFit Coach UI] Backend error", {
      endpoint: AI_COACH_ENDPOINT,
      status: response.status,
      message: data?.error?.message || data?.error || data?.message || "backend error",
      code,
      type: data?.error?.type || data?.type,
    });
    throw new Error(data?.error?.message || data?.message || AI_UNAVAILABLE_MESSAGE);
  }

  const answer = (
    data?.answer
    || data?.choices?.[0]?.message?.content
    || data?.output_text
    || ""
  ).trim();

  if (!answer) {
    console.error("[FruitFit Coach UI] Empty backend answer", {
      endpoint: AI_COACH_ENDPOINT,
      hasChoices: Array.isArray(data?.choices),
    });
    throw new Error(AI_UNAVAILABLE_MESSAGE);
  }

  return answer;
}

function withSelectedWorkoutHint(content = "", context = {}, selectedWorkoutId = "", selectedWorkoutTitle = "") {
  const activeWorkout = context.selectedWorkout || context.currentWorkout || {};
  const title = String(selectedWorkoutTitle || context.selectedWorkoutTitle || activeWorkout?.title || "").trim();
  const id = String(selectedWorkoutId || context.selectedWorkoutId || activeWorkout?.workoutId || activeWorkout?.lessonId || "").trim();
  if (!title && !id) return content;
  const dayNumber = activeWorkout?.lessonNumber || (Number.isFinite(Number(activeWorkout?.index)) ? Number(activeWorkout.index) + 1 : null);
  const status = String(activeWorkout?.uiStatus || activeWorkout?.status || "in_progress").trim();
  const hint = [
    "IMPORTANT ACTIVE WORKOUT OVERRIDE:",
    title ? `The user is currently viewing/selecting this FruitFit workout: ${title}.` : "",
    dayNumber ? `Workout day number: ${dayNumber}.` : "",
    id ? `Workout ID: ${id}.` : "",
    status ? `UI workout status: ${status}.` : "",
    "Answer about this selected workout if the question is about training.",
  ].filter(Boolean).join("\n");
  return `${hint}\n\nUser question: ${content}`.trim();
}

function normalizeCoachContext(context = {}) {
  if (!context || typeof context !== "object") return {};
  const safe = {
    contextType: context.contextType || null,
    profile: context.profile || null,
    accessState: context.accessState || null,
    programAssignment: context.programAssignment || null,
    selectedWorkout: context.selectedWorkout || null,
    currentWorkout: context.currentWorkout || null,
    currentWorkoutSource: context.currentWorkoutSource || null,
    serverCurrentWorkout: context.serverCurrentWorkout || null,
    selectedWorkoutId: context.selectedWorkoutId || null,
    selectedWorkoutTitle: context.selectedWorkoutTitle || null,
    userSelectedWorkoutWinsForThisRequest: Boolean(context.userSelectedWorkoutWinsForThisRequest),
    workoutSelectionConflict: context.workoutSelectionConflict || null,
    selectionResolution: context.selectionResolution || null,
    debugWorkoutHint: context.debugWorkoutHint || null,
    healthSnapshot: context.healthSnapshot || null,
    nutritionTarget: context.nutritionTarget || null,
    recentMessages: normalizeCoachMessages(context.recentMessages || [], ""),
    aiMemory: context.aiMemory || null,
  };
  return JSON.parse(JSON.stringify(safe, (key, value) => {
    const lowered = String(key || "").toLowerCase();
    if (lowered.includes("token") || lowered.includes("secret") || lowered.includes("authorization")) return undefined;
    return value;
  }));
}

function normalizeCoachMessages(messages = [], fallbackContent = "") {
  const normalized = (Array.isArray(messages) ? messages : [])
    .filter((item) => item?.role === "user" || item?.role === "assistant")
    .map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: String(item.content || "").trim().slice(0, 3000),
      ...(item.createdAt ? { createdAt: item.createdAt } : {}),
    }))
    .filter((item) => item.content);

  if (normalized.length) return normalized.slice(-12);
  return [{ role: "user", content: String(fallbackContent || "").trim().slice(0, 3000) }].filter((item) => item.content);
}

async function postWithRetry(url, payload, { retries = 2, timeoutMs = 18000, headers = {} } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await withTimeout(postJson(url, payload, {
        cache: "no-store",
        headers,
      }), timeoutMs);
      if ([408, 425, 500, 502, 503, 504].includes(response.status) && attempt < retries) {
        await delay(450 * (attempt + 1));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      await delay(450 * (attempt + 1));
    }
  }
  throw lastError || new Error("network error");
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error("request timeout")), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}
