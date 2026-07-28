import { Capacitor } from "@capacitor/core";
import { apiUrl, getAuthToken } from "../data/authStore";
import { getDeviceRegistrationPayload, getInstallationId } from "../data/deviceStore";
import { DISTRIBUTION_CHANNEL } from "../config/distributionChannel";
import { getAppInfo } from "./appInfo";
import { getCachedInstallReferrer } from "./installReferrer";

const QUEUE_KEY = "fruitfit.attribution.queue.v1";
const TOUCH_KEY = "fruitfit.attribution.touch.v1";
const FIRST_OPEN_KEY = "fruitfit.attribution.firstOpen.v1";
const MAX_QUEUE_SIZE = 200;
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;
const TOUCH_FIELDS = [
  "redirect_token",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "yclid",
  "ymclid",
  "gclid",
  "vk_click_id",
  "click_id",
  "campaign_id",
  "banner_id",
  "landing_page",
];
const CRITICAL_EVENTS = new Set(["app_first_open", "registration_completed"]);
const ALLOWED_EVENTS = new Set([
  "app_first_open",
  "app_open",
  "registration_started",
  "registration_completed",
  "questionnaire_started",
  "questionnaire_completed",
  "program_generated",
  "program_opened",
  "workout_opened",
  "workout_started",
  "workout_completed",
  "nutrition_opened",
  "lecture_opened",
  "ai_coach_opened",
  "paywall_opened",
  "checkout_started",
  "health_onboarding_shown",
  "health_onboarding_connect_clicked",
  "health_onboarding_later_clicked",
  "health_permission_requested",
  "health_permission_granted",
  "health_permission_denied",
  "notification_permission_requested",
  "notification_permission_granted",
  "notification_permission_denied",
]);
const PROPERTY_ALLOWLIST = new Set([
  "screen",
  "programId",
  "program_id",
  "programType",
  "program_type",
  "workoutId",
  "workout_id",
  "week",
  "day",
  "source",
  "entrypoint",
  "durationSeconds",
  "duration_seconds",
  "lectureId",
  "lecture_id",
  "paywallSource",
  "paywall_source",
  "paymentSessionId",
  "payment_session_id",
  "productCode",
  "product_code",
  "store",
  "platform",
]);

let flushPromise = null;
let initialized = false;

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (item) => item.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function readJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    return parsed == null ? fallback : parsed;
  } catch (_) {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {
    // Analytics storage failure must not affect the application.
  }
  return value;
}

function platformName() {
  const value = Capacitor.getPlatform?.() || "web";
  return ["ios", "android", "web"].includes(value) ? value : "unknown";
}

