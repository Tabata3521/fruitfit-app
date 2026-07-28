import { Capacitor, registerPlugin } from "@capacitor/core";
import { apiUrl, getAuthToken } from "../../data/authStore";
import { getDeviceId, getDeviceRegistrationPayloadAsync } from "../../data/deviceStore";
import { postJson } from "../nativeHttp";
import { FirebaseMessaging } from "#fruitfit/firebaseMessagingNative";

const FruitFitSystemSettings = registerPlugin("FruitFitSystemSettings");

function tokenKey(platform) {
  return `fruitfit.push.fcmToken.${platform}.v1`;
}

function registeredAtKey(platform) {
  return `fruitfit.push.fcmToken.${platform}.registeredAt.v1`;
}

let listenersReady = false;
let registrationPromise = null;

export async function getFirebaseMessagingPermissionStatus() {
  const platform = Capacitor.getPlatform?.() || "web";
  if (!Capacitor.isNativePlatform?.() || !["android", "ios"].includes(platform)) {
    return { ok: false, status: "native_push_unavailable", platform };
  }
  const permissions = await FirebaseMessaging.checkPermissions();
  return {
    ok: permissions.receive === "granted",
    status: permissions.receive || "unknown",
    permissions,
    platform,
  };
}

export async function openFirebaseMessagingSettings() {
  const platform = Capacitor.getPlatform?.() || "web";
  if (!Capacitor.isNativePlatform?.() || !["android", "ios"].includes(platform)) {
    return { ok: false, status: "settings_unavailable", platform };
  }
  return FruitFitSystemSettings.openAppSettings();
}

export async function registerFirebaseMessagingPush({ force = false, prompt = false } = {}) {
  const platform = Capacitor.getPlatform?.() || "web";
  if (!Capacitor.isNativePlatform?.() || !["android", "ios"].includes(platform)) {
    return { ok: false, status: "native_push_unavailable", platform };
  }
  if (!getAuthToken()) {
    return { ok: false, status: "UNAUTHENTICATED" };
  }
  if (registrationPromise && !force) return registrationPromise;

  registrationPromise = runRegistration({ prompt });
  try {
    return await registrationPromise;
  } finally {
    registrationPromise = null;
  }
}

async function runRegistration({ prompt = false } = {}) {
  const platform = Capacitor.getPlatform?.() || "web";
  await ensureListeners();
  await ensureAndroidChannels(platform);

  let permissions = await FirebaseMessaging.checkPermissions();
  if (permissions.receive !== "granted") {
    if (!prompt) {
      return { ok: false, status: "permission_not_requested", permissions, platform };
    }
    permissions = await FirebaseMessaging.requestPermissions();
  }
  if (permissions.receive !== "granted") {
    return {
      ok: false,
      status: permissions.receive === "denied" ? "permission_denied" : "permission_missing",
      permissions,
      canOpenSettings: platform === "ios",
    };
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
    window.dispatchEvent(new CustomEvent("fruitfit:push-received", { detail: event }));
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
  }
  return response;
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
