import { Capacitor } from "@capacitor/core";
import { FirebaseMessaging } from "@capacitor-firebase/messaging";
import { apiUrl, getAuthToken } from "../../data/authStore";
import { getDeviceId, getDeviceRegistrationPayloadAsync } from "../../data/deviceStore";
import { postJson } from "../nativeHttp";

const LAST_TOKEN_KEY = "fruitfit.push.fcmToken.ios.v1";
const LAST_REGISTERED_AT_KEY = "fruitfit.push.fcmToken.ios.registeredAt.v1";

let listenersReady = false;
let registrationPromise = null;

export async function registerFirebaseMessagingPush({ force = false } = {}) {
  if (!Capacitor.isNativePlatform?.() || Capacitor.getPlatform?.() !== "ios") {
    return { ok: false, status: "ios_only" };
  }
  if (!getAuthToken()) {
    return { ok: false, status: "UNAUTHENTICATED" };
  }
  if (registrationPromise && !force) return registrationPromise;

  registrationPromise = runRegistration();
  try {
    return await registrationPromise;
  } finally {
    registrationPromise = null;
  }
}

async function runRegistration() {
  await ensureListeners();

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

  return persistFcmToken(token);
}

async function ensureListeners() {
  if (listenersReady) return;
  listenersReady = true;

  await FirebaseMessaging.addListener("tokenReceived", async (event) => {
    const token = String(event?.token || "").trim();
    if (!token) return;
    try {
      await persistFcmToken(token);
    } catch (error) {
      console.warn("[FruitFit iOS Push] FCM token registration failed", error?.message || error);
    }
  });

  await FirebaseMessaging.addListener("notificationReceived", (event) => {
    window.dispatchEvent(new CustomEvent("fruitfit:push-received", { detail: event }));
  });

  await FirebaseMessaging.addListener("notificationActionPerformed", (event) => {
    window.dispatchEvent(new CustomEvent("fruitfit:push-action", { detail: event }));
  });
}

async function persistFcmToken(token) {
  const authToken = getAuthToken();
  if (!authToken) return { ok: false, status: "UNAUTHENTICATED" };

  const device = await getDeviceRegistrationPayloadAsync();
  const previousToken = safeLocalStorageGet(LAST_TOKEN_KEY);
  const response = await postJson(apiUrl("/api/push/register-token"), {
    token,
    provider: "fcm",
    platform: "ios",
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
    safeLocalStorageSet(LAST_TOKEN_KEY, token);
    safeLocalStorageSet(LAST_REGISTERED_AT_KEY, new Date().toISOString());
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
