import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { buildUtcPushSchedule, PUSH_CADENCE } from "../../../shared/pushMessages.js";
import { currentUserId } from "../../data/userScopedCache.js";
import { registerBackendPushToken, syncMotivationScheduleWithBackend } from "./backendPushBridge.js";
import { isPushNotificationsEnabled } from "./pushPreferences.js";

const CHANNEL_ID = "fruitfit_motivation";
const ADMIN_CHANNEL_ID = "fruitfit_admin";
const STORAGE_KEY = "fruitfit.localPushNotifications.v2";
const RESCHEDULE_AFTER_MS = 6 * 60 * 60_000;
const NOTIFICATION_SMALL_ICON = "ic_stat_fruitfit_orange";
const NOTIFICATION_LARGE_ICON = "app_icon_orange_artwork";
const NOTIFICATION_ICON_COLOR = "#FF7A2F";

export async function ensureMotivationLockScreenNotifications({ force = false } = {}) {
  if (!Capacitor.isNativePlatform?.()) {
    return { ok: false, status: "web_only", message: "Local notifications are available only in the native app." };
  }

  const userId = currentUserId();
  if (!userId) {
    return { ok: false, status: "UNAUTHENTICATED", message: "Push notification history is user-scoped." };
  }
  if (!force && !isPushNotificationsEnabled(userId)) {
    return { ok: false, status: "push_disabled_by_user", message: "Notifications are disabled by the user." };
  }

  const stored = readStore(userId);
  if (!force && stored.updatedAt && Date.now() - new Date(stored.updatedAt).getTime() < RESCHEDULE_AFTER_MS) {
    return {
      ok: true,
      status: "already_scheduled",
      scheduled: stored.scheduled?.length || 0,
      backendSync: stored.backendSync || null,
      nextAt: stored.scheduled?.[0]?.at || null,
    };
  }

  let permission = await LocalNotifications.checkPermissions();
  if (permission.display !== "granted") {
    permission = await LocalNotifications.requestPermissions();
  }
  if (permission.display !== "granted") {
    return { ok: false, status: "permission_missing", message: "Android notification permission is required." };
  }

  await ensureChannel();
  await cancelPrevious(stored.scheduled || []);

  const now = new Date();
  const timezoneOffsetMinutes = -now.getTimezoneOffset();
  const schedule = buildUtcPushSchedule({
    now,
    days: 7,
    timezoneOffsetMinutes,
    userId,
    recentMessageIds: recentMessageIdsFromStore(stored, now),
    recentBodies: recentBodiesFromStore(stored, now),
    previousBody: stored.lastBody || "",
  }).slice(0, 14);

  const notifications = schedule.map((item, index) => ({
    id: numericNotificationId(item.scheduledAt, index),
    title: "FruitFit",
    body: item.body,
    largeBody: item.body,
    summaryText: "Спокойное напоминание FruitFit",
    channelId: CHANNEL_ID,
    smallIcon: NOTIFICATION_SMALL_ICON,
    largeIcon: NOTIFICATION_LARGE_ICON,
    iconColor: NOTIFICATION_ICON_COLOR,
    schedule: { at: new Date(item.scheduledAt) },
    extra: {
      kind: item.kind,
      source: "local_push_behavior",
      scheduledAt: item.scheduledAt,
      messageId: item.data?.messageId || "",
      cadence: PUSH_CADENCE,
    },
  }));

  if (notifications.length) await LocalNotifications.schedule({ notifications });
  const backendSync = await syncBackendSchedule({ timezoneOffsetMinutes });

  const nextStore = {
    userId,
    updatedAt: now.toISOString(),
    lastBody: schedule.at(-1)?.body || stored.lastBody || "",
    lastSentMessageId: schedule.at(-1)?.data?.messageId || stored.lastSentMessageId || "",
    backendSync,
    scheduled: notifications.map((item) => ({
      id: item.id,
      at: item.schedule.at.toISOString(),
      body: item.body,
      kind: item.extra.kind,
      messageId: item.extra.messageId,
    })),
  };
  writeStore(userId, nextStore);

  return {
    ok: true,
    status: "scheduled",
    scheduled: notifications.length,
    backendSync,
    nextAt: nextStore.scheduled[0]?.at || null,
  };
}

export async function disableMotivationLockScreenNotifications() {
  const userId = currentUserId();
  if (!userId) return { ok: false, status: "UNAUTHENTICATED" };
  const stored = readStore(userId);
  await cancelPrevious(stored.scheduled || []);
  writeStore(userId, {
    userId,
    updatedAt: new Date().toISOString(),
    scheduled: [],
    disabledAt: new Date().toISOString(),
  });
  return { ok: true, status: "disabled" };
}

