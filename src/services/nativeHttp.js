import { Capacitor, CapacitorHttp } from "@capacitor/core";

function isNativeHttpAvailable() {
  try {
    return Boolean(Capacitor?.isNativePlatform?.() && CapacitorHttp);
  } catch (_) {
    return false;
  }
}

function normalizeNativeData(data) {
  if (typeof data !== "string") return data;
  try {
    return JSON.parse(data);
  } catch (_) {
    return data;
  }
}

function normalizeHeaders(headers = {}) {
  if (!headers) return {};
  if (typeof headers.entries === "function") {
    return Object.fromEntries(headers.entries());
  }
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), String(value)]));
}

function responseErrorCode(data = {}) {
  const value = data?.code || data?.error?.code || data?.error || data?.message || "";
  return String(value || "").trim().replace(/[\s-]+/g, "_").toUpperCase();
}

function hasBearerHeader(headers = {}) {
  return Object.entries(headers || {}).some(([key, value]) => (
    String(key).toLowerCase() === "authorization"
    && /^bearer\s+\S+/i.test(String(value || ""))
  ));
}

function notifyInvalidSession({ status, data, requestHeaders }) {
  if (typeof window === "undefined" || !hasBearerHeader(requestHeaders)) return;
  const rawCode = responseErrorCode(data);
  if (rawCode === "INVALID_CREDENTIALS") return;
  const code = rawCode === "UNAUTHORIZED" || rawCode === "INVALID_TOKEN"
    ? "SESSION_REVOKED"
    : rawCode;
  if (code !== "SESSION_REVOKED" && code !== "ACCOUNT_DELETED" && Number(status) !== 401) return;
  window.dispatchEvent(new CustomEvent("fruitfit:auth-session-invalid", {
    detail: { code: code || "SESSION_REVOKED", status: Number(status) || 401 },
  }));
}

function normalizedResponse(response, requestHeaders = {}) {
  const result = {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    data: normalizeNativeData(response.data),
    headers: normalizeHeaders(response.headers),
  };
  notifyInvalidSession({ ...result, requestHeaders });
  return result;
}

async function webResponse(response, requestHeaders = {}) {
  const data = await response.json().catch(() => ({}));
  const result = {
    ok: response.ok,
    status: response.status,
    data,
    headers: normalizeHeaders(response.headers),
  };
  notifyInvalidSession({ ...result, requestHeaders });
  return result;
}

export async function getJson(url, options = {}) {
  if (isNativeHttpAvailable()) {
    const response = await CapacitorHttp.get({
      url,
      headers: options.headers || {},
      params: options.params || {},
    });
    return normalizedResponse(response, options.headers || {});
  }

  const response = await fetch(url, {
    credentials: options.credentials || "include",
    cache: options.cache || "no-store",
    headers: options.headers,
  });
  return webResponse(response, options.headers || {});
}

export async function postJson(url, body = {}, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (isNativeHttpAvailable()) {
    const response = await CapacitorHttp.post({
      url,
      headers,
      data: body,
    });
    return normalizedResponse(response, headers);
  }

  const response = await fetch(url, {
    method: "POST",
    credentials: options.credentials || "include",
    headers,
    body: JSON.stringify(body),
    cache: options.cache || "no-store",
  });
  return webResponse(response, headers);
}

export async function putJson(url, body = {}, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (isNativeHttpAvailable()) {
    const response = await CapacitorHttp.put({
      url,
      headers,
      data: body,
    });
    return normalizedResponse(response, headers);
  }

  const response = await fetch(url, {
    method: "PUT",
    credentials: options.credentials || "include",
    headers,
    body: JSON.stringify(body),
    cache: options.cache || "no-store",
  });
  return webResponse(response, headers);
}

export async function deleteJson(url, body = {}, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (isNativeHttpAvailable()) {
    const response = await CapacitorHttp.delete({
      url,
      headers,
      data: body,
      params: options.params || {},
    });
    return normalizedResponse(response, headers);
  }

  const response = await fetch(url, {
    method: "DELETE",
    credentials: options.credentials || "include",
    headers,
    body: JSON.stringify(body),
    cache: options.cache || "no-store",
  });
  return webResponse(response, headers);
}
