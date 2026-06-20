import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import { requireAdmin, requireUser } from "./auth.js";
import { config } from "./config.js";
import { query } from "./db.js";
import { serializeDevice, serializeIdentity } from "./deviceRegistry.js";

export const meRouter = express.Router();
export const adminRouter = express.Router();
const ACCESS_STATUSES = new Set(["free", "paid", "vip", "admin", "trainer"]);
const TRAINING_PROGRAMS_KEY = "training-programs";
const COURSES_KEY = "courses";
const EXERCISE_CATALOG_KEYS = ["exercise-catalog", "exercises"];
const MEDIA_UPLOAD_DIR = process.env.ADMIN_MEDIA_UPLOAD_DIR || "/var/www/fruitfit-downloads/admin-media";
const MEDIA_UPLOAD_PUBLIC_BASE_URL = String(
  process.env.ADMIN_MEDIA_UPLOAD_PUBLIC_BASE_URL || "https://client.tagirfruit.ru/downloads/admin-media"
).replace(/\/$/, "");
const PROGRESS_PHOTOS_DIR = process.env.PROGRESS_PHOTOS_DIR || "/var/www/fruitfit-downloads/progress-photos";
const PROGRESS_PHOTOS_PUBLIC_BASE_URL = String(
  process.env.PROGRESS_PHOTOS_PUBLIC_BASE_URL || "https://client.tagirfruit.ru/downloads/progress-photos"
).replace(/\/$/, "");

meRouter.use(requireUser);

meRouter.get("/", async (req, res) => {
  const profile = await loadUserProfile(req.user.id);
  const programAssignment = await loadProgramAssignment(req.user.id);
  res.json({ user: { ...req.user, profile }, profile, programAssignment });
});

meRouter.get("/profile", async (req, res) => {
  const result = await query("SELECT profile, updated_at FROM user_profiles WHERE user_id = $1", [req.user.id]);
  res.json({ user: req.user, profile: result.rows[0]?.profile || {}, updatedAt: result.rows[0]?.updated_at || null });
});

meRouter.post("/profile", saveUserProfile);
meRouter.put("/profile", saveUserProfile);

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
  const profile = sanitizeObject(req.body?.profile ?? req.body ?? {});
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
  res.json({ profile: result.rows[0].profile, updatedAt: result.rows[0].updated_at, name: nameParts.fullName || req.user.name || null });
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
  res.json({ assignment: await loadProgramAssignment(req.user.id) });
});

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
  const result = await query(
    "SELECT id, taken_at, storage_key, public_url, meta, created_at FROM progress_photos WHERE user_id = $1 ORDER BY taken_at DESC LIMIT 200",
    [req.user.id]
  );
  res.json({ items: result.rows });
});

