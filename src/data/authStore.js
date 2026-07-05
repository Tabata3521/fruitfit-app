const AUTH_KEY = "fruitfit.authUser";
const TOKEN_KEY = "fruitfit.authToken";
const ACCESS_KEY = "fruitfit.accessState";
const PROGRAM_ASSIGNMENT_KEY = "fruitfit.programAssignment";
import { deleteJson, getJson, postJson, putJson } from "../services/nativeHttp";
import { clearCurrentUserContainers, readUserCoreField, writeUserCoreField } from "./dataContainers";
import { resetStaleWorkoutState, serverCurrentWorkoutFromAssignment } from "./dataAccess";
import { clearPreAuthProfileDraft, hasMeaningfulPreAuthProfileDraft, mergeProfileDraftWithServer, normalizeProfile, readPreAuthProfileDraft } from "./profileStore";
import { clearSensitiveInMemoryState, currentUserId, removeLegacySensitiveCache } from "./userScopedCache";

const API_BASE_URL = String(import.meta.env.VITE_FRUITFIT_API_URL || "https://api.tagirfruit.ru").replace(/\/$/, "");
export const TRAINER_REQUEST_URL = "https://tagirfruit.ru/trainer-request";

export function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

export function trainerRequestPageUrl(request = {}) {
  const directUrl = String(request?.requestUrl || request?.url || "").trim();
  if (directUrl.startsWith(TRAINER_REQUEST_URL)) return directUrl;
  const url = new URL(TRAINER_REQUEST_URL);
  const nested = request?.request && typeof request.request === "object" ? request.request : {};
  const id = String(
    request?.id
    || request?.requestId
    || request?.request_id
    || nested.id
    || nested.requestId
    || nested.request_id
    || ""
  ).trim();
  if (id) url.searchParams.set("requestId", id);
  return url.toString();
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function trainerRequestProfile(profile = {}) {
  const user = loadAuthUser() || {};
  const userProfile = user.profile || {};
  const email = firstNonEmpty(
    profile.email,
    profile.userEmail,
    profile.user_email,
    user.email,
    userProfile.email,
    user.providerEmail,
    user.provider_email
  );
  if (!email) return profile;
  return {
    ...profile,
    email,
    userEmail: email,
    user_email: email
  };
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
    return readUserCoreField("accessState", currentUserId(), null);
  } catch (_) {
    return null;
  }
}

export function loadProgramAssignment() {
  if (typeof window === "undefined") return null;
  try {
    return readUserCoreField("programAssignment", currentUserId(), null);
  } catch (_) {
    return null;
  }
}

function cleanProgramId(value) {
  return String(value || "").trim();
}

function programIdFromAssignment(assignment = null) {
  return cleanProgramId(assignment?.programId || assignment?.program_id || assignment?.id);
}

function assignmentTitle(assignment = null) {
  return assignment?.programTitle || assignment?.program_title || assignment?.title || null;
}

function accessMeta(access = null) {
  return access?.meta && typeof access.meta === "object" ? access.meta : {};
}

function assignmentMeta(assignment = null) {
  return assignment?.meta && typeof assignment.meta === "object" ? assignment.meta : {};
}

function legacyKeyFirstChar(code) {
  return globalThis?.String?.fromCharCode?.(code) || "";
}

function legacyCycleCamelKey() {
  return `${legacyKeyFirstChar(115)}ubscriptionCycleNumber`;
}

function legacyCycleSnakeKey() {
  return `${legacyKeyFirstChar(115)}ubscription_cycle_number`;
}

