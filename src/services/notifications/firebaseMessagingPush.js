import { Capacitor } from "@capacitor/core";
import { FirebaseMessaging } from "@capacitor-firebase/messaging";
import { apiUrl, getAuthToken } from "../../data/authStore";
import { getDeviceId, getDeviceRegistrationPayloadAsync } from "../../data/deviceStore";
import { deleteJson, postJson } from "../nativeHttp";
import { showIncomingPushNotification } from "./localMotivationNotifications";
import { isPushNotificationsEnabled } from "./pushPreferences";

function tokenKey(platform) {
  return `fruitfit.push.fcmToken.${platform}.v1`;
}

function registeredAtKey(platform) {
  return `fruitfit.push.fcmToken.${platform}.registeredAt.v1`;
}

let listenersReady = false;
let registrationPromise = null;

export async function registerFirebaseMessagingPush({ force = false } = {}) {
  const platform = Capacitor.getPlatform?.() || "web";
  if (!Capacitor.isNativePlatform?.() || !["android", "ios"].includes(platform)) {
    return { ok: false, status: "native_push_unavailable", platform };
  }
  if (!getAuthToken()) {
    return { ok: false, status: "UNAUTHENTICATED" };
  }
  if (!force && !isPushNotificationsEnabled()) {
    return { ok: false, status: "push_disabled_by_user", platform };
  }
  if (registrationPromise && !force) return registrationPromise;

  registrationPromise = runRegistration();
  try {
    return await registrationPromise;
  } catch (error) {
    return registrationErrorResult(error, platform);
  } finally {
    registrationPromise = null;
  }
}

async function runRegistration() {
  const platform = Capacitor.getPlatform?.() || "web";
  await ensureListeners();
  await ensureAndroidChannels(platform);

  let permissions = await FirebaseMessaging.checkPermissions();
  if (permissions.receive !== "granted") {
    permissions = await FirebaseMessaging.requestPermissions();
  }
  if (permissions.receive !== "granted") {
    return { ok: false, status: "permission_missing", permissions };
  }

  const result = await FirebaseMessaging.getToken();
  const token = String(result?.token || "").trim();
  if (!token) return { ok: false, status: "NO_FCM_TOKEN" };

  return persistFcmToken(token, platform);
}

async function ensureListeners() {
  if (listenersReady) return;
  listenersReady = true;

  await FirebaseMessaging.addListener("tokenReceived", async (event) => {
    const token = String(event?.token || "").trim();
    if (!token) return;
    try {
      await persistFcmToken(token, Capacitor.getPlatform?.() || "native");
    } catch (error) {
      console.warn("[FruitFit Push] FCM token registration failed", error?.message || error);
    }
  });

  await FirebaseMessaging.addListener("notificationReceived", (event) => {
    console.info("[FruitFit Push] notificationReceived", {
      id: event?.id || "",
      title: event?.title || event?.data?.title || "",
      hasBody: Boolean(event?.body || event?.data?.body || event?.data?.message),
    });
    window.dispatchEvent(new CustomEvent("fruitfit:push-received", { detail: event }));
    showIncomingPushNotification(event).catch((error) => {
      console.warn("[FruitFit Push] foreground notification display failed", error?.message || error);
    });
  });

  await FirebaseMessaging.addListener("notificationActionPerformed", (event) => {
    window.dispatchEvent(new CustomEvent("fruitfit:push-action", { detail: event }));
  });
}

async function ensureAndroidChannels(platform) {
  if (platform !== "android" || typeof FirebaseMessaging.createChannel !== "function") return;
  const channels = [
    {
      id: "fruitfit_admin",
      name: "FruitFit",
      description: "Admin notifications from FruitFit",
    },
    {
      id: "fruitfit_motivation",
      name: "FruitFit Motivation",
      description: "Motivation and training reminders",
    },
  ];

  for (const channel of channels) {
    try {
      await FirebaseMessaging.createChannel({
        ...channel,
        importance: 4,
        visibility: 1,
        lights: true,
        vibration: true,
      });
    } catch (error) {
      console.warn("[FruitFit Push] channel create failed", channel.id, error?.message || error);
    }
  }
}

async function persistFcmToken(token, platform) {
  const authToken = getAuthToken();
  if (!authToken) return { ok: false, status: "UNAUTHENTICATED" };

  const device = await getDeviceRegistrationPayloadAsync();
  const normalizedPlatform = platform || Capacitor.getPlatform?.() || "native";
  const previousToken = safeLocalStorageGet(tokenKey(normalizedPlatform));
  const response = await postJson(apiUrl("/api/push/register-token"), {
    token,
    provider: "fcm",
    platform: normalizedPlatform,
    deviceId: getDeviceId(),
    appVersion: device.appVersion || device.app_version || "",
    locale: navigator.language || "",
    registeredFrom: "capacitor-firebase-messaging",
    meta: {
      ...device,
      previousToken: previousToken && previousToken !== token ? previousToken : undefined,
      registeredFrom: "capacitor-firebase-messaging",
    },
  }, {
    credentials: "include",
    headers: { Authorization: `Bearer ${authToken}` },
    cache: "no-store",
  });

  if (response.ok) {
    safeLocalStorageSet(tokenKey(normalizedPlatform), token);
    safeLocalStorageSet(registeredAtKey(normalizedPlatform), new Date().toISOString());
    console.info("[FruitFit Push] FCM token registered", {
      platform: normalizedPlatform,
      suffix: token.slice(-8),
      deviceId: getDeviceId(),
    });
  } else {
    console.warn("[FruitFit Push] FCM token backend registration failed", {
      platform: normalizedPlatform,
      status: response.status,
      data: response.data,
    });
  }
  return response;
}

export async function disableFirebaseMessagingPush() {
  const platform = Capacitor.getPlatform?.() || "web";
  const authToken = getAuthToken();
  if (!authToken) return { ok: false, status: "UNAUTHENTICATED" };

  const token = safeLocalStorageGet(tokenKey(platform));
  const response = await deleteJson(apiUrl("/api/notifications/tokens"), {
    token,
    deviceId: getDeviceId(),
  }, {
    credentials: "include",
    headers: { Authorization: `Bearer ${authToken}` },
    cache: "no-store",
  });

  return {
    ok: response.ok,
    status: response.ok ? "disabled" : response.status,
    data: response.data,
  };
}

function safeLocalStorageGet(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch (_) {
    return "";
  }
}

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (_) {
    // Token registration should not block app startup.
  }
}

function registrationErrorResult(error, platform) {
  const message = String(error?.message || error || "");
  if (/not implemented/i.test(message)) {
    return {
      ok: false,
      status: "native_plugin_missing",
      platform,
      message: "Firebase Messaging plugin is unavailable in this native build.",
    };
  }
  if (/SERVICE_NOT_AVAILABLE|unavailable|network/i.test(message)) {
    return {
      ok: false,
      status: "service_unavailable",
      platform,
      message,
    };
  }
  return {
    ok: false,
    status: "registration_failed",
    platform,
    message,
  };
}
