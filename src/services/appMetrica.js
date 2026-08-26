import { Capacitor, registerPlugin } from "@capacitor/core";
import { DISTRIBUTION_CHANNEL } from "../config/distributionChannel.js";

const FruitFitAppMetrica = registerPlugin("FruitFitAppMetrica");
const PENDING_REGISTRATION_KEY = "fruitfit.appmetrica.pendingRegistration.v1";
const PROOF_BEFORE_RESPONSE_MS = 2 * 60 * 1000;
const PROOF_AFTER_RESPONSE_MS = 10 * 1000;
const PROOF_TTL_MS = 48 * 60 * 60 * 1000;

function isNativeAppMetricaBuild() {
  if (!Capacitor.isNativePlatform()) return false;
  const platform = Capacitor.getPlatform();
  return platform === "ios" || (platform === "android" && DISTRIBUTION_CHANNEL === "rustore");
}

function normalizedEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function headerValue(headers, name) {
  const target = String(name || "").toLowerCase();
  const entry = Object.entries(headers || {}).find(([key]) => String(key).toLowerCase() === target);
  return entry?.[1] || "";
}

function readPendingRegistration() {
  if (typeof localStorage === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_REGISTRATION_KEY) || "null");
    if (!parsed || Number(parsed.expiresAt) <= Date.now()) {
      localStorage.removeItem(PENDING_REGISTRATION_KEY);
      return null;
    }
    return parsed;
  } catch (_) {
    localStorage.removeItem(PENDING_REGISTRATION_KEY);
    return null;
  }
}

export function rememberPendingAppMetricaRegistration({ email, responseHeaders } = {}) {
  if (!isNativeAppMetricaBuild() || typeof localStorage === "undefined") return false;
  const normalized = normalizedEmail(email);
  const serverResponseAt = Date.parse(headerValue(responseHeaders, "date"));
  if (!normalized || !Number.isFinite(serverResponseAt)) return false;
  localStorage.setItem(PENDING_REGISTRATION_KEY, JSON.stringify({
    email: normalized,
    createdAfter: serverResponseAt - PROOF_BEFORE_RESPONSE_MS,
    createdBefore: serverResponseAt + PROOF_AFTER_RESPONSE_MS,
    expiresAt: Date.now() + PROOF_TTL_MS,
  }));
  return true;
}

export function clearPendingAppMetricaRegistration(email = "") {
  if (typeof localStorage === "undefined") return;
  const pending = readPendingRegistration();
  if (!pending || !email || pending.email === normalizedEmail(email)) {
    localStorage.removeItem(PENDING_REGISTRATION_KEY);
  }
}

export async function reportProvenPendingAppMetricaRegistration(user) {
  if (!isNativeAppMetricaBuild()) return { reported: false, skipped: true };
  const pending = readPendingRegistration();
  if (!pending || pending.email !== normalizedEmail(user?.email)) {
    return { reported: false, skipped: true };
  }

  const createdAt = Date.parse(user?.created_at || user?.createdAt || "");
  const proven = Number.isFinite(createdAt)
    && createdAt >= Number(pending.createdAfter)
    && createdAt <= Number(pending.createdBefore);
  clearPendingAppMetricaRegistration(user?.email);
  if (!proven) return { reported: false, skipped: true, reason: "not_new_registration" };
  return reportAppMetricaRegistration(user?.id);
}

export async function reportAppMetricaRegistration(userId) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId || !isNativeAppMetricaBuild()) {
    return { reported: false, skipped: true };
  }

  try {
    return await FruitFitAppMetrica.reportRegistration({ userId: normalizedUserId });
  } catch (error) {
    console.warn("[FruitFit AppMetrica] registration event failed", error?.message || error);
    return { reported: false, error: true };
  }
}
