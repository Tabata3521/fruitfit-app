import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import { clearAuthCookie, requireAdmin, requireUser } from "./auth.js";
import { config } from "./config.js";
import { query, transaction } from "./db.js";
import { devicePayloadFromBody, serializeDevice, serializeIdentity } from "./deviceRegistry.js";
import {
  canonicalizeTrainingProgram,
  findProgramByAnyId,
  programMatchesId,
  programToCanonicalCourseRecord
} from "./programCatalog.js";
import {
  normalizeSubscriptionQuestionnaire,
  selectSubscriptionProgramPlan
} from "./payments.js";

export const meRouter = express.Router();
export const adminRouter = express.Router();
const ACCESS_STATUSES = new Set(["free", "paid", "vip", "admin", "trainer", "test"]);
const TRAINING_PROGRAMS_KEY = "training-programs";
const COURSES_KEY = "courses";
const LESSONS_KEY = "lessons";
const EXERCISE_CATALOG_KEYS = ["exercise-catalog", "exercises"];
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MEDIA_UPLOAD_DIR = process.env.ADMIN_MEDIA_UPLOAD_DIR || "/var/www/fruitfit-downloads/admin-media";
const MEDIA_UPLOAD_PUBLIC_BASE_URL = String(
  process.env.ADMIN_MEDIA_UPLOAD_PUBLIC_BASE_URL || "https://client.tagirfruit.ru/downloads/admin-media"
).replace(/\/$/, "");
const PROGRESS_PHOTOS_DIR = process.env.PROGRESS_PHOTOS_DIR || "/var/www/fruitfit-downloads/progress-photos";
const PROGRESS_PHOTOS_PUBLIC_BASE_URL = String(
  process.env.PROGRESS_PHOTOS_PUBLIC_BASE_URL || "https://client.tagirfruit.ru/downloads/progress-photos"
).replace(/\/$/, "");
const ADMIN_TEST_PROMO_CODE = "ADMIN1RUB";
const NUTRITION_CALORIE_TARGETS = [1200, 1400, 1600, 1800, 2000, 2200, 2400, 2600, 2800, 3000];
const FULL_BODY_STRETCH_VIDEO_URL = "https://ac22cf36-390e-4f3a-b58f-98eb399f6f3b.selstorage.ru/exercises/%D0%A0%D0%B0%D1%81%D1%82%D1%8F%D0%B6%D0%BA%D0%B0%20%D0%BD%D0%B0%20%D0%B2%D1%81%D0%B5%20%D1%82%D0%B5%D0%BB%D0%BE.mp4";
const SPECIAL_EXERCISE_MEDIA_BY_NAME = new Map([
  [normalizeNameIdentity("Растяжка на все тело"), {
    videoUrl: FULL_BODY_STRETCH_VIDEO_URL,
    rfVideoUrl: FULL_BODY_STRETCH_VIDEO_URL
  }]
]);
const EXERCISE_REPLACEMENT_LIMIT_MESSAGE =
  "Замены упражнений закончились. Для дальнейшей адаптации рекомендую открыть полную программу тренировок и доступ ко всем лекциям.";
const EXERCISE_REPLACEMENT_LIFETIME_DEFAULT_STEPS = [
  { days: 14, limit: 1000 },
  { days: 21, limit: 50 },
  { days: 28, limit: 35 },
  { days: 35, limit: 20 },
  { days: 42, limit: 10 },
  { days: Number.POSITIVE_INFINITY, limit: 0 }
];
let exerciseReplacementSchemaReady = null;

meRouter.use(requireUser);

meRouter.get("/", async (req, res) => {
  const profile = await loadUserProfile(req.user.id);
  const programAssignment = await loadProgramAssignment(req.user.id, req.user);
  res.json({
    user: { ...req.user, profile },
    profile,
    programAssignment,
    ...adminTestPromoPayload(req.user)
  });
});

meRouter.get("/profile", async (req, res) => {
  const result = await query("SELECT profile, updated_at FROM user_profiles WHERE user_id = $1", [req.user.id]);
  res.json({ user: req.user, profile: result.rows[0]?.profile || {}, updatedAt: result.rows[0]?.updated_at || null });
});

meRouter.post("/profile", saveUserProfile);
meRouter.put("/profile", saveUserProfile);

meRouter.delete("/account", async (req, res) => {
  const confirmed = req.body?.confirm === true || req.body?.confirmed === true || req.query?.confirm === "true";
  if (!confirmed) {
    res.status(400).json({ error: "DELETE_CONFIRMATION_REQUIRED" });
    return;
  }

  const userId = req.user.id;
  const deletedAt = new Date();
  const photoRows = await query("SELECT storage_key FROM progress_photos WHERE user_id = $1", [userId])
    .then((result) => result.rows)
    .catch(() => []);

  const result = await transaction(async (client) => {
    const counts = {};
    counts.authIdentities = await deleteUserRows(client, "auth_identities", userId);
    counts.userCredentials = await deleteUserRows(client, "user_credentials", userId);
    counts.userDevices = await deleteUserRows(client, "user_devices", userId);
    counts.userProfiles = await deleteUserRows(client, "user_profiles", userId);
    counts.userAccess = await deleteUserRows(client, "user_access", userId);
    counts.measurements = await deleteUserRows(client, "measurements", userId);
    counts.programProgress = await deleteUserRows(client, "user_program_progress", userId);
    counts.programAssignments = await deleteUserRows(client, "user_program_assignments", userId);
    counts.progressPhotos = await deleteUserRows(client, "progress_photos", userId);
    counts.vipReports = await deleteUserRows(client, "vip_reports", userId);
    counts.pushTokens = await deleteUserRows(client, "push_tokens", userId);
    counts.aiMemory = await deleteUserRows(client, "ai_user_memory", userId);
    counts.aiDailyUsage = await deleteUserRows(client, "ai_coach_daily_usage", userId);

    await client.query(
      `UPDATE ai_usage_logs
       SET user_id = NULL
       WHERE user_id = $1`,
      [userId]
    ).catch(() => ({ rowCount: 0 }));

    await client.query(
      `UPDATE payment_sessions
       SET email = NULL,
           telegram_id = NULL,
           profile_snapshot = '{}'::jsonb,
           program_params = COALESCE(program_params, '{}'::jsonb) || $2::jsonb,
           updated_at = now()
       WHERE user_id = $1`,
      [userId, { accountDeletedAt: deletedAt.toISOString() }]
    ).catch(() => ({ rowCount: 0 }));

    await client.query(
      `UPDATE payments
       SET meta = COALESCE(meta, '{}'::jsonb) || $2::jsonb,
           updated_at = now()
       WHERE user_id = $1`,
      [userId, { accountDeletedAt: deletedAt.toISOString(), userAnonymized: true }]
    ).catch(() => ({ rowCount: 0 }));

    await client.query(
      `UPDATE referral_codes
       SET status = 'deleted',
           meta = COALESCE(meta, '{}'::jsonb) || $2::jsonb,
           updated_at = now()
       WHERE user_id = $1`,
      [userId, { accountDeletedAt: deletedAt.toISOString() }]
    ).catch(() => ({ rowCount: 0 }));

    await client.query(
      `UPDATE referral_uses
       SET meta = COALESCE(meta, '{}'::jsonb) || $2::jsonb,
           updated_at = now()
       WHERE referrer_user_id = $1 OR referred_user_id = $1`,
      [userId, { accountDeletedAt: deletedAt.toISOString(), userAnonymized: true }]
    ).catch(() => ({ rowCount: 0 }));

    const userResult = await client.query(
      `UPDATE users
       SET email = NULL,
           name = 'Deleted user',
           username = NULL,
           photo_url = NULL,
           role = 'deleted',
           email_verified_at = NULL,
           deleted_at = $2,
           deletion_meta = COALESCE(deletion_meta, '{}'::jsonb) || $3::jsonb,
           updated_at = now()
       WHERE id = $1
       RETURNING id, deleted_at`,
      [userId, deletedAt, {
        deletedBy: "self",
        source: "app",
        previousEmail: req.user.email || null
      }]
    );

    return { counts, user: userResult.rows[0] || null };
  });

  await deleteProgressPhotoFiles(photoRows);
  clearAuthCookie(res);
  res.json({
    ok: true,
    deletedAt: toIso(result.user?.deleted_at || deletedAt),
    preserved: { payments: true },
    deleted: result.counts
  });
});

meRouter.get("/menstrual-cycle", async (req, res) => {
  const profile = await loadUserProfile(req.user.id);
  const cycle = computeMenstrualCycle(profile?.menstrualCycle || profile?.cycle || {});
  res.json({ cycle });
});

meRouter.put("/menstrual-cycle", async (req, res) => {
  const currentProfile = await loadUserProfile(req.user.id);
  const cycle = computeMenstrualCycle(req.body || {});
  if (!cycle.configured) {
    res.status(400).json({ error: "lastPeriodStartDate is required" });
    return;
  }
  const profile = {
    ...currentProfile,
    menstrualCycle: cycle
  };
  const result = await query(
    `INSERT INTO user_profiles (user_id, profile, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id)
     DO UPDATE SET profile = EXCLUDED.profile, updated_at = now()
     RETURNING profile, updated_at`,
    [req.user.id, profile]
  );
  res.json({ cycle: result.rows[0].profile?.menstrualCycle || cycle, updatedAt: result.rows[0].updated_at });
});

async function saveUserProfile(req, res) {
  const incomingProfile = sanitizeObject(req.body?.profile ?? req.body ?? {});
  const currentProfile = await loadUserProfile(req.user.id);
  const profile = normalizeProfileNutritionAssignment(mergeProfilePatch(currentProfile, incomingProfile));
  const nameParts = normalizeProfileName(profile);
  const result = await query(
    `INSERT INTO user_profiles (user_id, profile, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id)
     DO UPDATE SET profile = EXCLUDED.profile, updated_at = now()
     RETURNING profile, updated_at`,
    [req.user.id, profile]
  );
  if (nameParts.fullName) {
    await query("UPDATE users SET name = $2, updated_at = now() WHERE id = $1", [req.user.id, nameParts.fullName]);
  }
  const savedProfile = result.rows[0].profile;
  const access = await loadEffectiveAccess(req.user);
  const reassignmentMode = immediateProfileReassignmentMode(req.user, access);
  let programReassignment = null;
  let programAssignment = null;

  if (reassignmentMode) {
    programReassignment = await transaction((client) => reassignProgramFromProfile(client, {
      user: req.user,
      profile: savedProfile,
      access,
      mode: reassignmentMode
    }));
    programAssignment = await loadProgramAssignment(req.user.id, req.user);
  }

  res.json({
    profile: savedProfile,
    updatedAt: result.rows[0].updated_at,
    name: nameParts.fullName || req.user.name || null,
    programReassignment,
    programAssignment
  });
}

function mergeProfilePatch(currentProfile = {}, incomingProfile = {}) {
  const current = sanitizeObject(currentProfile);
  const incoming = sanitizeObject(incomingProfile);
  const currentContacts = current.contacts && typeof current.contacts === "object" ? current.contacts : {};
  const incomingContacts = incoming.contacts && typeof incoming.contacts === "object" ? incoming.contacts : {};
  const currentQuestionnaire = current.questionnaire && typeof current.questionnaire === "object" ? current.questionnaire : {};
  const incomingQuestionnaire = incoming.questionnaire && typeof incoming.questionnaire === "object" ? incoming.questionnaire : {};

  return {
    ...current,
    ...incoming,
    contacts: {
      ...currentContacts,
      ...incomingContacts
    },
    questionnaire: {
      ...currentQuestionnaire,
      ...incomingQuestionnaire
    }
  };
}

function normalizeProfileNutritionAssignment(profile = {}) {
  const gender = profile.gender === "male" ? "male" : "female";
  const age = positiveNumber(profile.age, 30);
  const height = positiveNumber(profile.height || profile.heightCm || profile.height_cm, 170);
  const weight = positiveNumber(profile.weight || profile.weightKg || profile.weight_kg, 70);
  const trainingFrequency = String(profile.trainingFrequency || profile.training_frequency || profile.frequency || "");
  const workoutsPerWeek = trainingFrequency.startsWith("3") ? 3 : 2;
  const bmr = 10 * weight + 6.25 * height - 5 * age + (gender === "male" ? 5 : -161);
  const activityMultiplier = workoutsPerWeek >= 3 ? 1.35 : 1.2;
  const goal = String(profile.goal || profile.trainingGoal || profile.training_goal || "").toLowerCase();
  const goalOffset = goal.includes("похуд") ? -300 : goal.includes("масс") || goal.includes("набор") ? 200 : 0;
  const calculatedCalories = Math.min(Math.max(1200, Math.round(bmr * activityMultiplier + goalOffset)), 3000);
  const recommendedCaloriesTarget = nearestNutritionCaloriesTarget(calculatedCalories);
  const dietType = normalizeProfileDietType(profile.dietType || profile.diet_type || profile.nutritionType || profile.nutrition_type);

  return {
    ...profile,
    dietType,
    calculatedCalories,
    recommendedCaloriesTarget,
    nutritionAssignment: {
      ...(profile.nutritionAssignment && typeof profile.nutritionAssignment === "object" ? profile.nutritionAssignment : {}),
      dietType,
      ration: dietTypeToNutritionRation(dietType),
      caloriesTarget: recommendedCaloriesTarget,
      source: "profile_questionnaire"
    }
  };
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nearestNutritionCaloriesTarget(value) {
  const number = Number(value);
  const target = Number.isFinite(number) ? number : 1800;
  return NUTRITION_CALORIE_TARGETS.reduce((best, current) => (
    Math.abs(current - target) < Math.abs(best - target) ? current : best
  ), NUTRITION_CALORIE_TARGETS[0]);
}

function normalizeProfileDietType(value) {
  const text = String(value || "").trim();
  const lower = text.toLowerCase();
  if (lower.includes("мяс")) return "Люблю мясо";
  if (lower.includes("рыб")) return "Люблю рыбу";
  if (lower.includes("вегет")) return "Вегетарианство";
  if (lower.includes("лакт") && lower.includes("глют")) return "Без глютена и без лактозы";
  if (lower.includes("лакт")) return "Без лактозы";
  if (lower.includes("глют")) return "Без глютена";
  return "Обычное питание";
}

function dietTypeToNutritionRation(value) {
  return {
    "Обычное питание": "Без ограничений",
    "Люблю мясо": "Мясоеды",
    "Люблю рыбу": "Рыбоеды",
    "Вегетарианство": "Вегетарианство",
    "Без лактозы": "Без лактозы",
    "Без глютена": "Без глютена",
    "Без глютена и без лактозы": "Без глютена и без лактозы"
  }[value] || "Без ограничений";
}

meRouter.get("/access", async (req, res) => {
  const result = await query("SELECT * FROM user_access WHERE user_id = $1", [req.user.id]);
  res.json({ access: serializeAccess(result.rows[0], req.user) });
});

meRouter.get("/identities", async (req, res) => {
  const result = await query(
    `SELECT *
     FROM auth_identities
     WHERE user_id = $1
     ORDER BY linked_at DESC, created_at DESC`,
    [req.user.id]
  );
  res.json({ identities: result.rows.map(serializeIdentity) });
});

meRouter.get("/devices", async (req, res) => {
  const result = await query(
    `SELECT *
     FROM user_devices
     WHERE user_id = $1
     ORDER BY last_seen_at DESC`,
    [req.user.id]
  );
  res.json({ devices: result.rows.map(serializeDevice) });
});

meRouter.get("/measurements", async (req, res) => {
  const result = await query(
    "SELECT id, measured_at, values, note, created_at, updated_at FROM measurements WHERE user_id = $1 ORDER BY measured_at DESC LIMIT 200",
    [req.user.id]
  );
  res.json({ items: result.rows });
});

meRouter.post("/measurements", async (req, res) => {
  const id = crypto.randomUUID();
  const values = sanitizeObject(req.body?.values || {});
  const note = req.body?.note ? String(req.body.note).slice(0, 2000) : null;
  const measuredAt = req.body?.measuredAt ? new Date(req.body.measuredAt) : new Date();
  const result = await query(
    `INSERT INTO measurements (id, user_id, measured_at, values, note)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, measured_at, values, note, created_at, updated_at`,
    [id, req.user.id, measuredAt, values, note]
  );
  res.status(201).json({ item: result.rows[0] });
});

meRouter.get("/program-progress", async (req, res) => {
  const result = await query("SELECT program_id, state, updated_at FROM user_program_progress WHERE user_id = $1", [req.user.id]);
  res.json({ items: result.rows });
});

meRouter.get("/program-assignment", async (req, res) => {
  res.json({ assignment: await loadProgramAssignment(req.user.id, req.user) });
});

meRouter.post("/exercise-replacements", trackExerciseReplacement);

meRouter.put("/program-progress/:programId", async (req, res) => {
  const state = sanitizeObject(req.body?.state || {});
  const result = await query(
    `INSERT INTO user_program_progress (user_id, program_id, state, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id, program_id)
     DO UPDATE SET state = EXCLUDED.state, updated_at = now()
     RETURNING program_id, state, updated_at`,
    [req.user.id, String(req.params.programId), state]
  );
  res.json({ item: result.rows[0] });
});

meRouter.get("/progress-photos", async (req, res) => {
  if (!await hasVipFeatureAccess(req.user)) {
    res.status(403).json({ error: "VIP_ACCESS_REQUIRED" });
    return;
  }
  const result = await query(
    "SELECT id, taken_at, storage_key, public_url, meta, created_at FROM progress_photos WHERE user_id = $1 ORDER BY taken_at DESC LIMIT 200",
    [req.user.id]
  );
  res.json({ items: result.rows });
});

meRouter.post("/progress-photos", async (req, res) => {
  if (!await hasVipFeatureAccess(req.user)) {
    res.status(403).json({ error: "VIP_ACCESS_REQUIRED" });
    return;
  }
  const id = crypto.randomUUID();
  const storageKey = String(req.body?.storageKey || "").trim();
  if (!storageKey) {
    res.status(400).json({ error: "storageKey is required" });
    return;
  }
  const savedPhoto = await persistProgressPhoto(storageKey, req.body?.publicUrl || req.body?.dataUrl || "");
  const result = await query(
    `INSERT INTO progress_photos (id, user_id, taken_at, storage_key, public_url, meta)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, taken_at, storage_key, public_url, meta, created_at`,
    [
      id,
      req.user.id,
      req.body?.takenAt ? new Date(req.body.takenAt) : new Date(),
      savedPhoto.storageKey,
      savedPhoto.publicUrl || req.body?.publicUrl || null,
      {
        ...sanitizeObject(req.body?.meta || {}),
        storageBackend: savedPhoto.saved ? "local-public-file" : "external-url"
      }
    ]
  );
  res.status(201).json({ item: result.rows[0] });
});

meRouter.delete("/progress-photos/:photoId", async (req, res) => {
  if (!await hasVipFeatureAccess(req.user)) {
    res.status(403).json({ error: "VIP_ACCESS_REQUIRED" });
    return;
  }
  const result = await query(
    "DELETE FROM progress_photos WHERE id = $1 AND user_id = $2 RETURNING id",
    [String(req.params.photoId), req.user.id]
  );
  if (!result.rowCount) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }
  res.json({ ok: true });
});

