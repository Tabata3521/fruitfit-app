import crypto from "node:crypto";
import { config } from "./config.js";
import { query, transaction } from "./db.js";

const DEFAULT_LIMIT = 10;
const DEFAULT_DESCRIPTION = "FruitFit: automatic program renewal";
let recurringWorker = null;

export function robokassaRecurringPassword1() {
  return config.robokassaTestMode
    ? config.robokassaTestPassword1 || config.robokassaPassword1
    : config.robokassaPassword1;
}

export function robokassaRecurringHash(value) {
  const algorithm = String(config.robokassaHashAlgorithm || "md5").toLowerCase();
  if (!crypto.getHashes().includes(algorithm)) throw new Error(`Unsupported Robokassa hash algorithm: ${algorithm}`);
  return crypto.createHash(algorithm).update(String(value), "utf8").digest("hex");
}

export function robokassaRecurringShpParts(params) {
  return Object.keys(params)
    .filter((key) => /^Shp_[A-Za-z0-9_]+$/.test(key))
    .sort()
    .map((key) => `${key}=${params[key]}`);
}

export function buildRobokassaRecurringSignature(params, password) {
  const parts = [
    params.MerchantLogin,
    params.OutSum,
    params.InvoiceID || params.InvId || "",
    password,
    ...robokassaRecurringShpParts(params)
  ];
  return robokassaRecurringHash(parts.join(":"));
}

export function buildRobokassaRecurringParams({ subscription, childInvId, description = DEFAULT_DESCRIPTION }) {
  const params = {
    MerchantLogin: config.robokassaMerchantLogin,
    OutSum: Number(subscription.amount || 0).toFixed(2),
    InvoiceID: String(childInvId),
    PreviousInvoiceID: String(subscription.robokassa_parent_inv_id),
    Description: description,
    Shp_paymentSessionId: subscription.payment_session_id,
    Shp_productCode: "program_subscription",
    Shp_subscriptionDbId: String(subscription.id)
  };
  params.SignatureValue = buildRobokassaRecurringSignature(params, robokassaRecurringPassword1());
  return params;
}

export async function processDueRobokassaRecurringSubscriptions({ limit = DEFAULT_LIMIT, fetchImpl = globalThis.fetch } = {}) {
  if (!config.robokassaRecurringEnabled) return { prepared: 0, submitted: 0, skipped: true };
  if (!config.robokassaMerchantLogin || !robokassaRecurringPassword1()) {
    throw new Error("Robokassa recurring is not configured");
  }
  if (config.robokassaRecurringDryRun) {
    const due = await inspectDueRobokassaRecurringSubscriptions({ limit });
    return { prepared: due.length, submitted: 0, dryRun: true, due, skipped: false };
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is required to submit Robokassa recurring charges");
  }

  const jobs = await prepareDueRobokassaRecurringCharges({ limit });
  let submitted = 0;
  for (const job of jobs) {
    await submitRobokassaRecurringCharge(job, fetchImpl);
    submitted += 1;
  }
  return { prepared: jobs.length, submitted, skipped: false };
}

export async function inspectDueRobokassaRecurringSubscriptions({ limit = DEFAULT_LIMIT } = {}) {
  const result = await query(dueSubscriptionsSql({ forUpdate: false }), [Math.max(1, Number(limit) || DEFAULT_LIMIT)]);
  return result.rows.map((subscription) => ({
    id: String(subscription.id),
    userId: subscription.user_id || null,
    paymentSessionId: subscription.payment_session_id,
    amount: Number(subscription.amount || 0),
    currency: subscription.currency || "RUB",
    nextPaymentDate: subscription.next_payment_date,
    parentInvId: subscription.robokassa_parent_inv_id ? String(subscription.robokassa_parent_inv_id) : null,
    paramsPreview: buildRobokassaRecurringParams({
      subscription,
      childInvId: "DRY_RUN_CHILD_INV_ID",
      description: DEFAULT_DESCRIPTION
    })
  }));
}

