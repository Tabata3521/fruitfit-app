import { closePool, query, transaction } from "../src/db.js";
import { markRobokassaPaymentPaid } from "../src/payments.js";
import { inspectDueRobokassaRecurringSubscriptions } from "../src/robokassaRecurringWorker.js";

const command = process.argv[2] || "help";
const args = parseArgs(process.argv.slice(3));

try {
  if (command === "due-dry-run") {
    await simulateDueDryRun();
  } else if (command === "first-success") {
    await simulateFirstSuccess(required("session-id"));
  } else if (command === "renewal-success" || command === "fake-recurring-success") {
    await simulateRenewalSuccess(required("subscription-id"));
  } else if (command === "duplicate-callback") {
    await simulateDuplicateCallback(required("subscription-id"));
  } else if (command === "cancel") {
    await simulateCancel(required("user-id"));
  } else if (command === "cancel-before-due") {
    await simulateCancelBeforeDue(required("subscription-id"));
  } else if (command === "expired-paid-until") {
    await simulateExpiredPaidUntil(required("subscription-id"));
  } else if (command === "amount-mismatch") {
    await simulateAmountMismatch(required("session-id"));
  } else {
    printHelp();
  }
} finally {
  await closePool();
}

async function simulateDueDryRun() {
  const due = await inspectDueRobokassaRecurringSubscriptions({ limit: Number(args.limit || 10) });
  console.log(JSON.stringify({ ok: true, command: "due-dry-run", count: due.length, due }, null, 2));
}

async function simulateFirstSuccess(sessionId) {
  const session = await loadSession(sessionId);
  const invId = session.robokassa_inv_id || generateInvoiceId();
  const outSum = amountArg(session.final_amount ?? session.amount);
  await markRobokassaPaymentPaid({
    invId,
    outSum,
    sessionId: session.id,
    payload: {
      simulated: true,
      simulationCommand: "first-success",
      InvId: String(invId),
      OutSum: outSum,
      Shp_paymentSessionId: session.id,
      Shp_productCode: session.product_code
    }
  });
  console.log(JSON.stringify({ ok: true, command: "first-success", sessionId: session.id, invId, outSum }, null, 2));
}

async function simulateDuplicateCallback(subscriptionId) {
  const subscription = await loadSubscription(subscriptionId);
  const childInvId = generateInvoiceId();
  const outSum = amountArg(subscription.amount);
  const payload = {
    simulated: true,
    simulationCommand: "duplicate-callback",
    InvId: String(childInvId),
    OutSum: outSum,
    Shp_paymentSessionId: subscription.payment_session_id,
    Shp_productCode: "program_subscription",
    Shp_subscriptionDbId: String(subscription.id)
  };
  await createPendingRecurringPayment(subscription, childInvId, outSum, payload);
  await markRobokassaPaymentPaid({ invId: childInvId, outSum, sessionId: subscription.payment_session_id, payload });
  const afterFirst = await loadSubscription(subscriptionId);
  await markRobokassaPaymentPaid({ invId: childInvId, outSum, sessionId: subscription.payment_session_id, payload });
  const afterSecond = await loadSubscription(subscriptionId);
  const cycles = await query(
    "SELECT COUNT(*)::int AS count FROM subscription_program_cycles WHERE subscription_id = $1 AND payment_id = $2",
    [subscriptionId, `robokassa:${childInvId}`]
  );
  console.log(JSON.stringify({
    ok: true,
    command: "duplicate-callback",
    subscriptionId,
    childInvId,
    paidUntilAfterFirst: afterFirst.paid_until,
    paidUntilAfterSecond: afterSecond.paid_until,
    cycleRowsForPayment: cycles.rows[0]?.count ?? null
  }, null, 2));
}

async function simulateRenewalSuccess(subscriptionId) {
  const subscription = await loadSubscription(subscriptionId);
  const childInvId = generateInvoiceId();
  const outSum = amountArg(subscription.amount);
  const pendingPayload = {
    simulated: true,
    simulationCommand: "renewal-success",
    InvId: String(childInvId),
    OutSum: outSum
  };
  await createPendingRecurringPayment(subscription, childInvId, outSum, pendingPayload);
  await markRobokassaPaymentPaid({
    invId: childInvId,
    outSum,
    sessionId: subscription.payment_session_id,
    payload: {
      simulated: true,
      simulationCommand: "renewal-success",
      InvId: String(childInvId),
      OutSum: outSum,
      Shp_paymentSessionId: subscription.payment_session_id,
      Shp_productCode: "program_subscription",
      Shp_subscriptionDbId: String(subscription.id)
    }
  });
  console.log(JSON.stringify({ ok: true, command: "renewal-success", subscriptionId, childInvId, outSum }, null, 2));
}