function cycleNumberFrom(access = null, assignment = null) {
  const meta = { ...accessMeta(access), ...assignmentMeta(assignment) };
  const legacyCamel = legacyCycleCamelKey();
  const legacySnake = legacyCycleSnakeKey();
  const value = meta.programCycleNumber
    || meta.program_cycle_number
    || meta[legacyCamel]
    || meta[legacySnake]
    || meta.cycleNumber
    || meta.cycle_number
    || meta.cycle
    || assignment?.programCycleNumber
    || assignment?.program_cycle_number
    || assignment?.[legacyCamel]
    || assignment?.[legacySnake];
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function deliveryModeFrom(access = null, assignment = null) {
  const meta = { ...accessMeta(access), ...assignmentMeta(assignment) };
  const explicit = assignment?.deliveryMode
    || assignment?.delivery_mode
    || meta.deliveryMode
    || meta.delivery_mode
    || meta.lastDeliveryMode
    || meta.last_delivery_mode;
  const value = String(explicit || "").trim();
  if (value) return value;
  const cycleNumber = cycleNumberFrom(access, assignment);
  if (cycleNumber === 1) return "first_half";
  if (cycleNumber === 2) return "second_half";
  if (cycleNumber && cycleNumber >= 3) return "replacement_cycle";
  return "";
}

function canReplaceProgram(deliveryMode = "", cycleNumber = null) {
  const mode = String(deliveryMode || "").trim();
  return mode === "replacement_cycle" || mode === "fresh_program" || (cycleNumber != null && cycleNumber >= 3);
}

function readProgramCycleFallbacks(previous = null) {
  const programCycleLock = readUserCoreField("programCycleLock", currentUserId(), null) || {};
  return [
    readUserCoreField("baseProgramId", currentUserId(), ""),
    cleanProgramId(programCycleLock.programId || programCycleLock.program_id),
    programIdFromAssignment(previous),
  ].map(cleanProgramId).filter(Boolean);
}

function readHardBaseProgramId() {
  const programCycleLock = readUserCoreField("programCycleLock", currentUserId(), null) || {};
  return [
    readUserCoreField("baseProgramId", currentUserId(), ""),
    cleanProgramId(programCycleLock.programId || programCycleLock.program_id),
  ].map(cleanProgramId).find(Boolean) || "";
}

function normalizeProgramAssignmentForCycle(assignment = null, { previous = loadProgramAssignment(), access = loadAccessState() } = {}) {
  if (!assignment) return null;
  const incomingProgramId = programIdFromAssignment(assignment);
  if (!incomingProgramId) return assignment;

  const cycleNumber = cycleNumberFrom(access, assignment);
  const deliveryMode = deliveryModeFrom(access, assignment);
  const fallbackBaseProgramId = readProgramCycleFallbacks(previous)[0] || "";
  const hardBaseProgramId = readHardBaseProgramId();
  const preservePendingCycleBase = !deliveryMode && cycleNumber == null && hardBaseProgramId && incomingProgramId !== hardBaseProgramId;
  const isSecondCycle = deliveryMode === "second_half" || cycleNumber === 2;
  const isFirstCycle = deliveryMode === "first_half" || cycleNumber === 1;
  const replaceAllowed = canReplaceProgram(deliveryMode, cycleNumber);
  const baseProgramId = isSecondCycle
    ? (fallbackBaseProgramId || incomingProgramId)
    : (replaceAllowed || isFirstCycle ? incomingProgramId : (fallbackBaseProgramId || incomingProgramId));
  const effectiveProgramId = (isSecondCycle || preservePendingCycleBase) && baseProgramId ? baseProgramId : incomingProgramId;
  const previousTitle = programIdFromAssignment(previous) === effectiveProgramId ? assignmentTitle(previous) : null;
  const title = previousTitle || assignmentTitle(assignment);
  const originalProgramId = incomingProgramId !== effectiveProgramId ? incomingProgramId : (assignment.originalProgramId || assignment.original_program_id || null);
  const nowIso = new Date().toISOString();
  const normalizedMeta = {
    ...assignmentMeta(assignment),
    baseProgramId,
    deliveryMode,
    delivery_mode: deliveryMode,
    programCycleNumber: cycleNumber,
    program_cycle_number: cycleNumber,
    clientCycleGuard: true,
    normalizedAt: nowIso,
    ...(originalProgramId ? { clientOriginalProgramId: originalProgramId } : {}),
  };
  const normalized = {
    ...assignment,
    programId: effectiveProgramId,
    program_id: effectiveProgramId,
    programTitle: title,
    deliveryMode,
    delivery_mode: deliveryMode,
    baseProgramId,
    programCycleNumber: cycleNumber,
    program_cycle_number: cycleNumber,
    meta: normalizedMeta,
  };

  if (baseProgramId) {
    writeUserCoreField("baseProgramId", baseProgramId);
  }
  if (incomingProgramId !== effectiveProgramId) {
    console.info("[FruitFit Assignment] PROGRAM_ASSIGNMENT_CYCLE_GUARD", {
      cycleNumber,
      deliveryMode,
      incomingProgramId,
      baseProgramId,
      effectiveProgramId,
    });
  }
  return normalized;
}

function assignmentFromProgramAssignmentResponse(data = {}) {
  const payload = data && typeof data === "object" ? data : {};
  const assignment = payload.assignment
    || payload.programAssignment
    || payload.program_assignment
    || (payload.programId || payload.program_id ? payload : null);
  if (!assignment || typeof assignment !== "object") return assignment;
  const currentWorkout = payload.currentWorkout
    || payload.current_workout
    || payload.todayWorkout
    || payload.today_workout
    || payload.activeWorkout
    || payload.active_workout
    || null;
  if (!currentWorkout || assignment.currentWorkout || assignment.current_workout) return assignment;
  return { ...assignment, currentWorkout };
}

export function saveAuthUser(user) {
  const previous = loadAuthUser();
  if (!user) {
    const id = currentUserId();
    if (id) clearCurrentUserContainers(id);
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(PROGRAM_ASSIGNMENT_KEY);
    removeLegacySensitiveCache();
    clearSensitiveInMemoryState();
  } else {
    const previousId = String(previous?.id || previous?.userId || previous?.user_id || "").trim();
    const nextId = String(user?.id || user?.userId || user?.user_id || "").trim();
    const switched = Boolean(previousId && nextId && previousId !== nextId);
    if (switched) {
      console.info("[FruitFit cache] LOGIN_USER_SWITCH_DETECTED", { previousUserId: previousId, currentUserId: nextId });
    }
    removeLegacySensitiveCache();
    localStorage.setItem(AUTH_KEY, JSON.stringify({ ...user, updatedAt: new Date().toISOString() }));
    if (nextId) resetStaleWorkoutState({ userId: nextId, reason: "login" });
    if (switched) clearSensitiveInMemoryState();
  }
  window.dispatchEvent(new CustomEvent("fruitfit:auth-updated", { detail: user }));
  if (!user) window.dispatchEvent(new CustomEvent("fruitfit:access-updated", { detail: null }));
  if (!user) window.dispatchEvent(new CustomEvent("fruitfit:program-assignment-updated", { detail: null }));
  return user;
}

export function saveAccessState(access) {
  if (!access) {
    localStorage.removeItem(ACCESS_KEY);
    writeUserCoreField("accessState", null);
  } else {
    const user = loadAuthUser() || {};
    const userProfile = user.profile || {};
    const email = firstNonEmpty(
      access.email,
      access.userEmail,
      access.user_email,
      access.user?.email,
      user.email,
      userProfile.email,
      user.providerEmail,
      user.provider_email
    );
    const role = firstNonEmpty(
      access.role,
      access.userRole,
      access.user?.role,
      user.role,
      user.userRole,
      userProfile.role
    );
    access = {
      ...access,
      ...(email ? { email, userEmail: email, user_email: email } : {}),
      ...(role ? { role } : {}),
      user: {
        ...(access.user || {}),
        ...(email ? { email } : {}),
        ...(role ? { role } : {}),
      },
      updatedAt: new Date().toISOString(),
    };
    writeUserCoreField("accessState", access);
    const currentAssignment = loadProgramAssignment();
    if (currentAssignment) {
      saveProgramAssignment(currentAssignment, { access });
    }
  }
  window.dispatchEvent(new CustomEvent("fruitfit:access-updated", { detail: access }));
  return access;
}

export function saveProgramAssignment(assignment, options = {}) {
  const previous = loadProgramAssignment();
  const normalizedAssignment = normalizeProgramAssignmentForCycle(assignment, { previous, access: options.access || loadAccessState() });
  if (!assignment) {
    localStorage.removeItem(PROGRAM_ASSIGNMENT_KEY);
    resetStaleWorkoutState({ reason: "program-assignment-empty" });
    writeUserCoreField("programAssignment", null);
    writeUserCoreField("currentWorkout", null);
  } else {
    const previousProgramId = String(previous?.programId || previous?.program_id || "").trim();
    const previousDeliveryMode = deliveryModeFrom(null, previous);
    const nextDeliveryMode = deliveryModeFrom(null, normalizedAssignment);
    resetStaleWorkoutState({ reason: "program-assignment-update" });
    const serverWorkout = serverCurrentWorkoutFromAssignment(normalizedAssignment);
    const serverWorkoutProgramId = cleanProgramId(serverWorkout?.programId || serverWorkout?.program_id);
    const normalizedProgramId = cleanProgramId(normalizedAssignment?.programId || normalizedAssignment?.program_id);
    const shouldUseServerWorkoutProgram = Boolean(serverWorkoutProgramId && serverWorkoutProgramId !== normalizedProgramId);
    const assignmentToStore = shouldUseServerWorkoutProgram
      ? {
        ...normalizedAssignment,
        programId: serverWorkoutProgramId,
        program_id: serverWorkoutProgramId,
        baseProgramId: serverWorkoutProgramId,
        meta: {
          ...(normalizedAssignment.meta || {}),
          baseProgramId: serverWorkoutProgramId,
          serverWorkoutProgramId,
          clientProgramIdSyncedFromCurrentWorkout: true,
          previousClientProgramId: normalizedProgramId || null,
        },
      }
      : normalizedAssignment;
    const nextProgramId = String(assignmentToStore?.programId || assignmentToStore?.program_id || "").trim();
    if (shouldUseServerWorkoutProgram) {
      writeUserCoreField("baseProgramId", serverWorkoutProgramId);
      console.info("[FruitFit currentWorkout] SERVER_WORKOUT", {
        source: "program-id-sync-from-current-workout",
        previousProgramId: normalizedProgramId || null,
        serverWorkoutProgramId,
        workoutId: serverWorkout?.workoutId || null,
        title: serverWorkout?.title || null,
      });
    }
    writeUserCoreField("programAssignment", { ...assignmentToStore, updatedAt: new Date().toISOString() });
    writeUserCoreField("currentWorkout", serverWorkout);
    console.info("[FruitFit currentWorkout] SERVER_WORKOUT", {
      source: "/api/me/program-assignment",
      programId: nextProgramId || null,
      workoutId: serverWorkout?.workoutId || null,
      title: serverWorkout?.title || null,
      deliveryMode: nextDeliveryMode || null,
    });
    console.info("[FruitFit currentWorkout] CACHE_WORKOUT", {
      action: serverWorkout ? "overwrite_server_value" : "clear_stale_value",
      previousProgramId: previousProgramId || null,
      nextProgramId: nextProgramId || null,
      deliveryModeChanged: previousDeliveryMode !== nextDeliveryMode,
    });
  }
  const savedAssignment = assignment ? loadProgramAssignment() : null;
  window.dispatchEvent(new CustomEvent("fruitfit:program-assignment-updated", { detail: savedAssignment || null }));
  return savedAssignment || null;
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
    const savedUser = data.user ? saveAuthUser(data.user) : null;
    if (data.programAssignment) saveProgramAssignment(data.programAssignment);
    if (data.profile) writeUserCoreField("profile", data.profile);
    if (savedUser) return savedUser;
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

export async function createTrainerRequest({ profile = {}, source = "client" } = {}) {
  const res = await postJson(apiUrl("/api/trainer-requests"), { profile: trainerRequestProfile(profile), source }, {
    credentials: "include",
    headers: authHeaders()
  });
  if (!res.ok) {
    if (res.status === 401) saveAuthUser(null);
    throw new Error(res.data?.error || res.data?.message || "Не удалось создать заявку тренеру");
  }
  const data = res.data || {};
  const request = data.request && typeof data.request === "object" ? data.request : {};
  const requestId = String(request.id || request.requestId || request.request_id || data.requestId || data.request_id || "").trim();
  const normalized = {
    ...request,
    ...(requestId ? { id: requestId, requestId } : {}),
    ...(data.requestUrl ? { requestUrl: data.requestUrl } : {}),
    ...(data.status && !request.status ? { status: data.status } : {}),
    ...(data.message && !request.message ? { message: data.message } : {}),
  };
  if (!normalized.id && !normalized.requestUrl) {
    throw new Error("Не удалось подготовить заявку. Попробуйте ещё раз.");
  }
  return normalized;
}

function profilesEqualForTransfer(left = {}, right = {}) {
  const a = normalizeProfile(left);
  const b = normalizeProfile(right);
  return [
    "firstName",
    "lastName",
    "gender",
    "age",
    "height",
    "weight",
    "goal",
    "experience",
    "trainingFrequency",
    "restrictions",
    "dietType",
    "calculatedCalories",
    "recommendedCaloriesTarget",
    "onboardingCompleted",
  ].every((field) => String(a[field] ?? "") === String(b[field] ?? ""));
}

export async function transferPreAuthProfileDraft({ reason = "auth" } = {}) {
  const draft = readPreAuthProfileDraft();
  if (!hasMeaningfulPreAuthProfileDraft(draft) || !getAuthToken()) return { transferred: false, reason: "no_draft" };

  const serverProfile = await fetchProfile();
  const mergedProfile = mergeProfileDraftWithServer(serverProfile || {}, draft);
  if (serverProfile && profilesEqualForTransfer(serverProfile, mergedProfile)) {
    writeUserCoreField("profile", normalizeProfile(serverProfile));
    return { transferred: false, reason: "server_profile_already_filled", profile: normalizeProfile(serverProfile) };
  }

  const savedProfile = await saveServerProfile(mergedProfile);
  if (!savedProfile) return { transferred: false, reason: "backend_save_failed" };

  const normalizedSaved = normalizeProfile(savedProfile);
  writeUserCoreField("profile", normalizedSaved);
  clearPreAuthProfileDraft();
  resetStaleWorkoutState({ reason: `preauth-profile-transfer-${reason}` });
  saveProgramAssignment(null);
  const [user, assignment] = await Promise.all([
    fetchMe(),
    fetchProgramAssignment(),
  ]);
  console.info("[FruitFit Account] PRE_AUTH_PROFILE_DRAFT_TRANSFERRED", {
    reason,
    userId: String(user?.id || user?.userId || user?.user_id || currentUserId() || "").trim() || null,
    assignmentProgramId: assignment?.programId || assignment?.program_id || null,
  });
  return { transferred: true, profile: normalizedSaved, assignment, user };
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
    return saveProgramAssignment(assignmentFromProgramAssignmentResponse(res.data || {}));
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
    if (res.status === 401) saveAuthUser(null);
    const error = new Error(res.data?.error || res.data?.message || "Не удалось отправить отчёт тренеру");
    error.status = res.status;
    error.data = res.data;
    throw error;
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
