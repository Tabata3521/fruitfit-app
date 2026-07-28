import { getInstallationId } from "./deviceStore";

const STORAGE_KEY = "fruitfit.healthOnboarding.v1";
const SESSION_KEY = "fruitfit.healthOnboarding.session.v1";
export const HEALTH_ONBOARDING_RETRY_MS = 5 * 24 * 60 * 60 * 1000;

function ownerKey(user = null) {
  return String(user?.id || user?.userId || user?.user_id || getInstallationId() || "anonymous").trim();
}

function readAll() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writeAll(value) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch (_) {
    // Onboarding persistence is best-effort and never blocks the app.
  }
  return value;
}

export function readHealthOnboardingState(user = null) {
  return readAll()[ownerKey(user)] || {};
}

export function updateHealthOnboardingState(user = null, patch = {}) {
  const key = ownerKey(user);
  const all = readAll();
  const next = {
    ...(all[key] || {}),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  writeAll({ ...all, [key]: next });
  return next;
}

export function markHealthOnboardingSessionHandled(user = null) {
  try {
    sessionStorage.setItem(`${SESSION_KEY}:${ownerKey(user)}`, "1");
  } catch (_) {
    // The persisted timestamp still prevents noisy repeated prompts.
  }
}

export function healthOnboardingSessionHandled(user = null) {
  try {
    return sessionStorage.getItem(`${SESSION_KEY}:${ownerKey(user)}`) === "1";
  } catch (_) {
    return false;
  }
}

export function healthOnboardingDue(user = null, now = Date.now()) {
  if (healthOnboardingSessionHandled(user)) return false;
  const state = readHealthOnboardingState(user);
  if (state.completedAt) return false;
  const laterAt = new Date(state.laterAt || "").getTime();
  return !Number.isFinite(laterAt) || now - laterAt >= HEALTH_ONBOARDING_RETRY_MS;
}
