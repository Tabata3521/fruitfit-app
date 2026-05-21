import { TAGIRFRUIT_SYSTEM_PROMPT, buildTagirfruitContextMessage } from "../../server/coachPrompt.js";

const DEFAULT_MODEL = "gpt-5-nano";
const OPENAI_ENDPOINT = "responses";
const OPENAI_URL = "https://api.openai.com/v1/responses";

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function buildContextMessage(context = {}) {
  return `Контекст приложения FruitFit:
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

export async function onRequestOptions() {
  return json({ ok: true });
}

export async function onRequestPost({ request, env }) {
  const apiKey = env.OPENAI_API_KEY || "";
  const model = env.OPENAI_MODEL || DEFAULT_MODEL;

  if (!apiKey) {
    console.error("[tagirfruit] OPENAI_API_KEY is missing in Cloudflare Pages env");
    return json({ error: "OPENAI_API_KEY не найден в Cloudflare Pages env" }, 500);
  }

  try {
    const payload = await request.json();
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
      return json(
        {
          error: "Ошибка AI: смотри Cloudflare Pages Functions logs",
          details: data.error?.message || "OpenAI API error",
        },
        openAiResponse.status,
      );
    }

    const answer = extractResponseText(data);
    if (!answer) {
      console.error("[tagirfruit] Empty OpenAI response", {
        endpoint: OPENAI_ENDPOINT,
        model,
        responseId: data.id || null,
        status: data.status || null,
      });
      return json({ error: "Ошибка AI: смотри Cloudflare Pages Functions logs" }, 502);
    }

    return json({ answer });
  } catch (error) {
    console.error("[tagirfruit] Pages Function error", {
      endpoint: OPENAI_ENDPOINT,
      model,
      message: error.message || "Unknown function error",
    });
    return json({ error: "Ошибка AI: смотри Cloudflare Pages Functions logs" }, 500);
  }
}
