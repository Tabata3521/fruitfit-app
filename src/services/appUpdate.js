import { apiUrl } from "../data/authStore";
import { getAppInfo } from "./appInfo";
import { getJson } from "./nativeHttp";

export async function checkAndroidAppUpdate() {
  const appInfo = await getAppInfo();
  const currentBuild = String(appInfo.buildNumber || appInfo.build || "0");
  const params = new URLSearchParams({
    platform: "android",
    build: currentBuild,
  });
  const response = await getJson(apiUrl(`/api/app/version?${params.toString()}`), {
    credentials: "include",
    cache: "no-store",
  });
  const data = response.data || {};
  if (!response.ok) {
    throw new Error(data?.error || data?.message || "Не удалось проверить обновление");
  }
  return {
    currentVersion: appInfo.versionName || appInfo.version || "",
    currentBuild,
    hasUpdate: Boolean(data.hasUpdate),
    updateRequired: Boolean(data.updateRequired),
    latestVersion: data.latestVersion || data.version || "",
    latestBuild: data.latestBuild || data.build || "",
    releaseNotes: data.releaseNotes || data.notes || "",
    apkUrl: data.apkUrl || data.downloadUrl || "",
    raw: data,
  };
}

export function openApkDownload(apkUrl) {
  if (!apkUrl) return false;
  const opened = window.open(apkUrl, "_blank", "noopener,noreferrer");
  if (!opened) window.location.href = apkUrl;
  return true;
}
