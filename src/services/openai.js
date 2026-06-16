import { appInfo, normalizeApiUrl } from "./appInfo";
import { postJson } from "./nativeHttp";
import { getAuthToken, saveAuthUser } from "../data/authStore";

const API_BASE_URL = normalizeApiUrl(import.meta.env.VITE_FRUITFIT_API_URL || appInfo.api.productionApi);
const AI_COACH_ENDPOINT = `${API_BASE_URL}/api/coach`;
const AI_UNAVAILABLE_MESSAGE = "AI-помощник временно недоступен. Попробуйте позже.";
const AI_LOGIN_REQUIRED_MESSAGE = "Войдите в аккаунт, чтобы пользоваться AI Coach.";
const AI_LIMIT_REACHED_MESSAGE = "Лимит сообщений исчерпан. Для продолжения общения с тренером нужна полная программа.";

export async function askFruitFitCoach(message) {
  const content = String(message || "").trim();
  const token = getAuthToken();

  if (!token) {
    throw new Error(AI_LOGIN_REQUIRED_MESSAGE);
  }
  if (!content) {
    throw new Error("Введите сообщение для AI Coach.");
  }

  let response;
  try {
    response = await postWithRetry(AI_COACH_ENDPOINT, {
      message: content,
    }, {
      retries: 2,
      timeoutMs: 18000,
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
