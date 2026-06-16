import crypto from "node:crypto";
import express from "express";
import { hasValidAdminToken, optionalUserFromRequest, requireUser } from "./auth.js";
import { config } from "./config.js";
import { query, transaction } from "./db.js";
import { ensureReferralUseForPaymentSession, previewReferralDiscount, qualifyReferralUseAfterPayment } from "./referrals.js";

export const paymentsRouter = express.Router();

const DEFAULT_CURRENCY = "RUB";
const SESSION_TTL_HOURS = 24;
const PROGRAM_ASSIGNMENT_MIN_SCORE = 20;
const PROGRAM_PRODUCT_CODES = new Set(["individual_program", "training_program"]);
const PAYMENT_ASSIGNMENT_BATCH_SIZE = 10;
const MIN_PAYMENT_AMOUNT = 1;
let paymentAssignmentWorker = null;

export const PAYMENT_PRODUCTS = {
  individual_program: {
    code: "individual_program",
    title: "Индивидуальная программа тренировок",
    amount: 2990,
    accessStatus: "paid",
    accessPlan: "individual_program",
    recurringEligible: true,
    description: "FruitFit: индивидуальная программа тренировок"
  },
  vip_coaching: {
    code: "vip_coaching",
    title: "Комплексное VIP-ведение",
    amount: 20000,
    accessStatus: "vip",
    accessPlan: "vip_coaching",
    recurringEligible: false,
    description: "FruitFit: комплексное VIP-ведение"
  }
};

paymentsRouter.post("/sessions", requireUser, async (req, res) => {
  await createPaymentSession(req, res, req.body || {}, {
    user: req.user,
    allowBodyUserId: hasValidAdminToken(req)
  });
});

paymentsRouter.get("/subscription", requireUser, async (req, res) => {
  const subscription = await loadCurrentSubscription(req.user.id);
  res.json({ subscription: subscription ? serializeSubscription(subscription) : null });
});

paymentsRouter.post("/subscription/cancel", requireUser, async (req, res) => {
  const subscription = await loadCurrentSubscription(req.user.id);
  if (!subscription) {
    res.json({ subscription: null });
    return;
  }

  const result = await query(
    `UPDATE payment_sessions
     SET recurring_enabled = false,
         recurring_next_charge_at = NULL,
         meta = meta || $2::jsonb,
         updated_at = now()
     WHERE id = $1
       AND user_id = $3
     RETURNING *`,
    [
      subscription.id,
      {
        subscriptionStatus: "cancelled",
        recurringCancelledAt: new Date().toISOString(),
        recurringCancelledBy: req.user.id,
        recurringCancelReason: cleanNullableText(req.body?.reason, 240) || "client_request"
      },
      req.user.id
    ]
  );

  const updated = {
    ...result.rows[0],
    access_expires_at: subscription.access_expires_at,
    access_premium_until: subscription.access_premium_until
  };
  res.json({ subscription: serializeSubscription(updated) });
});

paymentsRouter.post("/sessions/demo", async (req, res) => {
  if (config.nodeEnv === "production" && !hasValidAdminToken(req)) {
    res.status(403).json({ error: "Demo sessions are disabled in production" });
    return;
  }
  await createPaymentSession(req, res, {
    productCode: req.body?.productCode || "individual_program",
    recurringEnabled: req.body?.recurringEnabled ?? true,
    promoCode: req.body?.promoCode || "FRUITFIT",
    email: req.body?.email || "client@example.com",
    telegramId: req.body?.telegramId || "demo_telegram_id",
    profileSnapshot: {
      firstName: "Имя",
      lastName: "Фамилия",
      gender: "female",
      age: "30",
      height: "170 см",
      weight: "70 кг",
      goal: "Похудение",
      dietType: "Обычное питание",
      restrictions: "Нет ограничений",
      ...(req.body?.profileSnapshot || req.body?.profile || {})
    },
    programParams: {
      trainingFrequency: "3 раза в неделю",
      deliveryTerm: "24 часа",
      ...(req.body?.programParams || req.body?.program_params || {})
    }
  }, {
    allowBodyUserId: config.nodeEnv !== "production" || hasValidAdminToken(req)
  });
});

async function createPaymentSession(req, res, body, options = {}) {
  const user = options.user || await optionalUserFromRequest(req);
  const rawProductCode = body?.productCode || body?.product_code;
  const product = rawProductCode ? productByCode(rawProductCode) : null;
  if (rawProductCode && !product) {
    res.status(400).json({ error: "Unknown productCode" });
    return;
  }

  const requestedRecurring = Boolean(body?.recurringEnabled || body?.recurring_enabled);
  const recurringEnabled = requestedRecurring && Boolean(product?.recurringEligible) && config.robokassaRecurringEnabled;
  const baseAmount = product ? sessionAmount(product) : 0;
  const profileSnapshot = sanitizeObject(body?.profileSnapshot || body?.profile || {});
  const programParams = sanitizeObject(body?.programParams || body?.program_params || {});
  const email = cleanNullableText(body?.email || user?.email, 320);
  const telegramId = cleanNullableText(body?.telegramId || body?.telegram_id || telegramIdFromProfile(user, profileSnapshot), 80);
  const promoCode = normalizePromoCode(body?.promoCode || body?.promo_code);
  const bodyUserId = options.allowBodyUserId ? cleanNullableText(body?.userId || body?.user_id, 120) : null;
  const userId = user?.id || bodyUserId;
  const id = await uniquePaymentSessionId();

  try {
    const session = await transaction(async (client) => {
      const price = promoCode && userId
        ? await previewReferralDiscount(client, {
            code: promoCode,
            userId,
            productCode: product?.code || null,
            baseAmount
          })
        : {
            promoCode,
            baseAmount: moneyNumber(baseAmount),
            discountAmount: 0,
            finalAmount: moneyNumber(baseAmount)
          };
      const result = await client.query(
        `INSERT INTO payment_sessions (
           id, user_id, product_code, amount, base_amount, discount_amount, final_amount, currency, profile_snapshot, program_params,
           email, telegram_id, promo_code, status, recurring_enabled, expires_at, meta
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'created', $14, now() + ($15 || ' hours')::interval, $16)
         RETURNING *`,
        [
          id,
          userId,
          product?.code || null,
          price.finalAmount,
          price.baseAmount,
          price.discountAmount,
          price.finalAmount,
          DEFAULT_CURRENCY,
          profileSnapshot,
          programParams,
          email,
          telegramId,
          price.promoCode || promoCode,
          recurringEnabled,
          SESSION_TTL_HOURS,
          {
            requestedRecurring,
            recurringAvailable: config.robokassaRecurringEnabled,
            testMode: config.robokassaTestMode,
            pricing: {
              baseAmount: price.baseAmount,
              discountAmount: price.discountAmount,
              finalAmount: price.finalAmount,
              promoCode: price.promoCode || promoCode || null
            }
          }
        ]
      );
      const session = result.rows[0];
      if (promoCode && userId) {
        await ensureReferralUseForPaymentSession(client, { session, promoCode, source: "payment_session_create" });
      }
      return session;
    });

    res.status(201).json({ session: serializePaymentSession(session) });
  } catch (error) {
    if (error.status) {
      res.status(error.status).json({ error: error.message, code: error.code || "REFERRAL_ERROR" });
      return;
    }
    throw error;
  }
}