meRouter.post("/progress-photos", async (req, res) => {
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

adminRouter.post("/media/upload", async (req, res) => {
  const result = await persistAdminMediaUpload(req.body || {});
  res.status(201).json(result);
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
  const override = normalizeMuscleMapOverride(req.body || {});
  if (!from) {
    res.status(400).json({ error: "old muscle map identity is required" });
    return;
  }
  const updated = await updateExerciseDocuments((exercise) => {
    const identities = [
      exercise.muscle_map_asset_path,
      exercise.muscleMapAssetPath,
      exercise.muscle_map_key,
      exercise.muscleMapKey,
      exercise.muscle_map_label,
      exercise.muscleMapLabel
    ].map(normalizeMuscleMapIdentity).filter(Boolean);
    return identities.includes(from) ? { ...exercise, ...override } : exercise;
  });
  res.json({ updated, from, override });
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
     WHERE u.id = $1`,
    [String(req.params.userId)]
  );
  if (!result.rowCount) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ user: serializeAdminUser(result.rows[0]) });
});

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

  const deleted = await query(
    `DELETE FROM users
     WHERE id = $1
       AND COALESCE(role, 'user') <> 'admin'
     RETURNING id, email, name, username, role`,
    [userId]
  );
  if (!deleted.rowCount) {
    res.status(403).json({ error: "User was not deleted" });
    return;
  }

  res.json({ deleted: deleted.rows[0] });
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
  const existingIndex = current.programs.findIndex((program) => String(program.id || program.courseId || program.course_id) === id);
  const programs = existingIndex >= 0
    ? current.programs.map((program, index) => index === existingIndex ? mergeStoredProgram(program, nextProgram) : program)
    : [markAdminCreatedProgram({ ...nextProgram, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }), ...current.programs];
  const saved = await persistTrainingPrograms(programs, req);
  res.json({ ...saved, program: saved.programs.find((program) => String(program.id || program.courseId || program.course_id) === id) || nextProgram });
}

async function deleteTrainingProgram(req, res) {
  const programId = String(req.params.programId || "").trim();
  if (!programId) {
    res.status(400).json({ error: "program id is required" });
    return;
  }
  const current = await loadTrainingProgramsDocument();
  const existingIndex = current.programs.findIndex((program) => String(program.id || program.courseId || program.course_id) === programId);
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
  const id = String(program.id || program.courseId || program.course_id || program.sourceProgramId || program.source_id || "").trim();
  return {
    ...sanitizeObject(program),
    id,
    courseId: String(program.courseId || program.course_id || program.sourceCourseId || id),
    course_id: String(program.course_id || program.courseId || program.sourceCourseId || id),
    updated_at: program.updated_at || program.updatedAt || new Date().toISOString()
  };
}

function programToCourseRecord(program = {}) {
  return {
    id: program.id,
    course_id: program.course_id || program.courseId || program.id,
    display_name: program.title || program.display_name || program.name || program.technical_name || program.id,
    title: program.title || program.display_name || program.name || "",
    technical_name: program.technicalName || program.technical_name || "",
    gender: program.gender || "",
    goal: program.goal || "",
    level: program.level || program.experience || "",
    frequency: program.frequency || program.workouts_per_week || "",
    trainings_per_week: program.frequency || program.workouts_per_week || "",
    restrictions: program.restrictions || program.limitations || []
  };
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
  res.json({ access: serializeAccess(access.rows[0], updatedUser.rows[0]), user: updatedUser.rows[0] });
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

async function updateExerciseDocuments(mutator) {
  let totalUpdated = 0;
  for (const key of EXERCISE_CATALOG_KEYS) {
    const result = await query("SELECT data FROM catalog_documents WHERE key = $1", [key]);
    if (!result.rowCount) continue;
    const data = result.rows[0].data;
    const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : Array.isArray(data?.exercises) ? data.exercises : [];
    if (!items.length) continue;
    let changed = 0;
    const nextItems = items.map((item) => {
      const next = mutator(item);
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
      [key, nextData]
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
  const status = normalizeAccessStatus(row?.status || (user.role === "admin" || user.role === "trainer" ? user.role : "free"));
  const isActive = accessIsActive(row, status);
  const paidLike = ["paid", "vip", "admin", "trainer"].includes(status);
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
    source: row?.source || "default",
    meta: row?.meta || {},
    features: {
      premium: isActive && paidLike,
      vip: isActive && (status === "vip" || Boolean(row?.is_vip)),
      admin: isActive && (status === "admin" || user.role === "admin"),
      trainer: isActive && (status === "trainer" || user.role === "trainer")
    }
  };
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

async function loadUserProfile(userId) {
  const result = await query("SELECT profile FROM user_profiles WHERE user_id = $1", [userId]);
  return result.rows[0]?.profile || {};
}

async function loadProgramAssignment(userId) {
  const result = await query("SELECT * FROM user_program_assignments WHERE user_id = $1", [userId]);
  return serializeProgramAssignment(result.rows[0]);
}

async function programTitleById(programId) {
  const document = await loadTrainingProgramsDocument();
  const program = document.programs.find((course) => String(course.course_id || course.courseId || course.id) === String(programId));
  return program?.display_name || program?.title || program?.name || program?.technical_name || "";
}

function serializeProgram(course = {}) {
  const id = String(course.course_id || course.id || "").trim();
  return {
    id,
    courseId: id,
    title: course.display_name || course.title || course.technical_name || id,
    technicalName: course.technical_name || null,
    gender: course.gender || null,
    goal: course.goal || null,
    level: course.level || null,
    restrictions: course.restrictions || null
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
