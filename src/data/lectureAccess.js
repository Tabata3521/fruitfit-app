import { apiUrl } from "./authStore";
import { getJson } from "../services/nativeHttp";
import { APP_STORE_REVIEW } from "../config/appStoreReview";

const CACHE_KEY = "fruitfit.lectureAccessPolicy.v1";
const DEFAULT_FREE_LECTURE_COUNT = 6;

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
  if (APP_STORE_REVIEW) return true;

  if (!access || access.isActive === false) return false;
  const status = String(access.status || access.plan || "").toLowerCase();
  return Boolean(
    access.isPaid ||
    access.isVip ||
    access.isAdmin ||
    access.isTrainer ||
    access.features?.premium ||
    ["paid", "vip", "admin", "trainer"].includes(status)
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

export function canOpenLecture(lecture, index, access, policy = defaultLectureAccessPolicy) {
  if (APP_STORE_REVIEW) return true;

  if (hasFullLectureAccess(access)) return true;
  const limit = accessLectureLimit(access);
  if (limit !== null) return index < limit;
  const normalized = normalizeLectureAccessPolicy(policy);
  if (normalized.mode === "list") return normalized.freeLectureIds.includes(String(lecture?.id || ""));
  return index < normalized.freeLectureCount;
}

export function visibleLecturesForAccess(lectures = [], access, policy = defaultLectureAccessPolicy) {
  const items = Array.isArray(lectures) ? lectures : [];
  if (APP_STORE_REVIEW) {
    const normalized = normalizeLectureAccessPolicy(policy);
    const visibleCount = firstFiniteNumber(normalized.visibleCount, normalized.visible_count) ?? DEFAULT_FREE_LECTURE_COUNT;
    return items.slice(0, Math.max(0, Math.floor(visibleCount)));
  }

  if (hasFullLectureAccess(access)) return items;
  const limit = accessLectureLimit(access);
  if (limit !== null) return items.slice(0, Math.max(0, Math.floor(limit)));
  const normalized = normalizeLectureAccessPolicy(policy);
  if (normalized.mode === "list") {
    return items.filter((item) => normalized.freeLectureIds.includes(String(item?.id || "")));
  }
  return items.slice(0, normalized.freeLectureCount);
}
