import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

const DEFAULT_MODEL = "gpt-5-nano";
const OPENAI_ENDPOINT = "responses";
const OPENAI_URL = "https://api.openai.com/v1/responses";
const VDS_COACH_URL = `${(process.env.VITE_FRUITFIT_API_URL || "https://api.tagirfruit.ru").replace(/\/$/, "")}/api/coach`;
const SYSTEM_PROMPT = `Ты FruitFit Coach.
Ты фитнес-ассистент внутри приложения FruitFit.

Отвечай:
- кратко
- понятно
- без воды
- максимум 5 предложений

Ты помогаешь:
- по тренировкам
- питанию
- восстановлению
- технике
- подбору нагрузки

НЕ давай опасных медицинских советов.
НЕ придумывай диагнозы.
НЕ пиши длинные лекции.

Если пользователь спрашивает про вес:
ориентируйся на прогресс прошлых тренировок.

Если пользователь спрашивает про восстановление:
учитывай сон, пульс и усталость.

Если пользователь спрашивает про замену упражнения:
используй локальную базу замен.`;

function readDotEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return {};

  return Object.fromEntries(
    fs.readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
        return [key, value];
      }),
  );
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Payload too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (_) {
        reject(new Error("Invalid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

function buildContextMessage(context = {}) {
  return `Контекст FruitFit:
${JSON.stringify({
    currentWorkout: context.currentWorkout,
    currentExercise: context.currentExercise,
    exerciseAlternatives: context.exerciseAlternatives,
    exerciseWeights: context.exerciseWeights,
    nutrition: context.nutrition,
    health: context.health,
    profile: context.profile,
  }, null, 2)}`;
}

function toResponsesInput(history, context) {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: buildContextMessage(context) },
    ...history.map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: String(item.content || "").slice(0, 2000),
    })),
  ];
}

function extractResponseText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text.trim();

  const chunks = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) chunks.push(content.text);
      if (content.type === "text" && content.text) chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

function logOpenAiError({ status, data, model }) {
  const error = data?.error || {};
  console.error("[FruitFit Coach] OpenAI request failed", {
    status,
    endpoint: OPENAI_ENDPOINT,
    model,
    message: error.message || "Unknown OpenAI error",
    code: error.code || null,
    type: error.type || null,
  });
}

function coachApiPlugin() {
  return {
    name: "fruitfit-coach-api",
    configureServer(server) {
      server.middlewares.use("/__fruitfit_vds_coach", async (request, response) => {
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "Method not allowed" });
          return;
        }

        try {
          const payload = await readJson(request);
          const vdsResponse = await fetch(VDS_COACH_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: "https://fruitfit.pages.dev",
            },
            body: JSON.stringify(payload),
          });
          const text = await vdsResponse.text();
          response.statusCode = vdsResponse.status;
          response.setHeader("Content-Type", vdsResponse.headers.get("Content-Type") || "application/json; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(text);
        } catch (error) {
          console.error("[FruitFit Coach VDS proxy] Backend error", {
            endpoint: VDS_COACH_URL,
            message: error.message || "Unknown proxy error",
          });
          sendJson(response, 502, { error: "VDS backend unavailable" });
        }
      });

      server.middlewares.use("/api/coach", async (request, response) => {
        const env = readDotEnv();
        const apiKey = process.env.OPENAI_API_KEY || env.OPENAI_API_KEY || "";
        const model = process.env.OPENAI_MODEL || env.OPENAI_MODEL || DEFAULT_MODEL;

        if (request.method !== "POST") {
          sendJson(response, 405, { error: "Method not allowed" });
          return;
        }

        if (!apiKey) {
          console.error("[FruitFit Coach] OPENAI_API_KEY is missing in .env");
          sendJson(response, 500, { error: "OPENAI_API_KEY не найден в .env" });
          return;
        }

        try {
          const payload = await readJson(request);
          const history = Array.isArray(payload.messages) ? payload.messages.slice(-10) : [];
          const input = toResponsesInput(history, payload.context || {});

          const openAiResponse = await fetch(OPENAI_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model,
              input,
              max_output_tokens: 600,
              reasoning: { effort: "minimal" },
              text: { verbosity: "low" },
            }),
          });

          const data = await openAiResponse.json().catch(() => ({}));
          if (!openAiResponse.ok) {
            logOpenAiError({ status: openAiResponse.status, data, model });
            sendJson(response, openAiResponse.status, {
              error: "Ошибка AI: смотри terminal/dev console",
              details: data.error?.message || "OpenAI API error",
            });
            return;
          }

          const answer = extractResponseText(data);
          if (!answer) {
            console.error("[FruitFit Coach] Empty OpenAI response", {
              endpoint: OPENAI_ENDPOINT,
              model,
              responseId: data.id || null,
              status: data.status || null,
            });
            sendJson(response, 502, { error: "Ошибка AI: смотри terminal/dev console" });
            return;
          }

          sendJson(response, 200, { answer });
        } catch (error) {
          console.error("[FruitFit Coach] Backend error", {
            endpoint: OPENAI_ENDPOINT,
            model,
            message: error.message || "Unknown backend error",
          });
          sendJson(response, 500, { error: "Ошибка AI: смотри terminal/dev console" });
        }
      });

      server.middlewares.use("/api/health", (_request, response) => {
        const env = readDotEnv();
        const apiKey = process.env.OPENAI_API_KEY || env.OPENAI_API_KEY || "";
        const model = process.env.OPENAI_MODEL || env.OPENAI_MODEL || DEFAULT_MODEL;
        sendJson(response, 200, {
          ok: true,
          openaiKeyLoaded: Boolean(apiKey),
          model,
          endpoint: OPENAI_ENDPOINT,
        });
      });
    },
  };
}

