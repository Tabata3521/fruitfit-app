import { currentUserId } from "../../data/userScopedCache.js";

const PUSH_ENABLED_KEY = "fruitfit.push.enabled.v1";

function scopedKey(userId = currentUserId()) {
  const id = String(userId || "").trim();
  return id ? `${PUSH_ENABLED_KEY}:${id}` : "";
}

export function isPushNotificationsEnabled(userId = currentUserId()) {
  if (typeof localStorage === "undefined") return false;
  const key = scopedKey(userId);
  return Boolean(key && localStorage.getItem(key) === "1");
}

export function setPushNotificationsEnabled(enabled, userId = currentUserId()) {
  if (typeof localStorage === "undefined") return false;
  const key = scopedKey(userId);
  if (!key) return false;
  if (enabled) localStorage.setItem(key, "1");
  else localStorage.removeItem(key);
  window.dispatchEvent(new CustomEvent("fruitfit:push-preference-updated", { detail: { enabled: Boolean(enabled), userId } }));
  return Boolean(enabled);
}
