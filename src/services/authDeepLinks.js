export const AUTH_RETURN_TO = "fruitfit://auth";

const ALLOWED_HTTPS_HOSTS = new Set([
  "tagirfruit.ru",
  "www.tagirfruit.ru",
  "api.tagirfruit.ru",
]);

const REGISTER_EVENTS = new Set(["register", "email_register"]);
const VERIFY_EVENTS = new Set(["email_verify"]);
const RESET_EVENTS = new Set(["password_reset"]);
const KNOWN_EVENTS = new Set([
  ...REGISTER_EVENTS,
  ...VERIFY_EVENTS,
  ...RESET_EVENTS,
]);

function safeDecode(value = "") {
  try {
    return decodeURIComponent(String(value || ""));
  } catch (_) {
    return String(value || "");
  }
}

function hashParamsFromUrl(url) {
  const rawHash = String(url?.hash || "").replace(/^#/, "");
  const query = rawHash.includes("?") ? rawHash.slice(rawHash.indexOf("?") + 1) : rawHash;
  return new URLSearchParams(query);
}

function hashPathFromUrl(url) {
  const rawHash = String(url?.hash || "").replace(/^#/, "");
  return rawHash.split("?")[0].replace(/^\/?/, "/").toLowerCase();
}

function firstParam(url, hashParams, ...names) {
  for (const name of names) {
    const value = url.searchParams.get(name) ?? hashParams.get(name);
    if (value !== null && value !== "") return safeDecode(value);
  }
  return "";
}

function secretDigest(value = "") {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function allowedUrl(url) {
  if (url.protocol === "fruitfit:") {
    return url.hostname.toLowerCase() === "auth";
  }
  if (url.protocol === "https:" || url.protocol === "http:") {
    if (url.protocol === "http:" && !["localhost", "127.0.0.1"].includes(url.hostname.toLowerCase())) return false;
    return ALLOWED_HTTPS_HOSTS.has(url.hostname.toLowerCase())
      || ["localhost", "127.0.0.1"].includes(url.hostname.toLowerCase());
  }
  return false;
}

function pathKind(path = "") {
  const normalized = String(path || "").toLowerCase().replace(/\/+/g, "/");
  if (normalized.endsWith("/email/register") || normalized === "/email/register") return "register";
  if (normalized.endsWith("/email/verify") || normalized === "/email/verify") return "verify";
  if (normalized.endsWith("/email/reset-password") || normalized === "/email/reset-password") return "reset";
  return "";
}

export function parseAuthDeepLink(rawUrl = "") {
  let url;
  try {
    url = new URL(String(rawUrl || ""), typeof window !== "undefined" ? window.location.origin : "https://tagirfruit.ru");
  } catch (_) {
    return { recognized: false, kind: "none", screen: "login", deliveryKey: "invalid" };
  }
  if (!allowedUrl(url)) {
    return { recognized: false, kind: "none", screen: "login", deliveryKey: "rejected" };
  }

  const hashParams = hashParamsFromUrl(url);
  const queryEvent = firstParam(url, hashParams, "event", "mode").toLowerCase();
  const nativePath = url.hostname === "email" ? `/email${url.pathname}` : url.pathname;
  const fromPath = pathKind(nativePath) || pathKind(hashPathFromUrl(url));
  const email = firstParam(url, hashParams, "email").trim().toLowerCase();
  const token = firstParam(url, hashParams, "token");
  let kind = "";
  if (REGISTER_EVENTS.has(queryEvent) || fromPath === "register") kind = "register";
  else if (VERIFY_EVENTS.has(queryEvent) || fromPath === "verify") kind = "verify";
  else if (RESET_EVENTS.has(queryEvent) || fromPath === "reset") kind = "reset";
  else if (queryEvent && !KNOWN_EVENTS.has(queryEvent)) {
    return { recognized: false, kind: "none", screen: "login", deliveryKey: `unknown:${queryEvent}` };
  }

  if (!kind) return { recognized: false, kind: "none", screen: "login", deliveryKey: "none" };

  const screen = {
    register: "register",
    verify: "verificationLink",
    reset: "resetPasswordLink",
  }[kind] || "login";
  const deliveryKey = `${kind}:${email}:${token ? secretDigest(token) : "no-secret"}`;
  return {
    recognized: true,
    kind,
    screen,
    email,
    token,
    deliveryKey,
  };
}

export function stripAuthSecretsFromBrowserUrl() {
  if (typeof window === "undefined" || !window.history?.replaceState) return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("token");
    url.searchParams.delete("auth_token");
    const rawHash = String(url.hash || "").replace(/^#/, "");
    if (rawHash) {
      const [hashPath, hashQuery = ""] = rawHash.split("?");
      const hashParams = new URLSearchParams(hashQuery || (rawHash.includes("=") ? rawHash : ""));
      hashParams.delete("token");
      hashParams.delete("auth_token");
      if (hashQuery) {
        const nextQuery = hashParams.toString();
        url.hash = `${hashPath}${nextQuery ? `?${nextQuery}` : ""}`;
      } else if (rawHash.includes("=")) {
        url.hash = hashParams.toString();
      }
    }
    if (/\/email\/(verify|reset-password|register)\/?$/i.test(url.pathname)) {
      url.pathname = "/";
      url.hash = "";
    }
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch (_) {}
}
