const AUTH_KEY = "fruitfit.authUser";
const TOKEN_KEY = "fruitfit.authToken";
const ACCESS_KEY = "fruitfit.accessState";
const PROGRAM_ASSIGNMENT_KEY = "fruitfit.programAssignment";
import { deleteJson, getJson, postJson, putJson } from "../services/nativeHttp";

const API_BASE_URL = String(import.meta.env.VITE_FRUITFIT_API_URL || "https://api.tagirfruit.ru").replace(/\/$/, "");

export function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

export function loadAuthUser() {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
  } catch (_) {
    return null;
  }
}

export function loadAccessState() {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem(ACCESS_KEY) || "null");
  } catch (_) {
    return null;
  }
}

export function loadProgramAssignment() {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem(PROGRAM_ASSIGNMENT_KEY) || "null");
  } catch (_) {
    return null;
  }
}

export function saveAuthUser(user) {
  if (!user) {
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(PROGRAM_ASSIGNMENT_KEY);
  } else {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ ...user, updatedAt: new Date().toISOString() }));
  }
  window.dispatchEvent(new CustomEvent("fruitfit:auth-updated", { detail: user }));
  if (!user) window.dispatchEvent(new CustomEvent("fruitfit:access-updated", { detail: null }));
  if (!user) window.dispatchEvent(new CustomEvent("fruitfit:program-assignment-updated", { detail: null }));
  return user;
}

export function saveAccessState(access) {
  if (!access) {
    localStorage.removeItem(ACCESS_KEY);
  } else {
    localStorage.setItem(ACCESS_KEY, JSON.stringify({ ...access, updatedAt: new Date().toISOString() }));
  }
  window.dispatchEvent(new CustomEvent("fruitfit:access-updated", { detail: access }));
  return access;
}