meRouter.get("/trainer-reports", async (req, res) => {
  if (!await hasVipFeatureAccess(req.user)) {
    res.status(403).json({ error: "VIP_ACCESS_REQUIRED" });
    return;
  }
  const result = await query(
    `SELECT id, user_id, status, title, report, created_at, updated_at
     FROM vip_reports
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [req.user.id]
  );
  res.json({ items: result.rows.map(serializeVipReport) });
});

meRouter.post("/trainer-reports", async (req, res) => {
  if (!await hasVipFeatureAccess(req.user)) {
    res.status(403).json({ error: "VIP_ACCESS_REQUIRED" });
    return;
  }
  const id = crypto.randomUUID();
  const report = normalizeTrainerReport(req.body?.report || {});
  const title = String(req.body?.title || report.title || "Отчёт клиента").slice(0, 160);
  const result = await query(
    `INSERT INTO vip_reports (id, user_id, status, title, report, created_at, updated_at)
     VALUES ($1, $2, 'submitted', $3, $4, now(), now())
     RETURNING id, user_id, status, title, report, created_at, updated_at`,
    [id, req.user.id, title, report]
  );
  res.status(201).json({ item: serializeVipReport(result.rows[0]) });
});

adminRouter.use((req, res, next) => {
  if (config.adminApiToken && req.headers["x-admin-token"] === config.adminApiToken) {
    next();
    return;
  }
  requireUser(req, res, () => requireAdmin(req, res, next));
});

adminRouter.get("/programs", async (_req, res) => {
  const document = await loadTrainingProgramsDocument();
  res.json({
    updatedAt: document.updatedAt,
    source: document.source,
    programs: document.programs
  });
});

adminRouter.put("/programs", saveTrainingPrograms);
adminRouter.post("/programs", saveTrainingPrograms);

adminRouter.put("/programs/:programId", saveTrainingProgram);
adminRouter.patch("/programs/:programId", saveTrainingProgram);
adminRouter.post("/programs/:programId", saveTrainingProgram);
adminRouter.delete("/programs/:programId", deleteTrainingProgram);

adminRouter.get("/payments/analytics", async (req, res) => {
  const range = parseAnalyticsRange(req.query);
  const payments = await query(
    `SELECT p.id, p.user_id, p.provider, p.provider_payment_id, p.status, p.amount, p.currency,
            p.product_code, p.created_at, p.updated_at, p.paid_at, p.payment_session_id,
            ps.status AS session_status, ps.assignment_status, ps.created_at AS session_created_at,
            ps.paid_at AS session_paid_at,
            u.email, u.name, u.username, u.created_at AS user_created_at
     FROM payments p
     LEFT JOIN payment_sessions ps ON ps.id = p.payment_session_id
     LEFT JOIN users u ON u.id = p.user_id
     WHERE COALESCE(p.paid_at, p.created_at, p.updated_at) >= $1
       AND COALESCE(p.paid_at, p.created_at, p.updated_at) < $2
     ORDER BY COALESCE(p.paid_at, p.created_at, p.updated_at) DESC
     LIMIT 1000`,
    [range.from, range.toExclusive]
  );
  const funnel = await loadRealPaymentFunnel(range);
  res.json({
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    payments: payments.rows.map(serializeAdminPaymentRecord),
    funnel
  });
});

adminRouter.get("/dashboard/summary", async (req, res) => {
  const range = parseAnalyticsRange(req.query);
  const users = await query("SELECT id, role, created_at FROM users");
  const access = await query("SELECT status, is_active FROM user_access");
  const payments = await query(
    `SELECT status, amount, product_code, COALESCE(paid_at, created_at, updated_at) AS event_at
     FROM payments
     WHERE COALESCE(paid_at, created_at, updated_at) >= $1
       AND COALESCE(paid_at, created_at, updated_at) < $2`,
    [range.from, range.toExclusive]
  );
  const assignments = await query("SELECT program_id FROM user_program_assignments");
  const paidPayments = payments.rows.filter((row) => paymentKind(row.status) === "paid");
  res.json({
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    users: {
      total: users.rowCount,
      newInRange: users.rows.filter((row) => inRange(row.created_at, range)).length,
      admin: users.rows.filter((row) => row.role === "admin").length
    },
    access: {
      free: access.rows.filter((row) => normalizeAccessStatus(row.status) === "free").length,
      paid: access.rows.filter((row) => normalizeAccessStatus(row.status) === "paid").length,
      vip: access.rows.filter((row) => normalizeAccessStatus(row.status) === "vip").length,
      activePaid: access.rows.filter((row) => row.is_active !== false && ["paid", "vip", "admin", "trainer"].includes(normalizeAccessStatus(row.status))).length
    },
    payments: {
      count: paidPayments.length,
      revenue: paidPayments.reduce((sum, row) => sum + Number(row.amount || 0), 0)
    },
    assignments: {
      total: assignments.rowCount
    }
  });
});


adminRouter.get("/dashboard/negative-stats", async (req, res) => {
  const range = parseAnalyticsRange(req.query);
  const inactiveDeviceDays = Math.max(7, Math.min(90, Number(req.query.inactiveDeviceDays || 14) || 14));

  const safeQuery = async (sql, params = [], fallbackRows = [{}]) => {
    try {
      return await query(sql, params);
    } catch (error) {
      if (["42P01", "42703"].includes(error?.code)) {
        return { rows: fallbackRows, rowCount: 0 };
      }
      throw error;
    }
  };

  const subscriptions = await safeQuery(
    `SELECT
       COUNT(*) FILTER (
         WHERE status = 'cancelled'
            OR cancelled_at IS NOT NULL
       )::int AS cancelled,
       COUNT(*) FILTER (WHERE status = 'cancel_requested')::int AS cancel_requested,
       COUNT(*) FILTER (WHERE status IN ('failed', 'expired', 'past_due'))::int AS failed_or_expired,
       MAX(cancelled_at) AS last_cancelled_at
     FROM subscriptions
     WHERE COALESCE(cancelled_at, updated_at, created_at) >= $1
       AND COALESCE(cancelled_at, updated_at, created_at) < $2
       AND (status IN ('cancelled', 'cancel_requested', 'failed', 'expired', 'past_due') OR cancelled_at IS NOT NULL)`,
    [range.from, range.toExclusive]
  );

  const accounts = await safeQuery(
    `SELECT COUNT(*)::int AS deleted, MAX(deleted_at) AS last_deleted_at
     FROM users
     WHERE deleted_at >= $1
       AND deleted_at < $2`,
    [range.from, range.toExclusive]
  );

  const apps = await safeQuery(
    `SELECT
       COUNT(*) FILTER (WHERE enabled = false AND updated_at >= $1 AND updated_at < $2)::int AS disabled_push_tokens,
       COUNT(*) FILTER (
         WHERE enabled = false
           AND updated_at >= $1
           AND updated_at < $2
           AND (
             lower(COALESCE(meta->>'disabledReason', '')) IN ('invalid_fcm_token', 'not_registered', 'unregistered')
             OR lower(COALESCE(meta->>'fcmError', '')) LIKE '%not%registered%'
             OR lower(COALESCE(meta::text, '')) LIKE '%registration-token-not-registered%'
           )
       )::int AS suspected_uninstalls,
       MAX(updated_at) FILTER (WHERE enabled = false) AS last_disabled_at
     FROM push_tokens`,
    [range.from, range.toExclusive]
  );

  const devices = await safeQuery(
    `SELECT
       COUNT(*)::int AS total_devices,
       COUNT(*) FILTER (WHERE last_seen_at >= now() - ($1::int * interval '1 day'))::int AS active_devices,
       COUNT(*) FILTER (WHERE last_seen_at < now() - ($1::int * interval '1 day'))::int AS stale_devices,
       MAX(last_seen_at) FILTER (WHERE last_seen_at < now() - ($1::int * interval '1 day')) AS last_stale_seen_at
     FROM user_devices`,
    [inactiveDeviceDays]
  );

  const recent = await safeQuery(
    `WITH events AS (
       SELECT 'subscription_cancelled' AS kind,
              COALESCE(s.cancelled_at, s.updated_at, s.created_at) AS event_at,
              s.user_id,
              COALESCE(NULLIF(u.name, ''), NULLIF(u.email, ''), NULLIF(u.username, ''), s.user_id) AS label,
              COALESCE(NULLIF(s.cancel_reason, ''), s.status, s.product_code) AS detail
       FROM subscriptions s
       LEFT JOIN users u ON u.id = s.user_id
       WHERE COALESCE(s.cancelled_at, s.updated_at, s.created_at) >= $1
         AND COALESCE(s.cancelled_at, s.updated_at, s.created_at) < $2
         AND (s.status IN ('cancelled', 'cancel_requested', 'failed', 'expired', 'past_due') OR s.cancelled_at IS NOT NULL)
       UNION ALL
       SELECT 'account_deleted' AS kind,
              u.deleted_at AS event_at,
              u.id AS user_id,
              COALESCE(NULLIF(u.name, ''), NULLIF(u.email, ''), NULLIF(u.username, ''), u.id) AS label,
              COALESCE(u.deletion_meta->>'source', u.deletion_meta->>'deletedBy', 'account deleted') AS detail
       FROM users u
       WHERE u.deleted_at >= $1
         AND u.deleted_at < $2
       UNION ALL
       SELECT 'push_disabled' AS kind,
              pt.updated_at AS event_at,
              pt.user_id,
              COALESCE(NULLIF(u.name, ''), NULLIF(u.email, ''), NULLIF(u.username, ''), pt.user_id, pt.device_id, 'device') AS label,
              COALESCE(pt.meta->>'disabledReason', pt.meta->>'fcmError', 'push token disabled') AS detail
       FROM push_tokens pt
       LEFT JOIN users u ON u.id = pt.user_id
       WHERE pt.enabled = false
         AND pt.updated_at >= $1
         AND pt.updated_at < $2
       UNION ALL
       SELECT 'device_stale' AS kind,
              ud.last_seen_at AS event_at,
              ud.user_id,
              COALESCE(NULLIF(u.name, ''), NULLIF(u.email, ''), NULLIF(u.username, ''), ud.user_id, ud.model, ud.device_id, 'device') AS label,
              CONCAT_WS(' · ', NULLIF(ud.platform, ''), NULLIF(ud.model, ''), 'no activity') AS detail
       FROM user_devices ud
       LEFT JOIN users u ON u.id = ud.user_id
       WHERE ud.last_seen_at >= $1
         AND ud.last_seen_at < $2
         AND ud.last_seen_at < now() - ($3::int * interval '1 day')
     )
     SELECT kind, event_at, user_id, label, detail
     FROM events
     ORDER BY event_at DESC NULLS LAST
     LIMIT 10`,
    [range.from, range.toExclusive, inactiveDeviceDays],
    []
  );

  const subscriptionRow = subscriptions.rows[0] || {};
  const accountRow = accounts.rows[0] || {};
  const appRow = apps.rows[0] || {};
  const deviceRow = devices.rows[0] || {};

  res.json({
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    source: "postgres",
    subscriptions: {
      cancelled: Number(subscriptionRow.cancelled || 0),
      cancelRequested: Number(subscriptionRow.cancel_requested || 0),
      failedOrExpired: Number(subscriptionRow.failed_or_expired || 0),
      lastCancelledAt: subscriptionRow.last_cancelled_at || null
    },
    accounts: {
      deleted: Number(accountRow.deleted || 0),
      lastDeletedAt: accountRow.last_deleted_at || null
    },
    apps: {
      disabledPushTokens: Number(appRow.disabled_push_tokens || 0),
      suspectedUninstalls: Number(appRow.suspected_uninstalls || 0),
      lastDisabledAt: appRow.last_disabled_at || null,
      totalDevices: Number(deviceRow.total_devices || 0),
      activeDevices: Number(deviceRow.active_devices || 0),
      staleDevices: Number(deviceRow.stale_devices || 0),
      lastStaleSeenAt: deviceRow.last_stale_seen_at || null,
      inactiveDeviceDays
    },
    recent: recent.rows.map((row) => ({
      kind: row.kind,
      eventAt: row.event_at ? new Date(row.event_at).toISOString() : null,
      userId: row.user_id || null,
      label: row.label || null,
      detail: row.detail || null
    }))
  });
});

adminRouter.post("/media/upload", async (req, res) => {
  const result = await persistAdminMediaUpload(req.body || {});
  res.status(201).json(result);
});

adminRouter.get("/exercises", async (_req, res) => {
  const catalog = await loadAdminExerciseCatalogDocument();
  res.json(catalog);
});

adminRouter.patch("/exercises/:id/muscle-map", async (req, res) => {
  const exerciseId = String(req.params.id || "").trim();
  if (!exerciseId) {
    res.status(400).json({ error: "exercise id is required" });
    return;
  }
  const override = normalizeMuscleMapOverride(req.body || {});
  const updated = await updateExerciseDocuments((exercise) => {
    if (!exerciseMatchesId(exercise, exerciseId)) return exercise;
    return { ...exercise, ...override };
  });
  res.json({ updated, exerciseId, override });
});

adminRouter.post("/exercises/muscle-map/replace-bulk", async (req, res) => {
  const from = normalizeMuscleMapIdentity(req.body?.from || req.body?.old || req.body?.oldUrl || req.body?.old_url || "");
  const exerciseIds = normalizeStringList(req.body?.exerciseIds || req.body?.exercise_ids || req.body?.ids);
  const exerciseNames = normalizeNameList(req.body?.exerciseNames || req.body?.exercise_names || req.body?.names);
  const fromLabels = normalizeNameList([
    req.body?.fromLabel,
    req.body?.from_label,
    req.body?.fromKey,
    req.body?.from_key,
    req.body?.muscleGroup,
    req.body?.muscle_group
  ]);
  const override = normalizeMuscleMapOverride(req.body || {});
  if (!from && !exerciseIds.length && !exerciseNames.length && !fromLabels.length) {
    res.status(400).json({ error: "old muscle map identity or exercise list is required" });
    return;
  }
  const updated = await updateExerciseDocuments((exercise, documentKey) => {
    const identities = [
      exercise.muscle_map_asset_path,
      exercise.muscleMapAssetPath,
      exercise.muscle_map_key,
      exercise.muscleMapKey,
      exercise.muscle_map_label,
      exercise.muscleMapLabel
    ].map(normalizeMuscleMapIdentity).filter(Boolean);
    const nameIdentity = normalizeNameIdentity(exercise.exercise_name || exercise.exerciseName || exercise.name || exercise.title);
    const groupIdentities = [
      exercise.muscle_group,
      exercise.muscleGroup,
      exercise.muscle_map_key,
      exercise.muscleMapKey,
      exercise.muscle_map_label,
      exercise.muscleMapLabel
    ].map(normalizeNameIdentity).filter(Boolean);
    const matchesExplicitId = exerciseIds.some((id) => exerciseMatchesId(exercise, id));
    const matchesExplicitName = nameIdentity && exerciseNames.includes(nameIdentity);
    const matchesOldMuscleMap = from && identities.includes(from);
    const matchesCatalogGroup = documentKey === "exercise-catalog"
      && fromLabels.length
      && groupIdentities.some((identity) => fromLabels.includes(identity));
    return matchesExplicitId || matchesExplicitName || matchesOldMuscleMap || matchesCatalogGroup
      ? { ...exercise, ...override }
      : exercise;
  });
  res.json({ updated, from, exerciseIds, exerciseNames, fromLabels, override });
});

adminRouter.get("/users", async (_req, res) => {
  const result = await query(
    `SELECT u.id, u.email, u.name, u.username, u.photo_url, u.role, u.created_at, u.updated_at,
            ua.status, ua.plan, ua.premium_until, ua.is_vip, ua.source, ua.meta,
            ua.starts_at, ua.expires_at, ua.is_active,
            up.profile AS user_profile,
            upa.program_id, upa.program_title, upa.assigned_by, upa.source AS program_source, upa.meta AS program_meta,
            upa.created_at AS program_created_at, upa.updated_at AS program_updated_at,
            COALESCE(idents.identities, '[]'::jsonb) AS identities,
            COALESCE(pay.payment_stats, '{}'::jsonb) AS payment_stats,
            latest_report.latest_report,
            COALESCE(progress_photos.progress_photos, '[]'::jsonb) AS progress_photos
     FROM users u
     LEFT JOIN user_access ua ON ua.user_id = u.id
     LEFT JOIN user_profiles up ON up.user_id = u.id
     LEFT JOIN user_program_assignments upa ON upa.user_id = u.id
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(
         jsonb_build_object(
           'id', ai.id,
           'provider', ai.provider,
           'providerUserId', ai.provider_user_id,
           'providerEmail', ai.provider_email,
           'providerUsername', ai.provider_username,
           'profile', ai.profile,
           'metadata', ai.metadata_json,
           'linkedAt', ai.linked_at,
           'lastLoginAt', ai.last_login_at,
           'createdAt', ai.created_at,
           'updatedAt', ai.updated_at
         )
         ORDER BY ai.linked_at DESC, ai.created_at DESC
       ) AS identities
       FROM auth_identities ai
       WHERE ai.user_id = u.id
     ) idents ON true
     LEFT JOIN LATERAL (
       SELECT jsonb_build_object(
         'total', COALESCE(SUM(CASE WHEN lower(p.status) = ANY(ARRAY['paid','succeeded','success','completed','captured']) THEN p.amount ELSE 0 END), 0),
         'payments', COALESCE(jsonb_agg(
           jsonb_build_object(
             'id', p.id,
             'date', COALESCE(p.paid_at, p.created_at, p.updated_at),
             'amount', p.amount,
             'product', CASE WHEN lower(COALESCE(p.product_code, '')) LIKE '%vip%' THEN 'VIP' WHEN lower(COALESCE(p.product_code, '')) LIKE '%program%' OR lower(COALESCE(p.product_code, '')) LIKE '%training%' THEN 'Программа' ELSE COALESCE(p.product_code, 'Оплата') END,
             'productCode', p.product_code,
             'status', p.status
           )
           ORDER BY COALESCE(p.paid_at, p.created_at, p.updated_at) DESC
         ) FILTER (WHERE p.id IS NOT NULL), '[]'::jsonb)
       ) AS payment_stats
       FROM payments p
       WHERE p.user_id = u.id
     ) pay ON true
     LEFT JOIN LATERAL (
       SELECT jsonb_build_object(
         'id', vr.id,
         'userId', vr.user_id,
         'status', vr.status,
         'title', vr.title,
         'report', vr.report,
         'createdAt', vr.created_at,
         'updatedAt', vr.updated_at
       ) AS latest_report
       FROM vip_reports vr
       WHERE vr.user_id = u.id
       ORDER BY vr.created_at DESC
       LIMIT 1
     ) latest_report ON true
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(
         jsonb_build_object(
           'id', pp.id,
           'takenAt', pp.taken_at,
           'storageKey', pp.storage_key,
           'publicUrl', pp.public_url,
           'meta', pp.meta,
           'createdAt', pp.created_at
         )
         ORDER BY pp.taken_at DESC, pp.created_at DESC
       ) AS progress_photos
       FROM progress_photos pp
       WHERE pp.user_id = u.id
     ) progress_photos ON true
     WHERE u.deleted_at IS NULL
       AND lower(COALESCE(u.role, '')) <> 'deleted'
     ORDER BY u.created_at DESC
     LIMIT 500`
  );
  res.json({ users: result.rows.map(serializeAdminUser) });
});

adminRouter.get("/vip-reports", async (_req, res) => {
  const result = await query(
    `SELECT vr.id, vr.user_id, vr.status, vr.title, vr.report, vr.created_at, vr.updated_at,
            u.email, u.name, u.username, u.photo_url
     FROM vip_reports vr
     LEFT JOIN users u ON u.id = vr.user_id
     ORDER BY vr.created_at DESC
     LIMIT 500`
  );
  res.json({ items: result.rows.map((row) => ({
    ...serializeVipReport(row),
    user: {
      id: row.user_id,
      email: row.email || null,
      name: row.name || null,
      username: row.username || null,
      photoUrl: row.photo_url || null,
    }
  })) });
});

adminRouter.get("/users/:userId/vip-reports", async (req, res) => {
  const result = await query(
    `SELECT id, user_id, status, title, report, created_at, updated_at
     FROM vip_reports
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 200`,
    [String(req.params.userId)]
  );
  res.json({ items: result.rows.map(serializeVipReport) });
});

adminRouter.get("/users/:userId", async (req, res) => {
  const result = await query(
    `SELECT u.id, u.email, u.name, u.username, u.photo_url, u.role, u.created_at, u.updated_at,
            ua.status, ua.plan, ua.premium_until, ua.is_vip, ua.source, ua.meta,
            ua.starts_at, ua.expires_at, ua.is_active,
            up.profile AS user_profile,
            upa.program_id, upa.program_title, upa.assigned_by, upa.source AS program_source, upa.meta AS program_meta,
            upa.created_at AS program_created_at, upa.updated_at AS program_updated_at,
            COALESCE(idents.identities, '[]'::jsonb) AS identities,
            COALESCE(pay.payment_stats, '{}'::jsonb) AS payment_stats,
            latest_report.latest_report,
            COALESCE(progress_photos.progress_photos, '[]'::jsonb) AS progress_photos
     FROM users u
     LEFT JOIN user_access ua ON ua.user_id = u.id
     LEFT JOIN user_profiles up ON up.user_id = u.id
     LEFT JOIN user_program_assignments upa ON upa.user_id = u.id
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(
         jsonb_build_object(
           'id', ai.id,
           'provider', ai.provider,
           'providerUserId', ai.provider_user_id,
           'providerEmail', ai.provider_email,
           'providerUsername', ai.provider_username,
           'profile', ai.profile,
           'metadata', ai.metadata_json,
           'linkedAt', ai.linked_at,
           'lastLoginAt', ai.last_login_at,
           'createdAt', ai.created_at,
           'updatedAt', ai.updated_at
         )
         ORDER BY ai.linked_at DESC, ai.created_at DESC
       ) AS identities
       FROM auth_identities ai
       WHERE ai.user_id = u.id
     ) idents ON true
     LEFT JOIN LATERAL (
       SELECT jsonb_build_object(
         'total', COALESCE(SUM(CASE WHEN lower(p.status) = ANY(ARRAY['paid','succeeded','success','completed','captured']) THEN p.amount ELSE 0 END), 0),
         'payments', COALESCE(jsonb_agg(
           jsonb_build_object(
             'id', p.id,
             'date', COALESCE(p.paid_at, p.created_at, p.updated_at),
             'amount', p.amount,
             'product', CASE WHEN lower(COALESCE(p.product_code, '')) LIKE '%vip%' THEN 'VIP' WHEN lower(COALESCE(p.product_code, '')) LIKE '%program%' OR lower(COALESCE(p.product_code, '')) LIKE '%training%' THEN 'Программа' ELSE COALESCE(p.product_code, 'Оплата') END,
             'productCode', p.product_code,
             'status', p.status
           )
           ORDER BY COALESCE(p.paid_at, p.created_at, p.updated_at) DESC
         ) FILTER (WHERE p.id IS NOT NULL), '[]'::jsonb)
       ) AS payment_stats
       FROM payments p
       WHERE p.user_id = u.id
     ) pay ON true
     LEFT JOIN LATERAL (
       SELECT jsonb_build_object(
         'id', vr.id,
         'userId', vr.user_id,
         'status', vr.status,
         'title', vr.title,
         'report', vr.report,
         'createdAt', vr.created_at,
         'updatedAt', vr.updated_at
       ) AS latest_report
       FROM vip_reports vr
       WHERE vr.user_id = u.id
       ORDER BY vr.created_at DESC
       LIMIT 1
     ) latest_report ON true
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(
         jsonb_build_object(
           'id', pp.id,
           'takenAt', pp.taken_at,
           'storageKey', pp.storage_key,
           'publicUrl', pp.public_url,
           'meta', pp.meta,
           'createdAt', pp.created_at
         )
         ORDER BY pp.taken_at DESC, pp.created_at DESC
       ) AS progress_photos
       FROM progress_photos pp
       WHERE pp.user_id = u.id
     ) progress_photos ON true
     WHERE u.id = $1
       AND u.deleted_at IS NULL
       AND lower(COALESCE(u.role, '')) <> 'deleted'`,
    [String(req.params.userId)]
  );
  if (!result.rowCount) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ user: serializeAdminUser(result.rows[0]) });
});

adminRouter.patch("/users/:userId/profile", saveAdminUserProfile);
adminRouter.put("/users/:userId/profile", saveAdminUserProfile);

adminRouter.delete("/users/:userId", async (req, res) => {
  const userId = String(req.params.userId || "").trim();
  const confirmation = String(req.body?.confirmation || req.body?.confirm || "").trim();
  if (confirmation !== "Удалить") {
    res.status(400).json({ error: "Confirmation word is required" });
    return;
  }

  const target = await query(
    `SELECT u.id, u.email, u.name, u.username, u.role, ua.status AS access_status
     FROM users u
     LEFT JOIN user_access ua ON ua.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );
  if (!target.rowCount) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const row = target.rows[0];
  const isAdmin = String(row.role || "").toLowerCase() === "admin" || String(row.access_status || "").toLowerCase() === "admin";
  if (isAdmin) {
    res.status(403).json({ error: "Admin users cannot be deleted" });
    return;
  }

  const photoRows = await query("SELECT storage_key FROM progress_photos WHERE user_id = $1", [userId])
    .then((result) => result.rows)
    .catch(() => []);
  const deletedAt = new Date();

  const deletion = await transaction(async (client) => {
    const counts = {};
    counts.authIdentities = await deleteUserRows(client, "auth_identities", userId);
    counts.userCredentials = await deleteUserRows(client, "user_credentials", userId);
    counts.userDevices = await deleteUserRows(client, "user_devices", userId);
    counts.userProfiles = await deleteUserRows(client, "user_profiles", userId);
    counts.userAccess = await deleteUserRows(client, "user_access", userId);
    counts.measurements = await deleteUserRows(client, "measurements", userId);
    counts.programProgress = await deleteUserRows(client, "user_program_progress", userId);
    counts.programAssignments = await deleteUserRows(client, "user_program_assignments", userId);
    counts.progressPhotos = await deleteUserRows(client, "progress_photos", userId);
    counts.vipReports = await deleteUserRows(client, "vip_reports", userId);
    counts.pushTokens = await deleteUserRows(client, "push_tokens", userId);
    counts.aiMemory = await deleteUserRows(client, "ai_user_memory", userId);
    counts.aiDailyUsage = await deleteUserRows(client, "ai_coach_daily_usage", userId);

    await client.query("UPDATE ai_usage_logs SET user_id = NULL WHERE user_id = $1", [userId]).catch(() => ({ rowCount: 0 }));
    await client.query(
      `UPDATE payment_sessions
       SET email = NULL,
           telegram_id = NULL,
           profile_snapshot = '{}'::jsonb,
           program_params = COALESCE(program_params, '{}'::jsonb) || $2::jsonb,
           updated_at = now()
       WHERE user_id = $1`,
      [userId, { accountDeletedAt: new Date().toISOString(), deletedBy: "admin-ui" }]
    ).catch(() => ({ rowCount: 0 }));
    await client.query(
      `UPDATE payments
       SET meta = COALESCE(meta, '{}'::jsonb) || $2::jsonb,
           updated_at = now()
       WHERE user_id = $1`,
      [userId, { accountDeletedAt: new Date().toISOString(), deletedBy: "admin-ui", userAnonymized: true }]
    ).catch(() => ({ rowCount: 0 }));
    await client.query(
      `UPDATE referral_codes
       SET status = 'deleted',
           meta = COALESCE(meta, '{}'::jsonb) || $2::jsonb,
           updated_at = now()
       WHERE user_id = $1`,
      [userId, { accountDeletedAt: new Date().toISOString(), deletedBy: "admin-ui" }]
    ).catch(() => ({ rowCount: 0 }));
    await client.query(
      `UPDATE referral_uses
       SET meta = COALESCE(meta, '{}'::jsonb) || $2::jsonb,
           updated_at = now()
       WHERE referrer_user_id = $1 OR referred_user_id = $1`,
      [userId, { accountDeletedAt: new Date().toISOString(), deletedBy: "admin-ui", userAnonymized: true }]
    ).catch(() => ({ rowCount: 0 }));

    const deleted = await client.query(
      `UPDATE users
       SET email = NULL,
           name = 'Deleted user',
           username = NULL,
           photo_url = NULL,
           role = 'deleted',
           email_verified_at = NULL,
           deleted_at = $2,
           deletion_meta = COALESCE(deletion_meta, '{}'::jsonb) || $3::jsonb,
           updated_at = now()
       WHERE id = $1
         AND COALESCE(role, 'user') <> 'admin'
       RETURNING id, email, name, username, role, deleted_at`,
      [userId, deletedAt, {
        deletedBy: "admin",
        source: "admin-ui",
        previousEmail: row.email || null,
        previousName: row.name || row.username || null
      }]
    );
    return { counts, user: deleted.rows[0] || null };
  });

  if (!deletion.user) {
    res.status(403).json({ error: "User was not deleted" });
    return;
  }

  await deleteProgressPhotoFiles(photoRows);
  res.json({ deleted: deletion.user, deletedAt: toIso(deletion.user?.deleted_at || deletedAt), cleanup: deletion.counts });
});

