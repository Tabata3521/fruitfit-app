import crypto from "node:crypto";
import express from "express";
import { requireUser } from "./auth.js";
import { config } from "./config.js";
import { query, transaction } from "./db.js";

export const referralsRouter = express.Router();

const CODE_WORDS = [
  "APPLE",
  "BERRY",
  "CHERRY",
  "KIWI",
  "LEMON",
  "MANGO",
  "MELON",
  "ORANGE",
  "PEACH",
  "PLUM"
];

referralsRouter.get("/me/code", requireUser, async (req, res) => {
  const code = await ensureReferralCodeForUser(req.user.id);
  const summary = await loadReferralSummary(req.user.id, code);
  res.json(serializeReferralDashboard(code, summary));
});

referralsRouter.get("/me", requireUser, async (req, res) => {
  const code = await ensureReferralCodeForUser(req.user.id);
  const summary = await loadReferralSummary(req.user.id, code);
  res.json(serializeReferralDashboard(code, summary));
});

referralsRouter.post("/apply", requireUser, async (req, res) => {
  const code = req.body?.code || req.body?.promoCode || req.body?.promo_code;
  const paymentSessionId = cleanNullableText(req.body?.paymentSessionId || req.body?.payment_session_id || req.body?.sessionId, 120);

  try {
    const referralUse = await transaction((client) => applyReferralCode(client, {
      code,
      userId: req.user.id,
      paymentSessionId,
      source: "api"
    }));
    res.json({ referralUse: serializeReferralUse(referralUse) });
  } catch (error) {
    if (error.status) {
      res.status(error.status).json({ error: error.message, code: error.code || "REFERRAL_ERROR" });
      return;
    }
    throw error;
  }
});

referralsRouter.post("/validate", async (req, res) => {
  const code = req.body?.code || req.body?.promoCode || req.body?.promo_code || req.body?.referralCode || req.body?.referral_code;
  const paymentSessionId = cleanNullableText(req.body?.paymentSessionId || req.body?.payment_session_id || req.body?.sessionId, 120);
  const requestedProductCode = cleanNullableText(req.body?.productCode || req.body?.product_code, 80);

  if (!paymentSessionId) {
    res.status(400).json({ error: "paymentSessionId is required", code: "PAYMENT_SESSION_REQUIRED" });
    return;
  }

  try {
    const preview = await transaction(async (client) => {
      const sessionResult = await client.query(
        `SELECT *
         FROM payment_sessions
         WHERE id = $1
         FOR UPDATE`,
        [paymentSessionId]
      );
      const session = sessionResult.rows[0] || null;
      if (!session) throw referralError(404, "Payment session not found", "PAYMENT_SESSION_NOT_FOUND");
      if (!session.user_id) throw referralError(401, "Payment session has no user", "PAYMENT_SESSION_USER_REQUIRED");
      if (session.status === "paid") throw referralError(409, "Payment session is already paid", "PAYMENT_SESSION_ALREADY_PAID");
      if (session.status === "expired") throw referralError(409, "Payment session is expired", "PAYMENT_SESSION_EXPIRED");

      const productCode = requestedProductCode || session.product_code || null;
      const serverProductAmount = referralProductAmount(productCode);
      const baseAmount = serverProductAmount > 0
        ? serverProductAmount
        : moneyNumber(session.base_amount || session.amount);
      const price = await previewReferralDiscount(client, {
        code,
        userId: session.user_id,
        productCode,
        baseAmount
      });

      return {
        session,
        price
      };
    });

    const { price } = preview;
    res.json({
      valid: true,
      promoCode: price.promoCode,
      referralCode: serializeReferralCode(price.referralCode),
      baseAmount: price.baseAmount,
      discountAmount: price.discountAmount,
      discount: -Math.abs(price.discountAmount),
      finalAmount: price.finalAmount,
      final_amount: price.finalAmount,
      bonusInfo: bonusInfoForReferralCode(price.referralCode)
    });
  } catch (error) {
    if (error.status) {
      res.status(error.status).json({ valid: false, error: error.message, code: error.code || "REFERRAL_ERROR" });
      return;
    }
    throw error;
  }
});

