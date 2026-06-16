import crypto from "node:crypto";
import express from "express";
import { requireUser } from "./auth.js";
import { config } from "./config.js";
import { query } from "./db.js";
import { getFcmStatus, sendFcmMessage } from "./fcm.js";
import { buildUtcMotivationSchedule, MOTIVATION_MESSAGES } from "../../shared/motivationMessages.js";

export const notificationRouter = express.Router();

notificationRouter.use(requireUser);

notificationRouter.get("/", async (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 100));
  const result = await query(
    `SELECT id, kind, title, body, data, status, scheduled_at, sent_at,
            COALESCE(sent_at, scheduled_at, created_at) AS display_sent_at,
            read_at, created_at, updated_at
     FROM notification_events
     WHERE user_id = $1
       AND COALESCE(sent_at, scheduled_at, created_at) <= now()
     ORDER BY COALESCE(sent_at, scheduled_at, created_at) DESC
     LIMIT $2`,
    [req.user.id, limit]
  );
  res.json({
    items: result.rows,
    pushConfigured: isPushProviderConfigured(),
    messageLibrarySize: MOTIVATION_MESSAGES.length
  });
});

notificationRouter.post("/tokens", async (req, res) => {
  const token = String(req.body?.token || "").trim();
  if (!token) {
    res.status(400).json({ error: "token is required" });
    return;
  }

  const platform = normalizePlatform(req.body?.platform);
  const provider = normalizeProvider(req.body?.provider);
  const deviceId = req.body?.deviceId ? String(req.body.deviceId).slice(0, 160) : null;
  const meta = sanitizeObject({
    ...(req.body?.meta || {}),
    appVersion: req.body?.appVersion || undefined,
    locale: req.body?.locale || undefined,
    registeredFrom: req.body?.registeredFrom || "client"
  });

  const result = await query(
    `INSERT INTO push_tokens (user_id, platform, provider, token, device_id, enabled, meta, updated_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, true, $6, now(), now())
     ON CONFLICT (token)
     DO UPDATE SET user_id = EXCLUDED.user_id,
                   platform = EXCLUDED.platform,
                   provider = EXCLUDED.provider,
                   device_id = EXCLUDED.device_id,
                   enabled = true,
                   meta = push_tokens.meta || EXCLUDED.meta,
                   updated_at = now(),
                   last_seen_at = now()
     RETURNING id, platform, provider, device_id, enabled, created_at, updated_at, last_seen_at`,
    [req.user.id, platform, provider, token, deviceId, meta]
  );

  res.status(201).json({ token: result.rows[0], pushConfigured: isPushProviderConfigured() });
});

notificationRouter.delete("/tokens", async (req, res) => {
  const token = String(req.body?.token || "").trim();
  const deviceId = req.body?.deviceId ? String(req.body.deviceId).slice(0, 160) : null;
  if (!token && !deviceId) {
    res.status(400).json({ error: "token or deviceId is required" });
    return;
  }

  const result = await query(
    `UPDATE push_tokens
     SET enabled = false, updated_at = now()
     WHERE user_id = $1
       AND (($2::text IS NOT NULL AND token = $2) OR ($3::text IS NOT NULL AND device_id = $3))
     RETURNING id, platform, provider, device_id, enabled, updated_at`,
    [req.user.id, token || null, deviceId]
  );
  res.json({ disabled: result.rowCount, tokens: result.rows });
});

notificationRouter.patch("/:id/read", async (req, res) => {
  const result = await query(
    `UPDATE notification_events
     SET read_at = COALESCE(read_at, now()), updated_at = now()
     WHERE user_id = $1 AND id = $2
     RETURNING id, read_at, updated_at`,
    [req.user.id, String(req.params.id)]
  );
  if (!result.rowCount) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }
  res.json({ item: result.rows[0] });
});

notificationRouter.post("/test", async (req, res) => {
  const payload = {
    kind: String(req.body?.kind || "test").slice(0, 80),
    title: String(req.body?.title || "FruitFit").slice(0, 120),
    body: String(req.body?.body || "Тестовое уведомление готово к отправке.").slice(0, 500),
    data: sanitizeObject(req.body?.data || { source: "manual-test" })
  };
  const result = await query(
    `INSERT INTO notification_events (id, user_id, kind, title, body, data, status, scheduled_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'queued', now())
     RETURNING id, kind, title, body, data, status, scheduled_at, created_at`,
    [crypto.randomUUID(), req.user.id, payload.kind, payload.title, payload.body, payload.data]
  );

  res.status(201).json({
    item: result.rows[0],
    pushConfigured: isPushProviderConfigured(),
    delivery: isPushProviderConfigured() ? "queued" : "queued_without_provider"
  });
});

