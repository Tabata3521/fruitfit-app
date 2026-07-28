import { apiUrl, getAuthToken } from "../data/authStore";
import {
  applyServerWorkoutSession,
  listWorkoutSessions,
  readWorkoutSession,
  saveWorkoutSession,
} from "../data/workoutSessions";
import { getJson, putJson } from "./nativeHttp";

const pendingTimers = new Map();

function authHeaders() {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function payloadFor(session) {
  return {
    sessionId: session.session_id,
    programId: session.program_id,
    programDayId: session.program_day_id,
    workoutId: session.workout_id,
    status: session.status,
    version: session.server_version || 0,
    clientVersion: session.local_version || 1,
    state: session,
  };
}

export async function syncWorkoutSession(sessionId, { userId, keepalive = false } = {}) {
  const session = readWorkoutSession(sessionId, userId);
  if (!session || !getAuthToken()) return session;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return saveWorkoutSession({ ...session, sync_status: "offline" }, { activate: session.status === "active", userId });
  }
  saveWorkoutSession({ ...session, sync_status: "syncing" }, { activate: session.status === "active", userId });
  try {
    const response = await putJson(
      apiUrl(`/api/me/workout-sessions/${encodeURIComponent(session.session_id)}`),
      payloadFor(session),
      { headers: authHeaders(), keepalive },
    );
    if (response.status === 409 && response.data?.session) {
      return applyServerWorkoutSession(response.data.session, userId, { conflict: true });
    }
    if (!response.ok) throw new Error(response.data?.error || `HTTP_${response.status}`);
    return applyServerWorkoutSession(response.data?.session || response.data, userId);
  } catch (error) {
    const latest = readWorkoutSession(sessionId, userId) || session;
    return saveWorkoutSession({
      ...latest,
      sync_status: typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "error",
      sync_error: String(error?.message || "SYNC_FAILED").slice(0, 160),
    }, { activate: latest.status === "active", userId });
  }
}

export function scheduleWorkoutSessionSync(sessionId, { userId, delay = 900 } = {}) {
  const key = `${userId || ""}:${sessionId}`;
  window.clearTimeout(pendingTimers.get(key));
  pendingTimers.set(key, window.setTimeout(() => {
    pendingTimers.delete(key);
    syncWorkoutSession(sessionId, { userId }).catch(() => {});
  }, Math.max(0, delay)));
}

export function flushWorkoutSessionSync(sessionId, options = {}) {
  return syncWorkoutSession(sessionId, { ...options, keepalive: true });
}

export async function syncPendingWorkoutSessions(userId) {
  if (!getAuthToken()) return [];
  const pending = listWorkoutSessions(userId).filter((session) => (
    session.status !== "abandoned"
    && session.sync_status !== "synced"
    && session.sync_status !== "conflict"
  ));
  return Promise.all(pending.map((session) => syncWorkoutSession(session.session_id, { userId })));
}

export async function hydrateWorkoutSessionsFromServer(userId) {
  if (!getAuthToken()) return [];
  try {
    const response = await getJson(apiUrl("/api/me/workout-sessions?status=unfinished"), {
      headers: authHeaders(),
    });
    if (!response.ok) return [];
    const sessions = Array.isArray(response.data?.sessions) ? response.data.sessions : [];
    const hydrated = sessions.map((session) => applyServerWorkoutSession(session, userId)).filter(Boolean);
    await syncPendingWorkoutSessions(userId);
    return hydrated;
  } catch (_) {
    return [];
  }
}