adminRouter.patch("/users/:userId/access", updateUserAccess);
adminRouter.put("/users/:userId/access", updateUserAccess);
adminRouter.get("/users/:userId/program-assignment", async (req, res) => {
  const userId = String(req.params.userId);
  const user = await query("SELECT id FROM users WHERE id = $1", [userId]);
  if (!user.rowCount) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ assignment: await loadProgramAssignment(userId) });
});
adminRouter.patch("/users/:userId/program-assignment", updateProgramAssignment);
adminRouter.put("/users/:userId/program-assignment", updateProgramAssignment);
adminRouter.delete("/users/:userId/program-assignment", async (req, res) => {
  const userId = String(req.params.userId);
  await query("DELETE FROM user_program_assignments WHERE user_id = $1", [userId]);
  res.json({ assignment: null });
});

async function trackExerciseReplacement(req, res) {
  await ensureExerciseReplacementSchema();

  const payload = req.body || {};
  const userId = req.user.id;
  const programId = replacementText(payload.programId || payload.program_id);
  const workoutId = replacementText(payload.workoutId || payload.workout_id || payload.lessonId || payload.lesson_id);
  const dayIndex = replacementInteger(payload.dayIndex ?? payload.day_index);
  const originalExerciseId = replacementText(payload.originalExerciseId || payload.original_exercise_id);
  const originalExerciseTitle = replacementText(payload.originalExerciseTitle || payload.original_exercise_title || payload.originalTitle);
  const replacementExerciseId = replacementText(payload.replacementExerciseId || payload.replacement_exercise_id);
  const replacementExerciseTitle = replacementText(payload.replacementExerciseTitle || payload.replacement_exercise_title || payload.replacementTitle);

  if (!originalExerciseTitle && !replacementExerciseTitle) {
    res.status(400).json({
      allowed: false,
      reason: "INVALID_REPLACEMENT",
      message: "Не удалось сохранить замену упражнения: не переданы данные упражнения."
    });
    return;
  }

  const accessRow = await query("SELECT * FROM user_access WHERE user_id = $1", [userId]).catch(() => ({ rows: [] }));
  const access = serializeAccess(accessRow.rows[0], req.user);
  const accessStatus = normalizeAccessStatus(access.status || req.user.role);
  const periodKey = currentMoscowPeriodKey();
  const monthlyLimit = replacementMonthlyLimit(accessStatus, req.user, access);
  const replacementDevice = await resolveExerciseReplacementDevice(userId, payload, req);
  const lifetimePlan = await replacementLifetimeLimitPlan({
    accessStatus,
    user: req.user,
    access,
    device: replacementDevice
  });
  const meta = sanitizeObject(payload.meta || {});

  const usage = await transaction(async (client) => {
    let monthlyUsed = null;
    if (monthlyLimit !== null) {
      const usedResult = await client.query(
        "SELECT count(*)::int AS used FROM exercise_replacement_events WHERE user_id = $1 AND period_key = $2",
        [userId, periodKey]
      );
      monthlyUsed = Number(usedResult.rows[0]?.used || 0);
      if (monthlyUsed >= monthlyLimit) {
        return { allowed: false, used: monthlyUsed, limit: monthlyLimit, period: "month", periodKey };
      }
    }

    let lifetimeUsage = null;
    if (lifetimePlan) {
      lifetimeUsage = await replacementLifetimeUsage(client, userId, replacementDevice);
      if (lifetimeUsage.used >= lifetimePlan.limit) {
        return {
          allowed: false,
          used: lifetimeUsage.used,
          limit: lifetimePlan.limit,
          period: "lifetime",
          periodKey: null,
          scope: lifetimeUsage.scope,
          daysSinceStart: lifetimePlan.daysSinceStart,
          startAt: lifetimePlan.startAt
        };
      }
    }

    await client.query(
      `INSERT INTO exercise_replacement_events (
         id, user_id, program_id, workout_id, day_index,
         original_exercise_id, original_exercise_title,
         replacement_exercise_id, replacement_exercise_title,
         reason, source, access_status, period_key, device_id, installation_id, meta, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now())`,
      [
        crypto.randomUUID(),
        userId,
        programId || null,
        workoutId || null,
        dayIndex,
        originalExerciseId || null,
        originalExerciseTitle || null,
        replacementExerciseId || null,
        replacementExerciseTitle || null,
        replacementText(payload.reason).slice(0, 120) || null,
        replacementText(payload.source).slice(0, 80) || "client",
        accessStatus,
        periodKey,
        replacementDevice?.deviceId || null,
        replacementDevice?.installationId || null,
        meta
      ]
    );
    return {
      allowed: true,
      used: monthlyUsed === null ? null : monthlyUsed + 1,
      monthlyUsed: monthlyUsed === null ? null : monthlyUsed + 1,
      lifetimeUsed: lifetimeUsage ? lifetimeUsage.used + 1 : null,
      lifetimeScope: lifetimeUsage?.scope || null
    };
  });

  if (!usage.allowed) {
    res.json({
      allowed: false,
      reason: "LIMIT_EXCEEDED",
      used: usage.used,
      limit: usage.limit,
      remaining: 0,
      period: usage.period,
      periodKey: usage.periodKey,
      scope: usage.scope || null,
      daysSinceStart: usage.daysSinceStart ?? null,
      upgradeRequired: true,
      message: EXERCISE_REPLACEMENT_LIMIT_MESSAGE
    });
    return;
  }

  res.json({
    allowed: true,
    used: usage.used ?? usage.lifetimeUsed,
    limit: monthlyLimit ?? lifetimePlan?.limit ?? null,
    remaining: monthlyLimit === null
      ? (lifetimePlan ? Math.max(0, lifetimePlan.limit - Number(usage.lifetimeUsed || 0)) : null)
      : Math.max(0, monthlyLimit - usage.used),
    period: monthlyLimit === null && lifetimePlan ? "lifetime" : "month",
    periodKey,
    lifetime: lifetimePlan ? {
      used: usage.lifetimeUsed,
      limit: lifetimePlan.limit,
      remaining: Math.max(0, lifetimePlan.limit - Number(usage.lifetimeUsed || 0)),
      scope: usage.lifetimeScope,
      daysSinceStart: lifetimePlan.daysSinceStart,
      startAt: lifetimePlan.startAt
    } : null
  });
}