notificationRouter.post("/test-pack", async (req, res) => {
  const startAt = req.body?.startAt ? new Date(req.body.startAt) : new Date();
  const timezoneOffsetMinutes = normalizeOffset(req.body?.timezoneOffsetMinutes);
  const schedule = buildUtcMotivationSchedule({
    now: startAt,
    days: 5,
    timezoneOffsetMinutes,
    previousBody: await latestMotivationBody(req.user.id)
  }).slice(0, 10);
  const rows = [];

  for (let index = 0; index < schedule.length; index += 1) {
    const item = schedule[index];
    const result = await query(
      `INSERT INTO notification_events (id, user_id, kind, title, body, data, status, scheduled_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7)
       ON CONFLICT DO NOTHING
       RETURNING id, kind, title, body, data, status, scheduled_at, created_at`,
      [
        crypto.randomUUID(),
        req.user.id,
        item.kind,
        item.title,
        item.body,
        {
          ...item.data,
          pack: "motivation-preview-10",
          index: index + 1,
          cadence: "2-3/day"
        },
        item.scheduledAt
      ]
    );
    if (result.rows[0]) rows.push(result.rows[0]);
  }

  res.status(201).json({
    items: rows,
    count: rows.length,
    cadence: "2-3/day",
    pushConfigured: isPushProviderConfigured(),
    delivery: isPushProviderConfigured() ? "queued" : "queued_without_provider"
  });
});

notificationRouter.post("/motivation/schedule", async (req, res) => {
  const days = Math.max(1, Math.min(Number(req.body?.days || 7), 14));
  const timezoneOffsetMinutes = normalizeOffset(req.body?.timezoneOffsetMinutes);
  const schedule = buildUtcMotivationSchedule({
    now: new Date(),
    days,
    timezoneOffsetMinutes,
    previousBody: await latestMotivationBody(req.user.id)
  });
  const rows = [];

  for (const item of schedule) {
    const result = await query(
      `INSERT INTO notification_events (id, user_id, kind, title, body, data, status, scheduled_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7)
       ON CONFLICT DO NOTHING
       RETURNING id, kind, title, body, data, status, scheduled_at, created_at`,
      [crypto.randomUUID(), req.user.id, item.kind, item.title, item.body, item.data, item.scheduledAt]
    );
    if (result.rows[0]) rows.push(result.rows[0]);
  }

  res.status(201).json({
    items: rows,
    count: rows.length,
    cadence: "2-3/day",
    messageLibrarySize: MOTIVATION_MESSAGES.length,
    pushConfigured: isPushProviderConfigured()
  });
});

notificationRouter.post("/dispatch-due", async (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.body?.limit || 20), 100));
  const fcmStatus = getFcmStatus();
  const due = await query(
    `SELECT id, kind, title, body, data, scheduled_at
     FROM notification_events
     WHERE user_id = $1
       AND status = 'queued'
       AND COALESCE(scheduled_at, created_at) <= now()
     ORDER BY COALESCE(scheduled_at, created_at)
     LIMIT $2`,
    [req.user.id, limit]
  );
  const tokens = fcmStatus.configured
    ? await query("SELECT token FROM push_tokens WHERE user_id = $1 AND enabled = true", [req.user.id])
    : { rows: [] };
  const rows = [];

  for (const item of due.rows) {
    const deliveries = [];
    if (fcmStatus.configured && tokens.rows.length) {
      for (const tokenRow of tokens.rows) {
        try {
          await sendFcmMessage({
            token: tokenRow.token,
            title: item.title,
            body: item.body,
            data: { ...item.data, notificationId: item.id, kind: item.kind }
          });
          deliveries.push({ provider: "fcm", ok: true });
        } catch (error) {
          deliveries.push({ provider: "fcm", ok: false, error: String(error?.message || error).slice(0, 240) });
        }
      }
    }

    const successCount = deliveries.filter((delivery) => delivery.ok).length;
    const delivery = successCount > 0 ? "fcm" : "in_app_simulated";
    const status = successCount > 0 ? "sent" : "in_app";
    const updated = await query(
      `UPDATE notification_events
       SET status = $2,
           sent_at = COALESCE(sent_at, now()),
           data = data || $3::jsonb,
           updated_at = now()
       WHERE id = $1 AND user_id = $4
       RETURNING id, kind, title, body, data, status, scheduled_at, sent_at, read_at`,
      [
        item.id,
        status,
        JSON.stringify({ delivery, deliveries, fcmConfigured: fcmStatus.configured }),
        req.user.id
      ]
    );
    if (updated.rows[0]) rows.push(updated.rows[0]);
  }

  res.json({
    items: rows,
    count: rows.length,
    pushConfigured: fcmStatus.configured,
    delivery: fcmStatus.configured ? "fcm_or_in_app_fallback" : "in_app_simulated"
  });
});

function normalizePlatform(value) {
  const platform = String(value || "android").toLowerCase();
  if (["android", "ios", "web"].includes(platform)) return platform;
  return "android";
}

function normalizeProvider(value) {
  const provider = String(value || config.pushProvider || "fcm").toLowerCase();
  if (["fcm", "apns", "web-push", "expo"].includes(provider)) return provider;
  return "fcm";
}

function isPushProviderConfigured() {
  if (config.pushProvider === "fcm") return getFcmStatus().configured;
  return false;
}

async function latestMotivationBody(userId) {
  const result = await query(
    `SELECT body
     FROM notification_events
     WHERE user_id = $1 AND kind = 'motivation'
     ORDER BY COALESCE(scheduled_at, sent_at, created_at) DESC
     LIMIT 1`,
    [userId]
  );
  return result.rows[0]?.body || "";
}

function normalizeOffset(value) {
  const offset = Number(value);
  if (Number.isFinite(offset) && offset >= -720 && offset <= 840) return offset;
  return 180;
}

function sanitizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value));
}