export async function showIncomingPushNotification(event = {}) {
  if (!Capacitor.isNativePlatform?.()) {
    return { ok: false, status: "web_only" };
  }
  if (!isPushNotificationsEnabled()) {
    return { ok: false, status: "push_disabled_by_user" };
  }

  let permission = await LocalNotifications.checkPermissions();
  if (permission.display !== "granted") {
    permission = await LocalNotifications.requestPermissions();
  }
  if (permission.display !== "granted") {
    return { ok: false, status: "permission_missing" };
  }

  const payload = normalizeIncomingPush(event);
  if (!payload.title && !payload.body) {
    return { ok: false, status: "empty_notification" };
  }

  await ensureAdminChannel();
  const notification = {
    id: numericNotificationId(new Date().toISOString(), Number(payload.id || Date.now()) % 1000),
    title: payload.title || "FruitFit",
    body: payload.body || "Откройте FruitFit",
    largeBody: payload.body || "",
    summaryText: "FruitFit",
    channelId: ADMIN_CHANNEL_ID,
    smallIcon: NOTIFICATION_SMALL_ICON,
    largeIcon: NOTIFICATION_LARGE_ICON,
    iconColor: NOTIFICATION_ICON_COLOR,
    schedule: { at: new Date(Date.now() + 250) },
    extra: {
      ...payload.data,
      source: "fcm_foreground_bridge",
      remoteMessageId: payload.id || "",
    },
  };

  await LocalNotifications.schedule({ notifications: [notification] });
  return { ok: true, status: "shown", id: notification.id };
}

async function ensureChannel() {
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: "FruitFit привычки",
      description: "Мотивация, порядок в зале и мягкие тренировочные напоминания.",
      importance: 4,
      visibility: 1,
      vibration: true,
      lights: false,
    });
  } catch (_) {
    // The channel may already exist with user-managed settings.
  }
}

async function ensureAdminChannel() {
  try {
    await LocalNotifications.createChannel({
      id: ADMIN_CHANNEL_ID,
      name: "FruitFit",
      description: "Сообщения от FruitFit",
      importance: 4,
      visibility: 1,
      vibration: true,
      lights: true,
    });
  } catch (_) {
    // The channel may already exist with user-managed settings.
  }
}

function normalizeIncomingPush(event = {}) {
  const data = event?.data || {};
  const title = firstText(
    event?.title,
    event?.notification?.title,
    data.title,
    data.notificationTitle,
    data.heading,
    "FruitFit",
  );
  const body = firstText(
    event?.body,
    event?.notification?.body,
    data.body,
    data.message,
    data.text,
    data.notificationBody,
  );
  return {
    id: String(event?.id || data.messageId || data.message_id || data.google_message_id || ""),
    title,
    body,
    data,
  };
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

async function syncBackendSchedule({ timezoneOffsetMinutes }) {
  const [tokenRegistration, scheduleSync] = await Promise.all([
    registerBackendPushToken({ platform: "android", provider: "fcm" }),
    syncMotivationScheduleWithBackend({ days: 7, timezoneOffsetMinutes }),
  ]);
  return { tokenRegistration, scheduleSync };
}

async function cancelPrevious(scheduled) {
  const notifications = scheduled
    .map((item) => Number(item.id))
    .filter((id) => Number.isInteger(id))
    .map((id) => ({ id }));
  if (!notifications.length) return;
  try {
    await LocalNotifications.cancel({ notifications });
  } catch (_) {
    // Old pending notifications should not block fresh scheduling.
  }
}

function numericNotificationId(iso, index) {
  const compact = iso.replace(/\D/g, "").slice(2, 12);
  return 700_000_000 + (Number(compact) % 100_000_000) + index;
}

function scopedStorageKey(userId) {
  return `${STORAGE_KEY}:${userId}`;
}

function readStore(userId) {
  if (typeof localStorage === "undefined") return {};
  try {
    const value = JSON.parse(localStorage.getItem(scopedStorageKey(userId)) || "{}") || {};
    return value.userId && value.userId !== userId ? {} : value;
  } catch (_) {
    return {};
  }
}

function writeStore(userId, value) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(scopedStorageKey(userId), JSON.stringify({ ...value, userId }));
  } catch (_) {
    // Scheduling status is useful, but not critical for app startup.
  }
}

function recentMessageIdsFromStore(stored = {}, now = new Date()) {
  return recentScheduledItems(stored, now).map((item) => item.messageId).filter(Boolean);
}

function recentBodiesFromStore(stored = {}, now = new Date()) {
  return recentScheduledItems(stored, now).map((item) => item.body).filter(Boolean);
}

function recentScheduledItems(stored = {}, now = new Date()) {
  const since = now.getTime() - 7 * 86_400_000;
  return (stored.scheduled || []).filter((item) => {
    const at = new Date(item.at || 0).getTime();
    return Number.isFinite(at) && at >= since;
  });
}
