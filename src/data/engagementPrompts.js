import { readUserCoreField, writeUserCoreField } from "./dataContainers";
import { accessTier } from "./accessRules";

const STATE_FIELD = "engagementPrompts";
const SESSION_KEY_PREFIX = "fruitfit.engagementPrompt.session";
const DAY_MS = 24 * 60 * 60 * 1000;

export const engagementPromptTypes = Object.freeze({
  RATING: "rating",
  PROGRAM: "program",
});

export const engagementPromptTiming = Object.freeze({
  programFirstDelayMs: 7 * DAY_MS,
  programRepeatDelayMs: 14 * DAY_MS,
  ratingFirstDelayMs: 10 * DAY_MS,
  ratingRepeatDelayMs: 30 * DAY_MS,
  ratingMinimumLaunches: 5,
});

function cleanId(value) {
  return String(value || "").trim();
}

function validTimestamp(value) {
  const timestamp = new Date(value || "").getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isoAt(timestamp) {
  return new Date(timestamp).toISOString();
}

function userIdFrom(user = null) {
  return cleanId(user?.id || user?.userId || user?.user_id);
}

function registeredAtFrom(user = null) {
  return [
    user?.createdAt,
    user?.created_at,
    user?.registeredAt,
    user?.registered_at,
    user?.registrationDate,
    user?.registration_date,
  ].map(validTimestamp).find((value) => value !== null) ?? null;
}

function isStrictlyFreeAccess(access = {}) {
  const markers = [
    access?.billingStatus,
    access?.billing_status,
    access?.paymentStatus,
    access?.payment_status,
    access?.status,
    access?.plan,
    access?.role,
    access?.userRole,
    access?.subscription?.status,
    access?.subscription?.plan,
  ].map((value) => String(value || "").trim().toLowerCase());
  const privileged = new Set(["paid", "vip", "admin", "trainer", "test"]);
  if (
    access?.isPaid
    || access?.isVip
    || access?.isAdmin
    || access?.isTrainer
    || access?.isTest
    || markers.some((value) => privileged.has(value))
  ) {
    return false;
  }
  return accessTier(access) === "free";
}

function normalizeState(value = {}, user = null, now = Date.now()) {
  const firstSeenTimestamp = validTimestamp(value?.firstSeenAt)
    ?? registeredAtFrom(user)
    ?? now;
  return {
    firstSeenAt: isoAt(Math.min(firstSeenTimestamp, now)),
    launchCount: Math.max(0, Number(value?.launchCount) || 0),
    lastLaunchAt: value?.lastLaunchAt || null,
    rating: value?.rating && typeof value.rating === "object" ? value.rating : {},
    program: value?.program && typeof value.program === "object" ? value.program : {},
  };
}

function due(lastShownAt, delayMs, now) {
  const lastShown = validTimestamp(lastShownAt);
  return lastShown === null || now - lastShown >= delayMs;
}

export function selectEngagementPrompt({ user = null, access = null, platform = "web", state = {}, now = Date.now() } = {}) {
  const userId = userIdFrom(user);
  if (!userId || !access || !["android", "ios"].includes(platform)) return null;

  const normalized = normalizeState(state, user, now);
  const accountAgeMs = Math.max(0, now - (validTimestamp(normalized.firstSeenAt) ?? now));

  if (
    isStrictlyFreeAccess(access)
    && accountAgeMs >= engagementPromptTiming.programFirstDelayMs
    && due(normalized.program?.lastShownAt, engagementPromptTiming.programRepeatDelayMs, now)
  ) {
    return engagementPromptTypes.PROGRAM;
  }

  if (
    !normalized.rating?.completedAt
    && normalized.launchCount >= engagementPromptTiming.ratingMinimumLaunches
    && accountAgeMs >= engagementPromptTiming.ratingFirstDelayMs
    && due(normalized.rating?.lastShownAt, engagementPromptTiming.ratingRepeatDelayMs, now)
  ) {
    return engagementPromptTypes.RATING;
  }

  return null;
}

function sessionKey(userId) {
  return `${SESSION_KEY_PREFIX}:${userId}`;
}

function sessionAlreadyHandled(userId) {
  try {
    return sessionStorage.getItem(sessionKey(userId)) === "1";
  } catch (_) {
    return false;
  }
}

function markSessionHandled(userId) {
  try {
    sessionStorage.setItem(sessionKey(userId), "1");
  } catch (_) {
    // Session storage is an optimization only; user-scoped timestamps remain authoritative.
  }
}

export function prepareEngagementPrompt({ user = null, access = null, platform = "web", now = Date.now() } = {}) {
  const userId = userIdFrom(user);
  if (!userId || !access || !["android", "ios"].includes(platform) || sessionAlreadyHandled(userId)) return null;

  const stored = readUserCoreField(STATE_FIELD, userId, {});
  const state = normalizeState(stored, user, now);
  const launchedThisSession = validTimestamp(state.lastLaunchAt) !== now;
  const nextState = {
    ...state,
    launchCount: state.launchCount + (launchedThisSession ? 1 : 0),
    lastLaunchAt: isoAt(now),
  };
  const type = selectEngagementPrompt({ user, access, platform, state: nextState, now });

  if (!type) {
    writeUserCoreField(STATE_FIELD, nextState, userId);
    markSessionHandled(userId);
    return null;
  }

  const promptState = nextState[type] || {};
  writeUserCoreField(STATE_FIELD, {
    ...nextState,
    [type]: {
      ...promptState,
      lastShownAt: isoAt(now),
      shownCount: Math.max(0, Number(promptState.shownCount) || 0) + 1,
    },
  }, userId);
  markSessionHandled(userId);
  return type;
}

export function recordEngagementPromptOutcome({ user = null, type, outcome = "dismissed", now = Date.now() } = {}) {
  const userId = userIdFrom(user);
  if (!userId || !Object.values(engagementPromptTypes).includes(type)) return false;
  const state = normalizeState(readUserCoreField(STATE_FIELD, userId, {}), user, now);
  const promptState = state[type] || {};
  const field = outcome === "completed" ? "completedAt" : outcome === "action" ? "actionAt" : "dismissedAt";
  writeUserCoreField(STATE_FIELD, {
    ...state,
    [type]: {
      ...promptState,
      [field]: isoAt(now),
    },
  }, userId);
  markSessionHandled(userId);
  return true;
}

export function ratingStoreUrl(platform = "web") {
  if (platform === "ios") return "https://apps.apple.com/app/id6784431088?action=write-review";
  if (platform === "android") return "https://apps.rustore.ru/app/com.tagirfruit.fruitfit";
  return "";
}
