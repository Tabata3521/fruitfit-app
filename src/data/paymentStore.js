import { getJson, postJson } from "../services/nativeHttp";
import { apiUrl, getAuthToken, saveAuthUser } from "./authStore";

function authHeaders(extra = {}) {
  const token = getAuthToken();
  return {
    ...extra,
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

function firstPaymentSessionValue(session = {}, ...keys) {
  for (const key of keys) {
    const value = String(session?.[key] || "").trim();
    if (value) return value;
  }
  return "";
}

export function paymentPageUrl(session) {
  const paymentPage = String(import.meta.env.VITE_FRUITFIT_PAYMENT_URL || "https://tagirfruit.ru/payment");
  const directUrl = firstPaymentSessionValue(
    session,
    "paymentUrl",
    "payment_url",
    "checkoutUrl",
    "checkout_url",
    "redirectUrl",
    "redirect_url",
    "confirmationUrl",
    "confirmation_url",
    "robokassaUrl",
    "robokassa_url",
    "url"
  );
  if (directUrl) return new URL(directUrl, window.location.origin).toString();

  const sessionId = firstPaymentSessionValue(
    typeof session === "object" ? session : { id: session },
    "id",
    "sessionId",
    "session_id",
    "paymentSessionId",
    "payment_session_id"
  );
  if (!sessionId) return "";
  const url = new URL(paymentPage, window.location.origin);
  url.searchParams.set("ps", sessionId);
  return url.toString();
}

export async function createPaymentSession(payload = {}) {
  if (!getAuthToken()) {
    throw new Error("Для оплаты нужно войти в аккаунт.");
  }
  const productCode = String(payload.productCode || payload.product_code || "individual_program").trim() || "individual_program";
  const res = await postJson(apiUrl("/api/payments/sessions"), {
    productCode,
    recurringEnabled: Boolean(payload.recurringEnabled || payload.recurring_enabled),
  }, {
    credentials: "include",
    headers: authHeaders()
  });
  if (!res.ok) {
    if (res.status === 401) {
      saveAuthUser(null);
      throw new Error("Сессия истекла. Войдите снова, чтобы оплатить.");
    }
    throw new Error(res.data?.error || res.data?.message || "Не удалось подготовить оплату");
  }
  return res.data?.session || res.data?.paymentSession || res.data || null;
}

export async function fetchPaymentSubscription() {
  try {
    const res = await getJson(apiUrl("/api/payments/subscription"), {
      credentials: "include",
      headers: authHeaders(),
      cache: "no-store"
    });
    if (!res.ok) return null;
    return normalizePaymentSubscription(res.data);
  } catch (err) {
    console.error("[FruitFit Payment] fetchPaymentSubscription failed", err);
  }
  return null;
}

export async function fetchPaymentSubscriptionCancelUrl() {
  if (!getAuthToken()) {
    throw new Error("Для отмены подписки нужно войти в аккаунт.");
  }
  const res = await getJson(apiUrl("/api/payments/subscription/cancel-url"), {
    credentials: "include",
    headers: authHeaders(),
    cache: "no-store"
  });
  if (!res.ok) {
    if (res.status === 401) {
      saveAuthUser(null);
      throw new Error("Сессия истекла. Войдите снова, чтобы отменить подписку.");
    }
    if (res.status === 404) {
      return {
        subscription: null,
        canCancel: false,
        can_cancel: false,
        message: "Активная подписка не найдена."
      };
    }
    throw new Error(res.data?.error || res.data?.message || "Не удалось проверить статус подписки");
  }
  return normalizeSubscriptionCancelInfo(res.data);
}

export async function cancelPaymentSubscription(reason = "client_request", preflightCancelInfo = null) {
  if (!getAuthToken()) {
    throw new Error("Для отмены подписки нужно войти в аккаунт.");
  }
  const cancelInfo = preflightCancelInfo || await fetchPaymentSubscriptionCancelUrl();
  if (cancelInfo && cancelInfo.canCancel === false) {
    return {
      ...cancelInfo,
      skipped: true,
      subscription: cancelInfo.subscription || null
    };
  }
  const res = await postJson(apiUrl("/api/payments/subscription/cancel"), {
    reason
  }, {
    credentials: "include",
    headers: authHeaders()
  });
  if (!res.ok) {
    if (res.status === 401) {
      saveAuthUser(null);
      throw new Error("Сессия истекла. Войдите снова, чтобы отменить подписку.");
    }
    throw new Error(res.data?.error || res.data?.message || "Не удалось отменить подписку");
  }
  const payload = normalizeSubscriptionCancelInfo(res.data);
  return {
    ...payload,
    cancelInfo,
    subscription: payload.subscription || normalizePaymentSubscription(res.data),
    robokassaUnsubscribeUrl: payload.robokassaUnsubscribeUrl || cancelInfo?.robokassaUnsubscribeUrl || "",
    robokassa_unsubscribe_url: payload.robokassaUnsubscribeUrl || cancelInfo?.robokassaUnsubscribeUrl || ""
  };
}

function normalizePaymentSubscription(payload = null) {
  const raw = payload?.subscription || payload;
  if (!raw || typeof raw !== "object") return null;
  const status = String(raw.status || "").toLowerCase();
  if (!status || status === "none") return null;
  const nextPaymentDate = raw.nextPaymentDate || raw.next_payment_date || raw.nextChargeAt || raw.recurringNextChargeAt || null;
  const paidUntil = raw.paidUntil || raw.paid_until || raw.accessUntil || raw.access_expires_at || null;
  const canCancel = raw.canCancel ?? raw.can_cancel ?? Boolean(["active", "pending", "past_due"].includes(status) && nextPaymentDate);
  const cancelMode = raw.cancelMode || raw.cancel_mode || "";
  const externalCancelRequired = raw.externalCancelRequired ?? raw.external_cancel_required ?? false;
  const robokassaUnsubscribeUrl = raw.robokassaUnsubscribeUrl
    || raw.robokassa_unsubscribe_url
    || raw.cancelUrl
    || raw.cancel_url
    || raw.url
    || "";
  return {
    ...raw,
    status: raw.status || status,
    recurringEnabled: raw.recurringEnabled ?? raw.recurring_enabled ?? Boolean(["active", "pending", "past_due"].includes(status) && nextPaymentDate),
    canCancel: Boolean(canCancel),
    can_cancel: Boolean(canCancel),
    nextPaymentDate,
    next_payment_date: raw.next_payment_date || nextPaymentDate,
    nextChargeAt: raw.nextChargeAt || nextPaymentDate,
    paidUntil,
    paid_until: raw.paid_until || paidUntil,
    cancelledAt: raw.cancelledAt || raw.cancelled_at || null,
    cancelled_at: raw.cancelled_at || raw.cancelledAt || null,
    cancelMode,
    cancel_mode: cancelMode,
    externalCancelRequired: Boolean(externalCancelRequired),
    external_cancel_required: Boolean(externalCancelRequired),
    cancelUrlAvailable: Boolean(raw.cancelUrlAvailable ?? raw.cancel_url_available ?? robokassaUnsubscribeUrl),
    cancel_url_available: Boolean(raw.cancel_url_available ?? raw.cancelUrlAvailable ?? robokassaUnsubscribeUrl),
    robokassaUnsubscribeUrl,
    robokassa_unsubscribe_url: robokassaUnsubscribeUrl,
    periodDays: raw.periodDays || raw.period_days || null,
    amount: Number(raw.amount || 0)
  };
}

function normalizeSubscriptionCancelInfo(payload = null) {
  const subscription = normalizePaymentSubscription(payload);
  const raw = payload && typeof payload === "object" ? payload : {};
  const robokassaUnsubscribeUrl = raw.robokassaUnsubscribeUrl
    || raw.robokassa_unsubscribe_url
    || raw.cancelUrl
    || raw.cancel_url
    || subscription?.robokassaUnsubscribeUrl
    || "";
  const canCancel = raw.canCancel ?? raw.can_cancel ?? subscription?.canCancel ?? false;
  const cancelMode = raw.cancelMode || raw.cancel_mode || subscription?.cancelMode || "";
  const externalCancelRequired = raw.externalCancelRequired ?? raw.external_cancel_required ?? subscription?.externalCancelRequired ?? false;
  return {
    ...raw,
    subscription,
    canCancel: Boolean(canCancel),
    can_cancel: Boolean(canCancel),
    cancelMode,
    cancel_mode: cancelMode,
    externalCancelRequired: Boolean(externalCancelRequired),
    external_cancel_required: Boolean(externalCancelRequired),
    robokassaUnsubscribeUrl,
    robokassa_unsubscribe_url: robokassaUnsubscribeUrl,
    paidUntil: raw.paidUntil || raw.paid_until || subscription?.paidUntil || null,
    paid_until: raw.paid_until || raw.paidUntil || subscription?.paidUntil || null,
    message: raw.message || ""
  };
}