export async function ensureReferralCodeForUser(userId) {
  const existing = await query(
    `SELECT rc.*
     FROM referral_codes rc
     LEFT JOIN referral_uses ru ON ru.referral_code_id = rc.id
     WHERE rc.owner_user_id = $1
       AND (rc.kind = 'user_referral' OR rc.status = 'active')
     GROUP BY rc.id
     ORDER BY COUNT(ru.id) DESC,
              CASE WHEN rc.kind = 'user_referral' THEN 0 ELSE 1 END,
              rc.created_at ASC
     LIMIT 1`,
    [userId]
  );
  if (existing.rowCount) return existing.rows[0];

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const code = generateReferralCode(attempt);
    try {
      const created = await query(
        `INSERT INTO referral_codes (code, owner_user_id, kind, status, discount_type, discount_value, reward_type, reward_value, created_by, meta)
         VALUES ($1, $2, 'user_referral', 'active', 'percent', 0, 'manual_bonus', 0, $2, $3)
         RETURNING *`,
        [code, userId, { generatedBy: "backend", generatedAt: new Date().toISOString() }]
      );
      return created.rows[0];
    } catch (error) {
      if (error.code === "23505") {
        const raced = await query(
          `SELECT rc.*
           FROM referral_codes rc
           LEFT JOIN referral_uses ru ON ru.referral_code_id = rc.id
           WHERE rc.owner_user_id = $1
             AND (rc.kind = 'user_referral' OR rc.status = 'active')
           GROUP BY rc.id
           ORDER BY COUNT(ru.id) DESC,
                    CASE WHEN rc.kind = 'user_referral' THEN 0 ELSE 1 END,
                    rc.created_at ASC
           LIMIT 1`,
          [userId]
        );
        if (raced.rowCount) return raced.rows[0];
        continue;
      }
      throw error;
    }
  }

  throw referralError(500, "Could not generate referral code", "REFERRAL_CODE_GENERATION_FAILED");
}

async function loadReferralSummary(userId, referralCode = null) {
  const codeId = referralCode?.id || null;
  const statsResult = await query(
    `SELECT
       COUNT(ru.id)::int AS invited_count,
       COUNT(ru.id) FILTER (WHERE ru.status = 'qualified')::int AS paid_count,
       COUNT(ru.id) FILTER (
         WHERE COALESCE(ru.meta->>'bonus_granted', ru.meta->>'bonusGranted') = 'true'
       )::int AS bonus_granted_count,
       COALESCE(SUM(
         CASE
           WHEN COALESCE(ru.meta->>'bonus_granted', ru.meta->>'bonusGranted') = 'true'
             THEN COALESCE(
               CASE WHEN NULLIF(ru.meta->>'bonus_days', '') ~ '^[0-9]+$' THEN (ru.meta->>'bonus_days')::int END,
               CASE WHEN NULLIF(ru.meta->>'bonusDays', '') ~ '^[0-9]+$' THEN (ru.meta->>'bonusDays')::int END,
               CASE WHEN NULLIF(ru.meta->>'rewardDays', '') ~ '^[0-9]+$' THEN (ru.meta->>'rewardDays')::int END,
               14
             )
           ELSE 0
         END
       ), 0)::int AS bonus_days_total,
       MAX(COALESCE(ru.qualified_at, ru.updated_at, ru.applied_at)) FILTER (
         WHERE COALESCE(ru.meta->>'bonus_granted', ru.meta->>'bonusGranted') = 'true'
            OR ru.status = 'qualified'
       ) AS last_bonus_at
     FROM referral_uses ru
     WHERE ru.referrer_user_id = $1
       AND ($2::bigint IS NULL OR ru.referral_code_id = $2)`,
    [userId, codeId]
  );
  const usesResult = await query(
    `SELECT *
     FROM referral_uses
     WHERE referrer_user_id = $1
       AND ($2::bigint IS NULL OR referral_code_id = $2)
     ORDER BY COALESCE(qualified_at, updated_at, applied_at) DESC
     LIMIT 50`,
    [userId, codeId]
  );
  return {
    stats: statsResult.rows[0] || {},
    uses: usesResult.rows
  };
}