function ensureExerciseReplacementSchema() {
  if (!exerciseReplacementSchemaReady) {
    exerciseReplacementSchemaReady = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS exercise_replacement_events (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL,
          program_id text,
          workout_id text,
          day_index integer,
          original_exercise_id text,
          original_exercise_title text,
          replacement_exercise_id text,
          replacement_exercise_title text,
          reason text,
          source text,
          access_status text,
          period_key text NOT NULL,
          device_id text,
          installation_id text,
          meta jsonb NOT NULL DEFAULT '{}'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await query("ALTER TABLE exercise_replacement_events ADD COLUMN IF NOT EXISTS device_id text");
      await query("ALTER TABLE exercise_replacement_events ADD COLUMN IF NOT EXISTS installation_id text");
      await query("CREATE INDEX IF NOT EXISTS exercise_replacement_events_user_period_idx ON exercise_replacement_events (user_id, period_key)");
      await query("CREATE INDEX IF NOT EXISTS exercise_replacement_events_created_idx ON exercise_replacement_events (created_at)");
      await query("CREATE INDEX IF NOT EXISTS exercise_replacement_events_program_idx ON exercise_replacement_events (program_id)");
      await query("CREATE INDEX IF NOT EXISTS exercise_replacement_events_device_idx ON exercise_replacement_events (device_id) WHERE device_id IS NOT NULL");
      await query("CREATE INDEX IF NOT EXISTS exercise_replacement_events_installation_idx ON exercise_replacement_events (installation_id) WHERE installation_id IS NOT NULL");
    })();
  }
  return exerciseReplacementSchemaReady;
}

async function resolveExerciseReplacementDevice(userId, payload = {}, req = null) {
  const meta = sanitizeObject(payload.meta || {});
  const bodyDevice = devicePayloadFromBody(payload, req);
  const candidate = {
    installationId: bodyDevice.installationId
      || replacementText(payload.installationId || payload.installation_id || meta.installationId || meta.installation_id || req?.headers?.["x-installation-id"]).slice(0, 160)
      || null,
    deviceId: bodyDevice.deviceId
      || replacementText(payload.deviceId || payload.device_id || meta.deviceId || meta.device_id || req?.headers?.["x-device-id"]).slice(0, 160)
      || null,
    platform: bodyDevice.platform
      || replacementText(payload.platform || meta.platform || req?.headers?.["x-client-platform"]).slice(0, 40)
      || null
  };

  if (candidate.installationId || candidate.deviceId) return candidate;

  const result = await query(
    `SELECT installation_id, device_id, platform
     FROM user_devices
     WHERE user_id = $1
     ORDER BY last_seen_at DESC
     LIMIT 1`,
    [userId]
  ).catch(() => ({ rows: [] }));
  const row = result.rows[0];
  if (!row) return { installationId: null, deviceId: null, platform: null };
  return {
    installationId: row.installation_id || null,
    deviceId: row.device_id || null,
    platform: row.platform || null
  };
}

async function replacementLifetimeLimitPlan({ accessStatus, user = {}, access = {}, device = {} }) {
  const overrideLimit = replacementLifetimeLimitOverride(access);
  const role = String(user.role || "").toLowerCase();
  const privileged = ["admin", "trainer", "test"].includes(role) || ["admin", "trainer", "test"].includes(accessStatus);
  if (overrideLimit === null) {
    if (!replacementLifetimeLimitsEnabled()) return null;
    if (privileged) return null;
  }

  const steps = overrideLimit === null ? replacementLifetimeLimitSteps(accessStatus) : [{ days: Number.POSITIVE_INFINITY, limit: overrideLimit }];
  if (!steps.length) return null;

  const startAt = await replacementLifetimeStartAt(user, device);
  const daysSinceStart = replacementDaysSince(startAt);
  const step = steps.find((item) => daysSinceStart <= item.days) || steps[steps.length - 1];
  if (!step || step.limit === null) return null;
  return {
    limit: step.limit,
    daysSinceStart,
    startAt: startAt.toISOString(),
    windowDays: Number.isFinite(step.days) ? step.days : null
  };
}

async function replacementLifetimeStartAt(user = {}, device = {}) {
  const candidates = [toDateOrNull(user.created_at || user.createdAt || user.createdAtIso)];
  const result = await query(
    `SELECT
       (
         SELECT min(first_seen_at)
         FROM user_devices
         WHERE ($2::text IS NOT NULL AND device_id = $2)
            OR ($3::text IS NOT NULL AND installation_id = $3)
       ) AS device_first_seen_at,
       (
         SELECT min(created_at)
         FROM exercise_replacement_events
         WHERE user_id = $1
            OR ($2::text IS NOT NULL AND device_id = $2)
            OR ($3::text IS NOT NULL AND installation_id = $3)
       ) AS replacement_first_seen_at`,
    [user.id, device?.deviceId || null, device?.installationId || null]
  ).catch(() => ({ rows: [] }));
  const row = result.rows[0] || {};
  candidates.push(toDateOrNull(row.device_first_seen_at));
  candidates.push(toDateOrNull(row.replacement_first_seen_at));
  const dates = candidates.filter(Boolean).sort((a, b) => a.getTime() - b.getTime());
  return dates[0] || new Date();
}

async function replacementLifetimeUsage(client, userId, device = {}) {
  const userResult = await client.query(
    "SELECT count(*)::int AS used FROM exercise_replacement_events WHERE user_id = $1",
    [userId]
  );
  const userUsed = Number(userResult.rows[0]?.used || 0);
  let deviceUsed = 0;
  if (device?.deviceId || device?.installationId) {
    const deviceResult = await client.query(
      `SELECT count(DISTINCT id)::int AS used
       FROM exercise_replacement_events
       WHERE ($1::text IS NOT NULL AND device_id = $1)
          OR ($2::text IS NOT NULL AND installation_id = $2)`,
      [device.deviceId || null, device.installationId || null]
    );
    deviceUsed = Number(deviceResult.rows[0]?.used || 0);
  }
  return {
    used: Math.max(userUsed, deviceUsed),
    userUsed,
    deviceUsed,
    scope: deviceUsed > userUsed ? "device" : "user"
  };
}

function replacementLifetimeLimitOverride(access = {}) {
  const meta = access?.meta && typeof access.meta === "object" ? access.meta : {};
  const raw = meta.exerciseReplacementLifetimeLimit
    ?? meta.exercise_replacement_lifetime_limit;
  return normalizeReplacementLimitValue(raw);
}

function replacementLifetimeLimitSteps(accessStatus) {
  const envKey = accessStatus === "vip"
    ? "EXERCISE_REPLACEMENT_VIP_LIFETIME_LIMIT_STEPS"
    : accessStatus === "paid"
      ? "EXERCISE_REPLACEMENT_PAID_LIFETIME_LIMIT_STEPS"
      : "EXERCISE_REPLACEMENT_FREE_LIFETIME_LIMIT_STEPS";
  const parsed = parseReplacementLifetimeSteps(process.env[envKey]);
  if (parsed.length) return parsed;
  return accessStatus === "free" ? EXERCISE_REPLACEMENT_LIFETIME_DEFAULT_STEPS : [];
}

function parseReplacementLifetimeSteps(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return [];
  return String(raw)
    .split(",")
    .map((chunk) => {
      const [daysRaw, limitRaw] = chunk.split(":").map((part) => String(part || "").trim());
      const days = ["*", "inf", "infinity", "forever"].includes(daysRaw.toLowerCase())
        ? Number.POSITIVE_INFINITY
        : Number(daysRaw);
      const limit = Number(limitRaw);
      if (!Number.isFinite(days) && days !== Number.POSITIVE_INFINITY) return null;
      if (!Number.isFinite(limit) || limit < 0) return null;
      return { days: days === Number.POSITIVE_INFINITY ? days : Math.floor(days), limit: Math.floor(limit) };
    })
    .filter(Boolean)
    .sort((a, b) => a.days - b.days);
}

function replacementLifetimeLimitsEnabled() {
  return ["1", "true", "yes", "on"].includes(String(process.env.EXERCISE_REPLACEMENT_LIFETIME_LIMIT_ENABLED || "").toLowerCase());
}

function replacementMonthlyLimit(accessStatus, user = {}, access = {}) {
  const overrideLimit = replacementMonthlyLimitOverride(access);
  if (overrideLimit !== null) return overrideLimit;
  if (!replacementLimitsEnabled()) return null;
  const role = String(user.role || "").toLowerCase();
  if (["admin", "trainer", "test"].includes(role) || ["admin", "trainer", "test"].includes(accessStatus)) return null;
  const envKey = accessStatus === "vip"
    ? "EXERCISE_REPLACEMENT_VIP_MONTHLY_LIMIT"
    : accessStatus === "paid"
      ? "EXERCISE_REPLACEMENT_PAID_MONTHLY_LIMIT"
      : "EXERCISE_REPLACEMENT_FREE_MONTHLY_LIMIT";
  return normalizeReplacementLimitValue(process.env[envKey]);
}

function replacementMonthlyLimitOverride(access = {}) {
  const meta = access?.meta && typeof access.meta === "object" ? access.meta : {};
  const raw = meta.exerciseReplacementMonthlyLimit
    ?? meta.exerciseReplacementLimit
    ?? meta.exercise_replacement_monthly_limit
    ?? meta.exercise_replacement_limit;
  return normalizeReplacementLimitValue(raw);
}

function normalizeReplacementLimitValue(raw) {
  if (raw === undefined || raw === null || raw === "" || String(raw).toLowerCase() === "null") return null;
  const limit = Number(raw);
  return Number.isFinite(limit) && limit >= 0 ? Math.floor(limit) : null;
}