export async function prepareDueRobokassaRecurringCharges({ limit = DEFAULT_LIMIT } = {}) {
  return transaction(async (client) => {
    const due = await client.query(dueSubscriptionsSql({ forUpdate: true }), [Math.max(1, Number(limit) || DEFAULT_LIMIT)]);

    const jobs = [];
    for (const subscription of due.rows) {
      const childInvId = generateRecurringInvoiceId();
      const params = buildRobokassaRecurringParams({ subscription, childInvId });
      const paymentId = `robokassa:${childInvId}`;
      const amount = Number(subscription.amount || 0);
      const rawPayload = {
        source: "robokassa_recurring_worker",
        params,
        preparedAt: new Date().toISOString()
      };
      await client.query(
        `INSERT INTO payments (
           id, user_id, payment_session_id, provider, provider_payment_id, robokassa_inv_id,
           status, amount, base_amount, discount_amount, final_amount, currency, product_code,
           raw_payload, recurring_parent_inv_id, recurring_child, meta, updated_at
         )
         VALUES ($1, $2, $3, 'robokassa', $4, $5, 'pending', $6, $6, 0, $6, $7, $8, $9, $10, true, $11, now())
         ON CONFLICT (id) DO NOTHING`,
        [
          paymentId,
          subscription.user_id,
          subscription.payment_session_id,
          String(childInvId),
          Number(childInvId),
          amount,
          subscription.currency || "RUB",
          subscription.product_code || "program_subscription",
          rawPayload,
          Number(subscription.robokassa_parent_inv_id),
          {
            subscriptionDbId: String(subscription.id),
            pendingCycle: true,
            recurringAttemptStatus: "pending",
            parentInvId: String(subscription.robokassa_parent_inv_id),
            childInvId: String(childInvId)
          }
        ]
      );
      await client.query(
        `UPDATE subscriptions
         SET meta = COALESCE(meta, '{}'::jsonb) || $2::jsonb,
             updated_at = now()
         WHERE id = $1`,
        [
          subscription.id,
          {
            pendingChildInvId: String(childInvId),
            recurringChargePreparedAt: rawPayload.preparedAt
          }
        ]
      );
      jobs.push({ paymentId, childInvId, subscriptionId: subscription.id, params });
    }
    return jobs;
  });
}

export async function submitRobokassaRecurringCharge(job, fetchImpl = globalThis.fetch) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(job.params)) {
    if (value !== undefined && value !== null && value !== "") body.set(key, String(value));
  }
  const response = await fetchImpl(config.robokassaRecurringUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const responseText = await response.text();
  await query(
    `UPDATE payments
     SET status = $4,
         raw_payload = COALESCE(raw_payload, '{}'::jsonb) || $2::jsonb,
         meta = COALESCE(meta, '{}'::jsonb) || $3::jsonb,
         updated_at = now()
     WHERE id = $1`,
    [
      job.paymentId,
      {
        robokassaRecurringResponse: responseText,
        robokassaRecurringStatus: response.status,
        submittedAt: new Date().toISOString()
      },
      {
        recurringAttemptStatus: response.ok ? "submitted" : "submit_failed"
      },
      response.ok ? "processing" : "failed"
    ]
  );
  return { ok: response.ok, status: response.status, body: responseText };
}

export function startRobokassaRecurringWorker() {
  if (!config.robokassaRecurringWorkerEnabled || !config.robokassaRecurringEnabled) return null;
  if (recurringWorker) return recurringWorker;
  const configuredIntervalMs = Number(config.robokassaRecurringWorkerIntervalMs || 0);
  const intervalMs = configuredIntervalMs > 0
    ? Math.max(60_000, configuredIntervalMs)
    : Math.max(60, Number(config.robokassaRecurringWorkerIntervalSeconds || 900)) * 1000;
  const limit = Math.max(1, Number(config.robokassaRecurringWorkerBatchSize || DEFAULT_LIMIT));
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const result = await processDueRobokassaRecurringSubscriptions({ limit });
      if (result.submitted) {
        console.log("[fruitfit-payments] recurring worker submitted charges", result);
      }
    } catch (error) {
      console.error("[fruitfit-payments] recurring worker failed", {
        message: error?.message || "unknown"
      });
    } finally {
      running = false;
    }
  }

  recurringWorker = setInterval(tick, intervalMs);
  recurringWorker.unref?.();
  tick();
  console.log("[fruitfit-payments] recurring worker started", {
    intervalSeconds: intervalMs / 1000,
    batchSize: limit,
    dryRun: Boolean(config.robokassaRecurringDryRun)
  });
  return recurringWorker;
}

function dueSubscriptionsSql({ forUpdate }) {
  return `SELECT s.*,
                 ps.recurring_enabled,
                 ps.email
          FROM subscriptions s
          JOIN payment_sessions ps ON ps.id = s.payment_session_id
          WHERE s.status = 'active'
            AND ps.recurring_enabled = true
            AND s.cancelled_at IS NULL
            AND s.next_payment_date <= now()
            AND s.robokassa_parent_inv_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1
              FROM payments p
              WHERE p.recurring_child = true
                AND p.status IN ('pending', 'processing')
                AND p.meta->>'subscriptionDbId' = s.id::text
            )
          ORDER BY s.next_payment_date ASC
          LIMIT $1${forUpdate ? "\n          FOR UPDATE SKIP LOCKED" : ""}`;
}

function generateRecurringInvoiceId() {
  return Date.now() * 1000 + crypto.randomInt(100, 999);
}