export async function ensureReferralUseForPaymentSession(client, { session, promoCode = null, source = "payment_session" }) {
  const code = promoCode || session?.promo_code;
  if (!code || !session?.user_id) return null;
  return applyReferralCode(client, {
    code,
    userId: session.user_id,
    paymentSessionId: session.id,
    source
  });
}

export async function previewReferralDiscount(client, { code, userId, productCode = null, baseAmount = 0 }) {
  const normalizedCode = normalizeReferralCode(code);
  if (!normalizedCode) {
    return {
      promoCode: null,
      referralCode: null,
      baseAmount: moneyNumber(baseAmount),
      discountAmount: 0,
      finalAmount: moneyNumber(baseAmount)
    };
  }
  if (!userId) throw referralError(401, "Unauthorized", "UNAUTHORIZED");

  const codeResult = await client.query(
    `SELECT *
     FROM referral_codes
     WHERE code = $1
     FOR UPDATE`,
    [normalizedCode]
  );
  const referralCode = codeResult.rows[0] || null;
  if (!referralCode) throw referralError(404, "Referral code not found", "REFERRAL_CODE_NOT_FOUND");
  validateReferralCodeForUse(referralCode, { userId });
  validateReferralCodeProduct(referralCode, productCode);

  const existingUse = await client.query(
    `SELECT *
     FROM referral_uses
     WHERE referred_user_id = $1
     FOR UPDATE`,
    [userId]
  );
  if (existingUse.rowCount && existingUse.rows[0].referral_code_id !== referralCode.id) {
    throw referralError(409, "User has already applied another referral code", "REFERRAL_ALREADY_USED");
  }
  if (existingUse.rowCount && existingUse.rows[0].status !== "pending_payment") {
    throw referralError(409, "Referral code can only be applied before first purchase", "REFERRAL_AFTER_FIRST_PURCHASE");
  }
  if (!existingUse.rowCount) {
    await assertNoPreviousPaidPayments(client, userId);
  }

  const normalizedBaseAmount = moneyNumber(baseAmount);
  const discountAmount = calculateDiscountAmount(referralCode, normalizedBaseAmount);
  return {
    promoCode: normalizedCode,
    referralCode,
    baseAmount: normalizedBaseAmount,
    discountAmount,
    finalAmount: finalAmountFromDiscount(normalizedBaseAmount, discountAmount)
  };
}

