const FALLBACK_VERSION = import.meta.env.VITE_APP_VERSION || "1.6";
const FALLBACK_BUILD = import.meta.env.VITE_APP_BUILD_NUMBER || "7";
const PRODUCTION_API_URL = "https://api.tagirfruit.ru";

export const appInfo = Object.freeze({
  api: Object.freeze({
    productionApi: PRODUCTION_API_URL,
  }),
  chatGptApi: "", // Keep secret keys server-side; do not put sk-* keys in client builds.
});

export function normalizeApiUrl(url) {
  return String(url || "").replace(/\/$/, "");
}

export async function getAppInfo() {
  const platform = getPlatform();
  const fallback = {
    platform,
    versionName: FALLBACK_VERSION,
    version: FALLBACK_VERSION,
    buildNumber: FALLBACK_BUILD,
    build: FALLBACK_BUILD,
  };

  try {
    const info = await window.Capacitor?.Plugins?.App?.getInfo?.();
    if (!info) return fallback;
    const version = info.version || info.versionName || fallback.versionName;
    const build = info.build || info.buildNumber || fallback.buildNumber;
    return {
      ...fallback,
      ...info,
      platform,
      versionName: version,
      version,
      buildNumber: String(build || fallback.buildNumber),
      build: String(build || fallback.buildNumber),
    };
  } catch (_) {
    return fallback;
  }
}

export function getPlatform() {
  try {
    return window.Capacitor?.getPlatform?.() || "web";
  } catch (_) {
    return "web";
  }
}
