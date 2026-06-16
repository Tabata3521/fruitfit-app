export const LOCKED_WORKOUT_MESSAGE = "Эта тренировка недоступна по текущему доступу.";

function normalizedStatus(access) {
  return String(access?.status || access?.plan || access?.role || "").toLowerCase();
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return null;
}

function workoutTotal(value) {
  return Array.isArray(value) ? value.length : Math.max(0, Number(value) || 0);
}

export function accessTier(access) {
  const status = normalizedStatus(access);
  const role = String(access?.role || "").toLowerCase();
  if (access?.isVip || status === "vip") return "vip";
  if (
    access?.isAdmin ||
    access?.isTrainer ||
    status === "admin" ||
    status === "trainer" ||
    role === "admin" ||
    role === "trainer"
  ) {
    return "full";
  }
  if (access?.isPaid || status === "paid") return "paid";
  return "free";
}

function serverWorkoutLimit(access) {
  return firstFiniteNumber(
    access?.limits?.workouts,
    access?.limits?.workoutCount,
    access?.limits?.visibleWorkouts,
    access?.features?.workouts,
    access?.features?.workoutCount,
    access?.features?.visibleWorkouts,
    access?.meta?.limits?.workouts,
    access?.meta?.limits?.visibleWorkouts,
    access?.appMap?.workouts?.visibleCount,
    access?.appMap?.training?.visibleWorkoutCount,
    access?.training?.visibleWorkoutCount,
    access?.visibleWorkoutCount,
    access?.workoutCount
  );
}

function freePreviewWorkoutCount(workoutsOrTotal = 0) {
  const total = workoutTotal(workoutsOrTotal);
  if (!Array.isArray(workoutsOrTotal) || !workoutsOrTotal.length) return Math.min(total, 3);

  const first = workoutsOrTotal[0] || {};
  const course = first.course || {};
  const text = [
    course.trainings_per_week,
    course.days_per_week,
    course.frequency,
    course.technical_name,
    course.display_name,
    course.gender,
    first.lesson?.training_type,
  ].filter(Boolean).join(" ").toLowerCase();

  if (/(^|\D)2(\D|$)/.test(text) || text.includes("две") || text.includes("два") || text.includes("2 раза")) {
    return Math.min(total, 2);
  }
  if (/(^|\D)3(\D|$)/.test(text) || text.includes("три") || text.includes("3 раза")) {
    return Math.min(total, 3);
  }
  return Math.min(total, 3);
}

export function unlockedWorkoutCount(workoutsOrTotal = 0, access) {
  const total = workoutTotal(workoutsOrTotal);
  const tier = accessTier(access);
  if (tier === "full" || tier === "vip" || tier === "paid") return total;

  const preview = freePreviewWorkoutCount(workoutsOrTotal);
  const serverLimit = serverWorkoutLimit(access);
  if (serverLimit !== null && serverLimit <= preview) return Math.min(total, Math.max(0, Math.floor(serverLimit)));
  return preview;
}

export function isWorkoutUnlocked(index, workoutsOrTotal, access) {
  return Number(index) < unlockedWorkoutCount(workoutsOrTotal, access);
}

export function visibleWorkoutsForAccess(workouts = [], access) {
  const items = Array.isArray(workouts) ? workouts : [];
  return items.slice(0, unlockedWorkoutCount(items, access));
}

export function workoutAccessLabel(access, workoutsOrTotal = 0) {
  const tier = accessTier(access);
  const count = unlockedWorkoutCount(workoutsOrTotal, access);
  if (tier === "full") return "Доступны все тренировки";
  if (tier === "vip") return "VIP: персональная программа";
  if (tier === "paid") return `Доступно ${count} тренировок`;
  return `Бесплатно доступны первые ${count}`;
}
