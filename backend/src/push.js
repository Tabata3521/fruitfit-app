import express from "express";
import { requireUser } from "./auth.js";
import { config } from "./config.js";
import { query } from "./db.js";
import { getFcmStatus } from "./fcm.js";

export const pushRouter = express.Router();

pushRouter.use(requireUser);

pushRouter.post("/register-token", async (req, res) => {
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
    registeredFrom: req.body?.registeredFrom || "client-push-api"
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
     RETURNING id, user_id, platform, provider, device_id, enabled, created_at, updated_at, last_seen_at`,
    [req.user.id, platform, provider, token, deviceId, meta]
  );

  const fcmStatus = getFcmStatus();
  res.status(201).json({
    status: "registered",
    token: result.rows[0],
    fcmConfigured: fcmStatus.configured,
    fcmStatus: publicFcmStatus(fcmStatus)
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

function publicFcmStatus(status = getFcmStatus()) {
  return {
    provider: "fcm",
    configured: status.configured,
    status: status.configured ? "READY" : "FCM_NOT_CONFIGURED",
    requiredEnv: status.configured ? [] : ["FCM_PROJECT_ID", "FCM_SERVICE_ACCOUNT_JSON"]
  };
}

function sanitizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value));
}