function replacementLimitsEnabled() {
  return ["1", "true", "yes", "on"].includes(String(process.env.EXERCISE_REPLACEMENT_LIMIT_ENABLED || "").toLowerCase());
}

function currentMoscowPeriodKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit"
  }).format(date);
}

function replacementText(value) {
  return String(value || "").trim();
}

function replacementInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.floor(number) : null;
}

function toDateOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function replacementDaysSince(startAt, now = new Date()) {
  const start = toDateOrNull(startAt) || now;
  return Math.max(0, Math.floor((now.getTime() - start.getTime()) / MS_PER_DAY));
}

async function loadTrainingProgramsDocument() {
  const result = await query(
    `SELECT key, data, source_path, updated_at
     FROM catalog_documents
     WHERE key = ANY($1::text[])
     ORDER BY CASE key WHEN $2 THEN 0 ELSE 1 END
     LIMIT 2`,
    [[TRAINING_PROGRAMS_KEY, COURSES_KEY], TRAINING_PROGRAMS_KEY]
  );
  const training = result.rows.find((row) => row.key === TRAINING_PROGRAMS_KEY);
  const courses = result.rows.find((row) => row.key === COURSES_KEY);
  const sourceRow = training || courses || null;
  const programs = programsFromCatalogData(sourceRow?.data);
  return {
    key: sourceRow?.key || TRAINING_PROGRAMS_KEY,
    source: sourceRow?.source_path || sourceRow?.key || null,
    updatedAt: sourceRow?.updated_at || null,
    programs
  };
}

async function saveTrainingPrograms(req, res) {
  const body = req.body || {};
  const programs = Array.isArray(body.programs)
    ? body.programs
    : programsFromCatalogData(body.data || body);
  if (programs.length < 100) {
    res.status(400).json({ error: "Refusing to overwrite full catalog with partial list" });
    return;
  }
  const saved = await persistTrainingPrograms(programs, req);
  res.json(saved);
}

async function saveTrainingProgram(req, res) {
  const programId = String(req.params.programId || "").trim();
  const bodyProgram = req.body?.program || req.body || {};
  const id = String(bodyProgram.id || bodyProgram.courseId || bodyProgram.course_id || programId).trim();
  if (!id) {
    res.status(400).json({ error: "program id is required" });
    return;
  }
  const current = await loadTrainingProgramsDocument();
  const nextProgram = { ...bodyProgram, id };
  const existingIndex = current.programs.findIndex((program) => programMatchesId(program, id));
  const programs = existingIndex >= 0
    ? current.programs.map((program, index) => index === existingIndex ? mergeStoredProgram(program, nextProgram) : program)
    : [markAdminCreatedProgram({ ...nextProgram, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }), ...current.programs];
  const saved = await persistTrainingPrograms(programs, req);
  res.json({ ...saved, program: findProgramByAnyId(saved.programs, id) || nextProgram });
}

async function deleteTrainingProgram(req, res) {
  const programId = String(req.params.programId || "").trim();
  if (!programId) {
    res.status(400).json({ error: "program id is required" });
    return;
  }
  const current = await loadTrainingProgramsDocument();
  const existingIndex = current.programs.findIndex((program) => programMatchesId(program, programId));
  if (existingIndex < 0) {
    res.status(404).json({ error: "program not found" });
    return;
  }
  const program = current.programs[existingIndex];
  if (!isAdminCreatedTrainingProgram(program)) {
    res.status(403).json({ error: "Refusing to delete base training program" });
    return;
  }
  const programs = current.programs.filter((_, index) => index !== existingIndex);
  const saved = await persistTrainingPrograms(programs, req);
  res.json({ ...saved, deleted: { id: programId } });
}

function mergeStoredProgram(existingProgram = {}, nextProgram = {}) {
  const merged = { ...existingProgram, ...nextProgram, updated_at: new Date().toISOString() };
  if (isAdminCreatedTrainingProgram(existingProgram) || isAdminCreatedTrainingProgram(nextProgram)) {
    return markAdminCreatedProgram(merged);
  }
  delete merged.custom;
  delete merged.isCustom;
  delete merged.adminCreated;
  delete merged.admin_created;
  return merged;
}

function markAdminCreatedProgram(program = {}) {
  return {
    ...program,
    custom: true,
    isCustom: true,
    adminCreated: true,
    admin_created: true,
    source: program.source || "admin-ui"
  };
}

function isAdminCreatedTrainingProgram(program = {}) {
  const id = String(program.id || program.courseId || program.course_id || "");
  const source = String(program.source || program.createdBy || program.importedFrom || "").toLowerCase();
  return program.custom === true
    || program.isCustom === true
    || program.adminCreated === true
    || program.admin_created === true
    || source.includes("admin-ui")
    || (id.startsWith("custom_program_") && source.includes("admin"));
}

async function persistTrainingPrograms(programs, req) {
  const safePrograms = Array.isArray(programs) ? programs.map(normalizeStoredProgram).filter((program) => program.id) : [];
  const document = {
    total: safePrograms.length,
    programs: safePrograms,
    updatedAt: new Date().toISOString(),
    updatedBy: req.user?.id || (req.headers["x-admin-token"] ? "admin-token" : "admin-ui")
  };
  await query(
    `INSERT INTO catalog_documents (key, data, source_path, imported_at, updated_at)
     VALUES ($1, $2, $3, now(), now())
     ON CONFLICT (key)
     DO UPDATE SET data = EXCLUDED.data,
                   source_path = EXCLUDED.source_path,
                   updated_at = now()`,
    [TRAINING_PROGRAMS_KEY, JSON.stringify(document), "admin-ui"]
  );
  const courseRecords = safePrograms.map(programToCourseRecord);
  await query(
    `INSERT INTO catalog_documents (key, data, source_path, imported_at, updated_at)
     VALUES ($1, $2, $3, now(), now())
     ON CONFLICT (key)
     DO UPDATE SET data = EXCLUDED.data,
                   source_path = EXCLUDED.source_path,
                   updated_at = now()`,
    [COURSES_KEY, JSON.stringify(courseRecords), "admin-ui/training-programs"]
  );
  return { updatedAt: document.updatedAt, source: "admin-ui", programs: safePrograms };
}

function programsFromCatalogData(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.programs)) return data.programs;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function normalizeStoredProgram(program = {}) {
  const canonical = canonicalizeTrainingProgram(program);
  const id = String(canonical.id || canonical.program_id || "").trim();
  return {
    ...canonical,
    id,
    courseId: String(canonical.courseId || canonical.course_id || canonical.sourceCourseId || canonical.program_id || id),
    course_id: String(canonical.course_id || canonical.courseId || canonical.sourceCourseId || canonical.program_id || id),
    updated_at: program.updated_at || program.updatedAt || new Date().toISOString()
  };
}

function programToCourseRecord(program = {}) {
  return programToCanonicalCourseRecord(program);
}

async function updateProgramAssignment(req, res) {
  const userId = String(req.params.userId);
  const user = await query("SELECT id FROM users WHERE id = $1", [userId]);
  if (!user.rowCount) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const programId = String(req.body?.programId || req.body?.program_id || "").trim();
  if (!programId) {
    res.status(400).json({ error: "programId is required" });
    return;
  }
  const title = String(req.body?.programTitle || req.body?.program_title || "").trim() || await programTitleById(programId);
  const source = String(req.body?.source || "admin").slice(0, 80);
  const meta = sanitizeObject(req.body?.meta || {});
  const assignedBy = req.user?.id || (req.headers["x-admin-token"] ? "admin" : null);

  const result = await query(
    `INSERT INTO user_program_assignments (user_id, program_id, program_title, assigned_by, source, meta, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (user_id)
     DO UPDATE SET program_id = EXCLUDED.program_id,
                   program_title = EXCLUDED.program_title,
                   assigned_by = EXCLUDED.assigned_by,
                   source = EXCLUDED.source,
                   meta = EXCLUDED.meta,
                   updated_at = now()
     RETURNING *`,
    [userId, programId, title || null, assignedBy, source, meta]
  );
  res.json({ assignment: serializeProgramAssignment(result.rows[0]) });
}

async function saveAdminUserProfile(req, res) {
  const userId = String(req.params.userId || "").trim();
  if (!userId) {
    res.status(400).json({ error: "user id is required" });
    return;
  }

  const userResult = await query(
    `SELECT id, email, name, username, role
     FROM users
     WHERE id = $1
       AND deleted_at IS NULL
       AND lower(COALESCE(role, '')) <> 'deleted'`,
    [userId]
  );
  if (!userResult.rowCount) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const currentProfile = await loadUserProfile(userId);
  const body = sanitizeObject(req.body || {});
  const bodyProfile = body.profile && typeof body.profile === "object" ? body.profile : {};
  const nextProfile = normalizeProfileNutritionAssignment({
    ...currentProfile,
    ...bodyProfile,
    ...(body.contacts ? { contacts: body.contacts } : {}),
    ...(body.questionnaire ? { questionnaire: body.questionnaire } : {})
  });
  const result = await query(
    `INSERT INTO user_profiles (user_id, profile, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id)
     DO UPDATE SET profile = EXCLUDED.profile, updated_at = now()
     RETURNING profile, updated_at`,
    [userId, nextProfile]
  );

  const nameParts = normalizeProfileName(nextProfile);
  const telegram = String(nextProfile.telegram || nextProfile.username || nextProfile.contacts?.telegram || nextProfile.contacts?.username || "").trim();
  await query(
    `UPDATE users
     SET name = COALESCE(NULLIF($2, ''), name),
         username = COALESCE(NULLIF($3, ''), username),
         updated_at = now()
     WHERE id = $1`,
    [userId, nameParts.fullName || "", telegram]
  );

  res.json({
    profile: result.rows[0].profile,
    updatedAt: result.rows[0].updated_at
  });
}

async function updateUserAccess(req, res) {
  const userId = String(req.params.userId);
  const user = await query("SELECT * FROM users WHERE id = $1", [userId]);
  if (!user.rowCount) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const status = normalizeAccessStatus(req.body?.status);
  const startsAt = parseDate(req.body?.startsAt || req.body?.starts_at);
  const expiresAt = parseDate(req.body?.expiresAt || req.body?.expires_at || req.body?.premiumUntil);
  const isVip = status === "vip" || Boolean(req.body?.isVip || req.body?.is_vip);
  const isActive = req.body?.isActive ?? req.body?.is_active;
  const source = String(req.body?.source || "admin");
  const meta = sanitizeObject(req.body?.meta || {});
  const access = await query(
    `INSERT INTO user_access (user_id, status, plan, premium_until, is_vip, source, meta, starts_at, expires_at, is_active, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     ON CONFLICT (user_id)
     DO UPDATE SET status = EXCLUDED.status,
                   plan = EXCLUDED.plan,
                   premium_until = EXCLUDED.premium_until,
                   is_vip = EXCLUDED.is_vip,
                   source = EXCLUDED.source,
                   meta = EXCLUDED.meta,
                   starts_at = EXCLUDED.starts_at,
                   expires_at = EXCLUDED.expires_at,
                   is_active = EXCLUDED.is_active,
                   updated_at = now()
     RETURNING *`,
    [
      userId,
      status,
      req.body?.plan || status,
      expiresAt,
      isVip,
      source,
      meta,
      startsAt,
      expiresAt,
      isActive === false ? false : true
    ]
  );

  const nextRole = status === "admin" ? "admin" : status === "trainer" ? "trainer" : "user";
  const updatedUser = await query("UPDATE users SET role = $2, updated_at = now() WHERE id = $1 RETURNING *", [userId, nextRole]);
  const serializedAccess = serializeAccess(access.rows[0], updatedUser.rows[0]);
  let programReassignment = { status: "skipped", reason: "not_required" };
  try {
    programReassignment = await maybeAssignProgramAfterAdminAccessGrant({
      user: updatedUser.rows[0],
      access: serializedAccess
    });
  } catch (error) {
    console.warn("[admin] program auto-assignment after access grant failed", {
      userId,
      status,
      error: error?.message || error
    });
    programReassignment = { status: "failed", reason: "auto_assignment_failed", error: error?.message || String(error) };
  }
  res.json({ access: serializedAccess, user: updatedUser.rows[0], programReassignment });
}

async function maybeAssignProgramAfterAdminAccessGrant({ user = {}, access = {} } = {}) {
  const userId = String(user.id || "").trim();
  if (!userId || !shouldAutoAssignProgramForAdminAccess(access)) {
    return { status: "skipped", reason: "access_not_paid_like" };
  }

  const existing = await query(
    "SELECT program_id, program_title FROM user_program_assignments WHERE user_id = $1 LIMIT 1",
    [userId]
  );
  if (existing.rowCount) {
    return {
      status: "skipped",
      reason: "assignment_exists",
      programId: existing.rows[0].program_id || null,
      programTitle: existing.rows[0].program_title || null
    };
  }

  const profile = await loadUserProfile(userId);
  return transaction((client) => reassignProgramFromProfile(client, {
    user,
    profile,
    access,
    mode: "admin_access_grant"
  }));
}

function shouldAutoAssignProgramForAdminAccess(access = {}) {
  const status = String(access.status || "").toLowerCase();
  return Boolean(access.isActive && access.isPaid && ["paid", "vip", "test"].includes(status));
}

function normalizeAccessStatus(value) {
  const status = String(value || "free").toLowerCase();
  return ACCESS_STATUSES.has(status) ? status : "free";
}

function parseAnalyticsRange(queryParams = {}) {
  const now = new Date();
  const fallbackTo = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const fallbackFrom = new Date(fallbackTo);
  fallbackFrom.setDate(fallbackFrom.getDate() - 29);
  fallbackFrom.setHours(0, 0, 0, 0);
  const from = parseDate(queryParams.from) || fallbackFrom;
  const to = parseDate(queryParams.to) || fallbackTo;
  const start = from <= to ? from : to;
  const end = from <= to ? to : from;
  const toExclusive = new Date(end);
  toExclusive.setDate(toExclusive.getDate() + 1);
  toExclusive.setHours(0, 0, 0, 0);
  return { from: start, to: end, toExclusive };
}

function inRange(value, range) {
  const date = parseDate(value);
  return Boolean(date && date >= range.from && date < range.toExclusive);
}

async function loadRealPaymentFunnel(range) {
  const users = await query("SELECT id, created_at FROM users");
  const assignments = await query(
    `SELECT user_id, created_at, updated_at
     FROM user_program_assignments
     WHERE COALESCE(updated_at, created_at) >= $1
       AND COALESCE(updated_at, created_at) < $2`,
    [range.from, range.toExclusive]
  );
  const paid = await query(
    `SELECT user_id, product_code
     FROM payments
     WHERE COALESCE(paid_at, created_at, updated_at) >= $1
       AND COALESCE(paid_at, created_at, updated_at) < $2
       AND lower(status) = ANY($3::text[])`,
    [range.from, range.toExclusive, ["paid", "succeeded", "success", "completed", "captured"]]
  );
  const registered = users.rows.filter((row) => inRange(row.created_at, range)).length;
  const assignedUsers = new Set(assignments.rows.map((row) => row.user_id).filter(Boolean));
  const programPaidUsers = new Set();
  const vipPaidUsers = new Set();
  for (const row of paid.rows) {
    const product = String(row.product_code || "").toLowerCase();
    if (product.includes("vip")) vipPaidUsers.add(row.user_id || `payment:${vipPaidUsers.size}`);
    if (!product.includes("vip")) programPaidUsers.add(row.user_id || `payment:${programPaidUsers.size}`);
  }
  return {
    leads: registered,
    registered,
    programGenerated: assignedUsers.size,
    programPaid: programPaidUsers.size,
    vipPaid: vipPaidUsers.size
  };
}

