import { closePool, query, transaction } from "./db.js";
import { migrations } from "./migrations.js";

export async function runMigrations() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const migration of migrations) {
    const existing = await query("SELECT id FROM schema_migrations WHERE id = $1", [migration.id]);
    if (existing.rowCount) continue;
    await transaction(async (client) => {
      await client.query(migration.sql);
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [migration.id]);
    });
    console.log(`[migrate] applied ${migration.id}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => closePool())
    .catch(async (error) => {
      console.error("[migrate] failed", error);
      await closePool().catch(() => {});
      process.exit(1);
    });
}
