import express from "express";
import { requireAdmin, requireUser } from "./auth.js";
import { config } from "./config.js";
import { query } from "./db.js";

export const lmsRouter = express.Router();
export const adminLmsRouter = express.Router();

const SETTING_KEY = "lecture_access_policy";
const DEFAULT_POLICY = Object.freeze({
  mode: "first_n",
  freeLectureCount: 6,
  freeLectureIds: [],
  paidAccess: "all"
});

lmsRouter.get("/lecture-access", async (_req, res) => {
  res.json({ policy: await loadLectureAccessPolicy() });
});

adminLmsRouter.use((req, res, next) => {
  if (config.adminApiToken && req.headers["x-admin-token"] === config.adminApiToken) {
    next();
    return;
  }
  requireUser(req, res, () => requireAdmin(req, res, next));
});

adminLmsRouter.get("/lecture-access", async (_req, res) => {
  res.json({ policy: await loadLectureAccessPolicy() });
});

adminLmsRouter.patch("/lecture-access", saveLectureAccessPolicy);
adminLmsRouter.put("/lecture-access", saveLectureAccessPolicy);

async function saveLectureAccessPolicy(req, res) {
  const policy = normalizePolicy(req.body?.policy || req.body || {});
  const updatedBy = req.user?.id || (req.headers["x-admin-token"] ? "admin-token" : null);
  const result = await query(
    `INSERT INTO app_settings (key, data, updated_by, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (key)
     DO UPDATE SET data = EXCLUDED.data,
                   updated_by = EXCLUDED.updated_by,
                   updated_at = now()
     RETURNING data, updated_at`,
    [SETTING_KEY, policy, updatedBy]
  );
  res.json({ policy: normalizePolicy(result.rows[0]?.data), updatedAt: result.rows[0]?.updated_at || null });
}

async function loadLectureAccessPolicy() {
  const result = await query("SELECT data FROM app_settings WHERE key = $1", [SETTING_KEY]);
  return normalizePolicy(result.rows[0]?.data);
}

function normalizePolicy(value = {}) {
  const mode = value.mode === "list" ? "list" : "first_n";
  const freeLectureCount = Math.max(0, Math.min(100, Number.parseInt(value.freeLectureCount ?? value.free_lecture_count ?? DEFAULT_POLICY.freeLectureCount, 10) || 0));
  const ids = Array.isArray(value.freeLectureIds || value.free_lecture_ids)
    ? (value.freeLectureIds || value.free_lecture_ids)
    : [];
  const freeLectureIds = Array.from(new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))).slice(0, 200);
  return {
    mode,
    freeLectureCount,
    freeLectureIds,
    paidAccess: "all"
  };
}