function clean(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function parseTouch(rawUrl) {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl, window.location.origin);
    const hashQuery = String(url.hash || "").includes("?")
      ? new URLSearchParams(String(url.hash).slice(String(url.hash).indexOf("?") + 1))
      : new URLSearchParams(String(url.hash || "").replace(/^#/, ""));
    const touch = {};
    TOUCH_FIELDS.forEach((field) => {
      const value = clean(url.searchParams.get(field) || hashQuery.get(field), 512);
      if (value) touch[field] = value;
    });
    if (!touch.landing_page) touch.landing_page = clean(`${url.origin}${url.pathname}`, 1000);
    const hasAttribution = TOUCH_FIELDS.some((field) => field !== "landing_page" && touch[field]);
    if (!hasAttribution) return null;
    return {
      ...touch,
      captured_at: new Date().toISOString(),
      attribution_method: touch.redirect_token ? "redirect_token" : "direct_utm",
      attribution_status: touch.redirect_token ? "confirmed" : "probable",
      attribution_confidence: touch.redirect_token ? "high" : "medium",
    };
  } catch (_) {
    return null;
  }
}

export function captureAttributionUrl(rawUrl) {
  const touch = parseTouch(rawUrl);
  if (!touch) return null;
  const state = readJson(TOUCH_KEY, {});
  const next = writeJson(TOUCH_KEY, {
    firstTouch: state.firstTouch || touch,
    lastTouch: touch,
    pending: true,
    updatedAt: touch.captured_at,
  });
  const firstOpen = readJson(FIRST_OPEN_KEY, {});
  if (firstOpen.syncedAt) queueTouchSync(touch).catch(() => {});
  return next;
}

function readQueue() {
  const queue = readJson(QUEUE_KEY, []);
  return Array.isArray(queue) ? queue : [];
}

function trimQueue(queue) {
  if (queue.length <= MAX_QUEUE_SIZE) return queue;
  const critical = queue.filter((item) => item.critical);
  const normal = queue.filter((item) => !item.critical);
  const normalSlots = Math.max(0, MAX_QUEUE_SIZE - critical.length);
  return [...critical, ...normal.slice(-normalSlots)];
}

function enqueue(item) {
  const queue = readQueue();
  if (queue.some((entry) => entry.id === item.id)) return item.id;
  writeJson(QUEUE_KEY, trimQueue([...queue, item]));
  queueMicrotask(() => flushAttributionQueue().catch(() => {}));
  return item.id;
}

function eventProperties(properties = {}) {
  return Object.fromEntries(
    Object.entries(properties)
      .filter(([key, value]) => PROPERTY_ALLOWLIST.has(key) && value !== undefined && value !== null && value !== "")
      .map(([key, value]) => [key, typeof value === "string" ? clean(value, 250) : value])
  );
}

export function trackAnalyticsEvent(eventName, properties = {}, options = {}) {
  if (!ALLOWED_EVENTS.has(eventName) || eventName === "payment_completed") return null;
  const eventId = options.eventId || uuid();
  const device = getDeviceRegistrationPayload();
  enqueue({
    id: options.queueId || `event:${eventId}`,
    endpoint: "/api/analytics/events",
    critical: CRITICAL_EVENTS.has(eventName),
    attempts: 0,
    nextAttemptAt: 0,
    createdAt: new Date().toISOString(),
    payload: {
      event_id: eventId,
      event_name: eventName,
      client_timestamp: options.clientTimestamp || new Date().toISOString(),
      installation_id: getInstallationId(),
      app_version: device.app_version || device.appVersion || "",
      platform: platformName(),
      store: DISTRIBUTION_CHANNEL,
      properties: eventProperties(properties),
    },
  });
  return Promise.resolve(eventId);
}

function installReferrerPayload(referrer = null) {
  if (!referrer || referrer.status !== "available") return null;
  return {
    install_referrer: referrer.installReferrer,
    referrerClickTimestampSeconds: referrer.referrerClickTimestamp,
    installBeginTimestampSeconds: referrer.installBeginTimestamp,
    referrerClickTimestampServerSeconds: referrer.referrerClickTimestampServer,
    installBeginTimestampServerSeconds: referrer.installBeginTimestampServer,
    instantExperienceLaunched: referrer.googlePlayInstant,
    install_version: referrer.installVersion,
  };
}

async function queueFirstOpen() {
  const installationId = getInstallationId();
  let state = readJson(FIRST_OPEN_KEY, null);
  if (!state?.installationId) {
    state = {
      installationId,
      timestamp: new Date().toISOString(),
      eventId: uuid(),
    };
    writeJson(FIRST_OPEN_KEY, state);
  }
  if (state.syncedAt) return;

  const [appInfo, referrer] = await Promise.all([getAppInfo(), getCachedInstallReferrer()]);
  const touchState = readJson(TOUCH_KEY, {});
  const touch = touchState.firstTouch || touchState.lastTouch || {};
  enqueue({
    id: `first-open:${installationId}`,
    endpoint: "/api/analytics/installations/first-open",
    critical: true,
    attempts: 0,
    nextAttemptAt: 0,
    createdAt: state.timestamp,
    firstOpen: true,
    payload: {
      installation_id: installationId,
      first_open_timestamp: state.timestamp,
      platform: platformName(),
      store: DISTRIBUTION_CHANNEL,
      target_store: DISTRIBUTION_CHANNEL,
      app_version: appInfo.versionName || appInfo.version || "",
      locale: navigator.language || "",
      language: navigator.language || "",
      client_timestamp: state.timestamp,
      ...touch,
      install_referrer: installReferrerPayload(referrer),
    },
  });
  await trackAnalyticsEvent("app_first_open", { source: "first_open" }, {
    eventId: state.eventId,
    queueId: `event:${state.eventId}`,
    clientTimestamp: state.timestamp,
  });
}

async function queueTouchSync(touch) {
  const appInfo = await getAppInfo();
  const touchedAt = touch?.captured_at || new Date().toISOString();
  const key = clean(touch?.redirect_token || `${touch?.utm_source || "unknown"}:${touchedAt}`, 160);
  enqueue({
    id: `touch:${key}`,
    endpoint: "/api/analytics/installations/first-open",
    critical: false,
    attempts: 0,
    nextAttemptAt: 0,
    createdAt: touchedAt,
    touchSync: true,
    touchCapturedAt: touchedAt,
    payload: {
      installation_id: getInstallationId(),
      first_open_timestamp: touchedAt,
      client_timestamp: touchedAt,
      platform: platformName(),
      store: DISTRIBUTION_CHANNEL,
      target_store: DISTRIBUTION_CHANNEL,
      app_version: appInfo.versionName || appInfo.version || "",
      locale: navigator.language || "",
      ...touch,
    },
  });
}

async function sendQueueItem(item) {
  const token = getAuthToken();
  const response = await fetch(apiUrl(item.endpoint), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
    cache: "no-store",
    body: JSON.stringify(item.payload),
  });
  return response;
}

