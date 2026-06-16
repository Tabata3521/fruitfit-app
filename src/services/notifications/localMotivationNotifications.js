import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { buildUtcMotivationSchedule } from "../../../shared/motivationMessages.js";
import { registerBackendPushToken, syncMotivationScheduleWithBackend } from "./backendPushBridge.js";

const CHANNEL_ID = "fruitfit_motivation";
const STORAGE_KEY = "fruitfit.localMotivationNotifications.v1";
const RESCHEDULE_AFTER_MS = 6 * 60 * 60_000;
const NOTIFICATION_SMALL_ICON = "ic_stat_fruitfit_orange";
const NOTIFICATION_LARGE_ICON = "app_icon_orange_artwork";
const NOTIFICATION_ICON_COLOR = "#FF7A2F";

export async function ensureMotivationLockScreenNotifications({ force = false } = {}) {
  if (!Capacitor.isNativePlatform?.()) {
    return { ok: false, status: "web_only", message: "Local notifications are available only in the native app." };
  }

  const stored = readStore();
  if (!force && stored.updatedAt && Date.now() - new Date(stored.updatedAt).getTime() < RESCHEDULE_AFTER_MS) {
    return {
      ok: true,
      status: "already_scheduled",
      scheduled: stored.scheduled?.length || 0,
      backendSync: stored.backendSync || null,
      nextAt: stored.scheduled?.[0]?.at || null
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
  const schedule = buildUtcMotivationSchedule({
    now,
    days: 5,
    timezoneOffsetMinutes,
    previousBody: stored.lastBody || ""
  }).slice(0, 12);

  const notifications = schedule.map((item, index) => ({
    id: numericNotificationId(item.scheduledAt, index),
    title: "FruitFit",
    body: item.body,
    largeBody: item.body,
    summaryText: "Спокойное напоминание",
    channelId: CHANNEL_ID,
    smallIcon: NOTIFICATION_SMALL_ICON,
    largeIcon: NOTIFICATION_LARGE_ICON,
    iconColor: NOTIFICATION_ICON_COLOR,
    schedule: { at: new Date(item.scheduledAt) },
    extra: {
      kind: item.kind,
      source: "local_motivation",
      scheduledAt: item.scheduledAt,
      cadence: "2-3/day"
    }
  }));

  if (notifications.length) await LocalNotifications.schedule({ notifications });
  const backendSync = await syncBackendSchedule({ timezoneOffsetMinutes });

  const nextStore = {
    updatedAt: now.toISOString(),
    lastBody: schedule.at(-1)?.body || stored.lastBody || "",
    backendSync,
    scheduled: notifications.map((item) => ({
      id: item.id,
      at: item.schedule.at.toISOString(),
      body: item.body
    }))
  };
  writeStore(nextStore);

  return {
    ok: true,
    status: "scheduled",
    scheduled: notifications.length,
    backendSync,
    nextAt: nextStore.scheduled[0]?.at || null
  };
}

async function ensureChannel() {
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: "FruitFit мотивация",
      description: "Спокойные напоминания о тренировках и движении.",
      importance: 4,
      visibility: 1,
      vibration: true,
      lights: false
    });
  } catch (_) {
    // The channel may already exist with user-managed settings.
  }
}

async function syncBackendSchedule({ timezoneOffsetMinutes }) {
  const [tokenRegistration, scheduleSync] = await Promise.all([
    registerBackendPushToken({ platform: "android", provider: "fcm" }),
    syncMotivationScheduleWithBackend({ days: 7, timezoneOffsetMinutes })
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

function readStore() {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
  } catch (_) {
    return {};
  }
}

function writeStore(value) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch (_) {
    // Scheduling status is useful, but not critical for app startup.
  }
}
