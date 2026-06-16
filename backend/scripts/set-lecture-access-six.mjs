import { closePool, query } from "../src/db.js";

const policy = {
  mode: "first_n",
  freeLectureCount: 6,
  freeLectureIds: [],
  paidAccess: "all",
};

const result = await query(
  `INSERT INTO app_settings (key, data, updated_at)
   VALUES ($1, $2, now())
   ON CONFLICT (key)
   DO UPDATE SET data = EXCLUDED.data,
                 updated_at = now()
   RETURNING data, updated_at`,
  ["lecture_access_policy", policy],
);

console.log(JSON.stringify(result.rows[0]));
await closePool();
