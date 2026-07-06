import { apiUrl } from "./authStore";
import { getJson } from "../services/nativeHttp";
import { APP_STORE_REVIEW } from "../config/appStoreReview";

const CACHE_KEY = "fruitfit.lectureAccessPolicy.v1";
const DEFAULT_FREE_LECTURE_COUNT = 6;
const ADMIN_ACCESS_EMAILS = new Set(["meyvaliev3521@gmail.com"]);

export const defaultLectureAccessPolicy = APP_STORE_REVIEW
  ? Object.freeze({ mode: "first_n", visibleCount: DEFAULT_FREE_LECTURE_COUNT })
  : Object.freeze({
      mode: "first_n",
      freeLectureCount: DEFAULT_FREE_LECTURE_COUNT,
      freeLectureIds: [],
      paidAccess: "all",
    });

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return null;
}

function normalizedAccessText(...values) {
  return values.map((value) => String(value || "").trim().toLowerCase()).find(Boolean) || "";
}

function accessEmail(access = {}) {
  return [
    access?.email,
    access?.user?.email,
    access?.profile?.email,
    access?.account?.email,
  ].map((value) => String(value || "").trim().toLowerCase()).find((value) => value.includes("@")) || "";
}

function hasAdminLectureAccess(access = {}) {
  const status = normalizedAccessText(access?.status, access?.plan);
  const role = normalizedAccessText(access?.role, access?.userRole, access?.user?.role);
  return Boolean(
    access?.isAdmin ||
    access?.isTrainer ||
    access?.isTest ||
    access?.features?.admin ||
    access?.features?.test ||
    status === "admin" ||
    status === "trainer" ||
    status === "test" ||
    role === "admin" ||
    role === "trainer" ||
    role === "test" ||
    ADMIN_ACCESS_EMAILS.has(accessEmail(access))
  );
}

export function loadLectureAccessPolicy() {
  if (APP_STORE_REVIEW) return defaultLectureAccessPolicy;
  if (typeof window === "undefined") return defaultLectureAccessPolicy;
  try {
    return normalizeLectureAccessPolicy(JSON.parse(localStorage.getItem(CACHE_KEY) || "null"));
  } catch {
    return defaultLectureAccessPolicy;
  }
}

export async function fetchLectureAccessPolicy() {
  if (APP_STORE_REVIEW) return defaultLectureAccessPolicy;
  try {
    const res = await getJson(apiUrl("/api/lms/lecture-access"), {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return loadLectureAccessPolicy();
    const policy = normalizeLectureAccessPolicy(res.data?.policy);
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...policy, updatedAt: new Date().toISOString() }));
    return policy;
  } catch (error) {
    console.error("[FruitFit LMS] lecture access policy failed", error);
    return loadLectureAccessPolicy();
  }
}

export function normalizeLectureAccessPolicy(value = {}) {
  if (APP_STORE_REVIEW) {
    return {
      mode: "first_n",
      visibleCount: firstFiniteNumber(value?.visibleCount, value?.visible_count, value?.limits?.lectures) ?? DEFAULT_FREE_LECTURE_COUNT,
    };
  }

  const mode = String(value?.mode || value?.accessMode || "first_n") === "list" ? "list" : "first_n";
  const freeLectureCount = firstFiniteNumber(value?.freeLectureCount, value?.free_lecture_count, value?.limits?.lectures) ?? DEFAULT_FREE_LECTURE_COUNT;
  const ids = Array.isArray(value?.freeLectureIds || value?.free_lecture_ids)
    ? (value.freeLectureIds || value.free_lecture_ids)
    : [];
  return {
    mode,
    freeLectureCount: Math.floor(freeLectureCount),
    freeLectureIds: Array.from(new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))),
    paidAccess: value?.paidAccess || value?.paid_access || "all",
  };
}

export function hasFullLectureAccess(access) {
  if (hasAdminLectureAccess(access)) return true;
  if (!access || access.isActive === false) return false;
  const status = normalizedAccessText(
    access.status,
    access.plan,
    access.billingStatus,
    access.billing_status,
    access.paymentStatus,
    access.payment_status
  );
  return Boolean(
    access.isPaid ||
    access.isVip ||
    access.allLectures ||
    access.all_lectures ||
    access.features?.premium ||
    access.features?.allLectures ||
    access.features?.all_lectures ||
    access.appMap?.lms?.allLectures ||
    access.appMap?.lms?.all_lectures ||
    ["paid", "vip", "admin", "trainer", "test"].includes(status)
  );
}

function accessLectureLimit(access) {
  return firstFiniteNumber(
    access?.limits?.lectures,
    access?.limits?.lectureCount,
    access?.features?.lectures,
    access?.features?.lectureCount,
    access?.meta?.limits?.lectures,
    access?.appMap?.lectures?.visibleCount,
    access?.appMap?.lms?.visibleLectureCount,
    access?.lectureCount,
    access?.visibleLectureCount
  );
}

function freeLectureLimit(access, policy = defaultLectureAccessPolicy) {
  const normalized = normalizeLectureAccessPolicy(policy);
  const policyLimit = firstFiniteNumber(
    normalized.visibleCount,
    normalized.visible_count,
    normalized.freeLectureCount,
    normalized.free_lecture_count
  ) ?? DEFAULT_FREE_LECTURE_COUNT;
  const serverLimit = accessLectureLimit(access);
  const limit = Math.min(
    DEFAULT_FREE_LECTURE_COUNT,
    Math.max(0, Math.floor(policyLimit)),
    serverLimit === null ? DEFAULT_FREE_LECTURE_COUNT : Math.max(0, Math.floor(serverLimit))
  );
  return limit;
}

export function canOpenLecture(lecture, index, access, policy = defaultLectureAccessPolicy) {
  if (hasFullLectureAccess(access)) return true;
  const normalized = normalizeLectureAccessPolicy(policy);
  if (!APP_STORE_REVIEW && normalized.mode === "list" && normalized.freeLectureIds.length) {
    const allowedIds = visibleLecturesForAccess([lecture], access, policy).map((item) => String(item?.id || ""));
    return allowedIds.includes(String(lecture?.id || "")) && index < DEFAULT_FREE_LECTURE_COUNT;
  }
  return index < freeLectureLimit(access, normalized);
}

export function visibleLecturesForAccess(lectures = [], access, policy = defaultLectureAccessPolicy) {
  const items = Array.isArray(lectures) ? lectures : [];
  if (APP_STORE_REVIEW) {
    if (hasFullLectureAccess(access)) return items;
    return items.slice(0, freeLectureLimit(access, policy));
  }

  if (hasFullLectureAccess(access)) return items;
  const normalized = normalizeLectureAccessPolicy(policy);
  if (normalized.mode === "list") {
    return items
      .filter((item) => normalized.freeLectureIds.includes(String(item?.id || "")))
      .slice(0, DEFAULT_FREE_LECTURE_COUNT);
  }
  return items.slice(0, freeLectureLimit(access, normalized));
}
