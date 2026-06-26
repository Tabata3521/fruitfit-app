import { getAuthToken } from "../../data/authStore.js";

const API_BASE_URL = (import.meta.env.VITE_FRUITFIT_API_URL || "https://api.tagirfruit.ru").replace(/\/$/, "");
const TOKEN_STORAGE_KEYS = Object.freeze([
  "fruitfit.push.fcmToken.android.v1",
  "fruitfit.push.fcmToken.ios.v1",
  "fruitfit.pushToken.v1",
  "fruitfit.fcmToken",
  "fruitfit.firebaseToken"
]);

export async function registerBackendPushToken({ token, platform = "android", provider = "fcm", deviceId, meta = {} } = {}) {
  const authToken = getAuthToken();
  const pushToken = String(token || readStoredPushToken() || "").trim();
  if (!authToken) return { ok: false, status: "UNAUTHENTICATED" };
  if (!pushToken) return { ok: false, status: "NO_PUSH_TOKEN" };

  try {
    const response = await fetch(apiUrl("/api/push/register-token"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`
      },
      body: JSON.stringify({
        token: pushToken,
        platform,
        provider,
        deviceId,
        meta: {
          ...meta,
          source: "existing-client-notifications"
        }
      }),
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: data.status || response.status, data };
  } catch (error) {
    return { ok: false, status: "NETWORK_ERROR", message: error?.message || "network error" };
  }
}

export async function syncMotivationScheduleWithBackend({ days = 7, timezoneOffsetMinutes } = {}) {
  const authToken = getAuthToken();
  if (!authToken) return { ok: false, status: "UNAUTHENTICATED" };

  try {
    const response = await fetch(apiUrl("/api/notifications/motivation/schedule"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`
      },
      body: JSON.stringify({ days, timezoneOffsetMinutes }),
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.ok ? "synced" : response.status, data };
  } catch (error) {
    return { ok: false, status: "NETWORK_ERROR", message: error?.message || "network error" };
  }
}

function apiUrl(path) {
  if (!API_BASE_URL) return path;
  return new URL(path, API_BASE_URL).toString();
}

function readStoredPushToken() {
  if (typeof window === "undefined") return "";
  const runtimeToken = window.FruitFitPush?.token || window.fruitfitPushToken || "";
  if (runtimeToken) return runtimeToken;
  for (const key of TOKEN_STORAGE_KEYS) {
    const value = localStorage.getItem(key);
    if (value) return value;
  }
  return "";
}