export async function flushAttributionQueue() {
  if (flushPromise) return flushPromise;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  flushPromise = (async () => {
    let queue = readQueue();
    for (const item of queue) {
      if (Number(item.nextAttemptAt || 0) > Date.now()) continue;
      try {
        const response = await sendQueueItem(item);
        if (response.ok) {
          queue = queue.filter((entry) => entry.id !== item.id);
          writeJson(QUEUE_KEY, queue);
          if (item.firstOpen) {
            const state = readJson(FIRST_OPEN_KEY, {});
            writeJson(FIRST_OPEN_KEY, { ...state, syncedAt: new Date().toISOString() });
            const touch = readJson(TOUCH_KEY, {});
            writeJson(TOUCH_KEY, { ...touch, pending: false, syncedAt: new Date().toISOString() });
          } else if (item.touchSync) {
            const touch = readJson(TOUCH_KEY, {});
            if (touch.lastTouch?.captured_at === item.touchCapturedAt) {
              writeJson(TOUCH_KEY, { ...touch, pending: false, syncedAt: new Date().toISOString() });
            }
          }
          continue;
        }
        const attempts = Number(item.attempts || 0) + 1;
        const delay = response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429
          ? MAX_BACKOFF_MS
          : Math.min(MAX_BACKOFF_MS, 1000 * (2 ** Math.min(attempts, 10)));
        queue = queue.map((entry) => entry.id === item.id
          ? { ...entry, attempts, nextAttemptAt: Date.now() + delay, lastStatus: response.status }
          : entry);
        writeJson(QUEUE_KEY, queue);
      } catch (_) {
        const attempts = Number(item.attempts || 0) + 1;
        queue = queue.map((entry) => entry.id === item.id
          ? { ...entry, attempts, nextAttemptAt: Date.now() + Math.min(MAX_BACKOFF_MS, 1000 * (2 ** Math.min(attempts, 10))) }
          : entry);
        writeJson(QUEUE_KEY, queue);
        break;
      }
    }
    return true;
  })().finally(() => {
    flushPromise = null;
  });
  return flushPromise;
}

export async function initializeAttribution(initialUrl = window.location.href) {
  captureAttributionUrl(initialUrl);
  if (!initialized) {
    initialized = true;
    window.addEventListener("online", () => flushAttributionQueue().catch(() => {}));
  }
  const touch = readJson(TOUCH_KEY, {});
  const firstOpen = readJson(FIRST_OPEN_KEY, {});
  if (touch.pending && firstOpen.syncedAt && touch.lastTouch) {
    await queueTouchSync(touch.lastTouch);
  }
  await queueFirstOpen();
  await trackAnalyticsEvent("app_open", { source: "app_start" });
  flushAttributionQueue().catch(() => {});
}

export function attributionDebugState() {
  return {
    installationId: getInstallationId(),
    channel: DISTRIBUTION_CHANNEL,
    touch: readJson(TOUCH_KEY, {}),
    queue: readQueue(),
    firstOpen: readJson(FIRST_OPEN_KEY, {}),
  };
}
