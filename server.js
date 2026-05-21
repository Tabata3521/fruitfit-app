import express from "express";
import fs from "node:fs";
import path from "node:path";
import { calculateNutritionItems, getNutritionDb, NUTRITION_DB_PATH, searchProducts } from "./server/nutritionDb.js";
import { buildNutritionAnswer, isNutritionIntent, parseFoodItemsFromMessage } from "./server/foodParser.js";
import authRouter from "./server/authHandlers.js";
import { createAuthSchema } from "./server/authDb.js";
import { TAGIRFRUIT_SYSTEM_PROMPT, buildTagirfruitContextMessage } from "./server/coachPrompt.js";

const PORT = Number(process.env.FRUITFIT_API_PORT || 8787);
const HOST = process.env.FRUITFIT_API_HOST || "127.0.0.1";
const DEFAULT_MODEL = "gpt-5-nano";
const OPENAI_ENDPOINT = "responses";
const OPENAI_URL = "https://api.openai.com/v1/responses";

loadEnv();

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use((request, response, next) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "OPTIONS") {
    response.json({ ok: true });
    return;
  }
  next();
});

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    openaiKeyLoaded: Boolean(process.env.OPENAI_API_KEY),
    model: getOpenAiModel(),
    endpoint: OPENAI_ENDPOINT,
    nutritionDbLoaded: fs.existsSync(NUTRITION_DB_PATH),
    nutritionDbPath: NUTRITION_DB_PATH,
  });
});

app.use("/api/auth", authRouter);

app.get("/api/nutrition/search", (request, response) => {
  try {
    const q = String(request.query.q || "").trim();
    response.json({ items: searchProducts(q, { limit: 10, userId: request.query.userId || "" }) });
  } catch (error) {
    console.error("[FruitFit Nutrition] Search failed", { message: error.message });
    response.status(500).json({ error: "Nutrition search failed" });
  }
});

app.post("/api/nutrition/calc", (request, response) => {
  try {
    const result = calculateNutritionItems(request.body?.items || [], {
      userId: request.body?.userId || "",
      db: getNutritionDb(),
    });
    response.json(result);
  } catch (error) {
    console.error("[FruitFit Nutrition] Calculation failed", { message: error.message });
    response.status(500).json({ error: "Nutrition calculation failed" });
  }
});

app.post("/api/coach", async (request, response) => {
  try {
    await handleCoach(request, response);
  } catch (error) {
    console.error("[tagirfruit] Backend error", {
      endpoint: OPENAI_ENDPOINT,
      model: getOpenAiModel(),
      message: error.message || "Server error",
    });
    response.status(500).json(openAiStyleResponse("Ошибка AI: смотри terminal/dev console"));
  }
});

app.use((_request, response) => {
  response.status(404).json({ error: "Not found" });
});

app.listen(PORT, HOST, () => {
  createAuthSchema();
  console.log(`FruitFit API listening on http://${HOST}:${PORT}`);
  console.log(`[FruitFit Nutrition] SQLite DB: ${NUTRITION_DB_PATH}`);
});

function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !process.env[key]) process.env[key] = value;
  }
}

function getOpenAiModel() {
  return process.env.OPENAI_MODEL || DEFAULT_MODEL;
}

function buildContextMessage(context = {}) {
  return `Контекст приложения FruitFit:
${JSON.stringify(
  {
    currentWorkout: context.currentWorkout,
    currentExercise: context.currentExercise,
    exerciseAlternatives: context.exerciseAlternatives,
    exerciseWeights: context.exerciseWeights,
    nutrition: context.nutrition,
    health: context.health,
    profile: context.profile,
  },
  null,
  2,
)}`;
}

function toResponsesInput(history, context) {
  return [
    { role: "system", content: TAGIRFRUIT_SYSTEM_PROMPT },
    { role: "system", content: buildTagirfruitContextMessage(context) },
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
  console.error("[tagirfruit] OpenAI request failed", {
    status,
    endpoint: OPENAI_ENDPOINT,
    model,
    message: error.message || "Unknown OpenAI error",
    code: error.code || null,
    type: error.type || null,
  });
}

async function handleCoach(request, response) {
  const payload = request.body || {};
  const history = Array.isArray(payload.messages)
    ? payload.messages
        .filter((item) => item?.role === "user" || item?.role === "assistant")
        .slice(-10)
    : [];
  const lastUserMessage = [...history].reverse().find((item) => item.role === "user" && String(item.content || "").trim());
  const userMessage = String(lastUserMessage?.content || "");

  if (isNutritionIntent(userMessage)) {
    const parsedItems = parseFoodItemsFromMessage(userMessage);
    const result = calculateNutritionItems(parsedItems, {
      userId: payload.context?.userId || payload.userId || "",
      db: getNutritionDb(),
    });

    console.log("[FruitFit Nutrition] Coach nutrition calculation", {
      parsedItems,
      matchedItems: result.items.length,
      warnings: result.warnings.length,
    });

    const answer = parsedItems.length
      ? buildNutritionAnswer(result)
      : "Напиши продукты и граммовки, например: 300 г творога 5% и 50 г грецких орехов.";

    response.json(openAiStyleResponse(answer, { nutrition: result, parsedItems }));
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const model = getOpenAiModel();
  if (!apiKey) {
    console.error("[tagirfruit] OPENAI_API_KEY is missing in .env");
    response.status(500).json({ error: "OPENAI_API_KEY не найден в .env" });
    return;
  }

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
      max_output_tokens: 250,
      reasoning: { effort: "minimal" },
      text: { verbosity: "low" },
    }),
  });

  const data = await openAiResponse.json().catch(() => ({}));
  if (!openAiResponse.ok) {
    logOpenAiError({ status: openAiResponse.status, data, model });
    response.status(openAiResponse.status).json({
      error: "Ошибка AI: смотри terminal/dev console",
      details: data.error?.message || "OpenAI API error",
    });
    return;
  }

  const answer = extractResponseText(data);
  if (!answer) {
    console.error("[tagirfruit] Empty OpenAI response", {
      endpoint: OPENAI_ENDPOINT,
      model,
      responseId: data.id || null,
      status: data.status || null,
    });
    response.status(502).json({ error: "Ошибка AI: смотри terminal/dev console" });
    return;
  }

  response.json(openAiStyleResponse(answer));
}

function openAiStyleResponse(content, extra = {}) {
  return {
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
        },
        finish_reason: "stop",
      },
    ],
    ...extra,
  };
}
