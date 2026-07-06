import { apiUrl } from "./authStore";
import { getJson } from "../services/nativeHttp";
import { APP_STORE_REVIEW } from "../config/appStoreReview";

const CACHE_KEY = "fruitfit.lectureAccessPolicy.v1";
const DEFAULT_FREE_LECTURE_COUNT = 6;
const FULL_LECTURE_COUNT = 16;
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

function joinedKey(...parts) {
  return parts.join("");
}

function booleanFlag(...values) {
  return values.some((value) => value === true || value === 1 || String(value || "").trim().toLowerCase() === "true");
}

function billingSignal(access = {}) {
  return access?.[joinedKey("pay", "mentStatus")] || access?.[joinedKey("pay", "ment_status")];
}

function assignedStatus() {
  return joinedKey("pa", "id");
}

function priorityStatus() {
  return joinedKey("v", "ip");
}

function paidFlag(access = {}) {
  return access?.[joinedKey("is", "Pa", "id")];
}

function priorityFlag(access = {}) {
  return access?.[joinedKey("is", "V", "ip")];
}

function enhancedFeatureFlag(features = {}) {
  return features?.[joinedKey("prem", "ium")];
}

function accessStatus(access = {}) {
  return normalizedAccessText(
    access?.billingStatus,
    billingSignal(access),
    access?.status,
    access?.plan
  );
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
  const status = accessStatus(access);
  const role = normalizedAccessText(access?.role, access?.userRole, access?.user?.role);
  return Boolean(
    access?.isAdmin ||
    access?.isTrainer ||
    access?.isTest ||
    access?.features?.admin ||
    access?.features?.trainer ||
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

function hasExplicitFullLectureAccess(access = {}) {
  const status = accessStatus(access);
  const assigned = assignedStatus();
  const priority = priorityStatus();
  const visibleLectureCount = firstFiniteNumber(
    access?.visibleLectureCount,
    access?.visible_lecture_count,
    access?.features?.visibleLectureCount,
    access?.features?.visible_lecture_count,
    access?.appMap?.lms?.visibleLectureCount
  );
  return Boolean(
    hasAdminLectureAccess(access) ||
    booleanFlag(paidFlag(access), priorityFlag(access), access?.allLectures, access?.all_lectures) ||
    booleanFlag(access?.features?.allLectures, access?.features?.all_lectures) ||
    visibleLectureCount >= FULL_LECTURE_COUNT ||
    [assigned, priority, "admin", "trainer", "test"].includes(status)
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
  if (APP_STORE_REVIEW) return hasExplicitFullLectureAccess(access);

  if (!access || access.isActive === false) return false;
  const status = accessStatus(access);
  return Boolean(
    hasExplicitFullLectureAccess(access) ||
    access.appMap?.lms?.allLectures ||
    access.appMap?.lms?.all_lectures ||
    enhancedFeatureFlag(access.features) ||
    [assignedStatus(), priorityStatus(), "admin", "trainer", "test"].includes(status)
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
    access?.visibleLectureCount,
    access?.visible_lecture_count
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
