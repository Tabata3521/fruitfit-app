import OpenAI from "openai";
import express from "express";
import { hasValidAdminToken, requireAdmin, requireUser } from "./auth.js";
import { config } from "./config.js";
import { query } from "./db.js";

export const openAiWebhookRouter = express.Router();
export const adminAiRouter = express.Router();

const MODEL_COSTS_PER_1M = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gpt-5-mini": { input: 0.25, output: 2.0 },
  "gpt-5.4-mini": { input: 0.25, output: 2.0 },
};

function openAiClient({ forWebhook = false } = {}) {
  return new OpenAI({
    apiKey: config.openAiApiKey || (forWebhook ? "webhook-signature-only" : undefined),
    webhookSecret: config.openAiWebhookSecret || undefined,
  });
}

export async function logOpenAiUsage({
  userId = null,
  model = config.openAiModel,
  requestId = null,
  responseId = null,
  usage = null,
  source = "backend_log",
  status = "completed",
  error = null,
  createdAt = null,
} = {}) {
  const normalized = normalizeUsage(usage);
  if (!normalized.totalTokens && status === "completed" && !responseId) return null;
  const safeUserId = await existingUserId(userId);
  const estimatedCostUsd = estimateCostUsd(model, normalized.promptTokens, normalized.completionTokens);
  if (responseId) {
    const update = await query(
      `UPDATE ai_usage_logs
       SET user_id = COALESCE($1::text, user_id),
           model = COALESCE(NULLIF($2::text, ''), model),
           request_id = COALESCE($3::text, request_id),
           prompt_tokens = CASE WHEN $4::integer > 0 THEN $4::integer ELSE prompt_tokens END,
           completion_tokens = CASE WHEN $5::integer > 0 THEN $5::integer ELSE completion_tokens END,
           total_tokens = CASE WHEN $6::integer > 0 THEN $6::integer ELSE total_tokens END,
           estimated_cost_usd = CASE WHEN $7::numeric > 0 OR $4::integer > 0 OR $5::integer > 0 THEN $7::numeric ELSE estimated_cost_usd END,
           source = $8::text,
           status = $9::text,
           error = $10::text
       WHERE id = (
         SELECT id
         FROM ai_usage_logs
         WHERE response_id = $11::text
         ORDER BY created_at DESC
         LIMIT 1
       )
       RETURNING *`,
      [
        safeUserId,
        model || "unknown",
        requestId,
        normalized.promptTokens,
        normalized.completionTokens,
        normalized.totalTokens,
        estimatedCostUsd,
        source,
        status,
        error ? String(error).slice(0, 2000) : null,
        responseId,
      ]
    );
    if (update.rowCount) return update.rows[0];
  }
  const result = await query(
    `INSERT INTO ai_usage_logs (
       user_id, provider, model, request_id, response_id,
       prompt_tokens, completion_tokens, total_tokens,
       estimated_cost_usd, source, status, error, created_at
     )
     VALUES ($1, 'openai', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12::timestamptz, now()))
     RETURNING *`,
    [
      safeUserId,
      model || "unknown",
      requestId,
      responseId,
      normalized.promptTokens,
      normalized.completionTokens,
      normalized.totalTokens,
      estimatedCostUsd,
      source,
      status,
      error ? String(error).slice(0, 2000) : null,
      createdAt,
    ]
  );
  return result.rows[0];
}

openAiWebhookRouter.post("/", async (req, res) => {
  if (!config.openAiWebhookSecret) {
    res.status(503).json({ error: "OPENAI_WEBHOOK_SECRET is not configured" });
    return;
  }

  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body || "");
  let event;
  try {
    event = await openAiClient({ forWebhook: true }).webhooks.unwrap(rawBody, req.headers, config.openAiWebhookSecret);
  } catch (error) {
    if (error instanceof OpenAI.InvalidWebhookSignatureError || String(error?.message || "").startsWith("Missing required header:")) {
      res.status(400).send("Invalid signature");
      return;
    }
    throw error;
  }

  const webhookId = String(req.headers["webhook-id"] || event?.id || "");
  if (!webhookId) {
    res.status(400).json({ error: "Missing webhook-id" });
    return;
  }

  const responseId = responseIdFromEvent(event);
  const usageLog = usageLogFromEvent(event, responseId);
  const insert = await query(
    `INSERT INTO openai_webhook_events (
       webhook_id, event_id, event_type, response_id, raw_json,
       user_id, model, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (webhook_id) DO NOTHING
     RETURNING webhook_id`,
    [
      webhookId,
      event?.id || null,
      event?.type || null,
      responseId,
      event || {},
      usageLog.userId,
      usageLog.model,
      usageLog.usage.promptTokens,
      usageLog.usage.completionTokens,
      usageLog.usage.totalTokens,
      usageLog.estimatedCostUsd,
    ]
  );

  if (!insert.rowCount) {
    res.status(200).json({ ok: true, duplicate: true });
    return;
  }

  queueWebhookUsageLog(event, responseId, usageLog);
  res.status(200).json({ ok: true });
});