function serializeAdminPaymentRecord(row = {}) {
  const kind = paymentKind(row.status || row.session_status);
  const eventAt = row.paid_at || row.created_at || row.updated_at || row.session_paid_at || row.session_created_at;
  return {
    id: row.id,
    userId: row.user_id || null,
    client: row.name || row.username || row.email || row.user_id || "Клиент",
    product: paymentProductTitle(row.product_code),
    productCode: row.product_code || null,
    amount: Number(row.amount || 0),
    currency: row.currency || "RUB",
    date: toIso(eventAt),
    paidAt: toIso(row.paid_at || row.session_paid_at),
    createdAt: toIso(row.created_at || row.session_created_at),
    status: paymentStatusLabel(kind, row.status || row.session_status),
    rawStatus: row.status || row.session_status || null,
    kind,
    assignmentStatus: row.assignment_status || null,
    newClient: inRange(row.user_created_at, { from: new Date(new Date(eventAt || Date.now()).setHours(0, 0, 0, 0)), toExclusive: new Date(new Date(eventAt || Date.now()).setHours(24, 0, 0, 0)) })
  };
}

function paymentKind(status) {
  const value = String(status || "").toLowerCase();
  if (["refund", "refunded", "chargeback"].includes(value)) return "refund";
  if (["failed", "error", "cancelled", "canceled", "expired"].includes(value)) return "error";
  return ["paid", "succeeded", "success", "completed", "captured"].includes(value) ? "paid" : "pending";
}

function paymentProductTitle(productCode) {
  const value = String(productCode || "").toLowerCase();
  if (value.includes("vip")) return "VIP";
  if (value.includes("program") || value.includes("training")) return "Программа";
  return productCode || "Оплата";
}

function paymentStatusLabel(kind, status) {
  if (kind === "paid") return "Оплачено";
  if (kind === "refund") return "Возврат";
  if (kind === "error") return "Ошибка";
  return status || "В ожидании";
}

async function persistAdminMediaUpload(body = {}) {
  const kind = String(body.kind || "media").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 40) || "media";
  const dataUrl = String(body.dataUrl || body.data_url || body.fileDataUrl || body.file || "").trim();
  const originalName = String(body.fileName || body.filename || `${kind}-${Date.now()}`).trim();
  const match = dataUrl.match(/^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/);
  if (!match) {
    throw new Error("dataUrl upload body is required");
  }
  const mime = match[1].toLowerCase();
  const extension = extensionFromMime(mime) || safeExtension(originalName) || "bin";
  const safeName = `${Date.now()}-${crypto.randomUUID()}.${extension}`;
  const targetDir = path.resolve(MEDIA_UPLOAD_DIR, kind);
  const targetPath = path.resolve(targetDir, safeName);
  const rootPath = path.resolve(MEDIA_UPLOAD_DIR);
  if (!targetPath.startsWith(`${rootPath}${path.sep}`)) {
    throw new Error("Invalid upload path");
  }
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > 40 * 1024 * 1024) {
    throw new Error("Invalid upload size");
  }
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(targetPath, buffer, { mode: 0o644 });
  const url = `${MEDIA_UPLOAD_PUBLIC_BASE_URL}/${kind}/${safeName}`;
  return { url, storageKey: `${kind}/${safeName}`, contentType: mime, size: buffer.length };
}

function extensionFromMime(mime) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "video/mp4") return "mp4";
  return "";
}

function safeExtension(fileName) {
  const extension = String(fileName || "").split(".").pop()?.toLowerCase() || "";
  return /^[a-z0-9]{2,6}$/.test(extension) ? extension : "";
}

function normalizeMuscleMapOverride(input = {}) {
  const url = String(input.url || input.muscleMapUrl || input.muscle_map_url || input.muscle_map_asset_path || "").trim();
  const label = String(input.label || input.muscleMapLabel || input.muscle_map_label || "").trim();
  const key = String(input.key || input.muscleMapKey || input.muscle_map_key || label || url || "").trim();
  return {
    muscle_map_asset_path: url,
    muscleMapAssetPath: url,
    muscle_map_label: label || key,
    muscleMapLabel: label || key,
    muscle_map_key: key,
    muscleMapKey: key,
    muscle_map_status: "manual_path",
    muscle_map_match_source: "admin-api",
    muscle_map_reason: "manual muscle map override from admin",
    updated_at: new Date().toISOString(),
    manual_override: true
  };
}

function normalizeMuscleMapIdentity(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeNameIdentity(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeStringList(value) {
  const items = Array.isArray(value) ? value : [value];
  return [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))];
}

function normalizeNameList(value) {
  return [...new Set(normalizeStringList(value).map(normalizeNameIdentity).filter(Boolean))];
}

function exerciseMatchesId(exercise = {}, id) {
  const wanted = String(id);
  return [
    exercise.id,
    exercise.source_id,
    exercise.sourceId,
    exercise.source_row,
    exercise.exercise_id
  ].some((value) => String(value || "") === wanted);
}

function exerciseDocumentItems(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.exercises)) return data.exercises;
  return [];
}

async function loadAdminExerciseCatalogDocument() {
  for (const key of EXERCISE_CATALOG_KEYS) {
    const result = await query("SELECT data, updated_at FROM catalog_documents WHERE key = $1", [key]);
    if (!result.rowCount) continue;
    const exercises = exerciseDocumentItems(result.rows[0].data);
    if (!exercises.length) continue;
    return {
      source: key,
      updatedAt: result.rows[0].updated_at,
      total: exercises.length,
      exercises
    };
  }
  return { source: "catalog_documents", updatedAt: null, total: 0, exercises: [] };
}

