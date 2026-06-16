import crypto from "node:crypto";
import express from "express";
import { requireAdmin } from "./auth.js";
import { query } from "./db.js";
import { getFcmStatus, sendFcmMessage } from "./fcm.js";
import { buildUtcMotivationSchedule, MOTIVATION_MESSAGES } from "../../shared/motivationMessages.js";

export const adminPushRouter = express.Router();

adminPushRouter.use(requireAdmin);

adminPushRouter.get("/logs", async (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit || 50), 200));
  const result = await query(
    `SELECT pl.id, pl.campaign_id, pl.user_id, pl.token_id, pl.status,
            pl.provider_message_id, pl.error, pl.sent_at, pl.created_at,
            pc.title, pc.body, pc.audience, pc.status AS campaign_status,
            pc.scheduled_at, pc.created_by
     FROM push_logs pl
     LEFT JOIN push_campaigns pc ON pc.id = pl.campaign_id
     ORDER BY pl.created_at DESC
     LIMIT $1`,
    [limit]
  );

  res.json({
    items: result.rows,
    fcmStatus: publicFcmStatus(),
    messageLibrarySize: MOTIVATION_MESSAGES.length
  });
});

adminPushRouter.post("/send-test", async (req, res) => {
  const payload = normalizePayload(req.body);
  const campaign = await createCampaign({
    ...payload,
    status: "sending",
    scheduledAt: null,
    createdBy: req.body?.createdBy || "admin-test"
  });
  const tokens = await loadAudienceTokens(payload);
  const delivery = await deliverCampaign({ campaign, payload, tokens, forceDryRun: Boolean(req.body?.dryRun) });

  res.status(201).json({
    status: delivery.status,
    campaignId: campaign.id,
    delivered: delivery.delivered,
    failed: delivery.failed,
    tokenCount: tokens.length,
    fcmStatus: publicFcmStatus(),
    messageLibrarySize: MOTIVATION_MESSAGES.length,
    logs: delivery.logs.slice(0, 20)
  });
});

adminPushRouter.post("/schedule", async (req, res) => {
  const payload = normalizePayload(req.body);
  const scheduledAt = normalizeScheduledAt(req.body?.scheduledAt);
  const campaign = await createCampaign({
    ...payload,
    status: "scheduled",
    scheduledAt,
    createdBy: req.body?.createdBy || "admin-schedule"
  });
  const tokens = await loadAudienceTokens(payload);

  if (!tokens.length) {
    await createLog({
      campaignId: campaign.id,
      status: "NO_TOKENS",
      error: "No enabled push tokens matched the selected audience."
    });
  } else {
    for (const token of tokens.slice(0, 500)) {
      await createLog({
        campaignId: campaign.id,
        userId: token.user_id,
        tokenId: token.id,
        status: "scheduled"
      });
    }
  }

  res.status(201).json({
    status: getFcmStatus().configured ? "scheduled" : "FCM_NOT_CONFIGURED",
    campaignId: campaign.id,
    scheduledAt,
    tokenCount: tokens.length,
    fcmStatus: publicFcmStatus(),
    messageLibrarySize: MOTIVATION_MESSAGES.length
  });
});

adminPushRouter.get("/motivation/preview", async (req, res) => {
  const days = Math.max(1, Math.min(Number(req.query.days || 5), 14));
  const timezoneOffsetMinutes = normalizeOffset(req.query.timezoneOffsetMinutes);
  const schedule = buildUtcMotivationSchedule({
    now: new Date(),
    days,
    timezoneOffsetMinutes,
    previousBody: String(req.query.previousBody || "")
  });

  res.json({
    items: schedule,
    cadence: "2-3/day",
    messageLibrarySize: MOTIVATION_MESSAGES.length
  });
});