adminAiRouter.use((req, res, next) => {
  if (hasValidAdminToken(req)) {
    next();
    return;
  }
  requireUser(req, res, () => requireAdmin(req, res, next));
});

adminAiRouter.get("/usage", async (req, res) => {
  const period = normalizePeriod(req.query.period);
  const [summary, topUsers, byModel, timeseries, budget] = await Promise.all([
    loadUsageSummary(period),
    loadUsageByUser(period, 5),
    loadUsageByModel(period),
    loadUsageTimeseries(period),
    loadAiBudget(),
  ]);
  res.json({
    period: period.id,
    summary: withForecast(summary, budget, period),
    topUsers,
    byModel,
    timeseries,
    budget,
  });
});

adminAiRouter.get("/usage/by-user", async (req, res) => {
  const period = normalizePeriod(req.query.period);
  res.json({ period: period.id, users: await loadUsageByUser(period, Number(req.query.limit || 50)) });
});

adminAiRouter.get("/by-user", async (req, res) => {
  const period = normalizePeriod(req.query.period);
  res.json({ period: period.id, users: await loadUsageByUser(period, Number(req.query.limit || 50)) });
});

adminAiRouter.get("/usage/by-model", async (req, res) => {
  const period = normalizePeriod(req.query.period);
  res.json({ period: period.id, models: await loadUsageByModel(period) });
});

adminAiRouter.get("/by-model", async (req, res) => {
  const period = normalizePeriod(req.query.period);
  res.json({ period: period.id, models: await loadUsageByModel(period) });
});

adminAiRouter.get("/budget", async (_req, res) => {
  res.json({ budget: await loadAiBudget() });
});

adminAiRouter.put("/budget", async (req, res) => {
  const budgetUsd = finiteNumber(req.body?.budgetUsd ?? req.body?.budget_usd);
  const manualBalanceUsd = finiteNumber(req.body?.manualBalanceUsd ?? req.body?.manual_balance_usd);
  const data = {
    budgetUsd: budgetUsd ?? 0,
    manualBalanceUsd: manualBalanceUsd ?? budgetUsd ?? 0,
    billingProvider: "manual",
    updatedAt: new Date().toISOString(),
  };
  const result = await query(
    `INSERT INTO app_settings (key, data, updated_at)
     VALUES ('ai_budget', $1, now())
     ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
     RETURNING data, updated_at`,
    [data]
  );
  res.json({ budget: serializeBudget(result.rows[0]) });
});

function queueWebhookUsageLog(event, responseId, eventUsageLog) {
  setImmediate(async () => {
    try {
      if (event?.type === "response.failed") {
        await logOpenAiUsage({
          userId: eventUsageLog?.userId || null,
          model: eventUsageLog?.model || config.openAiModel,
          responseId,
          usage: eventUsageLog?.usage || null,
          source: "webhook",
          status: "failed",
          error: event?.data?.error?.message || event?.data?.error || "response.failed",
          createdAt: createdAtFromEvent(event),
        });
        return;
      }
      if (event?.type !== "response.completed" || !responseId) return;
      let response = responsePayloadFromEvent(event);
      if ((!response?.usage || !response?.model) && config.openAiApiKey) {
        response = await openAiClient().responses.retrieve(responseId);
      }
      if (response?.usage) {
        await logOpenAiUsage({
          userId: userIdFromPayload(response) || eventUsageLog?.userId || null,
          model: response.model || config.openAiModel,
          responseId: response.id || responseId,
          usage: response.usage,
          source: "webhook",
          status: "completed",
          createdAt: createdAtFromEvent(event),
        });
      }
    } catch (error) {
      console.warn("[ai-usage] webhook usage log failed", error?.message || error);
    }
  });
}

