import { currentUserId } from "./userScopedCache";

function text(value) {
  return String(value ?? "").trim();
}

function firstText(...values) {
  return values.map(text).find(Boolean) || "";
}

function firstNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return Math.round(number);
  }
  return null;
}

function firstDate(...values) {
  for (const value of values) {
    if (!value) continue;
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return null;
}

export function workoutCycleIdentity(assignment = {}, access = {}) {
  const meta = assignment?.meta || {};
  const cycle = assignment?.subscriptionCycle || assignment?.subscription_cycle || assignment?.cycle || {};
  const cycleId = firstText(
    assignment?.subscriptionCycleId,
    assignment?.subscription_cycle_id,
    meta?.subscriptionCycleId,
    meta?.subscription_cycle_id,
    cycle?.id,
    access?.subscriptionCycleId,
    access?.subscription_cycle_id,
    access?.cycleId,
    access?.cycle_id,
    access?.meta?.subscriptionCycleId,
    access?.meta?.subscription_cycle_id,
  );
  const cycleNumber = firstNumber(
    assignment?.subscriptionCycleNumber,
    assignment?.subscription_cycle_number,
    meta?.subscriptionCycleNumber,
    meta?.subscription_cycle_number,
    meta?.cycleNumber,
    meta?.cycle_number,
    cycle?.cycleNumber,
    cycle?.cycle_number,
    access?.subscriptionCycleNumber,
    access?.subscription_cycle_number,
    access?.programCycleNumber,
    access?.program_cycle_number,
    access?.meta?.subscriptionCycleNumber,
    access?.meta?.subscription_cycle_number,
    access?.meta?.programCycleNumber,
    access?.meta?.program_cycle_number,
  );
  const accessFrom = firstDate(
    assignment?.subscriptionCycleAccessFrom,
    assignment?.subscription_cycle_access_from,
    meta?.subscriptionCycleAccessFrom,
    meta?.subscription_cycle_access_from,
    cycle?.accessFrom,
    cycle?.access_from,
    access?.subscriptionCycleAccessFrom,
    access?.subscription_cycle_access_from,
    access?.accessFrom,
    access?.access_from,
    access?.meta?.subscriptionCycleAccessFrom,
    access?.meta?.subscription_cycle_access_from,
  );
  const accessUntil = firstDate(
    assignment?.subscriptionCycleAccessUntil,
    assignment?.subscription_cycle_access_until,
    meta?.subscriptionCycleAccessUntil,
    meta?.subscription_cycle_access_until,
    cycle?.accessUntil,
    cycle?.access_until,
    access?.subscriptionCycleAccessUntil,
    access?.subscription_cycle_access_until,
    access?.accessUntil,
    access?.access_until,
    access?.meta?.subscriptionCycleAccessUntil,
    access?.meta?.subscription_cycle_access_until,
  );
  return {
    cycleId: cycleId || null,
    cycleNumber,
    accessFrom,
    accessUntil,
    key: cycleId
      ? `cycle:${cycleId}`
      : (cycleNumber ? `cycle-number:${cycleNumber}` : (accessFrom ? `cycle-from:${accessFrom}` : "legacy-unscoped")),
  };
}

export function cycleIdentity(cycle = {}) {
  const cycleId = firstText(cycle?.cycleId, cycle?.subscriptionCycleId, cycle?.subscription_cycle_id);
  if (cycleId) return `cycle:${cycleId}`;
  const cycleNumber = firstNumber(cycle?.cycleNumber, cycle?.subscriptionCycleNumber, cycle?.subscription_cycle_number);
  if (cycleNumber) return `cycle-number:${cycleNumber}`;
  const accessFrom = firstDate(cycle?.accessFrom, cycle?.subscriptionCycleAccessFrom, cycle?.subscription_cycle_access_from);
  if (accessFrom) return `cycle-from:${accessFrom}`;
  return "legacy-unscoped";
}

export function cycleScopedWorkoutKey(workoutId, cycle = {}, userId = currentUserId()) {
  const user = firstText(userId) || "anonymous";
  return `${user}::${cycleIdentity(cycle)}::${firstText(workoutId)}`;
}

export function stateTimestamp(state = {}) {
  return firstDate(
    state?.completedAt,
    state?.completed_at,
    state?.updatedAt,
    state?.updated_at,
    state?.savedAt,
    state?.saved_at,
    state?.startedAt,
    state?.started_at,
    state?.selectedAt,
    state?.selected_at,
  );
}

export function legacyStateBelongsToCycle(state = {}, cycle = {}) {
  const cycleId = firstText(cycle?.cycleId, cycle?.subscriptionCycleId, cycle?.subscription_cycle_id);
  const cycleNumber = firstNumber(cycle?.cycleNumber, cycle?.subscriptionCycleNumber, cycle?.subscription_cycle_number);
  const accessFrom = firstDate(cycle?.accessFrom, cycle?.subscriptionCycleAccessFrom, cycle?.subscription_cycle_access_from);
  if (!cycleId && !cycleNumber && !accessFrom) return false;
  const stateCycleId = firstText(state?.subscriptionCycleId, state?.subscription_cycle_id, state?.cycleId, state?.cycle_id);
  if (stateCycleId && cycleId) return stateCycleId === cycleId;
  const stateCycleNumber = firstNumber(state?.subscriptionCycleNumber, state?.subscription_cycle_number, state?.cycleNumber, state?.cycle_number);
  if (stateCycleNumber && cycleNumber) return stateCycleNumber === cycleNumber;
  if (stateCycleId || stateCycleNumber) return false;
  const timestamp = stateTimestamp(state);
  if (!timestamp || !accessFrom) return false;
  return new Date(timestamp).getTime() >= new Date(accessFrom).getTime();
}

export function withWorkoutCycle(state = {}, cycle = {}) {
  const hasCurrentCycle = cycleIdentity(cycle) !== "legacy-unscoped";
  const existingCycleId = firstText(state?.subscription_cycle_id, state?.subscriptionCycleId, state?.cycle_id, state?.cycleId);
  const existingCycleNumber = firstNumber(state?.subscription_cycle_number, state?.subscriptionCycleNumber, state?.cycle_number, state?.cycleNumber);
  const existingAccessFrom = firstDate(state?.subscription_cycle_access_from, state?.subscriptionCycleAccessFrom);
  return {
    ...state,
    subscription_cycle_id: hasCurrentCycle ? (firstText(cycle?.cycleId) || null) : (existingCycleId || null),
    subscription_cycle_number: hasCurrentCycle ? firstNumber(cycle?.cycleNumber) : existingCycleNumber,
    subscription_cycle_access_from: hasCurrentCycle ? firstDate(cycle?.accessFrom) : existingAccessFrom,
  };
}
