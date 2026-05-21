const AUTH_KEY = "fruitfit.authUser";
const TOKEN_KEY = "fruitfit.authToken";

export function loadAuthUser() {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
  } catch (_) {
    return null;
  }
}

export function saveAuthUser(user) {
  if (!user) {
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(TOKEN_KEY);
  } else {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ ...user, updatedAt: new Date().toISOString() }));
  }
  window.dispatchEvent(new CustomEvent("fruitfit:auth-updated", { detail: user }));
  return user;
}

export function setAuthToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function getAuthToken() {
  return typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
}

export async function fetchMe() {
  const token = getAuthToken();
  if (!token) return null;
  try {
    const res = await fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      if (res.status === 401) saveAuthUser(null);
      return null;
    }
    const data = await res.json();
    if (data.user) {
      return saveAuthUser(data.user);
    }
  } catch (err) {
    console.error("[FruitFit Auth] fetchMe failed", err);
  }
  return null;
}

export function telegramWebAppUser() {
  const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
  if (!tgUser) return null;
  return {
    provider: "telegram",
    id: String(tgUser.id),
    username: tgUser.username ? `@${tgUser.username}` : [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" "),
    name: [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" "),
  };
}

export function authDisplayName(user) {
  if (!user) return "";
  return user.username || user.name || "спортсмен";
}
