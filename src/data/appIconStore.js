import { Capacitor, registerPlugin } from "@capacitor/core";
import { useEffect, useMemo, useState } from "react";
import { defaultAppIconId, getAppIconById } from "../config/appIcons";

const APP_ICON_KEY = "fruitfit.appIcon";
const FruitFitAppIcon = registerPlugin("FruitFitAppIcon");

export function readAppIconId() {
  if (typeof window === "undefined") return defaultAppIconId;
  return localStorage.getItem(APP_ICON_KEY) || defaultAppIconId;
}

export function saveAppIconId(iconId) {
  localStorage.setItem(APP_ICON_KEY, iconId);
  window.dispatchEvent(new CustomEvent("fruitfit:app-icon-updated", { detail: iconId }));
}

export async function applyNativeAppIcon(icon) {
  if (!Capacitor.isNativePlatform()) {
    return { status: "web_only", message: "В web/PWA выбор сохранён локально." };
  }
  if (Capacitor.getPlatform() !== "ios") {
    return { status: "unsupported", message: "Смена ярлыка сейчас подключена для iOS." };
  }
  return FruitFitAppIcon.setAlternateIcon({
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
    setStatus("Меняю иконку...");
    try {
      const result = await applyNativeAppIcon(nextIcon);
      if (result?.status !== "unsupported") {
        saveAppIconId(nextIcon.id);
        setIconId(nextIcon.id);
      }
      setStatus(result?.message || "Иконка приложения обновлена.");
      return result;
    } catch (error) {
      const message = error?.message || "Не удалось поменять иконку приложения.";
      setStatus(message);
      return { status: "error", message };
    }
  }

  return { iconId, icon, status, selectIcon };
}