async function deliverCampaign({ campaign, payload, tokens, forceDryRun = false }) {
  const fcmStatus = getFcmStatus();
  if (!fcmStatus.configured || forceDryRun) {
    const status = fcmStatus.configured ? "DRY_RUN" : "FCM_NOT_CONFIGURED";
    const logs = [];
    if (!tokens.length) {
      logs.push(await createLog({
        campaignId: campaign.id,
        status: tokens.length ? status : "NO_TOKENS",
        error: tokens.length ? null : "No enabled push tokens matched the selected audience.",
        sentAt: new Date()
      }));
    } else {
      for (const token of tokens.slice(0, 500)) {
        logs.push(await createLog({
          campaignId: campaign.id,
          userId: token.user_id,
          tokenId: token.id,
          status,
          error: fcmStatus.configured ? null : "FCM server credentials are not configured.",
          sentAt: new Date()
        }));
      }
    }
    await updateCampaign(campaign.id, { status, sentAt: new Date() });
    return { status, delivered: 0, failed: logs.length, logs };
  }

  const logs = [];
  let delivered = 0;
  let failed = 0;

  for (const token of tokens.slice(0, 500)) {
    try {
      const response = await sendFcmMessage({
        token: token.token,
        title: payload.title,
        body: payload.body,
        data: {
          campaignId: campaign.id,
          kind: "admin_push",
          audience: payload.audience
        }
      });
      delivered += 1;
      logs.push(await createLog({
        campaignId: campaign.id,
        userId: token.user_id,
        tokenId: token.id,
        status: "sent",
        providerMessageId: response?.name || null,
        sentAt: new Date()
      }));
    } catch (error) {
      failed += 1;
      logs.push(await createLog({
        campaignId: campaign.id,
        userId: token.user_id,
        tokenId: token.id,
        status: "failed",
        error: String(error?.message || error).slice(0, 500),
        sentAt: new Date()
      }));
    }
  }

  const status = delivered > 0 && failed === 0 ? "sent" : delivered > 0 ? "partial" : "failed";
  await updateCampaign(campaign.id, { status, sentAt: new Date() });
  return { status, delivered, failed, logs };
}

async function createCampaign({ title, body, audience, scheduledAt, status, createdBy }) {
  const id = crypto.randomUUID();
  const result = await query(
    `INSERT INTO push_campaigns (id, title, body, audience, scheduled_at, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, title, body, audience, scheduled_at, sent_at, status, created_by, created_at, updated_at`,
    [id, title, body, audience, scheduledAt, status, createdBy]
  );
  return result.rows[0];
}

async function updateCampaign(id, { status, sentAt }) {
  await query(
    `UPDATE push_campaigns
     SET status = $2,
         sent_at = COALESCE($3, sent_at),
         updated_at = now()
     WHERE id = $1`,
    [id, status, sentAt || null]
  );
}

async function createLog({ campaignId, userId = null, tokenId = null, status, providerMessageId = null, error = null, sentAt = null }) {
  const result = await query(
    `INSERT INTO push_logs (campaign_id, user_id, token_id, status, provider_message_id, error, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, campaign_id, user_id, token_id, status, provider_message_id, error, sent_at, created_at`,
    [campaignId, userId, tokenId, status, providerMessageId, error, sentAt]
  );
  return result.rows[0];
}

async function loadAudienceTokens(payload) {
  if (payload.token) {
    return [{ id: null, user_id: payload.userId || null, token: payload.token }];
  }

  const params = [];
  let where = "pt.enabled = true";
  if (payload.userId) {
    params.push(payload.userId);
    where += ` AND pt.user_id = $${params.length}`;
  } else if (payload.audience === "vip") {
    where += " AND COALESCE(ua.is_vip, false) = true";
  } else if (payload.audience === "paid") {
    where += " AND (ua.status = 'paid' OR ua.premium_until > now())";
  } else if (payload.audience === "free") {
    where += " AND COALESCE(ua.status, 'free') = 'free'";
  }

  const result = await query(
    `SELECT pt.id, pt.user_id, pt.token
     FROM push_tokens pt
     LEFT JOIN user_access ua ON ua.user_id = pt.user_id
     WHERE ${where}
     ORDER BY pt.last_seen_at DESC
     LIMIT 500`,
    params
  );
  return result.rows;
}

function normalizePayload(body = {}) {
  const title = String(body.title || "FruitFit").trim().slice(0, 120);
  const sourceBody = body.body ?? body.text ?? "";
  const text = String(sourceBody || "").trim().slice(0, 500);
  return {
    title: title || "FruitFit",
    body: text || "Спокойное напоминание FruitFit готово к отправке.",
    audience: normalizeAudience(body.audience),
    userId: body.userId ? String(body.userId).slice(0, 120) : null,
    token: body.token ? String(body.token).trim() : null
  };
}

function normalizeAudience(value) {
  const audience = String(value || "all").toLowerCase();
  if (["all", "free", "paid", "vip", "male", "female"].includes(audience)) return audience;
  return "all";
}

function normalizeScheduledAt(value) {
  const date = value ? new Date(value) : new Date(Date.now() + 60 * 60_000);
  if (Number.isNaN(date.getTime())) return new Date(Date.now() + 60 * 60_000).toISOString();
  return date.toISOString();
}

function normalizeOffset(value) {
  const offset = Number(value);
  if (Number.isFinite(offset) && offset >= -720 && offset <= 840) return offset;
  return 180;
}

function publicFcmStatus(status = getFcmStatus()) {
  return {
    provider: "fcm",
    configured: status.configured,
    status: status.configured ? "READY" : "FCM_NOT_CONFIGURED",
    requiredEnv: status.configured ? [] : ["FCM_PROJECT_ID", "FCM_SERVICE_ACCOUNT_JSON"]
  };
}