async function createPendingRecurringPayment(subscription, childInvId, outSum, rawPayload) {
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO payments (
         id, user_id, payment_session_id, provider, provider_payment_id, robokassa_inv_id,
         status, amount, base_amount, discount_amount, final_amount, currency, product_code,
         raw_payload, recurring_parent_inv_id, recurring_child, meta, updated_at
       )
       VALUES ($1, $2, $3, 'robokassa', $4, $5, 'pending', $6, $6, 0, $6, $7, $8, $9, $10, true, $11, now())
       ON CONFLICT (id) DO NOTHING`,
      [
        `robokassa:${childInvId}`,
        subscription.user_id,
        subscription.payment_session_id,
        String(childInvId),
        Number(childInvId),
        Number(outSum),
        subscription.currency || "RUB",
        subscription.product_code || "program_subscription",
        rawPayload,
        Number(subscription.robokassa_parent_inv_id),
        {
          subscriptionDbId: String(subscription.id),
          pendingCycle: true,
          recurringAttemptStatus: "simulated"
        }
      ]
    );
  });
}

async function simulateCancel(userId) {
  const result = await query(
    `UPDATE subscriptions
     SET status = 'cancelled',
         cancelled_at = COALESCE(cancelled_at, now()),
         next_payment_date = NULL,
         cancel_reason = COALESCE(cancel_reason, 'simulation'),
         meta = COALESCE(meta, '{}'::jsonb) || $2::jsonb,
         updated_at = now()
     WHERE user_id = $1
       AND status <> 'cancelled'
     RETURNING id, payment_session_id`,
    [userId, { simulated: true, simulationCommand: "cancel", simulatedAt: new Date().toISOString() }]
  );
  for (const row of result.rows) {
    await query(
      `UPDATE payment_sessions
       SET recurring_enabled = false,
           recurring_next_charge_at = NULL,
           updated_at = now()
       WHERE id = $1`,
      [row.payment_session_id]
    );
  }
  console.log(JSON.stringify({ ok: true, command: "cancel", userId, cancelled: result.rowCount }, null, 2));
}

async function simulateCancelBeforeDue(subscriptionId) {
  const subscription = await loadSubscription(subscriptionId);
  const result = await query(
    `UPDATE subscriptions
     SET status = 'cancelled',
         cancelled_at = COALESCE(cancelled_at, now()),
         next_payment_date = NULL,
         cancel_reason = COALESCE(cancel_reason, 'simulation_before_due'),
         meta = COALESCE(meta, '{}'::jsonb) || $2::jsonb,
         updated_at = now()
     WHERE id = $1
     RETURNING id, user_id, payment_session_id, paid_until`,
    [subscriptionId, { simulated: true, simulationCommand: "cancel-before-due", simulatedAt: new Date().toISOString() }]
  );
  await query(
    `UPDATE payment_sessions
     SET recurring_enabled = false,
         recurring_next_charge_at = NULL,
         updated_at = now()
     WHERE id = $1`,
    [subscription.payment_session_id]
  );
  console.log(JSON.stringify({ ok: true, command: "cancel-before-due", subscription: result.rows[0] || null }, null, 2));
}

async function simulateExpiredPaidUntil(subscriptionId) {
  const subscription = await loadSubscription(subscriptionId);
  const expiredAt = new Date(Date.now() - 60_000);
  await query(
    `UPDATE subscriptions
     SET paid_until = $2,
         next_payment_date = $2,
         updated_at = now()
     WHERE id = $1`,
    [subscription.id, expiredAt]
  );
  await query(
    `UPDATE user_access
     SET premium_until = $2,
         expires_at = $2,
         updated_at = now()
     WHERE user_id = $1`,
    [subscription.user_id, expiredAt]
  );
  console.log(JSON.stringify({ ok: true, command: "expired-paid-until", subscriptionId, expiredAt }, null, 2));
}

async function simulateAmountMismatch(sessionId) {
  const session = await loadSession(sessionId);
  const invId = session.robokassa_inv_id || generateInvoiceId();
  try {
    await markRobokassaPaymentPaid({
      invId,
      outSum: amountArg(1),
      sessionId: session.id,
      payload: {
        simulated: true,
        simulationCommand: "amount-mismatch",
        InvId: String(invId),
        OutSum: amountArg(1),
        Shp_paymentSessionId: session.id,
        Shp_productCode: session.product_code
      }
    });
  } catch (error) {
    console.log(JSON.stringify({ ok: error?.code === "PAYMENT_AMOUNT_MISMATCH", command: "amount-mismatch", code: error?.code || null }, null, 2));
    return;
  }
  console.log(JSON.stringify({ ok: false, command: "amount-mismatch", error: "Mismatch was not rejected" }, null, 2));
}

async function loadSession(sessionId) {
  const result = await query("SELECT * FROM payment_sessions WHERE id = $1", [sessionId]);
  if (!result.rowCount) throw new Error(`Payment session not found: ${sessionId}`);
  return result.rows[0];
}

async function loadSubscription(subscriptionId) {
  const result = await query("SELECT * FROM subscriptions WHERE id = $1", [subscriptionId]);
  if (!result.rowCount) throw new Error(`Subscription not found: ${subscriptionId}`);
  return result.rows[0];
}

function parseArgs(items) {
  const parsed = {};
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item.startsWith("--")) continue;
    parsed[item.slice(2)] = items[index + 1];
    index += 1;
  }
  return parsed;
}

function required(name) {
  const value = args[name];
  if (!value) throw new Error(`Missing required --${name}`);
  return value;
}

function amountArg(fallback) {
  return Number(args.amount || fallback || 0).toFixed(2);
}

function generateInvoiceId() {
  return Date.now() * 1000 + Math.floor(Math.random() * 900 + 100);
}

function printHelp() {
  console.log(`Usage:
  node backend/scripts/simulate-recurring-flow.mjs due-dry-run [--limit 10]
  node backend/scripts/simulate-recurring-flow.mjs first-success --session-id <id> [--amount 2990]
  node backend/scripts/simulate-recurring-flow.mjs renewal-success --subscription-id <id> [--amount 2990]
  node backend/scripts/simulate-recurring-flow.mjs fake-recurring-success --subscription-id <id> [--amount 2990]
  node backend/scripts/simulate-recurring-flow.mjs duplicate-callback --subscription-id <id> [--amount 2990]
  node backend/scripts/simulate-recurring-flow.mjs cancel --user-id <id>
  node backend/scripts/simulate-recurring-flow.mjs cancel-before-due --subscription-id <id>
  node backend/scripts/simulate-recurring-flow.mjs expired-paid-until --subscription-id <id>
  node backend/scripts/simulate-recurring-flow.mjs amount-mismatch --session-id <id>`);
}