function responsePayloadFromEvent(event) {
  const data = event?.data || {};
  return data.response || data;
}

function responseIdFromEvent(event) {
  const data = event?.data || {};
  return data.id || data.response_id || data.response?.id || null;
}

function userIdFromPayload(payload = {}) {
  const metadata = payload.metadata || payload.meta || {};
  return payload.user_id || payload.userId || metadata.user_id || metadata.userId || metadata.fruitfit_user_id || null;
}

function createdAtFromEvent(event) {
  const value = event?.created_at || event?.created || event?.data?.created_at || event?.data?.created;
  if (!value) return null;
  if (typeof value === "number") return new Date(value * 1000).toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function usageLogFromEvent(event, responseId) {
  const payload = responsePayloadFromEvent(event);
  const usage = normalizeUsage(payload?.usage || event?.data?.usage || {});
  const model = payload?.model || event?.data?.model || config.openAiModel;
  return {
    responseId,
    userId: userIdFromPayload(payload) || userIdFromPayload(event?.data || {}),
    model,
    usage,
    estimatedCostUsd: estimateCostUsd(model, usage.promptTokens, usage.completionTokens),
  };
}

function normalizeUsage(usage = {}) {
  const value = usage || {};
  const promptTokens = intValue(value.prompt_tokens ?? value.promptTokens ?? value.input_tokens ?? value.inputTokens);
  const completionTokens = intValue(value.completion_tokens ?? value.completionTokens ?? value.output_tokens ?? value.outputTokens);
  const totalTokens = intValue(value.total_tokens ?? value.totalTokens) || promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

function estimateCostUsd(model, promptTokens, completionTokens) {
  const costs = {
    input: config.openAiInputCostPer1M || MODEL_COSTS_PER_1M[model]?.input || 0,
    output: config.openAiOutputCostPer1M || MODEL_COSTS_PER_1M[model]?.output || 0,
  };
  return Number((((promptTokens * costs.input) + (completionTokens * costs.output)) / 1_000_000).toFixed(6));
}

function normalizePeriod(value) {
  const id = ["7d", "30d", "90d"].includes(String(value)) ? String(value) : "7d";
  const days = id === "90d" ? 90 : id === "30d" ? 30 : 7;
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return { id, days, from };
}

async function loadUsageSummary(period) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const result = await query(
    `SELECT
       COALESCE(SUM(total_tokens) FILTER (WHERE created_at >= $2), 0)::bigint AS tokens_today,
       COALESCE(SUM(estimated_cost_usd) FILTER (WHERE created_at >= $2), 0)::numeric AS cost_today,
       COALESCE(SUM(total_tokens), 0)::bigint AS tokens_period,
       COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_tokens,
       COALESCE(SUM(completion_tokens), 0)::bigint AS completion_tokens,
       COALESCE(SUM(estimated_cost_usd), 0)::numeric AS estimated_cost_usd,
       COUNT(*)::integer AS requests,
       COUNT(*) FILTER (WHERE created_at >= $2)::integer AS requests_today,
       COUNT(*) FILTER (WHERE status = 'failed')::integer AS failed_requests
     FROM ai_usage_logs
     WHERE created_at >= $1`,
    [period.from, today]
  );
  const row = result.rows[0] || {};
  const requests = Number(row.requests || 0);
  return {
    tokensToday: Number(row.tokens_today || 0),
    requestsToday: Number(row.requests_today || 0),
    costTodayUsd: Number(row.cost_today || 0),
    tokensPeriod: Number(row.tokens_period || 0),
    promptTokens: Number(row.prompt_tokens || 0),
    completionTokens: Number(row.completion_tokens || 0),
    estimatedCostUsd: Number(row.estimated_cost_usd || 0),
    requests,
    failedRequests: Number(row.failed_requests || 0),
    averageTokensPerRequest: requests ? Math.round(Number(row.tokens_period || 0) / requests) : 0,
  };
}

async function loadUsageByUser(period, limit = 50) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const result = await query(
    `SELECT l.user_id,
            COALESCE(u.name, u.email, u.username, l.user_id, 'unknown') AS label,
            COUNT(*)::integer AS requests,
            COALESCE(SUM(l.total_tokens), 0)::bigint AS total_tokens,
            COALESCE(SUM(l.estimated_cost_usd), 0)::numeric AS estimated_cost_usd
     FROM ai_usage_logs l
     LEFT JOIN users u ON u.id = l.user_id
     WHERE l.created_at >= $1
     GROUP BY l.user_id, label
     ORDER BY estimated_cost_usd DESC, total_tokens DESC
     LIMIT $2`,
    [period.from, safeLimit]
  );
  return result.rows.map((row) => ({
    userId: row.user_id,
    label: row.label,
    requests: Number(row.requests || 0),
    totalTokens: Number(row.total_tokens || 0),
    estimatedCostUsd: Number(row.estimated_cost_usd || 0),
  }));
}

