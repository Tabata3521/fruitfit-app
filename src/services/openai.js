const AI_COACH_ENDPOINT = "https://tagirfruit-mini.duckdns.org/api/coach";
const LOCAL_VDS_PROXY = "/__fruitfit_vds_coach";
const AI_UNAVAILABLE_MESSAGE = "AI-помощник временно недоступен. Попробуйте позже.";

const FRUITFIT_COACH_SYSTEM_PROMPT = `Ты AI-помощник FruitFit.
Отвечай кратко, понятно, без медицинских диагнозов.
Не придумывай КБЖУ из памяти.
КБЖУ можно считать только по данным nutrition calculator / nutrition_db.
Если продукта нет в базе, скажи: "этот продукт нужно проверить в базе продуктов".
Не придумывай упражнения.
Используй только упражнения из локальной exercise database, если она передана в контексте.
Если подходящего упражнения нет в базе, скажи, что нужна ручная проверка тренером.
При ограничениях по коленям, пояснице, плечам, шее, сердцу или давлению не назначай интенсивные нагрузки без предупреждения.
При сердечно-сосудистых ограничениях, давлении, аритмии, беременности, болях в груди, головокружении, одышке, онемении или резкой боли рекомендуй консультацию врача.
Не обещай точные медицинские/физиологические результаты.
Не спорь с пользователем.
Не давай экстремальные диеты.
Не опускай калории ниже безопасного уровня.
Если данных мало, задай 1 уточняющий вопрос.`;

export async function askFruitFitCoach(messages, context) {
  const recentMessages = messages
    .slice(-10)
    .filter(({ role, content }) => (role === "user" || role === "assistant") && String(content || "").trim())
    .map(({ role, content }) => ({ role, content }));
  const firstUserIndex = recentMessages.findIndex(({ role }) => role === "user");
  const conversationMessages = firstUserIndex >= 0 ? recentMessages.slice(firstUserIndex) : [];

  const payload = {
    messages: [
      { role: "system", content: FRUITFIT_COACH_SYSTEM_PROMPT },
      ...conversationMessages,
    ],
    context: {
      ...context,
      systemRules: FRUITFIT_COACH_SYSTEM_PROMPT,
    },
  };

  let response;
  try {
    const endpoint = isLocalHost() ? LOCAL_VDS_PROXY : AI_COACH_ENDPOINT;
    response = await fetchWithRetry(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, { retries: 2, timeoutMs: 18000 });
  } catch (error) {
    console.error("[FruitFit Coach UI] Network error", {
      endpoint: isLocalHost() ? LOCAL_VDS_PROXY : AI_COACH_ENDPOINT,
      message: error?.message || "network error",
    });
    throw new Error(AI_UNAVAILABLE_MESSAGE);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("[FruitFit Coach UI] Backend error", {
      endpoint: isLocalHost() ? LOCAL_VDS_PROXY : AI_COACH_ENDPOINT,
      status: response.status,
      rateLimit: response.status === 429,
      message: data?.error?.message || data?.error || data?.message || "backend error",
      code: data?.error?.code || data?.code,
      type: data?.error?.type || data?.type,
    });
    throw new Error(AI_UNAVAILABLE_MESSAGE);
  }

  const answer = data?.choices?.[0]?.message?.content?.trim();
  if (!answer) {
    console.error("[FruitFit Coach UI] Empty backend answer", {
      endpoint: isLocalHost() ? LOCAL_VDS_PROXY : AI_COACH_ENDPOINT,
      hasChoices: Array.isArray(data?.choices),
    });
    throw new Error(AI_UNAVAILABLE_MESSAGE);
  }

  return answer;
}

function isLocalHost() {
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

async function fetchWithRetry(url, options, { retries = 2, timeoutMs = 18000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal, cache: "no-store" });
      window.clearTimeout(timeoutId);
      if ([408, 425, 429, 500, 502, 503, 504].includes(response.status) && attempt < retries) {
        await delay(450 * (attempt + 1));
        continue;
      }
      return response;
    } catch (error) {
      window.clearTimeout(timeoutId);
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
