const ALLOWED_CHANNELS = new Set([
  "app_store",
  "google_play",
  "rustore",
  "huawei_appgallery",
  "direct_apk",
  "unknown",
]);

export const DISTRIBUTION_CHANNEL = (() => {
  const configured = String(import.meta.env.VITE_DISTRIBUTION_CHANNEL || "unknown").trim().toLowerCase();
  return ALLOWED_CHANNELS.has(configured) ? configured : "unknown";
})();

export function isGooglePlayChannel() {
  return DISTRIBUTION_CHANNEL === "google_play";
}
