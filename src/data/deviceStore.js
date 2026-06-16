import { apiUrl, getAuthToken } from "./authStore";
import { getAppInfo, getPlatform } from "../services/appInfo";
import { postJson } from "../services/nativeHttp";

const INSTALLATION_KEY = "fruitfit.installationId.v1";
const DEVICE_ID_KEY = "fruitfit.deviceId.v1";

export function getInstallationId() {
  return getStableId(INSTALLATION_KEY, "inst");
}

export function getDeviceId() {
  return getStableId(DEVICE_ID_KEY, "dev");
}

export function getDeviceRegistrationPayload() {
  const language = navigator.language || navigator.languages?.[0] || "";
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  const platform = detectPlatform();
  const appVersion = import.meta.env.VITE_APP_VERSION || "1.6";
  const buildNumber = import.meta.env.VITE_APP_BUILD_NUMBER || "7";
  return {
    installationId: getInstallationId(),
    installation_id: getInstallationId(),
    deviceId: getDeviceId(),
    device_id: getDeviceId(),
    platform,
    appVersion,
    app_version: appVersion,
    buildNumber,
    build_number: buildNumber,
    manufacturer: "",
    model: navigator.userAgentData?.platform || navigator.platform || "",
    osVersion: "",
    os_version: "",
    timezone,
    language,
    country: countryFromLanguage(language)
  };
}

export async function getDeviceRegistrationPayloadAsync() {
  const appInfo = await getAppInfo();
  const base = getDeviceRegistrationPayload();
  const userAgentData = navigator.userAgentData || {};
  return {
    ...base,
    platform: appInfo.platform || base.platform,
    appVersion: appInfo.versionName || appInfo.version || base.appVersion,
    app_version: appInfo.versionName || appInfo.version || base.appVersion,
    buildNumber: String(appInfo.buildNumber || appInfo.build || base.buildNumber || ""),
    build_number: String(appInfo.buildNumber || appInfo.build || base.buildNumber || ""),
    manufacturer: userAgentData.mobile ? "" : base.manufacturer,
    model: userAgentData.platform || navigator.platform || base.model || "",
  };
}

export function deviceQueryString() {
  const device = getDeviceRegistrationPayload();
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(device)) {
    if (value) params.set(key, value);
  }
  return params.toString();
}

export async function deviceQueryStringAsync() {
  const device = await getDeviceRegistrationPayloadAsync();
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(device)) {
    if (value) params.set(key, value);
  }
  return params.toString();
}

export async function registerDevice(extra = {}) {
  const token = getAuthToken();
  const payload = { ...(await getDeviceRegistrationPayloadAsync()), ...extra };
  try {
    const response = await postJson(apiUrl("/api/device/register"), { device: payload }, {
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: "no-store",
    });
    const data = response.data || {};
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    return { ok: false, status: "NETWORK_ERROR", message: error?.message || "network error" };
  }
}

function getStableId(key, prefix) {
  if (typeof window === "undefined") return "";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = `${prefix}_${randomId()}`;
  localStorage.setItem(key, id);
  return id;
}

function randomId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  window.crypto?.getRandomValues?.(bytes);
  return Array.from(bytes, (item) => item.toString(16).padStart(2, "0")).join("");
}

function detectPlatform() {
  return getPlatform();
}

function countryFromLanguage(language) {
  const match = String(language || "").match(/[-_]([a-zA-Z]{2})$/);
  return match ? match[1].toUpperCase() : "";
}