paymentsRouter.get("/sessions/:id", async (req, res) => {
  const session = await loadSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Payment session not found" });
    return;
  }
  res.json({ session: serializePaymentSession(session) });
});

paymentsRouter.post("/sessions/:id/simulate-paid", async (req, res) => {
  if (config.nodeEnv === "production" && !hasValidAdminToken(req)) {
    res.status(403).json({ error: "simulate-paid is disabled in production" });
    return;
  }

  const session = await loadSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Payment session not found" });
    return;
  }
  const product = productByCode(session.product_code);
  if (!product) {
    res.status(400).json({ error: "Payment session has no valid productCode" });
    return;
  }

  const invId = session.robokassa_inv_id || generateInvoiceId();
  await markRobokassaPaymentPaid({
    invId,
    outSum: moneyString(session.amount || sessionAmount(product)),
    sessionId: session.id,
    payload: {
      simulated: true,
      InvId: String(invId),
      OutSum: moneyString(session.amount || sessionAmount(product)),
      Shp_paymentSessionId: session.id,
      Shp_productCode: product.code
    }
  });

  const updated = await loadSession(session.id);
  res.json({ session: serializePaymentSession(updated) });
});

paymentsRouter.post("/sessions/:id/recurring/cancel", async (req, res) => {
  const user = await optionalUserFromRequest(req);
  const adminToken = hasValidAdminToken(req);
  if (!user && !adminToken) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const session = await loadSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Payment session not found" });
    return;
  }
  if (session.user_id !== user?.id && !adminToken) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const result = await query(
    `UPDATE payment_sessions
     SET recurring_enabled = false,
         recurring_next_charge_at = NULL,
         meta = meta || $2::jsonb,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      session.id,
      {
        recurringCancelledAt: new Date().toISOString(),
        recurringCancelledBy: user?.id || "admin_token",
        recurringCancelReason: cleanNullableText(req.body?.reason, 240)
      }
    ]
  );
  res.json({ session: serializePaymentSession(result.rows[0]) });
});

paymentsRouter.post("/robokassa/checkout", async (req, res) => {
  const sessionId = cleanNullableText(req.body?.paymentSessionId || req.body?.sessionId || req.body?.id, 120);
  const requestedProduct = productByCode(req.body?.productCode || req.body?.product_code);
  if (!sessionId) {
    res.status(400).json({ error: "paymentSessionId is required" });
    return;
  }
  if ((req.body?.productCode || req.body?.product_code) && !requestedProduct) {
    res.status(400).json({ error: "Unknown productCode" });
    return;
  }
  if (!robokassaConfigured()) {
    res.status(503).json({ error: "Robokassa is not configured" });
    return;
  }

  const legalConsent = normalizeLegalConsent(req.body?.legalConsent || req.body?.legal_consent);
  if (!legalConsent.offerAccepted) {
    res.status(400).json({ error: "Offer acceptance is required" });
    return;
  }

  let result;
  try {
    result = await transaction(async (client) => {
    const locked = await client.query("SELECT * FROM payment_sessions WHERE id = $1 FOR UPDATE", [sessionId]);
    const session = locked.rows[0];
    if (!session) return { status: 404, body: { error: "Payment session not found" } };
    if (session.status === "paid") return { status: 409, body: { error: "Payment session is already paid" } };
    if (session.expires_at && new Date(session.expires_at).getTime() <= Date.now()) {
      await client.query("UPDATE payment_sessions SET status = 'expired', updated_at = now() WHERE id = $1", [session.id]);
      return { status: 410, body: { error: "Payment session expired" } };
    }

    const product = requestedProduct || productByCode(session.product_code);
    if (!product) return { status: 400, body: { error: "productCode is required" } };

    const baseAmount = sessionAmount(product);
    const requestedRecurring = Boolean(req.body?.recurringEnabled || req.body?.recurring_enabled || session.recurring_enabled)
      && product.recurringEligible;
    if (requestedRecurring && config.robokassaRecurringEnabled && !legalConsent.recurringAccepted) {
      return { status: 400, body: { error: "Recurring acceptance is required" } };
    }
    const recurringEnabled = requestedRecurring && config.robokassaRecurringEnabled;
    const promoCode = normalizePromoCode(req.body?.promoCode || req.body?.promo_code || session.promo_code);
    const price = promoCode && session.user_id
      ? await previewReferralDiscount(client, {
          code: promoCode,
          userId: session.user_id,
          productCode: product.code,
          baseAmount
        })
      : {
          promoCode,
          baseAmount: moneyNumber(baseAmount),
          discountAmount: 0,
          finalAmount: moneyNumber(baseAmount)
        };
    const invId = session.robokassa_inv_id || generateInvoiceId();
    const programParams = sanitizeObject(session.program_params || {});
    const legalConsentRecord = {
      ...legalConsent,
      recordedAt: new Date().toISOString(),
      userAgent: cleanNullableText(req.get("user-agent"), 500)
    };
    const updatedProgramParams = {
      ...programParams,
      legalConsent: legalConsentRecord
    };
    await client.query(
      `UPDATE payment_sessions
       SET robokassa_inv_id = $2,
           product_code = $3,
           amount = $4,
           base_amount = $5,
           discount_amount = $6,
           final_amount = $7,
           recurring_enabled = $8,
           promo_code = COALESCE($9, promo_code),
           program_params = COALESCE(program_params, '{}'::jsonb) || $10::jsonb,
           meta = COALESCE(meta, '{}'::jsonb) || $11::jsonb,
           status = 'checkout_created',
           updated_at = now()
       WHERE id = $1`,
      [
        session.id,
        invId,
        product.code,
        price.finalAmount,
        price.baseAmount,
        price.discountAmount,
        price.finalAmount,
        recurringEnabled,
        price.promoCode || promoCode,
        { legalConsent: legalConsentRecord },
        {
          pricing: {
            baseAmount: price.baseAmount,
            discountAmount: price.discountAmount,
            finalAmount: price.finalAmount,
            promoCode: price.promoCode || promoCode || null
          }
        }
      ]
    );

    if (promoCode && session.user_id) {
      await ensureReferralUseForPaymentSession(client, {
        session: {
          ...session,
          product_code: product.code,
          amount: price.finalAmount,
          base_amount: price.baseAmount,
          discount_amount: price.discountAmount,
          final_amount: price.finalAmount,
          promo_code: price.promoCode || promoCode
        },
        promoCode: price.promoCode || promoCode,
        source: "robokassa_checkout"
      });
    }

    const checkoutUrl = buildRobokassaCheckoutUrl({
      session: {
        ...session,
        product_code: product.code,
        amount: price.finalAmount,
        base_amount: price.baseAmount,
        discount_amount: price.discountAmount,
        final_amount: price.finalAmount,
        recurring_enabled: recurringEnabled,
        promo_code: price.promoCode || promoCode,
        robokassa_inv_id: invId,
        program_params: updatedProgramParams
      },
      product,
      successUrl: paymentReturnUrl("success"),
      failUrl: paymentReturnUrl("fail")
    });
    return {
      status: 200,
      body: {
        checkoutUrl,
        invId: String(invId),
        session: serializePaymentSession({
          ...session,
          product_code: product.code,
          amount: price.finalAmount,
          base_amount: price.baseAmount,
          discount_amount: price.discountAmount,
          final_amount: price.finalAmount,
          recurring_enabled: recurringEnabled,
          promo_code: price.promoCode || promoCode,
          robokassa_inv_id: invId,
          program_params: updatedProgramParams,
          status: "checkout_created"
        })
      }
    };
    });
  } catch (error) {
    if (error.status) {
      res.status(error.status).json({ error: error.message, code: error.code || "REFERRAL_ERROR" });
      return;
    }
    throw error;
  }

  res.status(result.status).json(result.body);
});

paymentsRouter.post("/robokassa/result", express.urlencoded({ extended: false }), async (req, res) => {
  const payload = { ...req.query, ...req.body };
  const invId = cleanNullableText(payload.InvId || payload.InvID || payload.InvoiceID, 40);
  const outSum = cleanNullableText(payload.OutSum, 40);
  const signature = cleanNullableText(payload.SignatureValue, 256);
  if (!invId || !outSum || !signature) {
    res.status(400).send("missing required Robokassa fields");
    return;
  }

  const password2 = password2Candidates();
  const valid = password2.some((password) => verifyRobokassaResultSignature(payload, password));
  if (!valid) {
    res.status(400).send("invalid signature");
    return;
  }

  const sessionId = cleanNullableText(payload.Shp_paymentSessionId || payload.Shp_session || payload.Shp_sessionId, 120);
  try {
    await markRobokassaPaymentPaid({ invId, outSum, sessionId, payload });
  } catch (error) {
    if (error?.code === "PAYMENT_AMOUNT_MISMATCH") {
      res.status(400).send("AMOUNT_MISMATCH");
      return;
    }
    throw error;
  }
  res.type("text/plain").send(`OK${invId}`);
});

paymentsRouter.get("/robokassa/success", async (req, res) => {
  res
    .status(200)
    .set("Cache-Control", "no-store")
    .type("html")
    .send(buildPaymentReturnHtmlClean("success"));
});

paymentsRouter.get("/robokassa/fail", async (req, res) => {
  res
    .status(200)
    .set("Cache-Control", "no-store")
    .type("html")
    .send(buildPaymentReturnHtmlClean("fail"));
});

export function paymentReturnUrl(status) {
  const base = (config.apiPublicUrl || config.siteBaseUrl).replace(/\/$/, "");
  return `${base}/api/payments/robokassa/${status === "fail" ? "fail" : "success"}`;
}

function appProfileUrl() {
  const base = (config.appPublicUrl || config.appBaseUrl || config.siteBaseUrl).replace(/\/$/, "");
  return `${base}/#/profile`;
}

function buildPaymentReturnHtmlClean(status) {
  const success = status === "success";
  const webUrl = appProfileUrl();
  const deepLinkHost = success ? "payment-success" : "payment-fail";
  const deepLinkUrl = `${config.appDeepLinkScheme}://${deepLinkHost}`;
  const androidIntentUrl = `intent://${deepLinkHost}#Intent;scheme=${encodeURIComponent(config.appDeepLinkScheme)};package=${encodeURIComponent(config.androidPackageName)};S.browser_fallback_url=${encodeURIComponent(webUrl)};end`;
  const payload = jsonForHtml({ webUrl, deepLinkUrl, androidIntentUrl });
  const title = success ? "\u041e\u043f\u043b\u0430\u0442\u0430 \u043f\u0440\u0438\u043d\u044f\u0442\u0430" : "\u041e\u043f\u043b\u0430\u0442\u0430 \u043d\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u0430";
  const message = success
    ? "\u041e\u043f\u043b\u0430\u0442\u0430 \u0438 \u0430\u043d\u043a\u0435\u0442\u043d\u044b\u0435 \u0434\u0430\u043d\u043d\u044b\u0435 \u043f\u0440\u0438\u043d\u044f\u0442\u044b. \u0412 \u0442\u0435\u0447\u0435\u043d\u0438\u0435 24 \u0447\u0430\u0441\u043e\u0432 \u0432\u044b \u043f\u043e\u043b\u0443\u0447\u0438\u0442\u0435 \u043f\u0440\u043e\u0433\u0440\u0430\u043c\u043c\u0443 \u0442\u0440\u0435\u043d\u0438\u0440\u043e\u0432\u043e\u043a."
    : "\u041e\u043f\u043b\u0430\u0442\u0430 \u043d\u0435 \u0431\u044b\u043b\u0430 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u0430. \u0412\u044b \u043c\u043e\u0436\u0435\u0442\u0435 \u0432\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f \u0432 FruitFit \u0438 \u043f\u043e\u043f\u0440\u043e\u0431\u043e\u0432\u0430\u0442\u044c \u0441\u043d\u043e\u0432\u0430.";
  const badge = success ? "\u0413\u043e\u0442\u043e\u0432\u043e" : "\u041d\u0435 \u043e\u043f\u043b\u0430\u0447\u0435\u043d\u043e";
  const returnButton = "\u0412\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f \u0432 FruitFit";
  const fallbackPrefix = "\u0415\u0441\u043b\u0438 \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435 \u043d\u0435 \u043e\u0442\u043a\u0440\u044b\u043b\u043e\u0441\u044c,";
  const fallbackLink = "\u043e\u0442\u043a\u0440\u043e\u0439\u0442\u0435 \u043a\u043b\u0438\u0435\u043d\u0442\u0441\u043a\u0438\u0439 \u0441\u0430\u0439\u0442";
  const orangeIconUrl = "https://client.tagirfruit.ru/downloads/fruitfit-orange-icon.png";
  const accent = success ? "#b8ff5f" : "#ff8b6f";
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>${htmlEscape(title)} - FruitFit</title>
  <style>
    :root { color-scheme: dark; --bg: #07150c; --text: #f5f7ef; --muted: #b8c4b3; --line: rgba(190, 215, 177, .24); --accent: ${accent}; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: radial-gradient(circle at 20% 0%, #1a341e 0, var(--bg) 42%); color: var(--text); font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(520px, 100%); border: 1px solid var(--line); border-radius: 24px; background: rgba(16, 33, 22, .92); padding: 28px; box-shadow: 0 24px 80px rgba(0, 0, 0, .32); }
    .brand { display: flex; align-items: center; gap: 14px; margin-bottom: 28px; }
    .logo { width: 52px; height: 52px; border-radius: 16px; object-fit: cover; background: #000; box-shadow: 0 0 0 1px rgba(255,255,255,.08), 0 10px 30px rgba(0,0,0,.28); }
    .brand-name { font-weight: 900; font-size: 22px; }
    .badge { display: inline-flex; padding: 8px 14px; border: 1px solid color-mix(in srgb, var(--accent), transparent 45%); border-radius: 999px; color: var(--accent); font-weight: 800; margin-bottom: 18px; }
    h1 { margin: 0; font-size: clamp(32px, 8vw, 48px); line-height: .98; letter-spacing: 0; }
    p { margin: 18px 0 0; color: var(--muted); font-size: 18px; line-height: 1.55; }
    button { width: 100%; min-height: 58px; margin-top: 28px; border: 0; border-radius: 16px; display: inline-flex; align-items: center; justify-content: center; background: var(--accent); color: #102012; font: inherit; font-weight: 900; cursor: pointer; }
    .secondary { margin-top: 14px; color: var(--muted); font-size: 14px; text-align: center; }
    .secondary a { color: var(--accent); }
  </style>
</head>
<body>
  <main>
    <div class="brand"><img class="logo" src="${htmlEscape(orangeIconUrl)}" alt=""><div class="brand-name">FruitFit</div></div>
    <div class="badge">${htmlEscape(badge)}</div>
    <h1>${htmlEscape(title)}</h1>
    <p>${htmlEscape(message)}</p>
    <button type="button" id="returnToApp">${htmlEscape(returnButton)}</button>
    <div class="secondary">${htmlEscape(fallbackPrefix)} <a id="webFallback" href="${htmlEscape(webUrl)}">${htmlEscape(fallbackLink)}</a>.</div>
  </main>
  <script>
    const fruitfitReturn = ${payload};
    document.getElementById("returnToApp").addEventListener("click", () => {
      const isAndroid = /Android/i.test(navigator.userAgent);
      const fallbackTimer = window.setTimeout(() => { window.location.href = fruitfitReturn.webUrl; }, 900);
      window.addEventListener("pagehide", () => window.clearTimeout(fallbackTimer), { once: true });
      window.location.href = isAndroid ? fruitfitReturn.androidIntentUrl : fruitfitReturn.deepLinkUrl;
    });
  </script>
</body>
</html>`;
}

function buildPaymentReturnHtml(status) {
  const success = status === "success";
  const webUrl = appProfileUrl();
  const deepLinkHost = success ? "payment-success" : "payment-fail";
  const deepLinkUrl = `${config.appDeepLinkScheme}://${deepLinkHost}`;
  const androidIntentUrl = `intent://${deepLinkHost}#Intent;scheme=${encodeURIComponent(config.appDeepLinkScheme)};package=${encodeURIComponent(config.androidPackageName)};S.browser_fallback_url=${encodeURIComponent(webUrl)};end`;
  const payload = jsonForHtml({ webUrl, deepLinkUrl, androidIntentUrl });
  const title = success ? "Оплата принята" : "Оплата не завершена";
  const message = success
    ? "Оплата и анкетные данные приняты. В течение 24 часов вы получите программу тренировок."
    : "Оплата не была завершена. Вы можете вернуться в FruitFit и попробовать снова.";
  const badge = success ? "Готово" : "Не оплачено";
  const accent = success ? "#b8ff5f" : "#ff8b6f";
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>${htmlEscape(title)} · FruitFit</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #07150c;
      --panel: #102116;
      --text: #f5f7ef;
      --muted: #b8c4b3;
      --line: rgba(190, 215, 177, .24);
      --accent: ${accent};
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      background: radial-gradient(circle at 20% 0%, #1a341e 0, var(--bg) 42%);
      color: var(--text);
      font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(520px, 100%);
      border: 1px solid var(--line);
      border-radius: 24px;
      background: rgba(16, 33, 22, .92);
      padding: 28px;
      box-shadow: 0 24px 80px rgba(0, 0, 0, .32);
    }
    .brand { display: flex; align-items: center; gap: 14px; margin-bottom: 28px; }
    .logo {
      width: 52px;
      height: 52px;
      border-radius: 16px;
      display: grid;
      place-items: center;
      background: linear-gradient(145deg, #ff9d2f, #b8ff5f);
      color: #102012;
      font-weight: 1000;
    }
    .brand-name { font-weight: 900; font-size: 22px; }
    .badge {
      display: inline-flex;
      padding: 8px 14px;
      border: 1px solid color-mix(in srgb, var(--accent), transparent 45%);
      border-radius: 999px;
      color: var(--accent);
      font-weight: 800;
      margin-bottom: 18px;
    }
    h1 { margin: 0; font-size: clamp(32px, 8vw, 48px); line-height: .98; letter-spacing: 0; }
    p { margin: 18px 0 0; color: var(--muted); font-size: 18px; line-height: 1.55; }
    button, a.button {
      width: 100%;
      min-height: 58px;
      margin-top: 28px;
      border: 0;
      border-radius: 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--accent);
      color: #102012;
      font: inherit;
      font-weight: 900;
      text-decoration: none;
      cursor: pointer;
    }
    .secondary {
      margin-top: 14px;
      color: var(--muted);
      font-size: 14px;
      text-align: center;
    }
    .secondary a { color: var(--accent); }
  </style>
</head>
<body>
  <main>
    <div class="brand">
      <div class="logo" aria-hidden="true">FF</div>
      <div class="brand-name">FruitFit</div>
    </div>
    <div class="badge">${htmlEscape(badge)}</div>
    <h1>${htmlEscape(title)}</h1>
    <p>${htmlEscape(message)}</p>
    <button type="button" id="returnToApp">Вернуться в FruitFit</button>
    <div class="secondary">Если приложение не открылось, <a id="webFallback" href="${htmlEscape(webUrl)}">откройте клиентский сайт</a>.</div>
  </main>
  <script>
    const fruitfitReturn = ${payload};
    document.getElementById("returnToApp").addEventListener("click", () => {
      const isAndroid = /Android/i.test(navigator.userAgent);
      const fallbackTimer = window.setTimeout(() => {
        window.location.href = fruitfitReturn.webUrl;
      }, 900);
      window.addEventListener("pagehide", () => window.clearTimeout(fallbackTimer), { once: true });
      window.location.href = isAndroid ? fruitfitReturn.androidIntentUrl : fruitfitReturn.deepLinkUrl;
    });
  </script>
</body>
</html>`;
}

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function jsonForHtml(value) {
  return JSON.stringify(value).replace(/[<>&]/g, (char) => ({
    "<": "\\u003c",
    ">": "\\u003e",
    "&": "\\u0026"
  }[char]));
}

export function buildRobokassaCheckoutUrl({ session, product, successUrl, failUrl }) {
  const amount = moneyString(session.final_amount ?? session.amount);
  const invId = String(session.robokassa_inv_id);
  const params = {
    MerchantLogin: config.robokassaMerchantLogin,
    OutSum: amount,
    InvId: invId,
    Description: product?.description || "FruitFit",
    Culture: "ru",
    Encoding: "utf-8",
    Shp_paymentSessionId: session.id,
    Shp_productCode: session.product_code
  };

  if (config.robokassaTestMode) params.IsTest = "1";
  if (session.email) params.Email = session.email;
  if (successUrl) {
    params.SuccessUrl2 = successUrl;
    params.SuccessUrl2Method = "GET";
  }
  if (failUrl) {
    params.FailUrl2 = failUrl;
    params.FailUrl2Method = "GET";
  }
  if (session.recurring_enabled && product?.recurringEligible && config.robokassaRecurringEnabled) {
    params.Recurring = "true";
  }

  params.SignatureValue = buildRobokassaPaymentSignature(params, password1());

  const url = new URL(config.robokassaPaymentUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export function buildRobokassaPaymentSignature(params, password) {
  const parts = [
    params.MerchantLogin,
    params.OutSum,
    params.InvId || ""
  ];
  for (const modifier of ["Receipt", "StepByStep", "ResultUrl2", "SuccessUrl2", "SuccessUrl2Method", "FailUrl2", "FailUrl2Method", "Token"]) {
    if (params[modifier]) parts.push(params[modifier]);
  }
  parts.push(password);
  parts.push(...shpSignatureParts(params));
  return robokassaHash(parts.join(":"));
}

export function verifyRobokassaResultSignature(payload, password) {
  const parts = [payload.OutSum, payload.InvId || payload.InvID || payload.InvoiceID || "", password, ...shpSignatureParts(payload)];
  const expected = robokassaHash(parts.join(":"));
  return safeEqualHex(expected, payload.SignatureValue);
}

export function shpSignatureParts(params) {
  return Object.keys(params)
    .filter((key) => /^Shp_[A-Za-z0-9_]+$/.test(key))
    .sort()
    .map((key) => `${key}=${params[key]}`);
}

export function robokassaHash(value) {
  const algorithm = String(config.robokassaHashAlgorithm || "md5").toLowerCase();
  if (!crypto.getHashes().includes(algorithm)) throw new Error(`Unsupported Robokassa hash algorithm: ${algorithm}`);
  return crypto.createHash(algorithm).update(String(value), "utf8").digest("hex");
}

export async function markRobokassaPaymentPaid({ invId, outSum, sessionId, payload }) {
  await transaction(async (client) => {
    const sessionResult = sessionId
      ? await client.query("SELECT * FROM payment_sessions WHERE id = $1 FOR UPDATE", [sessionId])
      : await client.query("SELECT * FROM payment_sessions WHERE robokassa_inv_id = $1 FOR UPDATE", [Number(invId)]);
    const session = sessionResult.rows[0] || null;
    const product = productByCode(session?.product_code);
    const paymentId = `robokassa:${invId}`;
    const amount = Number(outSum);
    assertRobokassaAmountMatchesSession({ session, outSum, paymentId });
    console.log("[fruitfit-payments] payment paid", {
      paymentId,
      sessionId: session?.id || sessionId || null,
      productCode: session?.product_code || null,
      userId: session?.user_id || null,
      amount: Number.isFinite(amount) ? amount : null
    });

    await tryEnsureReferralUseForPaidSession(client, { session });

    const paymentResult = await client.query(
      `INSERT INTO payments (
         id, user_id, payment_session_id, provider, provider_payment_id, robokassa_inv_id,
         status, amount, base_amount, discount_amount, final_amount, currency, product_code, raw_payload, paid_at, meta, updated_at
       )
       VALUES ($1, $2, $3, 'robokassa', $4, $5, 'paid', $6, $7, $8, $9, $10, $11, $12, now(), $13, now())
       ON CONFLICT (id)
       DO UPDATE SET status = 'paid',
                     raw_payload = EXCLUDED.raw_payload,
                     amount = EXCLUDED.amount,
                     base_amount = EXCLUDED.base_amount,
                     discount_amount = EXCLUDED.discount_amount,
                     final_amount = EXCLUDED.final_amount,
                     paid_at = COALESCE(payments.paid_at, now()),
                     updated_at = now()
       RETURNING *`,
      [
        paymentId,
        session?.user_id || null,
        session?.id || null,
        String(invId),
        Number(invId),
        Number.isFinite(amount) ? amount : 0,
        moneyNumber(session?.base_amount ?? amount),
        moneyNumber(session?.discount_amount ?? 0),
        moneyNumber(session?.final_amount ?? session?.amount ?? amount),
        session?.currency || DEFAULT_CURRENCY,
        session?.product_code || null,
        payload,
        { testMode: config.robokassaTestMode }
      ]
    );

    if (!session) return;

    const recurringParentInvId = session.recurring_enabled ? Number(invId) : null;
    await client.query(
      `UPDATE payment_sessions
       SET status = 'paid',
           paid_at = COALESCE(paid_at, now()),
           robokassa_inv_id = COALESCE(robokassa_inv_id, $3),
           recurring_parent_inv_id = COALESCE(recurring_parent_inv_id, $2),
           recurring_next_charge_at = CASE WHEN recurring_enabled THEN COALESCE(recurring_next_charge_at, now() + interval '30 days') ELSE recurring_next_charge_at END,
           updated_at = now()
       WHERE id = $1`,
      [session.id, recurringParentInvId, Number(invId)]
    );

    await tryQualifyReferralUseAfterPayment(client, {
      session,
      payment: paymentResult.rows[0],
      paymentId,
      amount: Number.isFinite(amount) ? amount : 0,
      productCode: session.product_code || null
    });

    if (session.user_id && product) {
      const isVip = product.accessStatus === "vip";
      await client.query(
        `INSERT INTO user_access (user_id, status, plan, premium_until, is_vip, source, meta, starts_at, expires_at, is_active, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'robokassa', $6, now(), $4, true, now())
         ON CONFLICT (user_id)
         DO UPDATE SET status = EXCLUDED.status,
                       plan = EXCLUDED.plan,
                       premium_until = EXCLUDED.premium_until,
                       is_vip = EXCLUDED.is_vip,
                       source = EXCLUDED.source,
                       meta = user_access.meta || EXCLUDED.meta,
                       starts_at = COALESCE(user_access.starts_at, EXCLUDED.starts_at),
                       expires_at = EXCLUDED.expires_at,
                       is_active = true,
                       updated_at = now()`,
        [
          session.user_id,
          product.accessStatus,
          product.accessPlan,
          new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          isVip,
          {
            paymentSessionId: session.id,
            robokassaInvId: String(invId),
            productCode: product.code,
            recurringEnabled: session.recurring_enabled
          }
        ]
      );

      if (shouldAutoAssignProgram(product)) {
        await scheduleProgramAssignmentAfterPayment(client, { session, product, paymentId, invId });
      } else if (isVip) {
        await recordProgramAssignmentStatus(client, session.user_id, session.id, {
          status: "pending_manual",
          reason: "vip_manual_coaching",
          productCode: product.code,
          paymentId,
          paymentSessionId: session.id,
          robokassaInvId: String(invId)
        });
      }
    }
  });
}

function shouldAutoAssignProgram(product) {
  return PROGRAM_PRODUCT_CODES.has(product?.code) || product?.accessPlan === "individual_program";
}

async function tryEnsureReferralUseForPaidSession(client, { session }) {
  if (!session?.promo_code || !session?.user_id) return;
  try {
    await ensureReferralUseForPaymentSession(client, {
      session,
      promoCode: session.promo_code,
      source: "robokassa_result"
    });
  } catch (error) {
    console.warn("[fruitfit-referrals] referral use was not attached during payment callback", {
      sessionId: session?.id || null,
      userId: session?.user_id || null,
      promoCode: session?.promo_code || null,
      code: error?.code || null,
      message: error?.message || "unknown"
    });
  }
}

async function tryQualifyReferralUseAfterPayment(client, { session, payment, paymentId, amount, productCode }) {
  try {
    const referralUse = await qualifyReferralUseAfterPayment(client, { session, payment, paymentId, amount, productCode });
    if (referralUse?.status === "qualified") {
      console.log("[fruitfit-referrals] referral qualified", {
        referralUseId: referralUse.id,
        code: referralUse.code,
        referrerUserId: referralUse.referrer_user_id || null,
        referredUserId: referralUse.referred_user_id || null,
        paymentSessionId: referralUse.payment_session_id || null,
        paymentId: referralUse.payment_id || null
      });
    }
  } catch (error) {
    console.warn("[fruitfit-referrals] referral qualification failed", {
      sessionId: session?.id || null,
      userId: session?.user_id || null,
      paymentId,
      code: error?.code || null,
      message: error?.message || "unknown"
    });
  }
}

async function scheduleProgramAssignmentAfterPayment(client, { session, product, paymentId, invId }) {
  const delaySeconds = assignmentDelaySeconds();
  const criteria = buildProgramCriteria(session);
  const meta = {
    programAssignmentStatus: "scheduled",
    programAssignmentDelaySeconds: delaySeconds,
    programAssignmentScheduledAt: new Date().toISOString(),
    paymentSessionId: session.id,
    paymentId,
    robokassaInvId: String(invId),
    productCode: product.code,
    criteria
  };

  const result = await client.query(
    `UPDATE payment_sessions
     SET assignment_status = CASE
           WHEN assignment_status IN ('assigned', 'scheduled', 'pending_manual') THEN assignment_status
           ELSE 'scheduled'
         END,
         assignment_due_at = CASE
           WHEN assignment_status IN ('assigned', 'scheduled', 'pending_manual') THEN assignment_due_at
           ELSE COALESCE(assignment_due_at, now() + ($2::integer * interval '1 second'))
         END,
         assignment_error = CASE
           WHEN assignment_status IN ('assigned', 'pending_manual') THEN assignment_error
           ELSE NULL
         END,
         meta = CASE
           WHEN assignment_status IN ('assigned', 'pending_manual') THEN COALESCE(meta, '{}'::jsonb)
           ELSE COALESCE(meta, '{}'::jsonb) || $3::jsonb
         END,
         updated_at = now()
     WHERE id = $1
     RETURNING assignment_status, assignment_due_at`,
    [session.id, delaySeconds, meta]
  );

  const dueAt = result.rows[0]?.assignment_due_at || null;
  const assignmentStatus = result.rows[0]?.assignment_status || "scheduled";
  if (assignmentStatus === "scheduled") {
    console.log("[fruitfit-payments] assignment scheduled", {
      sessionId: session.id,
      userId: session.user_id,
      paymentId,
      dueAt,
      delaySeconds
    });
  } else {
    console.log("[fruitfit-payments] assignment already finalized", {
      sessionId: session.id,
      userId: session.user_id,
      paymentId,
      assignmentStatus
    });
  }

  await recordUserAssignmentMeta(client, session.user_id, {
    ...meta,
    programAssignmentStatus: assignmentStatus,
    programAssignmentDueAt: dueAt ? toIso(dueAt) : null
  });
}

async function assignProgramAfterPayment(client, { session, product, paymentId, invId, source = "payment/robokassa_delayed" }) {
  const criteria = buildProgramCriteria(session);
  const selected = await selectProgramForPayment(client, criteria);
  if (!selected) {
    return {
      status: "pending_manual",
      reason: "no_matching_program",
      productCode: product.code,
      paymentId,
      paymentSessionId: session.id,
      robokassaInvId: String(invId),
      criteria
    };
  }

  const meta = {
    paymentId,
    paymentSessionId: session.id,
    robokassaInvId: String(invId),
    productCode: product.code,
    programAssignmentStatus: "assigned",
    source,
    matchScore: selected.score,
    matchedBy: selected.matchedBy,
    criteria
  };

  const result = await client.query(
    `INSERT INTO user_program_assignments (
       user_id, program_id, program_title, assigned_by, source, meta, assigned_at, updated_at
     )
     VALUES ($1, $2, $3, 'robokassa', $4, $5, now(), now())
     ON CONFLICT (user_id)
     DO UPDATE SET program_id = EXCLUDED.program_id,
                   program_title = EXCLUDED.program_title,
                   assigned_by = EXCLUDED.assigned_by,
                   source = EXCLUDED.source,
                   meta = user_program_assignments.meta || EXCLUDED.meta,
                   assigned_at = now(),
                   updated_at = now()
     RETURNING *`,
    [session.user_id, selected.programId, selected.programTitle, source, meta]
  );

  return {
    status: "assigned",
    productCode: product.code,
    paymentId,
    paymentSessionId: session.id,
    robokassaInvId: String(invId),
    programId: result.rows[0]?.program_id || selected.programId,
    programTitle: result.rows[0]?.program_title || selected.programTitle,
    matchScore: selected.score,
    matchedBy: selected.matchedBy,
    criteria
  };
}

async function recordProgramAssignmentStatus(client, userId, paymentSessionId, assignment) {
  const statusMeta = {
    programAssignmentStatus: assignment.status,
    programAssignmentReason: assignment.reason || null,
    programAssignmentUpdatedAt: new Date().toISOString(),
    paymentSessionId: assignment.paymentSessionId || paymentSessionId,
    paymentId: assignment.paymentId || null,
    robokassaInvId: assignment.robokassaInvId || null,
    assignedProgram: assignment.status === "assigned"
      ? {
          programId: assignment.programId,
          programTitle: assignment.programTitle,
          source: "payment/robokassa_delayed",
          matchScore: assignment.matchScore,
          matchedBy: assignment.matchedBy
        }
      : null
  };

  await client.query(
    `UPDATE payment_sessions
     SET assignment_status = $2,
         assignment_attempted_at = CASE WHEN $2 IN ('assigned', 'pending_manual') THEN now() ELSE assignment_attempted_at END,
         assignment_error = $3,
         assigned_program_id = $4,
         meta = COALESCE(meta, '{}'::jsonb) || $5::jsonb,
         updated_at = now()
     WHERE id = $1`,
    [
      paymentSessionId,
      assignment.status,
      assignment.status === "pending_manual" ? assignment.reason || "Manual assignment required" : null,
      assignment.status === "assigned" ? assignment.programId : null,
      statusMeta
    ]
  );

  await recordUserAssignmentMeta(client, userId, statusMeta);
}

async function recordUserAssignmentMeta(client, userId, statusMeta) {
  if (userId) {
    await client.query(
      `UPDATE user_access
       SET meta = COALESCE(meta, '{}'::jsonb) || $2::jsonb,
           updated_at = now()
       WHERE user_id = $1`,
      [userId, statusMeta]
    );
  }
}

async function selectProgramForPayment(client, criteria) {
  const result = await client.query("SELECT data FROM catalog_documents WHERE key = 'courses'");
  const courses = Array.isArray(result.rows[0]?.data) ? result.rows[0].data : [];
  const ranked = courses
    .map((course) => scoreProgram(course, criteria))
    .filter((item) => item.programId && item.score >= PROGRAM_ASSIGNMENT_MIN_SCORE)
    .sort((a, b) => b.score - a.score || String(a.programTitle).localeCompare(String(b.programTitle), "ru"));
  return ranked[0] || null;
}

export function startPaymentAssignmentWorker() {
  if (paymentAssignmentWorker) return paymentAssignmentWorker;
  const intervalMs = Math.max(5, Number(config.paymentAssignmentWorkerIntervalSeconds || 30)) * 1000;
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      await processDueProgramAssignmentJobs();
    } catch (error) {
      console.error("[fruitfit-payments] assignment worker failed", {
        message: error?.message || "unknown"
      });
    } finally {
      running = false;
    }
  }

  paymentAssignmentWorker = setInterval(tick, intervalMs);
  paymentAssignmentWorker.unref?.();
  tick();
  console.log("[fruitfit-payments] assignment worker started", {
    intervalSeconds: intervalMs / 1000,
    delaySeconds: assignmentDelaySeconds()
  });
  return paymentAssignmentWorker;
}

export async function processDueProgramAssignmentJobs() {
  return transaction(async (client) => {
    const due = await client.query(
      `SELECT *
       FROM payment_sessions
       WHERE status = 'paid'
         AND product_code = ANY($1::text[])
         AND assignment_status = 'scheduled'
         AND assignment_due_at <= now()
       ORDER BY assignment_due_at ASC
       LIMIT $2
       FOR UPDATE SKIP LOCKED`,
      [[...PROGRAM_PRODUCT_CODES], PAYMENT_ASSIGNMENT_BATCH_SIZE]
    );

    for (const session of due.rows) {
      await processProgramAssignmentSession(client, session);
    }
    return due.rowCount;
  });
}

async function processProgramAssignmentSession(client, session) {
  const product = productByCode(session.product_code);
  if (!product || !session.user_id) {
    await recordProgramAssignmentStatus(client, session.user_id, session.id, {
      status: "pending_manual",
      reason: "invalid_session_for_assignment",
      paymentSessionId: session.id,
      productCode: session.product_code
    });
    return;
  }

  const payment = await latestPaymentForSession(client, session.id);
  const invId = payment?.robokassa_inv_id || session.robokassa_inv_id || "";
  const paymentId = payment?.id || (invId ? `robokassa:${invId}` : null);

  console.log("[fruitfit-payments] assignment started", {
    sessionId: session.id,
    userId: session.user_id,
    paymentId
  });

  const assignment = await assignProgramAfterPayment(client, {
    session,
    product,
    paymentId,
    invId,
    source: "payment/robokassa_delayed"
  });
  await recordProgramAssignmentStatus(client, session.user_id, session.id, assignment);

  if (assignment.status === "assigned") {
    console.log("[fruitfit-payments] assignment assigned", {
      sessionId: session.id,
      userId: session.user_id,
      programId: assignment.programId,
      matchScore: assignment.matchScore
    });
  } else {
    console.warn("[fruitfit-payments] assignment pending manual", {
      sessionId: session.id,
      userId: session.user_id,
      reason: assignment.reason
    });
  }
}

async function latestPaymentForSession(client, sessionId) {
  const result = await client.query(
    `SELECT id, robokassa_inv_id
     FROM payments
     WHERE payment_session_id = $1
       AND status = 'paid'
     ORDER BY paid_at DESC NULLS LAST, updated_at DESC
     LIMIT 1`,
    [sessionId]
  );
  return result.rows[0] || null;
}

function buildProgramCriteria(session = {}) {
  const profile = sanitizeObject(session.profile_snapshot || {});
  const params = sanitizeObject(session.program_params || {});
  const frequency = parseFrequency(
    firstPresent(
      params.trainingFrequency,
      params.training_frequency,
      params.frequency,
      params.daysPerWeek,
      params.days_per_week,
      profile.trainingFrequency,
      profile.training_frequency,
      profile.frequency,
      profile.daysPerWeek,
      profile.days_per_week
    )
  );

  return {
    gender: normalizeGender(firstPresent(params.gender, profile.gender, profile.sex)),
    goal: normalizeGoal(firstPresent(params.goal, profile.goal, profile.trainingGoal, profile.training_goal)),
    level: normalizeLevel(firstPresent(params.experience, params.level, profile.experience, profile.level)),
    frequency,
    restrictions: normalizeRestrictions(firstPresent(params.limitations, params.restrictions, profile.limitations, profile.restrictions)),
    raw: {
      profileSnapshot: profile,
      programParams: params
    }
  };
}

function scoreProgram(course = {}, criteria = {}) {
  const matchedBy = [];
  let score = 0;
  const programId = String(course.course_id || course.id || "").trim();
  const programTitle = course.display_name || course.title || course.technical_name || programId;
  const courseGender = normalizeGender(course.gender);
  const courseGoal = normalizeGoal(course.goal || course.display_name || course.technical_name);
  const courseLevel = normalizeLevel(course.level || course.experience || course.technical_name);
  const courseFrequency = parseFrequency(course.trainings_per_week || course.frequency || course.days_per_week || course.technical_name || course.display_name);
  const courseRestrictions = normalizeRestrictions(course.restrictions || course.limitations || course.technical_name || course.display_name);

  if (criteria.gender) {
    if (courseGender === criteria.gender) {
      score += 40;
      matchedBy.push("gender");
    } else if (courseGender) {
      score -= 30;
    }
  }

  if (criteria.goal) {
    if (courseGoal === criteria.goal) {
      score += 35;
      matchedBy.push("goal");
    } else if (courseGoal) {
      score -= 8;
    }
  }

  if (criteria.frequency) {
    if (courseFrequency === criteria.frequency) {
      score += 20;
      matchedBy.push("frequency");
    } else if (courseFrequency && Math.abs(courseFrequency - criteria.frequency) === 1) {
      score += 8;
      matchedBy.push("frequency_near");
    }
  }

  if (criteria.level) {
    if (courseLevel === criteria.level) {
      score += 10;
      matchedBy.push("level");
    }
  }

  if (criteria.restrictions) {
    if (criteria.restrictions === "none" && courseRestrictions === "none") {
      score += 15;
      matchedBy.push("restrictions");
    } else if (criteria.restrictions !== "none" && courseRestrictions && courseRestrictions.includes(criteria.restrictions)) {
      score += 12;
      matchedBy.push("restrictions");
    } else if (criteria.restrictions !== "none" && courseRestrictions === "none") {
      score -= 5;
    }
  }

  return { programId, programTitle, score, matchedBy, course };
}

async function loadSession(id) {
  const result = await query("SELECT * FROM payment_sessions WHERE id = $1", [String(id)]);
  return result.rows[0] || null;
}

async function loadCurrentSubscription(userId) {
  const result = await query(
    `SELECT ps.*,
            ua.expires_at AS access_expires_at,
            ua.premium_until AS access_premium_until
     FROM payment_sessions ps
     LEFT JOIN user_access ua ON ua.user_id = ps.user_id
     WHERE ps.user_id = $1
       AND ps.recurring_enabled = true
     ORDER BY ps.recurring_next_charge_at NULLS LAST,
              ps.paid_at DESC NULLS LAST,
              ps.updated_at DESC NULLS LAST
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

function serializePaymentSession(row = {}) {
  const product = productByCode(row.product_code);
  return {
    id: row.id,
    userId: row.user_id || null,
    productCode: row.product_code,
    productTitle: product?.title || row.product_code,
    amount: Number(row.amount || 0),
    baseAmount: Number(row.base_amount || row.amount || 0),
    discountAmount: Number(row.discount_amount || 0),
    finalAmount: Number(row.final_amount || row.amount || 0),
    currency: row.currency || DEFAULT_CURRENCY,
    profileSummary: publicProfileSummary(row.profile_snapshot || {}),
    programParams: sanitizeObject(row.program_params || {}),
    email: row.email || null,
    telegramId: row.telegram_id || null,
    promoCode: row.promo_code || null,
    robokassaInvId: row.robokassa_inv_id ? String(row.robokassa_inv_id) : null,
    status: row.status || "draft",
    recurringEnabled: Boolean(row.recurring_enabled),
    recurringNextChargeAt: toIso(row.recurring_next_charge_at),
    createdAt: toIso(row.created_at),
    expiresAt: toIso(row.expires_at),
    paidAt: toIso(row.paid_at),
    assignmentStatus: row.assignment_status || null,
    assignmentDueAt: toIso(row.assignment_due_at),
    assignmentAttemptedAt: toIso(row.assignment_attempted_at),
    assignmentError: row.assignment_error || null,
    assignedProgramId: row.assigned_program_id || null,
    testMode: config.robokassaTestMode
  };
}

function serializeSubscription(row = {}) {
  const session = serializePaymentSession(row);
  const meta = sanitizeObject(row.meta || {});
  const cancelledAt = meta.recurringCancelledAt || meta.subscriptionCancelledAt || null;
  const status = row.recurring_enabled
    ? "active"
    : (cancelledAt ? "cancelled" : String(meta.subscriptionStatus || "cancelled"));
  return {
    id: row.id,
    paymentSessionId: row.id,
    productCode: session.productCode,
    productTitle: session.productTitle,
    status,
    amount: session.finalAmount || session.amount,
    currency: session.currency,
    interval: "month",
    recurringEnabled: Boolean(row.recurring_enabled),
    nextChargeAt: session.recurringNextChargeAt,
    paidUntil: toIso(row.access_expires_at || row.access_premium_until || row.expires_at),
    cancelledAt: toIso(cancelledAt),
    cancelReason: meta.recurringCancelReason || meta.subscriptionCancelReason || null,
    robokassaInvId: session.robokassaInvId
  };
}

function publicProfileSummary(profile = {}) {
  return {
    firstName: cleanNullableText(profile.firstName || profile.first_name, 80),
    lastName: cleanNullableText(profile.lastName || profile.last_name, 80),
    gender: cleanNullableText(profile.gender, 40),
    height: cleanNullableText(profile.height, 20),
    weight: cleanNullableText(profile.weight, 20),
    age: cleanNullableText(profile.age, 20),
    goal: cleanNullableText(profile.goal, 160),
    dietType: cleanNullableText(profile.dietType || profile.diet_type, 160),
    restrictions: cleanNullableText(profile.restrictions || profile.limitations, 240)
  };
}

function productByCode(code) {
  return PAYMENT_PRODUCTS[String(code || "").trim()] || null;
}

function sessionAmount(product) {
  if (product?.code === "individual_program") {
    const priceMode = String(config.programPriceMode || "").trim().toLowerCase();
    if (priceMode === "test") return config.programPriceTest;
    if (priceMode === "prod" || priceMode === "production") return config.programPriceProd;
    return config.robokassaTestMode ? config.programPriceTest : config.programPriceProd;
  }
  return product.amount;
}

function assignmentDelaySeconds() {
  const value = Number(config.paymentProgramAssignmentDelaySeconds);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : 180;
}

function password1() {
  return config.robokassaTestMode ? config.robokassaTestPassword1 || config.robokassaPassword1 : config.robokassaPassword1;
}

function password2Candidates() {
  return [config.robokassaTestPassword2, config.robokassaPassword2].filter(Boolean);
}

function robokassaConfigured() {
  return Boolean(config.robokassaMerchantLogin && password1() && password2Candidates().length);
}

function generateInvoiceId() {
  return Date.now() * 1000 + crypto.randomInt(100, 999);
}

async function uniquePaymentSessionId() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = crypto.randomBytes(10).toString("base64url");
    const existing = await query("SELECT id FROM payment_sessions WHERE id = $1", [id]);
    if (!existing.rowCount) return id;
  }
  return crypto.randomUUID();
}

function telegramIdFromProfile(user, profile) {
  return profile?.telegramId || profile?.telegram_id || user?.username || null;
}

function moneyString(value) {
  return Number(value || 0).toFixed(2);
}

function moneyNumber(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

function moneyCents(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

function assertRobokassaAmountMatchesSession({ session, outSum, paymentId }) {
  if (!session) return;
  const expected = moneyCents(session.final_amount ?? session.amount);
  const actual = moneyCents(outSum);
  if (expected !== null && actual !== null && expected === actual) return;

  console.error("[fruitfit-payments] payment amount mismatch", {
    paymentId,
    sessionId: session.id,
    userId: session.user_id || null,
    expectedFinalAmount: session.final_amount ?? session.amount,
    actualOutSum: outSum
  });

  const error = new Error("AMOUNT_MISMATCH");
  error.code = "PAYMENT_AMOUNT_MISMATCH";
  error.status = 400;
  throw error;
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function normalizedText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeGender(value) {
  const text = normalizedText(value);
  if (!text) return "";
  if (/female|woman|women|жен/.test(text)) return "female";
  if (/male|man|men|муж/.test(text)) return "male";
  return "";
}

function normalizeGoal(value) {
  const text = normalizedText(value);
  if (!text) return "";
  if (/mass|muscle|bulk|набор|масс|мышц/.test(text)) return "muscle_gain";
  if (/loss|cut|dry|fat|похуд|суш|жир|сниж/.test(text)) return "fat_loss";
  if (/recomp|tone|shape|рекомп|тонус|форм/.test(text)) return "recomposition";
  return text.slice(0, 80);
}

function normalizeLevel(value) {
  const text = normalizedText(value);
  if (!text) return "";
  if (/beginner|start|нович|начина/.test(text)) return "beginner";
  if (/advanced|pro|опыт|продвин/.test(text)) return "advanced";
  if (/middle|intermediate|средн/.test(text)) return "intermediate";
  return text.slice(0, 80);
}

function parseFrequency(value) {
  const text = normalizedText(value);
  if (!text) return null;
  const number = text.match(/\b([1-7])\b/);
  if (number) return Number(number[1]);
  if (/one|один|одно|раз/.test(text)) return 1;
  if (/two|два|две/.test(text)) return 2;
  if (/three|три/.test(text)) return 3;
  if (/four|четыр/.test(text)) return 4;
  if (/five|пять/.test(text)) return 5;
  if (/six|шесть/.test(text)) return 6;
  if (/seven|семь/.test(text)) return 7;
  return null;
}

function normalizeRestrictions(value) {
  const text = normalizedText(value);
  if (!text) return "";
  if (/none|no restrictions|без огранич|нет огранич|нет/.test(text)) return "none";
  if (/knee|колен/.test(text)) return "knee";
  if (/back|spine|спин|поясн/.test(text)) return "back";
  if (/shoulder|плеч/.test(text)) return "shoulder";
  return text.slice(0, 120);
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cleanNullableText(value, limit = 200) {
  const text = String(value || "").trim();
  return text ? text.slice(0, limit) : null;
}

function normalizePromoCode(value) {
  const text = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  return text ? text.slice(0, 40) : null;
}

function sanitizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value));
}

function normalizeLegalConsent(value) {
  const consent = sanitizeObject(value);
  return {
    offerAccepted: consent.offerAccepted === true || consent.offer_accepted === true,
    offerUrl: cleanNullableText(consent.offerUrl || consent.offer_url, 1000),
    acceptedAt: cleanNullableText(consent.acceptedAt || consent.accepted_at, 80),
    recurringAccepted: consent.recurringAccepted === true || consent.recurring_accepted === true,
    recurringTermsUrl: cleanNullableText(consent.recurringTermsUrl || consent.recurring_terms_url, 1000),
    recurringAcceptedAt: cleanNullableText(consent.recurringAcceptedAt || consent.recurring_accepted_at, 80)
  };
}

function safeEqualHex(expected, supplied) {
  const a = Buffer.from(String(expected || "").toLowerCase());
  const b = Buffer.from(String(supplied || "").toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