async function updateExerciseDocuments(mutator) {
  let totalUpdated = 0;
  for (const key of EXERCISE_CATALOG_KEYS) {
    const result = await query("SELECT data FROM catalog_documents WHERE key = $1", [key]);
    if (!result.rowCount) continue;
    const data = result.rows[0].data;
    const items = exerciseDocumentItems(data);
    if (!items.length) continue;
    let changed = 0;
    const nextItems = items.map((item) => {
      const next = mutator(item, key);
      if (next !== item) changed += 1;
      return next;
    });
    if (!changed) continue;
    const nextData = Array.isArray(data)
      ? nextItems
      : { ...data, items: Array.isArray(data?.items) ? nextItems : data.items, exercises: Array.isArray(data?.exercises) ? nextItems : data.exercises };
    await query(
      `UPDATE catalog_documents
       SET data = $2, updated_at = now()
       WHERE key = $1`,
      [key, JSON.stringify(nextData)]
    );
    totalUpdated += changed;
  }
  return totalUpdated;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function deleteUserRows(client, tableName, userId) {
  const safeTables = new Set([
    "auth_identities",
    "user_credentials",
    "user_devices",
    "user_profiles",
    "user_access",
    "measurements",
    "user_program_progress",
    "user_program_assignments",
    "progress_photos",
    "vip_reports",
    "push_tokens",
    "ai_user_memory",
    "ai_coach_daily_usage"
  ]);
  if (!safeTables.has(tableName)) throw new Error(`Unsafe account deletion table: ${tableName}`);
  try {
    const result = await client.query(`DELETE FROM ${tableName} WHERE user_id = $1`, [userId]);
    return result.rowCount || 0;
  } catch (error) {
    if (error?.code === "42P01") return 0;
    throw error;
  }
}

async function deleteProgressPhotoFiles(rows = []) {
  const baseDir = path.resolve(PROGRESS_PHOTOS_DIR);
  await Promise.allSettled(rows.map(async (row) => {
    const key = String(row?.storage_key || "").trim();
    if (!key || key.includes("..") || path.isAbsolute(key)) return;
    const filePath = path.resolve(baseDir, key);
    if (!filePath.startsWith(baseDir + path.sep)) return;
    await fs.unlink(filePath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }));
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function accessIsActive(row, status) {
  if (row?.is_active === false) return false;
  const now = Date.now();
  const startsAt = row?.starts_at ? new Date(row.starts_at).getTime() : null;
  const expiresAt = row?.expires_at || row?.premium_until ? new Date(row.expires_at || row.premium_until).getTime() : null;
  if (startsAt && startsAt > now) return false;
  if (expiresAt && expiresAt <= now) return false;
  return Boolean(status);
}

function serializeAccess(row, user = {}) {
  const status = normalizeAccessStatus(row?.status || (["admin", "trainer", "test"].includes(user.role) ? user.role : "free"));
  const isActive = accessIsActive(row, status);
  const paidLike = ["paid", "vip", "admin", "trainer", "test"].includes(status);
  return {
    userId: row?.user_id || user.id,
    status,
    role: user.role || "user",
    plan: row?.plan || status,
    startsAt: toIso(row?.starts_at),
    expiresAt: toIso(row?.expires_at || row?.premium_until),
    premiumUntil: toIso(row?.premium_until || row?.expires_at),
    isVip: Boolean(row?.is_vip || status === "vip"),
    isActive,
    isPaid: isActive && paidLike,
    isAdmin: isActive && (status === "admin" || user.role === "admin"),
    isTrainer: isActive && (status === "trainer" || user.role === "trainer"),
    isTest: isActive && (status === "test" || user.role === "test"),
    source: row?.source || "default",
    meta: row?.meta || {},
    features: {
      premium: isActive && paidLike,
      vip: isActive && (status === "vip" || Boolean(row?.is_vip)),
      admin: isActive && (status === "admin" || user.role === "admin"),
      trainer: isActive && (status === "trainer" || user.role === "trainer"),
      test: isActive && (status === "test" || user.role === "test")
    }
  };
}

function adminTestPromoPayload(user = {}) {
  if (!isPrivilegedTestUser(user) || !isAdminTestPromoActive()) return {};
  return {
    myPromoCode: adminTestPromoCode(),
    isTestPromoActive: true,
    testPromoExpiresAt: adminTestPromoExpiresAt()?.toISOString() || null
  };
}

function isPrivilegedTestUser(user = {}) {
  return ["admin", "trainer", "test"].includes(String(user.role || "").toLowerCase());
}

function adminTestPromoCode() {
  return String(config.adminTestPromoCode || ADMIN_TEST_PROMO_CODE).trim().toUpperCase() || ADMIN_TEST_PROMO_CODE;
}

function adminTestPromoExpiresAt() {
  const raw = String(config.adminTestPromoExpiresAt || "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : null;
}

function isAdminTestPromoActive(now = Date.now()) {
  const expiresAt = adminTestPromoExpiresAt();
  return Boolean(expiresAt && expiresAt.getTime() > now);
}

function serializeAdminUser(row) {
  const identities = Array.isArray(row.identities) ? row.identities : [];
  const latestReport = row.latest_report ? serializeVipReport(row.latest_report) : null;
  const progressPhotos = Array.isArray(row.progress_photos) ? row.progress_photos.map(serializeProgressPhoto) : [];
  const access = serializeAccess({
    user_id: row.id,
    status: row.status,
    plan: row.plan,
    premium_until: row.premium_until,
    is_vip: row.is_vip,
    source: row.source,
    meta: row.meta,
    starts_at: row.starts_at,
    expires_at: row.expires_at,
    is_active: row.is_active
  }, row);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    username: row.username,
    photoUrl: row.photo_url,
    role: row.role,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    providerLogin: providerLogin(identities),
    profile: row.user_profile || {},
    paymentStats: row.payment_stats || {},
    latestReport,
    report: latestReport?.report || null,
    progressPhotos,
    programAssignment: serializeProgramAssignment(row),
    identities,
    access
  };
}

function serializeProgressPhoto(photo = {}) {
  return {
    id: photo.id,
    takenAt: toIso(photo.taken_at || photo.takenAt),
    storageKey: photo.storage_key || photo.storageKey || null,
    publicUrl: photo.public_url || photo.publicUrl || null,
    meta: photo.meta || {},
    createdAt: toIso(photo.created_at || photo.createdAt)
  };
}

async function loadEffectiveAccess(user = {}) {
  const result = await query("SELECT * FROM user_access WHERE user_id = $1", [user.id]);
  return serializeAccess(result.rows[0], user);
}

async function hasVipFeatureAccess(user = {}) {
  const access = await loadEffectiveAccess(user);
  const status = String(access?.status || "").toLowerCase();
  const role = String(access?.role || user?.role || "").toLowerCase();
  return Boolean(
    access?.isActive &&
    (
      access?.isVip ||
      access?.isAdmin ||
      access?.isTrainer ||
      status === "vip" ||
      status === "admin" ||
      status === "trainer" ||
      status === "test" ||
      role === "admin" ||
      role === "trainer" ||
      role === "test"
    )
  );
}

async function loadUserProfile(userId) {
  const result = await query("SELECT profile FROM user_profiles WHERE user_id = $1", [userId]);
  return result.rows[0]?.profile || {};
}

export function immediateProfileReassignmentMode(user = {}, access = {}) {
  const role = String(user.role || access.role || "").toLowerCase();
  const status = String(access.status || "").toLowerCase();
  if (["admin", "trainer", "test"].includes(role) || access.isAdmin || access.isTrainer || access.isTest || status === "admin" || status === "trainer" || status === "test") {
    return "privileged";
  }
  if (status === "free" || access.isActive === false || !access.isPaid) {
    return "free_preview";
  }
  return null;
}

export async function reassignProgramFromProfile(client, { user = {}, profile = {}, access = {}, mode = null } = {}) {
  const userId = String(user.id || "").trim();
  const reassignmentMode = mode || immediateProfileReassignmentMode(user, access);
  if (!userId || !reassignmentMode) {
    return { status: "skipped", reason: "not_reassignable" };
  }

  const questionnaire = questionnaireFromProfile(profile);
  const plan = await selectSubscriptionProgramPlan(client, {
    questionnaire,
    cycleNumber: 1,
    previousCycle: null,
    accessFrom: new Date()
  });

  if (!plan?.programId) {
    return {
      status: "pending_manual",
      reason: "no_matching_program",
      mode: reassignmentMode,
      criteria: plan?.criteria || null,
      deliveryMode: plan?.deliveryMode || "manual_review"
    };
  }

  const source = reassignmentMode === "free_preview"
    ? "profile/free_preview_reassignment"
    : reassignmentMode === "admin_access_grant"
      ? "admin/access_grant_assignment"
      : "profile/privileged_reassignment";
  const assignedAt = new Date();
  const deliveryMode = plan.deliveryMode || "first_half";
  const meta = {
    source,
    reassignmentMode,
    reassignedAt: assignedAt.toISOString(),
    deliveryMode,
    profileUpdateTriggered: reassignmentMode !== "admin_access_grant",
    adminAccessGrantTriggered: reassignmentMode === "admin_access_grant",
    criteria: plan.criteria || {},
    questionnaireSnapshot: questionnaire,
    matchedBy: plan.matchedBy || [],
    matchScore: plan.matchScore || 0,
    baseProgramId: plan.baseProgramId || plan.programId,
    baseProgramTitle: plan.baseProgramTitle || plan.programTitle || null,
    baseProgramKey: plan.baseProgramKey || plan.meta?.courseMeta?.baseProgramKey || null,
    restrictionKey: plan.restrictionKey || questionnaire.restrictionKey || null,
    canonicalProgramId: plan.programId,
    programAssignmentStatus: "assigned",
    courseMeta: plan.meta?.courseMeta || null
  };

  const assignmentResult = await client.query(
    `INSERT INTO user_program_assignments (user_id, program_id, program_title, assigned_by, source, meta, assigned_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (user_id)
     DO UPDATE SET program_id = EXCLUDED.program_id,
                   program_title = EXCLUDED.program_title,
                   assigned_by = EXCLUDED.assigned_by,
                   source = EXCLUDED.source,
                   meta = EXCLUDED.meta,
                   assigned_at = EXCLUDED.assigned_at,
                   updated_at = now()
     RETURNING *`,
    [userId, plan.programId, plan.programTitle || null, userId, source, meta, assignedAt]
  );

  const cycle = reassignmentMode === "privileged"
    ? await updateActiveCycleForProfileReassignment(client, { userId, plan, questionnaire, meta, assignedAt })
    : null;

  await client.query(
    `UPDATE user_access
     SET meta = COALESCE(meta, '{}'::jsonb) || $2::jsonb,
         updated_at = now()
     WHERE user_id = $1`,
    [userId, {
      programAssignmentStatus: "assigned",
      profileReassignmentMode: reassignmentMode,
      profileReassignmentUpdatedAt: assignedAt.toISOString(),
      assignedProgram: {
        source,
        programId: plan.programId,
        programTitle: plan.programTitle || null,
        matchScore: plan.matchScore || 0,
        matchedBy: plan.matchedBy || []
      }
    }]
  ).catch(() => ({ rowCount: 0 }));

  return {
    status: "assigned",
    mode: reassignmentMode,
    programId: assignmentResult.rows[0]?.program_id || plan.programId,
    programTitle: assignmentResult.rows[0]?.program_title || plan.programTitle || null,
    deliveryMode,
    matchedBy: plan.matchedBy || [],
    matchScore: plan.matchScore || 0,
    criteria: plan.criteria || {},
    updatedCycleId: cycle?.id ? String(cycle.id) : null
  };
}

function questionnaireFromProfile(profile = {}) {
  const cleanProfile = sanitizeObject(profile);
  const profileSnapshot = {
    firstName: cleanProfile.firstName || cleanProfile.first_name || null,
    lastName: cleanProfile.lastName || cleanProfile.last_name || null,
    gender: cleanProfile.gender || cleanProfile.sex || null,
    height: cleanProfile.height || cleanProfile.heightCm || cleanProfile.height_cm || null,
    weight: cleanProfile.weight || cleanProfile.weightKg || cleanProfile.weight_kg || null,
    age: cleanProfile.age || null,
    goal: cleanProfile.goal || cleanProfile.trainingGoal || cleanProfile.training_goal || null,
    dietType: cleanProfile.dietType || cleanProfile.diet_type || null,
    restrictions: cleanProfile.restrictions || cleanProfile.limitations || null
  };
  const programParams = {
    experience: cleanProfile.experience || cleanProfile.level || null,
    trainingFrequency: cleanProfile.trainingFrequency || cleanProfile.training_frequency || cleanProfile.frequency || null,
    recommendedCaloriesTarget: cleanProfile.recommendedCaloriesTarget || cleanProfile.recommended_calories_target || null,
    calculatedCalories: cleanProfile.calculatedCalories || cleanProfile.calculated_calories || null
  };
  return normalizeSubscriptionQuestionnaire({
    ...profileSnapshot,
    ...programParams,
    profileSnapshot,
    programParams
  });
}

async function updateActiveCycleForProfileReassignment(client, { userId, plan, questionnaire, meta, assignedAt }) {
  const current = await client.query(
    `SELECT spc.*
     FROM subscription_program_cycles spc
     JOIN subscriptions s ON s.id = spc.subscription_id
     WHERE spc.user_id = $1
       AND lower(COALESCE(s.status, '')) IN ('active', 'cancel_requested')
       AND COALESCE(spc.access_until, s.paid_until, now() + interval '1 day') > now()
     ORDER BY spc.access_from DESC NULLS LAST, spc.cycle_number DESC, spc.created_at DESC
     LIMIT 1
     FOR UPDATE`,
    [userId]
  ).catch(() => ({ rows: [] }));
  const cycle = current.rows[0];
  if (!cycle) return null;

  const result = await client.query(
    `UPDATE subscription_program_cycles
     SET questionnaire_snapshot = $2,
         program_id = $3,
         program_title = $4,
         base_program_key = $5,
         restriction_key = $6,
         delivery_mode = $7,
         meta = COALESCE(meta, '{}'::jsonb) || $8::jsonb
     WHERE id = $1
     RETURNING *`,
    [
      cycle.id,
      questionnaire,
      plan.programId,
      plan.programTitle || null,
      plan.baseProgramKey || plan.meta?.courseMeta?.baseProgramKey || null,
      plan.restrictionKey || questionnaire.restrictionKey || null,
      plan.deliveryMode || "first_half",
      {
        ...meta,
        reassignedCycleAt: assignedAt.toISOString(),
        previousProgramId: cycle.program_id || null,
        previousProgramTitle: cycle.program_title || null,
        profileReassignmentCycleUpdate: true
      }
    ]
  );
  return result.rows[0] || null;
}

async function loadProgramAssignment(userId, user = null) {
  const result = await query("SELECT * FROM user_program_assignments WHERE user_id = $1", [userId]);
  const assignment = serializeProgramAssignment(result.rows[0]);
  if (!assignment || !user) return assignment;

  const access = await loadEffectiveAccess(user);
  const subscriptionCycle = await loadActiveSubscriptionProgramCycle(userId, assignment.programId);
  const deliveryMode = resolveProgramDeliveryMode({ access, assignment, subscriptionCycle });
  const program = await loadAssignedProgram(assignment.programId);
  return {
    ...assignment,
    ...(program ? buildProgramAccessPayload(program, access, { deliveryMode, subscriptionCycle, assignment }) : {
      program: null,
      availableWorkouts: [],
      hiddenWorkoutsCount: 0,
      currentWorkout: emptyProgramCurrentWorkout(),
      accessRules: buildProgramAccessRules(access, 0, 0, { deliveryMode })
    })
  };
}

async function loadActiveSubscriptionProgramCycle(userId, programId) {
  const id = String(programId || "").trim();
  const result = await query(
    `SELECT spc.*
     FROM subscription_program_cycles spc
     JOIN subscriptions s ON s.id = spc.subscription_id
     WHERE spc.user_id = $1
       AND (
         $2 = ''
         OR spc.program_id = $2
         OR spc.meta->>'baseProgramId' = $2
         OR spc.meta->>'base_program_id' = $2
         OR s.meta->>'baseProgramId' = $2
         OR s.meta->>'base_program_id' = $2
       )
       AND lower(COALESCE(s.status, '')) IN ('active', 'cancel_requested', 'cancelled')
       AND COALESCE(spc.access_until, s.paid_until, now() + interval '1 day') > now()
     ORDER BY spc.cycle_number DESC, spc.created_at DESC
     LIMIT 1`,
    [userId, id]
  ).catch(() => ({ rows: [] }));
  return result.rows[0] || null;
}

async function loadAssignedProgram(programId) {
  const id = String(programId || "").trim();
  if (!id) return null;
  const document = await loadTrainingProgramsDocument();
  const program = findProgramByAnyId(document.programs, id);
  return hydrateProgramWithLessons(program);
}

function buildProgramAccessPayload(program = {}, access = {}, options = {}) {
  const normalizedProgram = sanitizeObject(program);
  const workouts = programWorkouts(normalizedProgram);
  const mediaHydratedWorkouts = workouts.map(hydrateProgramWorkoutMedia);
  const mediaHydratedProgram = {
    ...normalizedProgram,
    days: Array.isArray(normalizedProgram.days) ? mediaHydratedWorkouts : normalizedProgram.days,
    workouts: Array.isArray(normalizedProgram.workouts) ? mediaHydratedWorkouts : normalizedProgram.workouts,
    lessons: Array.isArray(normalizedProgram.lessons) ? mediaHydratedWorkouts : normalizedProgram.lessons
  };
  const total = workouts.length;
  const deliveryMode = normalizeProgramDeliveryMode(options.deliveryMode);
  const blockIndex = programBlockIndex(deliveryMode);
  const visibleRange = visibleWorkoutRange(normalizedProgram, access, total, { deliveryMode });
  const visibleWorkouts = mediaHydratedWorkouts.slice(visibleRange.start, visibleRange.end);
  const currentWorkout = buildProgramCurrentWorkout(mediaHydratedProgram, access, {
    assignment: options.assignment,
    subscriptionCycle: options.subscriptionCycle,
    deliveryMode,
    visibleRange,
    now: options.now
  });
  const programForClient = {
    ...mediaHydratedProgram,
    days: Array.isArray(mediaHydratedProgram.days) ? visibleWorkouts : mediaHydratedProgram.days,
    workouts: Array.isArray(mediaHydratedProgram.workouts) ? visibleWorkouts : mediaHydratedProgram.workouts,
    lessons: Array.isArray(mediaHydratedProgram.lessons) ? visibleWorkouts : mediaHydratedProgram.lessons
  };
  return {
    program: programForClient,
    availableWorkouts: visibleWorkouts,
    hiddenWorkoutsCount: Math.max(0, total - visibleWorkouts.length),
    currentWorkout,
    accessRules: buildProgramAccessRules(access, total, visibleWorkouts.length, {
      deliveryMode,
      blockIndex,
      visibleWorkoutLimit: visibleRange.limit
    })
  };
}

function hydrateProgramWorkoutMedia(workout = {}) {
  if (!workout || typeof workout !== "object") return workout;
  let changed = false;
  const next = { ...workout };
  for (const key of ["exercises", "items", "exerciseList", "exercise_list"]) {
    if (!Array.isArray(next[key])) continue;
    const hydrated = next[key].map(hydrateProgramExerciseMedia);
    if (hydrated.some((exercise, index) => exercise !== next[key][index])) changed = true;
    next[key] = hydrated;
  }
  for (const groupKey of ["blocks", "sections", "groups"]) {
    if (!Array.isArray(next[groupKey])) continue;
    const hydratedGroups = next[groupKey].map((group) => {
      if (!group || typeof group !== "object") return group;
      let groupChanged = false;
      const nextGroup = { ...group };
      for (const exerciseKey of ["exercises", "items", "movements"]) {
        if (!Array.isArray(nextGroup[exerciseKey])) continue;
        const hydrated = nextGroup[exerciseKey].map(hydrateProgramExerciseMedia);
        if (hydrated.some((exercise, index) => exercise !== nextGroup[exerciseKey][index])) groupChanged = true;
        nextGroup[exerciseKey] = hydrated;
      }
      if (groupChanged) changed = true;
      return groupChanged ? nextGroup : group;
    });
    next[groupKey] = hydratedGroups;
  }
  return changed ? next : workout;
}

function hydrateProgramExerciseMedia(exercise = {}) {
  if (!exercise || typeof exercise !== "object") return exercise;
  const name = String(exercise.name || exercise.title || exercise.exerciseName || exercise.exercise_name || "").trim();
  const media = SPECIAL_EXERCISE_MEDIA_BY_NAME.get(normalizeNameIdentity(name));
  if (!media) return exercise;
  const videoUrl = String(exercise.video_url || exercise.videoUrl || media.videoUrl || "").trim();
  const rfVideoUrl = String(exercise.rfVideoUrl || exercise.rf_video_url || media.rfVideoUrl || videoUrl || "").trim();
  return {
    ...exercise,
    video_url: videoUrl,
    videoUrl,
    rf_video_url: rfVideoUrl,
    rfVideoUrl,
    has_video: true,
    hasVideo: true
  };
}

function buildProgramCurrentWorkout(program = {}, access = {}, options = {}) {
  const workouts = programWorkouts(program);
  const total = workouts.length;
  if (!total) return emptyProgramCurrentWorkout();
  const deliveryMode = normalizeProgramDeliveryMode(options.deliveryMode);
  const visibleRange = options.visibleRange || visibleWorkoutRange(program, access, total, { deliveryMode });
  const start = Math.max(0, Number(visibleRange.start) || 0);
  const end = Math.min(total, Math.max(start, Number(visibleRange.end) || 0));
  const visibleTotal = Math.max(0, end - start);
  if (!visibleTotal) return emptyProgramCurrentWorkout("locked");
  const anchor = firstValidDate(
    options.subscriptionCycle?.access_from,
    options.subscriptionCycle?.accessFrom,
    options.assignment?.assignedAt,
    options.assignment?.assigned_at,
    options.assignment?.createdAt,
    options.assignment?.created_at
  ) || options.now || new Date();
  const now = options.now || new Date();
  const visibleIndex = Math.max(0, diffUtcCalendarDays(anchor, now)) % visibleTotal;
  const absoluteIndex = start + visibleIndex;
  return serializeProgramCurrentWorkout(workouts[absoluteIndex], {
    absoluteIndex,
    blockIndex: programBlockIndex(deliveryMode),
    status: "current"
  });
}

function serializeProgramCurrentWorkout(workout = {}, { absoluteIndex = 0, blockIndex = "first_half", status = "current" } = {}) {
  const dayIndex = absoluteIndex + 1;
  return {
    workoutId: String(workout.workoutId || workout.workout_id || workout.id || workout.lesson_id || workout.training_id || workout.dayId || workout.slug || `day_${dayIndex}`).trim(),
    title: String(workout.title || workout.lesson_title || workout.name || workout.display_name || workout.dayTitle || `Workout ${dayIndex}`).trim(),
    dayIndex,
    lessonNumber: dayIndex,
    blockIndex,
    exercises: programWorkoutExercises(workout).map(serializeProgramExercise).filter(Boolean),
    status
  };
}

function emptyProgramCurrentWorkout(status = "rest_day") {
  return {
    workoutId: null,
    title: "Rest day",
    dayIndex: null,
    blockIndex: null,
    exercises: [],
    status
  };
}

function programWorkoutExercises(workout = {}) {
  const direct = firstArray(workout.exercises, workout.items, workout.exerciseList, workout.exercise_list);
  if (direct.length) return direct;
  return firstArray(workout.blocks, workout.sections, workout.groups)
    .flatMap((block) => firstArray(block.exercises, block.items, block.movements));
}

function serializeProgramExercise(exercise = {}, index = 0) {
  const name = String(exercise.name || exercise.title || exercise.exerciseName || exercise.exercise_name || "").trim();
  if (!name) return null;
  const hydratedExercise = hydrateProgramExerciseMedia(exercise);
  const videoUrl = String(hydratedExercise.video_url || hydratedExercise.videoUrl || "").trim();
  const rfVideoUrl = String(hydratedExercise.rfVideoUrl || hydratedExercise.rf_video_url || videoUrl || "").trim();
  return {
    id: String(hydratedExercise.exerciseId || hydratedExercise.exercise_id || hydratedExercise.id || `exercise_${index + 1}`).trim(),
    name,
    sets: hydratedExercise.sets ?? null,
    reps: hydratedExercise.reps ?? null,
    repsRange: hydratedExercise.repsRange || hydratedExercise.reps_range || null,
    rest: hydratedExercise.rest ?? null,
    video_url: videoUrl,
    videoUrl,
    rf_video_url: rfVideoUrl,
    rfVideoUrl,
    has_video: Boolean(videoUrl || rfVideoUrl || hydratedExercise.has_video || hydratedExercise.hasVideo),
    hasVideo: Boolean(videoUrl || rfVideoUrl || hydratedExercise.has_video || hydratedExercise.hasVideo)
  };
}

function firstArray(...values) {
  return values.find((value) => Array.isArray(value)) || [];
}

function firstValidDate(...values) {
  for (const value of values) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isFinite(date.getTime())) return date;
  }
  return null;
}

function diffUtcCalendarDays(from, to) {
  const start = utcDayStart(from);
  const end = utcDayStart(to);
  return Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY);
}

function utcDayStart(value) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function buildProgramAccessRules(access = {}, totalWorkouts = 0, visibleWorkouts = 0, options = {}) {
  return {
    tier: programAccessTier(access),
    totalWorkouts,
    visibleWorkouts,
    hiddenWorkouts: Math.max(0, totalWorkouts - visibleWorkouts),
    hiddenWorkoutsCount: Math.max(0, totalWorkouts - visibleWorkouts),
    deliveryMode: normalizeProgramDeliveryMode(options.deliveryMode),
    visibleWorkoutLimit: Number.isFinite(options.visibleWorkoutLimit) ? options.visibleWorkoutLimit : visibleWorkouts,
    blockIndex: programBlockIndex(options.deliveryMode),
    freeFirstWeekOnly: programAccessTier(access) === "free"
  };
}

function programWorkouts(program = {}) {
  if (Array.isArray(program.days)) return program.days;
  if (Array.isArray(program.workouts)) return program.workouts;
  if (Array.isArray(program.lessons)) return program.lessons;
  return [];
}

async function hydrateProgramWithLessons(program) {
  if (!program) return null;
  if (programWorkouts(program).length) return program;
  const lessons = await loadProgramLessons(program);
  if (!lessons.length) return program;
  return { ...program, lessons };
}