export async function qualifyReferralUseAfterPayment(client, { session, payment, paymentId, amount, productCode }) {
  if (!session?.id) return null;

  const existing = await client.query(
    `SELECT *
     FROM referral_uses
     WHERE payment_session_id = $1
     FOR UPDATE`,
    [session.id]
  );
  const referralUse = existing.rows[0] || null;
  if (!referralUse) return null;

  if (referralUse.status === "qualified" && referralUse.payment_id === paymentId) {
    return referralUse;
  }
  if (referralUse.status !== "pending_payment") {
    return referralUse;
  }

  const orderAmount = moneyNumber(session.base_amount ?? amount ?? payment?.amount ?? session.amount);
  const updated = await client.query(
    `UPDATE referral_uses
     SET payment_id = $2,
         product_code = COALESCE($3, product_code),
         order_amount = $4,
         status = 'qualified',
         qualified_at = COALESCE(qualified_at, now()),
         meta = COALESCE(meta, '{}'::jsonb) || $5::jsonb,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      referralUse.id,
      paymentId,
      productCode || session.product_code || referralUse.product_code || null,
      orderAmount,
      {
        qualifiedBy: "robokassa",
        qualifiedAt: new Date().toISOString(),
        paymentSessionId: session.id,
        paymentId
      }
    ]
  );

  await client.query(
    `UPDATE referral_codes
     SET uses_count = uses_count + 1,
         updated_at = now()
     WHERE id = $1`,
    [referralUse.referral_code_id]
  );

  return updated.rows[0];
}

export async function applyReferralCode(client, { code, userId, paymentSessionId = null, source = "api" }) {
  const normalizedCode = normalizeReferralCode(code);
  if (!normalizedCode) throw referralError(400, "Referral code is required", "REFERRAL_CODE_REQUIRED");
  if (!userId) throw referralError(401, "Unauthorized", "UNAUTHORIZED");

  const codeResult = await client.query(
    `SELECT *
     FROM referral_codes
     WHERE code = $1
     FOR UPDATE`,
    [normalizedCode]
  );
  const referralCode = codeResult.rows[0] || null;
  if (!referralCode) throw referralError(404, "Referral code not found", "REFERRAL_CODE_NOT_FOUND");
  validateReferralCodeForUse(referralCode, { userId });

  const existingUse = await client.query(
    `SELECT *
     FROM referral_uses
     WHERE referred_user_id = $1
     FOR UPDATE`,
    [userId]
  );
  if (existingUse.rowCount && existingUse.rows[0].referral_code_id !== referralCode.id) {
    throw referralError(409, "User has already applied another referral code", "REFERRAL_ALREADY_USED");
  }

  const paymentSession = paymentSessionId
    ? await loadOwnedPaymentSession(client, paymentSessionId, userId)
    : null;
  const productCode = paymentSession?.product_code || null;
  validateReferralCodeProduct(referralCode, productCode);

  if (!existingUse.rowCount) {
    await assertNoPreviousPaidPayments(client, userId);
  }

  const amount = moneyNumber(paymentSession?.base_amount ?? paymentSession?.amount);
  const discountAmount = calculateDiscountAmount(referralCode, amount);
  const meta = {
    source,
    appliedAt: new Date().toISOString(),
    paymentSessionId: paymentSession?.id || null,
    discountPreview: {
      originalAmount: amount,
      discountAmount,
      payableAmountPreview: finalAmountFromDiscount(amount, discountAmount),
      robokassaAmountChanged: true
    }
  };

  if (paymentSession) {
    await client.query(
      `UPDATE payment_sessions
       SET promo_code = $2,
           meta = COALESCE(meta, '{}'::jsonb) || $3::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [
        paymentSession.id,
        normalizedCode,
        {
          referral: {
            code: normalizedCode,
            referralCodeId: referralCode.id,
            referrerUserId: referralCode.owner_user_id || null,
            discountType: referralCode.discount_type,
            discountValue: Number(referralCode.discount_value || 0),
            discountAmount,
            finalAmount: finalAmountFromDiscount(amount, discountAmount),
            robokassaAmountChanged: true
          }
        }
      ]
    );
  }

  if (existingUse.rowCount) {
    const existing = existingUse.rows[0];
    if (existing.status !== "pending_payment") return existing;
    const updated = await client.query(
      `UPDATE referral_uses
       SET payment_session_id = CASE WHEN $2::text IS NOT NULL THEN $2 ELSE payment_session_id END,
           product_code = COALESCE(product_code, $3),
           order_amount = CASE WHEN $4::numeric > 0 THEN $4 ELSE order_amount END,
           discount_type = $5,
           discount_value = $6,
           discount_amount = $7,
           meta = COALESCE(meta, '{}'::jsonb) || $8::jsonb,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        existing.id,
        paymentSession?.id || null,
        productCode,
        amount,
        referralCode.discount_type,
        referralCode.discount_value,
        discountAmount,
        meta
      ]
    );
    return updated.rows[0];
  }

  const created = await client.query(
    `INSERT INTO referral_uses (
       referral_code_id, code, referrer_user_id, referred_user_id, payment_session_id,
       product_code, order_amount, discount_type, discount_value, discount_amount,
       status, meta
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending_payment', $11)
     RETURNING *`,
    [
      referralCode.id,
      referralCode.code,
      referralCode.owner_user_id || null,
      userId,
      paymentSession?.id || null,
      productCode,
      amount,
      referralCode.discount_type,
      referralCode.discount_value,
      discountAmount,
      meta
    ]
  );
  return created.rows[0];
}

function validateReferralCodeForUse(referralCode, { userId }) {
  if (referralCode.status !== "active") {
    throw referralError(409, "Referral code is not active", "REFERRAL_CODE_INACTIVE");
  }
  if (referralCode.owner_user_id && referralCode.owner_user_id === userId) {
    throw referralError(409, "Self-referral is not allowed", "SELF_REFERRAL_NOT_ALLOWED");
  }
  if (referralCode.expires_at && new Date(referralCode.expires_at).getTime() <= Date.now()) {
    throw referralError(409, "Referral code has expired", "REFERRAL_CODE_EXPIRED");
  }
  if (referralCode.max_uses !== null && Number(referralCode.uses_count || 0) >= Number(referralCode.max_uses)) {
    throw referralError(409, "Referral code usage limit reached", "REFERRAL_CODE_LIMIT_REACHED");
  }
}

function validateReferralCodeProduct(referralCode, productCode) {
  const productCodes = Array.isArray(referralCode.applies_to_product_codes)
    ? referralCode.applies_to_product_codes.filter(Boolean)
    : [];
  if (!productCodes.length || !productCode) return;
  if (!productCodes.includes(productCode)) {
    throw referralError(409, "Referral code is not valid for this product", "REFERRAL_PRODUCT_NOT_ALLOWED");
  }
}

async function assertNoPreviousPaidPayments(client, userId) {
  const result = await client.query(
    `SELECT id
     FROM payments
     WHERE user_id = $1 AND status = 'paid'
     LIMIT 1`,
    [userId]
  );
  if (result.rowCount) {
    throw referralError(409, "Referral code can only be applied before first purchase", "REFERRAL_AFTER_FIRST_PURCHASE");
  }
}

async function loadOwnedPaymentSession(client, paymentSessionId, userId) {
  const result = await client.query(
    `SELECT *
     FROM payment_sessions
     WHERE id = $1
     FOR UPDATE`,
    [paymentSessionId]
  );
  const session = result.rows[0] || null;
  if (!session) throw referralError(404, "Payment session not found", "PAYMENT_SESSION_NOT_FOUND");
  if (session.user_id !== userId) throw referralError(403, "Payment session belongs to another user", "PAYMENT_SESSION_FORBIDDEN");
  if (session.status === "paid") throw referralError(409, "Payment session is already paid", "PAYMENT_SESSION_ALREADY_PAID");
  if (session.status === "expired") throw referralError(409, "Payment session is expired", "PAYMENT_SESSION_EXPIRED");
  return session;
}

function calculateDiscountAmount(referralCode, amount) {
  const value = Number(referralCode.discount_value || 0);
  if (!Number.isFinite(value) || value <= 0 || amount <= 0) return 0;
  if (referralCode.discount_type === "fixed") return Math.min(amount, roundMoney(value));
  if (referralCode.discount_type === "percent") return Math.min(amount, roundMoney(amount * value / 100));
  return 0;
}

function finalAmountFromDiscount(baseAmount, discountAmount) {
  const normalizedBaseAmount = moneyNumber(baseAmount);
  if (normalizedBaseAmount <= 0) return 0;
  const finalAmount = normalizedBaseAmount - moneyNumber(discountAmount);
  return Math.max(1, roundMoney(finalAmount));
}

function generateReferralCode(attempt) {
  const word = CODE_WORDS[crypto.randomInt(0, CODE_WORDS.length)];
  const digits = String(crypto.randomInt(0, 100)).padStart(2, "0");
  if (attempt < 8) return `${word}${digits}`;
  const suffix = crypto.randomBytes(1).toString("hex").toUpperCase();
  return `${word}${digits}${suffix}`;
}

function normalizeReferralCode(value) {
  const normalized = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!normalized) return "";
  if (normalized.length < 4 || normalized.length > 24) {
    throw referralError(400, "Referral code has invalid length", "REFERRAL_CODE_INVALID");
  }
  return normalized;
}

function cleanNullableText(value, limit = 200) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, limit) : null;
}

function moneyNumber(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? roundMoney(amount) : 0;
}

function referralProductAmount(productCode) {
  if (productCode === "individual_program" || productCode === "training_program") {
    const priceMode = String(config.programPriceMode || "").trim().toLowerCase();
    if (priceMode === "test") return moneyNumber(config.programPriceTest);
    if (priceMode === "prod" || priceMode === "production") return moneyNumber(config.programPriceProd);
    return moneyNumber(config.robokassaTestMode ? config.programPriceTest : config.programPriceProd);
  }
  if (productCode === "vip_coaching") return 20000;
  return 0;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function referralError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function serializeReferralCode(row = {}) {
  if (!row) return null;
  return {
    id: row.id ? Number(row.id) : null,
    code: row.code,
    ownerUserId: row.owner_user_id || null,
    kind: row.kind,
    status: row.status,
    discountType: row.discount_type,
    discountValue: Number(row.discount_value || 0),
    rewardType: row.reward_type || null,
    rewardValue: Number(row.reward_value || 0),
    appliesToProductCodes: row.applies_to_product_codes || [],
    maxUses: row.max_uses === null || row.max_uses === undefined ? null : Number(row.max_uses),
    usesCount: Number(row.uses_count || 0),
    expiresAt: toIso(row.expires_at),
    createdAt: toIso(row.created_at)
  };
}

function bonusInfoForReferralCode(row = {}) {
  if (!row) return null;
  const rewardType = row.reward_type || null;
  const rewardValue = Number(row.reward_value || 0);
  if (!rewardType || rewardValue <= 0) {
    return {
      days: 14,
      rewardType: "access_days",
      rewardValue: 14
    };
  }
  return {
    days: rewardType === "access_days" || rewardType === "manual_bonus" ? rewardValue : 14,
    rewardType,
    rewardValue
  };
}

function serializeReferralDashboard(referralCode, summary = {}) {
  const stats = summary.stats || {};
  const invitedCount = Number(stats.invited_count || 0);
  const paidCount = Number(stats.paid_count || 0);
  const bonusGrantedCount = Number(stats.bonus_granted_count || 0);
  const bonusDaysTotal = Number(stats.bonus_days_total || 0);
  const referralUses = (summary.uses || []).map(serializeReferralUse);

  return {
    referralCode: serializeReferralCode(referralCode),
    referral_code: referralCode?.code || null,
    code: referralCode?.code || null,
    invitedCount,
    invited_count: invitedCount,
    paidCount,
    paid_count: paidCount,
    bonusDaysTotal,
    bonus_days_total: bonusDaysTotal,
    lastBonusAt: toIso(stats.last_bonus_at),
    last_bonus_at: toIso(stats.last_bonus_at),
    bonusGranted: bonusGrantedCount > 0,
    bonus_granted: bonusGrantedCount > 0,
    bonusInfo: {
      ...bonusInfoForReferralCode(referralCode),
      days: 14,
      totalDays: bonusDaysTotal
    },
    stats: {
      invitedCount,
      invited_count: invitedCount,
      referralsCount: invitedCount,
      paidCount,
      paid_count: paidCount,
      paymentsCount: paidCount,
      qualifiedCount: paidCount,
      bonusGrantedCount,
      bonus_granted_count: bonusGrantedCount,
      bonusDaysTotal,
      bonus_days_total: bonusDaysTotal,
      lastBonusAt: toIso(stats.last_bonus_at),
      last_bonus_at: toIso(stats.last_bonus_at)
    },
    referralUses,
    referral_uses: referralUses
  };
}

function serializeReferralUse(row = {}) {
  const discountApplied = Number(row.discount_amount || 0) > 0
    || boolMeta(row.meta?.discountApplied)
    || boolMeta(row.meta?.discount_applied);
  const bonusGranted = boolMeta(row.meta?.bonusGranted) || boolMeta(row.meta?.bonus_granted);
  return {
    id: row.id ? Number(row.id) : null,
    referralCodeId: row.referral_code_id ? Number(row.referral_code_id) : null,
    code: row.code,
    referrerUserId: row.referrer_user_id || null,
    referredUserId: row.referred_user_id || null,
    paymentSessionId: row.payment_session_id || null,
    paymentId: row.payment_id || null,
    productCode: row.product_code || null,
    orderAmount: Number(row.order_amount || 0),
    discountType: row.discount_type,
    discountValue: Number(row.discount_value || 0),
    discountAmount: Number(row.discount_amount || 0),
    discountApplied,
    discount_applied: discountApplied,
    bonusGranted,
    bonus_granted: bonusGranted,
    status: row.status,
    appliedAt: toIso(row.applied_at),
    qualifiedAt: toIso(row.qualified_at)
  };
}

function boolMeta(value) {
  if (value === true) return true;
  return String(value || "").toLowerCase() === "true";
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