export function saveProgramAssignment(assignment) {
  if (!assignment) {
    localStorage.removeItem(PROGRAM_ASSIGNMENT_KEY);
  } else {
    localStorage.setItem(PROGRAM_ASSIGNMENT_KEY, JSON.stringify({ ...assignment, updatedAt: new Date().toISOString() }));
  }
  window.dispatchEvent(new CustomEvent("fruitfit:program-assignment-updated", { detail: assignment || null }));
  return assignment || null;
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

function authHeaders(extra = {}) {
  const token = getAuthToken();
  return {
    ...extra,
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

export async function fetchMe() {
  try {
    const res = await getJson(apiUrl("/api/me"), {
      credentials: "include",
      headers: authHeaders()
    });
    if (!res.ok) {
      if (res.status === 401) saveAuthUser(null);
      return null;
    }
    const data = res.data || {};
    if (data.user) return saveAuthUser(data.user);
  } catch (err) {
    console.error("[FruitFit Auth] fetchMe failed", err);
  }
  return null;
}

export async function fetchProfile() {
  try {
    const res = await getJson(apiUrl("/api/me/profile"), {
      credentials: "include",
      headers: authHeaders()
    });
    if (!res.ok) {
      if (res.status === 401) saveAuthUser(null);
      return null;
    }
    return res.data?.profile || null;
  } catch (err) {
    console.error("[FruitFit Auth] fetchProfile failed", err);
  }
  return null;
}

export async function saveServerProfile(profile) {
  try {
    const res = await postJson(apiUrl("/api/me/profile"), { profile }, {
      credentials: "include",
      headers: authHeaders()
    });
    if (!res.ok) {
      if (res.status === 401) saveAuthUser(null);
      return null;
    }
    const savedProfile = res.data?.profile || profile;
    const current = loadAuthUser();
    if (current) {
      saveAuthUser({
        ...current,
        ...(Object.prototype.hasOwnProperty.call(res.data || {}, "name") ? { name: res.data.name } : {}),
        profile: savedProfile
      });
    }
    return savedProfile;
  } catch (err) {
    console.error("[FruitFit Auth] saveServerProfile failed", err);
  }
  return null;
}

export async function fetchMeasurements() {
  try {
    const res = await getJson(apiUrl("/api/me/measurements"), {
      credentials: "include",
      headers: authHeaders(),
      cache: "no-store"
    });
    if (!res.ok) {
      if (res.status === 401) saveAuthUser(null);
      return [];
    }
    return Array.isArray(res.data?.items) ? res.data.items : [];
  } catch (err) {
    console.error("[FruitFit Auth] fetchMeasurements failed", err);
  }
  return [];
}

export async function saveMeasurement(item = {}) {
  const values = {
    weight: item.weight || "",
    chest: item.chest || "",
    waist: item.waist || "",
    hips: item.hips || "",
  };
  const date = String(item.date || "").slice(0, 10);
  const measuredAt = date ? new Date(`${date}T12:00:00`).toISOString() : new Date().toISOString();
  const res = await postJson(apiUrl("/api/me/measurements"), {
    measuredAt,
    values,
    note: item.note || "",
  }, {
    credentials: "include",
    headers: authHeaders()
  });
  if (!res.ok) {
    if (res.status === 401) saveAuthUser(null);
    throw new Error(res.data?.error || res.data?.message || "Не удалось сохранить замер");
  }
  return res.data?.item || null;
}

export async function createPaymentSession(payload = {}) {
  if (!getAuthToken()) {
    throw new Error("Для оплаты нужно войти в аккаунт.");
  }
  const productCode = String(payload.productCode || payload.product_code || "individual_program").trim() || "individual_program";
  const res = await postJson(apiUrl("/api/payments/sessions"), {
    productCode,
    recurringEnabled: Boolean(payload.recurringEnabled || payload.recurring_enabled),
  }, {
    credentials: "include",
    headers: authHeaders()
  });
  if (!res.ok) {
    if (res.status === 401) {
      saveAuthUser(null);
      throw new Error("Сессия истекла. Войдите снова, чтобы оплатить.");
    }
    throw new Error(res.data?.error || res.data?.message || "Не удалось подготовить оплату");
  }
  return res.data?.session || res.data?.paymentSession || res.data || null;
}

export async function fetchPaymentSubscription() {
  try {
    const res = await getJson(apiUrl("/api/payments/subscription"), {
      credentials: "include",
      headers: authHeaders(),
      cache: "no-store"
    });
    if (!res.ok) return null;
    return res.data?.subscription || null;
  } catch (err) {
    console.error("[FruitFit Auth] fetchPaymentSubscription failed", err);
  }
  return null;
}

export async function cancelPaymentSubscription(reason = "client_request") {
  if (!getAuthToken()) {
    throw new Error("Для отмены подписки нужно войти в аккаунт.");
  }
  const res = await postJson(apiUrl("/api/payments/subscription/cancel"), {
    reason
  }, {
    credentials: "include",
    headers: authHeaders()
  });
  if (!res.ok) {
    if (res.status === 401) {
      saveAuthUser(null);
      throw new Error("Сессия истекла. Войдите снова, чтобы отменить подписку.");
    }
    throw new Error(res.data?.error || res.data?.message || "Не удалось отменить подписку");
  }
  return res.data || { subscription: null };
}

export async function fetchReferralInfo() {
  try {
    const primary = await getJson(apiUrl("/api/referrals/me/code"), {
      credentials: "include",
      headers: authHeaders(),
      cache: "no-store"
    });
    if (primary.ok) return primary.data || null;
    if (primary.status === 401) {
      saveAuthUser(null);
      return null;
    }

    const fallback = await getJson(apiUrl("/api/referrals/me"), {
      credentials: "include",
      headers: authHeaders(),
      cache: "no-store"
    });
    if (fallback.ok) return fallback.data || null;
    if (fallback.status === 401) {
      saveAuthUser(null);
      return null;
    }

    const me = await getJson(apiUrl("/api/me"), {
      credentials: "include",
      headers: authHeaders(),
      cache: "no-store"
    });
    if (me.ok) return me.data?.user || me.data || null;
    if (me.status === 401) saveAuthUser(null);
  } catch (err) {
    console.error("[FruitFit Auth] fetchReferralInfo failed", err);
  }
  return null;
}

export async function fetchAccess() {
  try {
    const res = await getJson(apiUrl("/api/me/access"), {
      credentials: "include",
      headers: authHeaders()
    });
    if (!res.ok) {
      if (res.status === 401) saveAuthUser(null);
      return null;
    }
    const data = res.data || {};
    return saveAccessState(data.access || null);
  } catch (err) {
    console.error("[FruitFit Auth] fetchAccess failed", err);
  }
  return null;
}

export async function fetchProgramAssignment() {
  try {
    const res = await getJson(apiUrl("/api/me/program-assignment"), {
      credentials: "include",
      headers: authHeaders()
    });
    if (!res.ok) {
      if (res.status === 401) saveAuthUser(null);
      return null;
    }
    return saveProgramAssignment(res.data?.assignment || null);
  } catch (err) {
    console.error("[FruitFit Auth] fetchProgramAssignment failed", err);
  }
  return null;
}

export async function fetchMenstrualCycle() {
  try {
    const res = await getJson(apiUrl("/api/me/menstrual-cycle"), {
      credentials: "include",
      headers: authHeaders()
    });
    if (!res.ok) {
      if (res.status === 401) saveAuthUser(null);
      return null;
    }
    return res.data?.cycle || null;
  } catch (err) {
    console.error("[FruitFit Auth] fetchMenstrualCycle failed", err);
  }
  return null;
}

export async function saveMenstrualCycle(cycle) {
  const res = await putJson(apiUrl("/api/me/menstrual-cycle"), cycle || {}, {
    credentials: "include",
    headers: authHeaders()
  });
  if (!res.ok) {
    if (res.status === 401) saveAuthUser(null);
    throw new Error(res.data?.error || res.data?.message || "Не удалось сохранить цикл");
  }
  return res.data?.cycle || null;
}

export async function logoutUser() {
  try {
    await postJson(apiUrl("/api/auth/logout"), {}, {
      credentials: "include",
      headers: authHeaders()
    });
  } catch (err) {
    console.error("[FruitFit Auth] logout failed", err);
  }
  setAuthToken(null);
  saveAuthUser(null);
}

export async function fetchAuthIdentities() {
  try {
    const res = await getJson(apiUrl("/api/me/identities"), {
      credentials: "include",
      headers: authHeaders()
    });
    if (!res.ok) {
      if (res.status === 401) saveAuthUser(null);
      return [];
    }
    return Array.isArray(res.data?.identities) ? res.data.identities : [];
  } catch (err) {
    console.error("[FruitFit Auth] fetchAuthIdentities failed", err);
    return [];
  }
}

export async function unlinkAuthProvider(provider, providerUserId = "") {
  const res = await deleteJson(apiUrl("/api/auth/unlink-provider"), {
    provider,
    providerUserId
  }, {
    credentials: "include",
    headers: authHeaders()
  });
  if (!res.ok) {
    throw new Error(res.data?.error || res.data?.message || "Не удалось отвязать аккаунт");
  }
  return Array.isArray(res.data?.identities) ? res.data.identities : null;
}

export async function linkAuthProvider(provider, payload = {}) {
  const res = await postJson(apiUrl("/api/auth/link-provider"), {
    provider,
    ...payload
  }, {
    credentials: "include",
    headers: authHeaders()
  });
  if (!res.ok) {
    throw new Error(res.data?.error || res.data?.message || "Не удалось привязать аккаунт");
  }
  return Array.isArray(res.data?.identities) ? res.data.identities : null;
}

export async function fetchProgressPhotos() {
  try {
    const res = await getJson(apiUrl("/api/me/progress-photos"), {
      credentials: "include",
      headers: authHeaders()
    });
    if (!res.ok) {
      if (res.status === 401) saveAuthUser(null);
      return [];
    }
    return Array.isArray(res.data?.items) ? res.data.items : [];
  } catch (err) {
    console.error("[FruitFit Auth] fetchProgressPhotos failed", err);
    return [];
  }
}

export async function saveProgressPhoto({ type, dataUrl, fileName, takenAt } = {}) {
  const normalizedType = String(type || "front").toLowerCase();
  const now = new Date();
  const storageKey = `progress/${now.toISOString().slice(0, 10)}/${now.getTime()}-${normalizedType}.jpg`;
  const res = await postJson(apiUrl("/api/me/progress-photos"), {
    storageKey,
    publicUrl: dataUrl || null,
    takenAt: takenAt || now.toISOString(),
    meta: {
      type: normalizedType,
      view: normalizedType,
      fileName: fileName || `${normalizedType}.jpg`,
      source: "client-upload",
      aiAnalysisAllowed: true,
      noMedicalConclusions: true,
      purpose: "progress-report"
    }
  }, {
    credentials: "include",
    headers: authHeaders()
  });
  if (!res.ok) {
    throw new Error(res.data?.error || res.data?.message || "Не удалось сохранить фото прогресса");
  }
  return res.data?.item || null;
}

export async function deleteProgressPhoto(photoId) {
  const id = String(photoId || "").trim();
  if (!id) return false;
  const res = await deleteJson(apiUrl(`/api/me/progress-photos/${encodeURIComponent(id)}`), {}, {
    credentials: "include",
    headers: authHeaders()
  });
  if (!res.ok) {
    throw new Error(res.data?.error || res.data?.message || "Не удалось удалить фото прогресса");
  }
  return true;
}

export async function deleteAccount() {
  const res = await deleteJson(apiUrl("/api/me/account"), { confirm: true }, {
    credentials: "include",
    headers: authHeaders()
  });
  if (!res.ok) {
    if (res.status === 401) saveAuthUser(null);
    throw new Error(res.data?.error || res.data?.message || "Не удалось удалить аккаунт");
  }
  setAuthToken(null);
  saveAuthUser(null);
  return true;
}

export async function fetchTrainerReports() {
  try {
    const res = await getJson(apiUrl("/api/me/trainer-reports"), {
      credentials: "include",
      headers: authHeaders()
    });
    if (!res.ok) {
      if (res.status === 401) saveAuthUser(null);
      return [];
    }
    return Array.isArray(res.data?.items) ? res.data.items : [];
  } catch (err) {
    console.error("[FruitFit Auth] fetchTrainerReports failed", err);
    return [];
  }
}

export async function submitTrainerReport(report = {}) {
  const res = await postJson(apiUrl("/api/me/trainer-reports"), { report }, {
    credentials: "include",
    headers: authHeaders()
  });
  if (!res.ok) {
    throw new Error(res.data?.error || res.data?.message || "Не удалось отправить отчёт тренеру");
  }
  const item = res.data?.item || null;
  window.dispatchEvent(new CustomEvent("fruitfit:trainer-report-submitted", { detail: { item, report } }));
  return item;
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

function firstReadableName(value, options = {}) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.includes("@") || /^https?:\/\//i.test(text)) return "";
  const first = text.split(/\s+/).find(Boolean) || "";
  if (!first || first.includes("@")) return "";
  const withoutPunctuation = first.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (!withoutPunctuation) return "";
  if (options.rejectExact && String(options.rejectExact).trim().toLowerCase() === withoutPunctuation.toLowerCase()) return "";
  return withoutPunctuation;
}

export function authDisplayName(user) {
  if (!user) return "";
  const profile = user.profile || {};
  const firstName = firstReadableName(profile.firstName || profile.first_name || user.firstName || user.first_name);
  if (firstName) return firstName;
  const lastName = profile.lastName || profile.last_name || user.lastName || user.last_name;
  const providerName = firstReadableName(
    profile.providerName || profile.provider_name || user.providerName || user.provider_name || user.name || profile.name,
    { rejectExact: lastName }
  );
  return providerName || "спортсмен";
}
