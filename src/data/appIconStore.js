import { useEffect, useMemo, useState } from "react";
import { defaultAppIconId, getAppIconById } from "../config/appIcons";

const APP_ICON_KEY = "fruitfit.appIcon";

export function readAppIconId() {
  if (typeof window === "undefined") return defaultAppIconId;
  return localStorage.getItem(APP_ICON_KEY) || defaultAppIconId;
}

export function saveAppIconId(iconId) {
  localStorage.setItem(APP_ICON_KEY, iconId);
  window.dispatchEvent(new CustomEvent("fruitfit:app-icon-updated", { detail: iconId }));
}

export async function applyNativeAppIcon(icon) {
  const plugin = window.Capacitor?.Plugins?.FruitFitAppIcon;
  if (!plugin?.setAlternateIcon) {
    return { status: "web_only", message: "В web/PWA выбор сохранён локально. В Android APK ярлык меняется через native bridge." };
  }
  return plugin.setAlternateIcon({
    androidAlias: icon.androidAlias,
    iosAlternateName: icon.iosAlternateName,
  });
}

export function useAppIcon() {
  const [iconId, setIconId] = useState(readAppIconId);
  const [status, setStatus] = useState("");
  const icon = useMemo(() => getAppIconById(iconId), [iconId]);

  useEffect(() => {
    function sync(event) {
      setIconId(event?.detail || readAppIconId());
    }
    window.addEventListener("fruitfit:app-icon-updated", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("fruitfit:app-icon-updated", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  async function selectIcon(nextId) {
    const nextIcon = getAppIconById(nextId);
    saveAppIconId(nextIcon.id);
    setIconId(nextIcon.id);
    const result = await applyNativeAppIcon(nextIcon);
    setStatus(result?.message || "Иконка сохранена.");
    return result;
  }

  return { iconId, icon, status, selectIcon };
}