const REVIEW_PUBLIC_DATA_FILES = ["courses.json", "training-programs.json"];
const REVIEW_PRIVATE_DATA_KEYS = new Set([
  "pay_url",
  "payment_url",
  "checkout_url",
  "course_url",
  "source_url",
  "product_id",
  "productId",
  "product_code",
  "productCode",
]);

function sanitizeReviewPublicData(value) {
  if (Array.isArray(value)) return value.map(sanitizeReviewPublicData);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, entryValue]) => {
        if (REVIEW_PRIVATE_DATA_KEYS.has(key)) return false;
        if (typeof entryValue === "string" && /tagirfruit\.inskill\.ru\/(?:ru\/pay|admin\/courses)/i.test(entryValue)) return false;
        return true;
      })
      .map(([key, entryValue]) => [key, sanitizeReviewPublicData(entryValue)])
  );
}

function appStoreReviewAssetSanitizer() {
  return {
    name: "fruitfit-app-store-review-asset-sanitizer",
    apply: "build",
    closeBundle() {
      if (process.env.VITE_APP_STORE_REVIEW !== "true") return;
      const dataDir = path.resolve(process.cwd(), "dist/data");
      for (const fileName of REVIEW_PUBLIC_DATA_FILES) {
        const filePath = path.join(dataDir, fileName);
        if (!fs.existsSync(filePath)) continue;
        const json = JSON.parse(fs.readFileSync(filePath, "utf8"));
        fs.writeFileSync(filePath, `${JSON.stringify(sanitizeReviewPublicData(json), null, 2)}\n`);
      }
    },
  };
}

export default defineConfig({
  define: {
    __APP_STORE_REVIEW__: JSON.stringify(process.env.VITE_APP_STORE_REVIEW === "true"),
  },
  resolve: {
    alias: {
      "#fruitfit/programAction": path.resolve(
        process.cwd(),
        process.env.VITE_APP_STORE_REVIEW === "true"
          ? "src/services/programAction.review.js"
          : "src/services/programAction.standard.js"
      ),
      "#fruitfit/programRenewal": path.resolve(
        process.cwd(),
        process.env.VITE_APP_STORE_REVIEW === "true"
          ? "src/services/programRenewal.review.js"
          : "src/services/programRenewal.standard.js"
      ),
      "#fruitfit/firebaseMessagingNative": path.resolve(
        process.cwd(),
        process.env.VITE_APP_STORE_REVIEW === "true"
          ? "src/services/notifications/firebaseMessagingNative.review.js"
          : "src/services/notifications/firebaseMessagingNative.standard.js"
      ),
    },
  },
  plugins: [react(), coachApiPlugin(), appStoreReviewAssetSanitizer()],
});
