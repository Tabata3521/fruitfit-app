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

export async function getJson(url, options = {}) {
  if (isNativeHttpAvailable()) {
    const response = await CapacitorHttp.get({
      url,
      headers: options.headers || {},
      params: options.params || {},
    });
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      data: normalizeNativeData(response.data),
    };
  }

  const response = await fetch(url, {
    credentials: options.credentials || "include",
    cache: options.cache || "no-store",
    headers: options.headers,
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

export async function postJson(url, body = {}, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (isNativeHttpAvailable()) {
    const response = await CapacitorHttp.post({
      url,
      headers,
      data: body,
    });
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      data: normalizeNativeData(response.data),
    };
  }

  const response = await fetch(url, {
    method: "POST",
    credentials: options.credentials || "include",
    headers,
    body: JSON.stringify(body),
    cache: options.cache || "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

export async function putJson(url, body = {}, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (isNativeHttpAvailable()) {
    const response = await CapacitorHttp.put({
      url,
      headers,
      data: body,
    });
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      data: normalizeNativeData(response.data),
    };
  }

  const response = await fetch(url, {
    method: "PUT",
    credentials: options.credentials || "include",
    headers,
    body: JSON.stringify(body),
    cache: options.cache || "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
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
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      data: normalizeNativeData(response.data),
    };
  }

  const response = await fetch(url, {
    method: "DELETE",
    credentials: options.credentials || "include",
    headers,
    body: JSON.stringify(body),
    cache: options.cache || "no-store",
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}
