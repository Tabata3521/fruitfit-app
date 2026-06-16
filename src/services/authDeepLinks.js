export const AUTH_RETURN_TO = "fruitfit://auth";

export function sanitizeTelegramBot(value, fallback = "fruitfit_auth_bot") {
  return String(value || fallback).replace(/^@/, "").trim() || fallback;
}

export function buildTelegramStartParam(installationId = "") {
  const cleanId = String(installationId || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 48);
  return cleanId ? `fruitfit_${cleanId}` : "fruitfit_login";
}

export function openTelegramAppLogin({ botUsername, startParam, onFallback } = {}) {
  const bot = sanitizeTelegramBot(botUsername);
  const start = encodeURIComponent(startParam || "fruitfit_login");
  const url = `tg://resolve?domain=${encodeURIComponent(bot)}&start=${start}`;
  window.location.href = url;
  window.setTimeout(() => {
    onFallback?.();
  }, 1200);
  return url;
}

export function providerAuthUrl(apiUrl, provider, queryString) {
  const normalized = String(provider || "").toLowerCase();
  return apiUrl(`/api/auth/${normalized}?${queryString}`);
}