async function loadProgramLessons(program = {}) {
  const courseIds = programCourseIdentityValues(program);
  if (!courseIds.length) return [];
  const result = await query(
    `SELECT data
     FROM catalog_documents
     WHERE key = $1
     LIMIT 1`,
    [LESSONS_KEY]
  ).catch(() => ({ rows: [] }));
  const lessons = Array.isArray(result.rows[0]?.data) ? result.rows[0].data : [];
  return lessons
    .filter((lesson) => programCourseIdentityValues(lesson).some((id) => courseIds.includes(id)))
    .sort(compareProgramLessons)
    .map(serializeLessonAsWorkout);
}

function programCourseIdentityValues(value = {}) {
  return [
    value.course_id,
    value.courseId,
    value.sourceCourseId,
    value.source_course_id
  ].map((item) => String(item || "").trim()).filter(Boolean);
}

function compareProgramLessons(left = {}, right = {}) {
  return lessonOrder(left) - lessonOrder(right);
}

function lessonOrder(value = {}) {
  const numeric = Number.parseInt(String(value.lesson_number || value.lessonNumber || value.order || value.position || ""), 10);
  return Number.isFinite(numeric) ? numeric : Number.MAX_SAFE_INTEGER;
}

function serializeLessonAsWorkout(lesson = {}, index = 0) {
  const lessonNumber = Number.parseInt(String(lesson.lesson_number || lesson.lessonNumber || ""), 10);
  return {
    ...lesson,
    id: String(lesson.lesson_id || lesson.training_id || lesson.id || `lesson_${index + 1}`).trim(),
    workoutId: String(lesson.lesson_id || lesson.training_id || lesson.id || `lesson_${index + 1}`).trim(),
    title: String(lesson.lesson_title || lesson.title || lesson.name || `Workout ${Number.isFinite(lessonNumber) ? lessonNumber : index + 1}`).trim(),
    dayIndex: Number.isFinite(lessonNumber) ? lessonNumber : index + 1,
    lessonNumber: Number.isFinite(lessonNumber) ? lessonNumber : index + 1
  };
}

function visibleWorkoutLimit(program = {}, access = {}, total = 0) {
  return visibleWorkoutRange(program, access, total).limit;
}

function visibleWorkoutRange(program = {}, access = {}, total = 0, options = {}) {
  const safeTotal = Math.max(0, Number(total) || 0);
  const tier = programAccessTier(access);
  if (tier === "full") return { start: 0, end: safeTotal, limit: safeTotal };
  if (tier === "free") {
    const split = Math.min(safeTotal, programSplitDays(program));
    return { start: 0, end: split, limit: split };
  }
  const blockSize = subscriptionProgramBlockSize(safeTotal);
  const deliveryMode = normalizeProgramDeliveryMode(options.deliveryMode);
  if (deliveryMode === "second_half" && safeTotal > blockSize) {
    return { start: blockSize, end: safeTotal, limit: Math.max(0, safeTotal - blockSize) };
  }
  return { start: 0, end: Math.min(safeTotal, blockSize), limit: Math.min(safeTotal, blockSize) };
}

function subscriptionProgramBlockSize(total = 0) {
  const safeTotal = Math.max(0, Number(total) || 0);
  if (safeTotal <= 12) return safeTotal;
  return Math.ceil(safeTotal / 2);
}

function resolveProgramDeliveryMode({ access = {}, assignment = {}, subscriptionCycle = null } = {}) {
  const tier = programAccessTier(access);
  if (tier === "full" || tier === "free") return null;
  return normalizeProgramDeliveryMode(
    subscriptionCycle?.delivery_mode ||
    subscriptionCycle?.deliveryMode ||
    assignment?.meta?.deliveryMode ||
    assignment?.meta?.delivery_mode ||
    "first_half"
  );
}

function normalizeProgramDeliveryMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  if (mode === "second_half") return "second_half";
  if (["first_half", "fresh_program", "replacement_cycle", "manual_review"].includes(mode)) return mode;
  return null;
}

function programBlockIndex(deliveryMode) {
  return normalizeProgramDeliveryMode(deliveryMode) === "second_half" ? "second_half" : "first_half";
}

function legacyVisibleWorkoutLimit(program = {}, access = {}, total = 0) {
  if (programAccessTier(access) !== "free") return total;
  const split = programSplitDays(program);
  return Math.min(total, split);
}

function programSplitDays(program = {}) {
  const candidates = [
    program.frequency,
    program.frequencyLabel,
    program.trainings_per_week,
    program.days_per_week,
    program.workouts_per_week,
    program.format,
    program.technical_name,
    program.title,
    program.display_name
  ];
  for (const value of candidates) {
    const text = String(value || "").toLowerCase();
    const number = Number.parseInt(text.match(/\d+/)?.[0] || "", 10);
    if (number === 2 || number === 3) return number;
    if (/(две|2\s*р|2-day|two)/i.test(text)) return 2;
    if (/(три|3\s*р|3-day|three)/i.test(text)) return 3;
  }
  return 3;
}

function programAccessTier(access = {}) {
  if (!access?.isActive) return "free";
  const status = String(access.status || access.plan || access.role || "").toLowerCase();
  const role = String(access.role || "").toLowerCase();
  if (access.isAdmin || access.isTrainer || status === "admin" || status === "trainer" || role === "admin" || role === "trainer") return "full";
  if (access.isTest || status === "test" || role === "test") return "test";
  if (access.isVip || status === "vip") return "vip";
  if (access.isPaid || status === "paid") return "paid";
  return "free";
}

async function programTitleById(programId) {
  const document = await loadTrainingProgramsDocument();
  const program = findProgramByAnyId(document.programs, programId);
  return program?.generatedTitle || program?.display_name || program?.title || program?.name || program?.technical_name || "";
}

function serializeProgram(course = {}) {
  const canonical = canonicalizeTrainingProgram(course);
  const id = String(canonical.program_id || canonical.course_id || canonical.id || "").trim();
  return {
    id,
    programId: id,
    legacyIds: canonical.legacy_ids || [],
    courseId: id,
    title: canonical.generatedTitle || course.display_name || course.title || course.technical_name || id,
    technicalName: course.technical_name || null,
    gender: canonical.meta?.gender || course.gender || null,
    goal: canonical.meta?.goal || course.goal || null,
    level: canonical.meta?.level || course.level || null,
    restrictions: canonical.meta?.limitations || course.restrictions || null,
    status: canonical.status,
    subscriptionEligible: canonical.subscriptionEligible
  };
}

function serializeProgramAssignment(row) {
  if (!row?.program_id) return null;
  return {
    userId: row.user_id || null,
    programId: row.program_id,
    programTitle: row.program_title || null,
    assignedBy: row.assigned_by || null,
    source: row.program_source || row.source || "admin",
    meta: row.program_meta || row.meta || {},
    assignedAt: toIso(row.program_assigned_at || row.assigned_at || row.assignedAt),
    createdAt: toIso(row.program_created_at || row.created_at),
    updatedAt: toIso(row.program_updated_at || row.updated_at)
  };
}

function normalizeProfileName(profile = {}) {
  const firstName = String(profile.firstName || profile.first_name || "").trim();
  const lastName = String(profile.lastName || profile.last_name || "").trim();
  const fullName = firstName ? [firstName, lastName].filter(Boolean).join(" ") : "";
  return { firstName, lastName, fullName };
}

function providerLogin(identities) {
  if (!identities.length) return "manual";
  return identities
    .map((identity) => {
      const profile = identity.profile || {};
      const label = identity.providerUsername || identity.providerEmail || profile.username || profile.login || profile.email || profile.name || identity.providerUserId;
      return `${identity.provider}:${label}`;
    })
    .join(", ");
}

async function persistProgressPhoto(storageKey, source) {
  const dataUrl = String(source || "");
  const safeKey = safeStorageKey(storageKey);
  if (!dataUrl.startsWith("data:image/")) {
    return { storageKey: safeKey, publicUrl: dataUrl || null, saved: false };
  }
  const match = dataUrl.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i);
  if (!match) {
    return { storageKey: safeKey, publicUrl: null, saved: false };
  }
  const extension = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
  const keyWithExtension = safeKey.replace(/\.(jpg|jpeg|png|webp)$/i, `.${extension}`);
  const targetPath = path.resolve(PROGRESS_PHOTOS_DIR, keyWithExtension);
  const rootPath = path.resolve(PROGRESS_PHOTOS_DIR);
  if (!targetPath.startsWith(`${rootPath}${path.sep}`)) {
    throw new Error("Invalid storageKey");
  }
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > 8 * 1024 * 1024) {
    throw new Error("Invalid photo size");
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, buffer, { mode: 0o644 });
  return {
    storageKey: keyWithExtension,
    publicUrl: `${PROGRESS_PHOTOS_PUBLIC_BASE_URL}/${keyWithExtension.split(path.sep).join("/")}`,
    saved: true
  };
}

function safeStorageKey(value) {
  const normalized = String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => part.replace(/[^a-zA-Z0-9._-]/g, "_"))
    .join("/");
  return normalized || `progress/${Date.now()}-${crypto.randomUUID()}.jpg`;
}

function serializeVipReport(row = {}) {
  const report = normalizeTrainerReport(row.report || {});
  return {
    id: row.id,
    userId: row.user_id || row.userId || null,
    status: row.status || "submitted",
    title: row.title || null,
    report,
    createdAt: toIso(row.created_at || row.createdAt),
    updatedAt: toIso(row.updated_at || row.updatedAt)
  };
}

function scoreValue(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return Math.max(1, Math.min(10, Math.round(number)));
  }
  return null;
}

function normalizeTrainerReport(input = {}) {
  const report = sanitizeObject(input || {});
  const sourceScores = report.scores && typeof report.scores === "object" ? report.scores : report;
  const scores = {
    selfFeeling: scoreValue(sourceScores.selfFeeling, sourceScores.wellbeing, sourceScores.wellbeing_score),
    strength: scoreValue(sourceScores.strength, sourceScores.energy, sourceScores.energy_score, sourceScores.strength_score),
    sleepQuality: scoreValue(sourceScores.sleepQuality, sourceScores.sleep, sourceScores.sleep_quality_score),
    workoutFeeling: scoreValue(sourceScores.workoutFeeling, sourceScores.workout, sourceScores.workout_score)
  };
  const legacyScores = {
    wellbeing: scores.selfFeeling,
    energy: scores.strength,
    sleep: scores.sleepQuality,
    workout: scores.workoutFeeling
  };
  return {
    ...report,
    kind: report.kind || "client_checkin",
    submittedAt: report.submittedAt || report.submitted_at || new Date().toISOString(),
    scores: {
      ...legacyScores,
      ...scores
    },
    selfFeeling: scores.selfFeeling,
    strength: scores.strength,
    sleepQuality: scores.sleepQuality,
    workoutFeeling: scores.workoutFeeling
  };
}

function localDateKey(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(value.getTime())) return new Date().toISOString().slice(0, 10);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDateFromKey(dateKey) {
  const [year, month, day] = String(dateKey || "").split("-").map(Number);
  const value = new Date(year || 1970, (month || 1) - 1, day || 1, 12, 0, 0, 0);
  return Number.isFinite(value.getTime()) ? value : null;
}

function addLocalDays(dateKey, days) {
  const value = localDateFromKey(dateKey);
  if (!value) return "";
  value.setDate(value.getDate() + Number(days || 0));
  return localDateKey(value);
}

function diffLocalDays(fromDateKey, toDateKey = localDateKey()) {
  const from = localDateFromKey(fromDateKey);
  const to = localDateFromKey(toDateKey);
  if (!from || !to) return 0;
  return Math.floor((to.getTime() - from.getTime()) / 86400000);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  const safe = Number.isFinite(number) ? number : fallback;
  return Math.max(min, Math.min(max, Math.round(safe)));
}

function normalizeMenstrualProfile(input = {}) {
  const lastPeriodStartDate = String(input.lastPeriodStartDate || input.last_period_start_date || input.periodStartDate || "").slice(0, 10);
  const cycleLengthDays = clampNumber(input.cycleLengthDays || input.cycle_length_days || input.cycleLength || input.length, 21, 45, 28);
  const periodLengthDays = clampNumber(input.periodLengthDays || input.period_length_days || input.periodLength, 2, 10, 5);
  const lutealPhaseLengthDays = clampNumber(input.lutealPhaseLengthDays || input.luteal_phase_length_days, 10, 18, 14);
  const hasValidDate = Boolean(lastPeriodStartDate && localDateFromKey(lastPeriodStartDate));
  return {
    lastPeriodStartDate: hasValidDate ? lastPeriodStartDate : "",
    cycleLengthDays,
    periodLengthDays,
    lutealPhaseLengthDays,
    configured: hasValidDate,
    dataSource: hasValidDate ? (input.dataSource || input.data_source || "manual") : null
  };
}

function computeMenstrualCycle(input = {}) {
  const profile = normalizeMenstrualProfile(input);
  if (!profile.configured) {
    return {
      ...profile,
      phase: null,
      phaseLabel: "",
      day: null,
      cycleDay: null,
      length: profile.cycleLengthDays,
      progress: 0,
      nextPeriodDate: "",
      daysUntilNextPeriod: null,
      ovulationDate: "",
      daysUntilOvulation: null,
      ovulationInDays: null,
      recommendation: "Добавьте дату начала последней менструации, чтобы FruitFit рассчитал цикл."
    };
  }

  const todayKey = localDateKey();
  const daysSinceStart = Math.max(0, diffLocalDays(profile.lastPeriodStartDate, todayKey));
  const cyclesPassed = Math.floor(daysSinceStart / profile.cycleLengthDays);
  const currentCycleStart = addLocalDays(profile.lastPeriodStartDate, cyclesPassed * profile.cycleLengthDays);
  const cycleDay = (daysSinceStart % profile.cycleLengthDays) + 1;
  const ovulationDay = clampNumber(profile.cycleLengthDays - profile.lutealPhaseLengthDays, profile.periodLengthDays + 1, profile.cycleLengthDays - 7, 14);
  const ovulationDate = addLocalDays(currentCycleStart, ovulationDay - 1);
  let nextPeriodDate = addLocalDays(profile.lastPeriodStartDate, cyclesPassed * profile.cycleLengthDays);
  if (diffLocalDays(todayKey, nextPeriodDate) <= 0) nextPeriodDate = addLocalDays(nextPeriodDate, profile.cycleLengthDays);
  const daysUntilNextPeriod = Math.max(0, diffLocalDays(todayKey, nextPeriodDate));
  const daysUntilOvulationRaw = diffLocalDays(todayKey, ovulationDate);
  const daysUntilOvulation = daysUntilOvulationRaw >= 0 ? daysUntilOvulationRaw : null;

  let phase = "luteal";
  let phaseLabel = "Лютеиновая фаза";
  if (cycleDay <= profile.periodLengthDays) {
    phase = "menstrual";
    phaseLabel = "Менструальная фаза";
  } else if (cycleDay >= ovulationDay - 1 && cycleDay <= ovulationDay + 1) {
    phase = "ovulatory";
    phaseLabel = "Овуляторное окно";
  } else if (cycleDay < ovulationDay - 1) {
    phase = "follicular";
    phaseLabel = "Фолликулярная фаза";
  }
  const recommendations = {
    menstrual: "Можно снизить интенсивность и оставить лёгкую тренировку, растяжку или прогулку.",
    follicular: "Обычно это удобное время для постепенного повышения нагрузки, если восстановление хорошее.",
    ovulatory: "Можно тренироваться в обычном режиме, но следить за техникой и ощущениями.",
    luteal: "Лучше внимательнее следить за восстановлением, сном и уровнем утомления."
  };
  return {
    ...profile,
    phase,
    phaseLabel,
    day: cycleDay,
    cycleDay,
    length: profile.cycleLengthDays,
    progress: Math.round((cycleDay / profile.cycleLengthDays) * 100),
    ovulationDay,
    ovulationDate,
    daysUntilOvulation,
    ovulationInDays: daysUntilOvulation,
    nextPeriodDate,
    daysUntilNextPeriod,
    recommendation: recommendations[phase]
  };
}

function sanitizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value));
}

export const __testProgramAccess = {
  buildProgramAccessPayload,
  buildProgramAccessRules,
  programAccessTier,
  resolveProgramDeliveryMode,
  subscriptionProgramBlockSize,
  visibleWorkoutRange
};
