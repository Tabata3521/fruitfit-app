import { Capacitor, registerPlugin } from "@capacitor/core";
import { isGooglePlayChannel } from "../config/distributionChannel";

const FruitFitInstallReferrer = registerPlugin("FruitFitInstallReferrer");
const CACHE_KEY = "fruitfit.attribution.installReferrer.v1";
const MAX_RETRY_COUNT = 3;

function readCache() {
  try {
    const value = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    return value && typeof value === "object" ? value : null;
  } catch (_) {
    return null;
  }
}

function writeCache(value) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(value));
  } catch (_) {
    // Referrer enrichment is optional and must never block startup.
  }
  return value;
}

export async function getCachedInstallReferrer() {
  const cached = readCache();
  if (cached?.status === "available" || cached?.status === "not_available") return cached;
  if ((cached?.attempts || 0) >= MAX_RETRY_COUNT) return cached;

  if (!isGooglePlayChannel() || !Capacitor.isNativePlatform?.() || Capacitor.getPlatform?.() !== "android") {
    return writeCache({
      status: "not_available",
      reason: isGooglePlayChannel() ? "android_native_required" : "channel_not_google_play",
      attempts: 1,
      checkedAt: new Date().toISOString(),
    });
  }

  try {
    const result = await FruitFitInstallReferrer.getInstallReferrer();
    return writeCache({
      status: result?.installReferrer ? "available" : "not_available",
      installReferrer: String(result?.installReferrer || ""),
      referrerClickTimestamp: Number(result?.referrerClickTimestamp || 0) || null,
      installBeginTimestamp: Number(result?.installBeginTimestamp || 0) || null,
      referrerClickTimestampServer: Number(result?.referrerClickTimestampServer || 0) || null,
      installBeginTimestampServer: Number(result?.installBeginTimestampServer || 0) || null,
      googlePlayInstant: Boolean(result?.googlePlayInstant),
      installVersion: String(result?.installVersion || ""),
      attempts: (cached?.attempts || 0) + 1,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return writeCache({
      status: "error",
      reason: String(error?.code || error?.message || "install_referrer_error").slice(0, 120),
      attempts: (cached?.attempts || 0) + 1,
      checkedAt: new Date().toISOString(),
    });
  }
}
