import { getNutritionDb } from "./nutritionDb.js";

export function createAuthSchema(db = getNutritionDb()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      username TEXT,
      name TEXT,
      email TEXT,
      photo_url TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider, provider_id)
    );
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `);
}

export function findOrCreateUserByProvider(db, provider, providerId, profile) {
  createAuthSchema(db); // Ensure schema
  const existing = db.prepare(`SELECT * FROM users WHERE provider = ? AND provider_id = ?`).get(provider, providerId);
  
  if (existing) {
    db.prepare(`
      UPDATE users 
      SET username = ?, name = ?, email = ?, photo_url = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      profile.username || existing.username, 
      profile.name || existing.name, 
      profile.email || existing.email, 
      profile.photo_url || existing.photo_url, 
      existing.id
    );
    return db.prepare(`SELECT * FROM users WHERE id = ?`).get(existing.id);
  }

  let finalId = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  // Basic email linking: if email exists, we just use the same user id so they share identity
  if (profile.email) {
    const existingByEmail = db.prepare(`SELECT * FROM users WHERE email = ?`).get(profile.email);
    if (existingByEmail) {
      finalId = existingByEmail.id; // Link to existing user ID
    }
  }

  db.prepare(`
    INSERT INTO users (id, provider, provider_id, username, name, email, photo_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    finalId,
    provider,
    providerId,
    profile.username || null,
    profile.name || null,
    profile.email || null,
    profile.photo_url || null
  );

  return db.prepare(`SELECT * FROM users WHERE id = ? LIMIT 1`).get(finalId);
}

export function getUserById(db, id) {
  return db.prepare(`SELECT * FROM users WHERE id = ? LIMIT 1`).get(id);
}