async function loadUsageTimeseries(period) {
  const result = await query(
    `SELECT date_trunc('day', created_at)::date AS day,
            COUNT(*)::integer AS requests,
            COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
            COALESCE(SUM(estimated_cost_usd), 0)::numeric AS estimated_cost_usd
     FROM ai_usage_logs
     WHERE created_at >= $1
     GROUP BY date_trunc('day', created_at)::date
     ORDER BY day ASC`,
    [period.from]
  );
  const byDay = new Map(result.rows.map((row) => [dateKey(row.day), row]));
  const days = [];
  const cursor = new Date(period.from);
  cursor.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  while (cursor <= today) {
    const key = dateKey(cursor);
    const row = byDay.get(key) || {};
    days.push({
      date: key,
      requests: Number(row.requests || 0),
      totalTokens: Number(row.total_tokens || 0),
      estimatedCostUsd: Number(row.estimated_cost_usd || 0),
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

async function loadUsageByModel(period) {
  const result = await query(
    `SELECT COALESCE(model, 'unknown') AS model,
            COUNT(*)::integer AS requests,
            COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0)::bigint AS completion_tokens,
            COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
            COALESCE(SUM(estimated_cost_usd), 0)::numeric AS estimated_cost_usd
     FROM ai_usage_logs
     WHERE created_at >= $1
     GROUP BY COALESCE(model, 'unknown')
     ORDER BY estimated_cost_usd DESC, total_tokens DESC`,
    [period.from]
  );
  return result.rows.map((row) => ({
    model: row.model,
    requests: Number(row.requests || 0),
    promptTokens: Number(row.prompt_tokens || 0),
    completionTokens: Number(row.completion_tokens || 0),
    totalTokens: Number(row.total_tokens || 0),
    estimatedCostUsd: Number(row.estimated_cost_usd || 0),
  }));
}

async function loadAiBudget() {
  const result = await query("SELECT data, updated_at FROM app_settings WHERE key = 'ai_budget'");
  return serializeBudget(result.rows[0]);
}

function withForecast(summary, budget, period) {
  const dailyCost = summary.estimatedCostUsd ? summary.estimatedCostUsd / Math.max(1, period.days) : 0;
  const balance = Number(budget.manualBalanceUsd || budget.budgetUsd || config.openAiBudgetUsd || 0);
  return {
    ...summary,
    forecastDaysLeft: dailyCost > 0 && balance > 0 ? Math.floor(balance / dailyCost) : null,
    dailyEstimatedCostUsd: Number(dailyCost.toFixed(6)),
  };
}

function serializeBudget(row = {}) {
  const data = row?.data || {};
  const budgetUsd = finiteNumber(data.budgetUsd ?? data.budget_usd) ?? config.openAiBudgetUsd ?? 0;
  const manualBalanceUsd = finiteNumber(data.manualBalanceUsd ?? data.manual_balance_usd) ?? budgetUsd;
  return {
    budgetUsd,
    manualBalanceUsd,
    billingProvider: data.billingProvider || "manual",
    directBillingApi: "not_available",
    updatedAt: row?.updated_at || data.updatedAt || null,
  };
}

function intValue(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function existingUserId(userId) {
  if (!userId) return null;
  const result = await query("SELECT id FROM users WHERE id = $1", [String(userId)]);
  return result.rows[0]?.id || null;
}

function dateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}
