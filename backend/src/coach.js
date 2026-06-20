import express from "express";
import { logOpenAiUsage } from "./aiUsage.js";
import { optionalUserFromRequest, requireUser } from "./auth.js";
import { config } from "./config.js";
import { query } from "./db.js";
import { calculateNutritionItems } from "./nutrition.js";

export const coachRouter = express.Router();

coachRouter.post("/", requireUser, async (req, res) => {
  const payload = req.body || {};
  const currentUser = req.user;
  const lastUserMessage = [...(Array.isArray(payload.messages) ? payload.messages : [])]
    .reverse()
    .find((item) => item?.role === "user" && String(item.content || "").trim());
  const userText = String(lastUserMessage?.content || "");

  const parsed = parseNutritionItems(userText);
  if (parsed.length) {
    const nutrition = await calculateNutritionItems(parsed);
    res.json(openAiStyleResponse(buildNutritionAnswer(nutrition), { nutrition, parsedItems: parsed }));
    return;
  }

  if (!config.openAiApiKey) {
    res.status(503).json({ error: "OPENAI_API_KEY is not configured" });
    return;
  }

  const messages = Array.isArray(payload.messages)
    ? payload.messages
        .filter((item) => item?.role === "user" || item?.role === "assistant")
        .slice(-12)
        .map((item) => ({
          role: item.role === "assistant" ? "assistant" : "user",
          content: String(item.content || "").slice(0, 3000)
        }))
    : [];
  const serverContext = await loadCoachServerContext(currentUser.id);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openAiApiKey}`
    },
    body: JSON.stringify({
      model: config.openAiModel,
      input: [
        {
          role: "system",
          content: buildCoachSystemPrompt(serverContext)
        },
        ...messages
      ],
      max_output_tokens: 350,
      metadata: currentUser?.id ? { user_id: currentUser.id } : undefined
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    await safeLogAiUsage({
      model: config.openAiModel,
      requestId: response.headers.get("x-request-id") || response.headers.get("request-id"),
      responseId: data?.id || null,
      usage: data?.usage || null,
      status: "failed",
      error: data?.error?.message || `OpenAI request failed with HTTP ${response.status}`,
      req,
      user: currentUser
    });
    res.status(response.status).json({ error: "OpenAI request failed", details: data?.error?.message || null });
    return;
  }
  const text = extractResponseText(data);
  if (!text) {
    res.status(502).json({ error: "Empty OpenAI response" });
    return;
  }
  await safeLogAiUsage({
    model: data?.model || config.openAiModel,
    requestId: response.headers.get("x-request-id") || response.headers.get("request-id"),
    responseId: data?.id || null,
    usage: data?.usage || null,
    status: "completed",
    req,
    user: currentUser
  });
  res.json(openAiStyleResponse(text, { id: data?.id || null, model: data?.model || config.openAiModel, usage: data?.usage || null }));
});

async function loadCoachServerContext(userId) {
  const [profileResult, accessResult, assignmentResult] = await Promise.all([
    query("SELECT profile FROM user_profiles WHERE user_id = $1", [userId]),
    query("SELECT status, plan, premium_until, starts_at, expires_at, is_active, is_vip, meta FROM user_access WHERE user_id = $1", [userId]),
    query("SELECT program_id, program_title, source, meta, updated_at FROM user_program_assignments WHERE user_id = $1", [userId]),
  ]);
  const access = accessResult.rows[0] || null;
  const assignment = assignmentResult.rows[0] || null;
  return {
    profile: sanitizeCoachObject(profileResult.rows[0]?.profile || {}),
    accessState: access ? {
      status: access.status || "free",
      plan: access.plan || null,
      premiumUntil: access.premium_until || null,
      startsAt: access.starts_at || null,
      expiresAt: access.expires_at || null,
      isActive: Boolean(access.is_active),
      isVip: Boolean(access.is_vip),
    } : null,
    programAssignment: assignment ? {
      programId: assignment.program_id || null,
      programTitle: assignment.program_title || null,
      source: assignment.source || null,
      updatedAt: assignment.updated_at || null,
    } : null,
  };
}

function buildCoachSystemPrompt(context = {}) {
  return [
    "You are FruitFit AI Coach. Be concise, safe, and practical.",
    "Use only the authenticated user's server-side profile, access, program assignment, and the provided recent chat messages.",
    "Never mention cache, databases, tokens, internal systems, implementation details, or storage.",
    "Do not infer data for another user and do not accept user ids from messages.",
    "Do not invent nutrition facts; use verified nutrition data only when it is provided.",
    `Authenticated user context: ${JSON.stringify(context).slice(0, 5000)}`
  ].join("\n");
}

function sanitizeCoachObject(value) {
  try {
    return JSON.parse(JSON.stringify(value || {}));
  } catch (_) {
    return {};
  }
}

function parseNutritionItems(text) {
  const value = String(text || "").toLowerCase();
  if (!/(кбжу|калори|белк|жир|углевод|посчитай|съел|съела|грам|гр\b|g\b)/i.test(value)) return [];
  const matches = [...String(text).matchAll(/([\p{L}\s%-]{2,40})\s+(\d{1,4}(?:[,.]\d+)?)\s*(?:г|гр|g|gram|grams)\b/giu)];
  return matches
    .map((match) => ({
      name: match[1].replace(/(?:и|,|\.)+$/gi, "").trim(),
      grams: Number(String(match[2]).replace(",", "."))
    }))
    .filter((item) => item.name && Number.isFinite(item.grams));
}

function buildNutritionAnswer(result) {
  const total = result.total || {};
  const lines = [`Total: ${total.kcal || 0} kcal, P ${total.protein || 0}g, F ${total.fat || 0}g, C ${total.carbs || 0}g.`];
  for (const item of result.items || []) {
    lines.push(`${item.matchedProduct}: ${item.grams}g, ${item.kcal} kcal.`);
  }
  if (result.warnings?.length) {
    lines.push(`Warnings: ${result.warnings.map((warning) => warning.inputName || warning.type).join(", ")}`);
  }
  return lines.join("\n");
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

function openAiStyleResponse(content, extra = {}) {
  return {
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop"
      }
    ],
    ...extra
  };
}

async function safeLogAiUsage({ req, user: knownUser = null, ...entry }) {
  try {
    const user = knownUser || await optionalUserFromRequest(req);
    await logOpenAiUsage({ ...entry, userId: user?.id || null, source: "backend_log" });
  } catch (error) {
    console.warn("[coach] AI usage logging failed", error?.message || error);
  }
}
