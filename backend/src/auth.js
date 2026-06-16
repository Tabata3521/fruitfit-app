import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import cookie from "cookie";
import express from "express";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { query, transaction } from "./db.js";
import { isEmailSmtpConfigured, sendPasswordResetEmail, sendVerificationEmail } from "./emailSender.js";
import {
  PUBLIC_AUTH_PROVIDERS,
  availableProviderNames,
  cleanText,
  devicePayloadFromBody,
  devicePayloadFromQuery,
  normalizeDevicePayload,
  normalizeProfile,
  normalizeProvider,
  resolveRegion,
  sanitizeObject,
  serializeDevice,
  serializeIdentity,
  upsertUserDevice,
  userIdForInstallation
} from "./deviceRegistry.js";

const TOKEN_COOKIE = "fruitfit_token";
const TOKEN_TTL = "30d";
const ACCESS_STATUSES = new Set(["free", "paid", "vip", "admin", "trainer"]);
const EMAIL_TOKEN_BYTES = 32;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const EMAIL_AUTH_LIMITS = {
  register: { limit: 5, windowMs: 15 * 60 * 1000 },
  login: { limit: 10, windowMs: 10 * 60 * 1000 },
  resend: { limit: 3, windowMs: 15 * 60 * 1000 },
  resetRequest: { limit: 3, windowMs: 15 * 60 * 1000 },
  resetPassword: { limit: 5, windowMs: 15 * 60 * 1000 }
};
const emailRateLimitBuckets = new Map();

export const authRouter = express.Router();
export const deviceRouter = express.Router();

export function signToken(user) {
  if (!config.jwtSecret) throw new Error("JWT_SECRET is not configured");
  return jwt.sign(
    {
      id: user.id,
      email: user.email || null,
      name: user.name || null,
      username: user.username || null,
      photo_url: user.photo_url || null,
      role: user.role || "user"
    },
    config.jwtSecret,
    { expiresIn: TOKEN_TTL }
  );
}

export function setAuthCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    cookie.serialize(TOKEN_COOKIE, token, {
      httpOnly: true,
      secure: config.nodeEnv === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60
    })
  );
}

export function clearAuthCookie(res) {
  res.setHeader(
    "Set-Cookie",
    cookie.serialize(TOKEN_COOKIE, "", {
      httpOnly: true,
      secure: config.nodeEnv === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0
    })
  );
}

export function readBearerToken(req) {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim();
  const cookies = cookie.parse(req.headers.cookie || "");
  return cookies[TOKEN_COOKIE] || "";
}

export function hasValidAdminToken(req) {
  const supplied = req.headers["x-admin-token"] || req.body?.adminToken || req.body?.token || req.query?.adminToken;
  if (!config.adminApiToken || !supplied) return false;
  const expectedBuffer = Buffer.from(config.adminApiToken);
  const suppliedBuffer = Buffer.from(String(supplied));
  return expectedBuffer.length === suppliedBuffer.length && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export async function requireUser(req, res, next) {
  const token = readBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    const result = await query("SELECT * FROM users WHERE id = $1", [decoded.id]);
    if (!result.rowCount) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.user = result.rows[0];
    next();
  } catch (_) {
    res.status(401).json({ error: "Invalid token" });
  }
}

export async function optionalUserFromRequest(req) {
  const token = readBearerToken(req);
  if (!token || !config.jwtSecret) return null;
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    const result = await query("SELECT * FROM users WHERE id = $1", [decoded.id]);
    return result.rows[0] || null;
  } catch (_) {
    return null;
  }
}

export function requireAdmin(req, res, next) {
  if (hasValidAdminToken(req)) {
    next();
    return;
  }
  if (req.user?.role === "admin") {
    next();
    return;
  }
  res.status(403).json({ error: "Forbidden" });
}

export async function findOrCreateUserByIdentity(provider, providerUserId, profile, context = {}) {
  const normalizedProvider = normalizeProvider(provider);
  const normalizedProfile = normalizeProfile(profile);
  const metadata = sanitizeObject(context.metadata || profile?.metadata || profile?.meta || {});
  const device = context.device ? normalizeDevicePayload(context.device, context.req) : null;
  const currentUserId = context.currentUserId || null;

  return transaction(async (client) => {
    const identity = await client.query(
      `SELECT u.*
       FROM auth_identities ai
       JOIN users u ON u.id = ai.user_id
       WHERE ai.provider = $1 AND ai.provider_user_id = $2`,
      [normalizedProvider, providerUserId]
    );
    if (identity.rowCount) {
      const user = identity.rows[0];
      await updateUserProfile(client, user.id, normalizedProfile);
      await touchIdentity(client, normalizedProvider, providerUserId, normalizedProfile, metadata);
      await upsertUserDevice(client, device, { userId: user.id });
      const refreshed = await client.query("SELECT * FROM users WHERE id = $1", [user.id]);
      return refreshed.rows[0];
    }

    const linkedUserId = currentUserId || (await userIdForInstallation(client, device?.installationId));
    if (linkedUserId) {
      const existingUser = await client.query("SELECT * FROM users WHERE id = $1", [linkedUserId]);
      if (existingUser.rowCount) {
        await updateUserProfile(client, linkedUserId, normalizedProfile);
        await insertIdentity(client, linkedUserId, normalizedProvider, providerUserId, normalizedProfile, metadata);
        await ensureUserDefaults(client, linkedUserId);
        await upsertUserDevice(client, device, { userId: linkedUserId });
        const refreshed = await client.query("SELECT * FROM users WHERE id = $1", [linkedUserId]);
        return refreshed.rows[0];
      }
    }

    const id = crypto.randomUUID();
    const created = await client.query(
      `INSERT INTO users (id, email, name, username, photo_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, normalizedProfile.email, normalizedProfile.name, normalizedProfile.username, normalizedProfile.photo_url]
    );
    await insertIdentity(client, id, normalizedProvider, providerUserId, normalizedProfile, metadata);
    await ensureUserDefaults(client, id);
    await upsertUserDevice(client, device, { userId: id });
    return created.rows[0];
  });
}

export async function linkIdentityToUser(userId, provider, providerUserId, profile, context = {}) {
  const normalizedProvider = normalizeProvider(provider);
  const normalizedProfile = normalizeProfile(profile);
  const metadata = sanitizeObject(context.metadata || profile?.metadata || profile?.meta || {});
  const device = context.device ? normalizeDevicePayload(context.device, context.req) : null;

  return transaction(async (client) => {
    const identity = await client.query(
      `SELECT * FROM auth_identities
       WHERE provider = $1 AND provider_user_id = $2`,
      [normalizedProvider, providerUserId]
    );

    if (identity.rowCount && identity.rows[0].user_id !== userId) {
      const error = new Error("Provider identity is already linked to another user");
      error.status = 409;
      throw error;
    }

    if (identity.rowCount) {
      await touchIdentity(client, normalizedProvider, providerUserId, normalizedProfile, metadata);
    } else {
      await insertIdentity(client, userId, normalizedProvider, providerUserId, normalizedProfile, metadata);
    }

    await updateUserProfile(client, userId, normalizedProfile);
    await upsertUserDevice(client, device, { userId });
    const identities = await client.query(
      `SELECT *
       FROM auth_identities
       WHERE user_id = $1
       ORDER BY linked_at DESC, created_at DESC`,
      [userId]
    );
    return identities.rows.map(serializeIdentity);
  });
}

async function updateUserProfile(client, userId, profile) {
  await client.query(
    `UPDATE users
     SET email = COALESCE($2, email),
         name = COALESCE($3, name),
         username = COALESCE($4, username),
         photo_url = COALESCE($5, photo_url),
         updated_at = now()
     WHERE id = $1`,
    [userId, profile.email, profile.name, profile.username, profile.photo_url]
  );
}

async function insertIdentity(client, userId, provider, providerUserId, profile, metadata = {}) {
  await client.query(
    `INSERT INTO auth_identities (
       user_id, provider, provider_user_id, provider_email, provider_username,
       profile, metadata_json, linked_at, last_login_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now(), now())`,
    [userId, provider, providerUserId, profile.email, profile.username, profile, metadata]
  );
}

async function touchIdentity(client, provider, providerUserId, profile, metadata = {}) {
  await client.query(
    `UPDATE auth_identities
     SET provider_email = COALESCE($3, provider_email),
         provider_username = COALESCE($4, provider_username),
         profile = $5,
         metadata_json = COALESCE($6, metadata_json),
         last_login_at = now(),
         updated_at = now()
     WHERE provider = $1 AND provider_user_id = $2`,
    [provider, providerUserId, profile.email, profile.username, profile, metadata]
  );
}

async function ensureUserDefaults(client, userId) {
  await client.query("INSERT INTO user_access (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [userId]);
  await client.query("INSERT INTO user_profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [userId]);
}

const TELEGRAM_LOGIN_FIELDS = new Set(["id", "first_name", "last_name", "username", "photo_url", "auth_date", "hash"]);
const TELEGRAM_STATIC_JWKS = {
  keys: [
    {
      alg: "RS256",
      e: "AQAB",
      kty: "RSA",
      n: "5RneLtsKvVcxdv6gu6gxEQu30Cru5NiMQnY6SNr9ZyZFZ4ya-pfHNuaZXJ6QPG0JSFwoxeOkEO2-eZN_REVPm448PvjjsR1eQdZ5QpEkNxnItFcmxkHH91v5cgf52_EI9BGO-MT6f1vaBSg3uWHFlDxI7J2AYxNvd1_Nf3TkgrrR7gyJFTmEIai5RefGnA0KGNYDlRIGUzrz2F05n6gTaHFT_iHL5UHatTZA4GCiUSjIOuwqu5pE5uZge20TFv3cxXMQaFw_xv1pgQt_Rq8eoCN7TS0RQ0zjWKiad-W286BcFectXsUm03p5Nq_kY4mf_7rqwX_B8yy_bBreyKn7RQ",
      kid: "oidc-1"
    },
    {
      alg: "ES256",
      kty: "EC",
      x: "ahVYrohhX6YA7w0P2gUNSwMFbaabCgBZFkeq9bWdmwU",
      y: "Ea8nKJ34VQMA7zv8aYDfzcBhXEjnWQ9C06jVke_eUV0",
      crv: "P-256",
      kid: "oidc-es256-1",
      use: "sig"
    }
  ]
};
let telegramJwksCache = { expiresAt: 0, keys: TELEGRAM_STATIC_JWKS.keys };

function extractTelegramPayload(body = {}) {
  const source = body?.telegram || body?.telegramPayload || body?.payload || body?.user || body || {};
  const payload = {};
  for (const [key, value] of Object.entries(source)) {
    if (TELEGRAM_LOGIN_FIELDS.has(key)) payload[key] = value;
  }
  return payload;
}

function verifyTelegramSignature(data) {
  if (!config.telegramBotToken || !data?.hash) return false;
  const { hash, ...params } = data;
  const dataCheckString = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("\n");
  const secretKey = crypto.createHash("sha256").update(config.telegramBotToken).digest();
  const calculated = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (calculated.length !== String(hash).length) return false;
  return crypto.timingSafeEqual(Buffer.from(calculated), Buffer.from(hash));
}

function extractTelegramOidcToken(body = {}) {
  return String(
    body?.telegramOidc?.idToken ||
    body?.telegram_oidc?.id_token ||
    body?.telegram?.id_token ||
    body?.id_token ||
    body?.idToken ||
    ""
  ).trim();
}

async function telegramJwks() {
  if (telegramJwksCache.expiresAt > Date.now() && telegramJwksCache.keys?.length) {
    return telegramJwksCache.keys;
  }
  try {
    const response = await fetch(config.telegramJwksUrl, { signal: AbortSignal.timeout(8000) });
    const data = await response.json().catch(() => ({}));
    if (response.ok && Array.isArray(data.keys) && data.keys.length) {
      telegramJwksCache = { expiresAt: Date.now() + 6 * 60 * 60 * 1000, keys: data.keys };
      return data.keys;
    }
  } catch (_) {
    // Keep static public Telegram keys as a fallback when the Moscow host cannot reach oauth.telegram.org.
  }
  return telegramJwksCache.keys?.length ? telegramJwksCache.keys : TELEGRAM_STATIC_JWKS.keys;
}

async function verifyTelegramOidcToken(idToken) {
  if (!idToken) {
    const error = new Error("Missing Telegram id_token");
    error.status = 400;
    throw error;
  }
  const decoded = jwt.decode(idToken, { complete: true });
  const header = decoded?.header || {};
  const allowedAlgorithms = ["RS256", "ES256"];
  if (!allowedAlgorithms.includes(header.alg)) {
    const error = new Error("Unsupported Telegram id_token algorithm");
    error.status = 401;
    throw error;
  }
  const keys = await telegramJwks();
  const candidates = keys.filter((key) => !header.kid || key.kid === header.kid);
  for (const jwk of candidates) {
    try {
      const keyObject = crypto.createPublicKey({ key: jwk, format: "jwk" });
      return jwt.verify(idToken, keyObject, {
        algorithms: [header.alg],
        issuer: "https://oauth.telegram.org",
        audience: String(config.telegramClientId)
      });
    } catch (_) {
      // Try the next Telegram public key.
    }
  }
  const error = new Error("Invalid Telegram id_token");
  error.status = 401;
  throw error;
}

function identityFromTelegramOidcClaims(claims = {}) {
  const providerUserId = String(claims.sub || claims.id || "");
  if (!providerUserId) {
    const error = new Error("Telegram id_token is missing subject");
    error.status = 401;
    throw error;
  }
  return {
    provider: "telegram",
    providerUserId,
    profile: {
      username: claims.preferred_username ? `@${claims.preferred_username}` : null,
      name: claims.name || null,
      photo_url: claims.picture || null,
      metadata: { provider: "telegram", oidc: true }
    },
    metadata: {
      provider: "telegram",
      oidc: true,
      issuer: claims.iss || null,
      audience: claims.aud || null
    }
  };
}

function issueSession(res, user) {
  const token = signToken(user);
  setAuthCookie(res, token);
  return token;
}

function normalizeAccessStatus(value, fallback = "free") {
  const status = String(value || fallback).toLowerCase();
  return ACCESS_STATUSES.has(status) ? status : fallback;
}

function normalizeRole(value) {
  const role = String(value || "user").toLowerCase();
  return ["admin", "trainer", "user"].includes(role) ? role : "user";
}

function dateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function setUserRole(userId, role) {
  const result = await query("UPDATE users SET role = $2, updated_at = now() WHERE id = $1 RETURNING *", [userId, role]);
  return result.rows[0];
}

async function upsertAccess(userId, options = {}) {
  const status = normalizeAccessStatus(options.status || options.access);
  const expiresAt = dateOrNull(options.expiresAt || options.premiumUntil);
  const startsAt = dateOrNull(options.startsAt);
  const isVip = status === "vip" || Boolean(options.isVip);
  const result = await query(
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
      options.plan || status,
      expiresAt,
      isVip,
      options.source || "auth-test",
      options.meta || {},
      startsAt,
      expiresAt,
      options.isActive === false ? false : true
    ]
  );
  return result.rows[0];
}

function yandexRedirectUri(req, override) {
  return override || config.yandexRedirectUri || `${req.protocol}://${req.get("host")}/api/auth/yandex/callback`;
}

function googleRedirectUri(req, override) {
  return override || config.googleRedirectUri || `${req.protocol}://${req.get("host")}/api/auth/google/callback`;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  const email = normalizeEmail(value);
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(value, email = "") {
  const password = String(value || "");
  if (password.length < PASSWORD_MIN_LENGTH) return "PASSWORD_TOO_SHORT";
  if (password.length > PASSWORD_MAX_LENGTH) return "PASSWORD_TOO_LONG";
  if (!/[A-Za-zА-Яа-яЁё]/.test(password) || !/\d/.test(password)) return "PASSWORD_REQUIRES_LETTER_AND_NUMBER";
  if (normalizeEmail(email) && password.toLowerCase() === normalizeEmail(email)) return "PASSWORD_CANNOT_MATCH_EMAIL";
  return "";
}

function emailAuthRateLimit(req, action, email = "") {
  const rule = EMAIL_AUTH_LIMITS[action] || EMAIL_AUTH_LIMITS.login;
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  const key = `${action}:${ip}:${normalizeEmail(email) || "no-email"}`;
  const now = Date.now();
  const current = emailRateLimitBuckets.get(key);
  if (!current || current.resetAt <= now) {
    emailRateLimitBuckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    return true;
  }
  current.count += 1;
  if (current.count > rule.limit) return false;
  return true;
}

function createOpaqueToken() {
  return crypto.randomBytes(EMAIL_TOKEN_BYTES).toString("base64url");
}

function hashOpaqueToken(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function emailVerificationExpiresAt() {
  const minutes = Number.isFinite(config.emailVerificationTtlMinutes) && config.emailVerificationTtlMinutes > 0
    ? config.emailVerificationTtlMinutes
    : 60;
  return new Date(Date.now() + minutes * 60 * 1000);
}

function passwordResetExpiresAt() {
  const minutes = Number.isFinite(config.passwordResetTtlMinutes) && config.passwordResetTtlMinutes > 0
    ? config.passwordResetTtlMinutes
    : 30;
  return new Date(Date.now() + minutes * 60 * 1000);
}

function verificationLink(token) {
  const base = String(config.appPublicUrl || config.appBaseUrl || "http://localhost:5173").replace(/\/+$/, "");
  return `${base}/email/verify?token=${encodeURIComponent(token)}`;
}

function passwordResetLink(token) {
  const base = String(config.appPublicUrl || config.appBaseUrl || "http://localhost:5173").replace(/\/+$/, "");
  return `${base}/email/reset-password?token=${encodeURIComponent(token)}`;
}

function publicEmailAuthResponse() {
  return {
    ok: true,
    verificationRequired: true,
    message: "If the email can be registered, a verification email will be sent."
  };
}

function publicPasswordResetResponse() {
  return {
    ok: true,
    message: "If the email has password login, a reset email will be sent."
  };
}

async function rotateVerificationToken(client, credential) {
  const token = createOpaqueToken();
  const tokenHash = hashOpaqueToken(token);
  const expiresAt = emailVerificationExpiresAt();
  await client.query(
    `UPDATE user_credentials
     SET email_verification_token_hash = $2,
         email_verification_expires_at = $3,
         updated_at = now()
     WHERE user_id = $1`,
    [credential.user_id, tokenHash, expiresAt]
  );
  return { email: credential.email, token, link: verificationLink(token) };
}

async function rotatePasswordResetToken(client, credential) {
  const token = createOpaqueToken();
  const tokenHash = hashOpaqueToken(token);
  const expiresAt = passwordResetExpiresAt();
  await client.query(
    `UPDATE user_credentials
     SET password_reset_token_hash = $2,
         password_reset_expires_at = $3,
         updated_at = now()
     WHERE user_id = $1`,
    [credential.user_id, tokenHash, expiresAt]
  );
  return { email: credential.email, token, link: passwordResetLink(token) };
}

function isAllowedAdminEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized || !config.adminAllowedEmails.length) return false;
  return config.adminAllowedEmails.map(normalizeEmail).includes(normalized);
}

function safeAuthReturnTo(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol === "fruitfit:" && url.hostname === "auth") return "fruitfit://auth";
    if (url.protocol === "fruitfitadmin:" && url.hostname === "auth") return "fruitfitadmin://auth";
    if (url.protocol === "https:" && url.hostname === "client.tagirfruit.ru") return "https://client.tagirfruit.ru";
    if (url.protocol === "https:" && url.hostname === "admin.tagirfruit.ru") return `${url.origin}${url.pathname || "/admin"}`;
    if (config.nodeEnv !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname)) return `${url.origin}${url.pathname || "/admin"}`;
  } catch (_) {
    return "";
  }
  return "";
}

function redirectWithAuthToken(res, token, returnTo = "") {
  const safeReturnTo = safeAuthReturnTo(returnTo);
  if (safeReturnTo.startsWith("fruitfit://")) {
    const url = new URL(safeReturnTo);
    url.searchParams.set("auth_token", token);
    res.redirect(url.toString());
    return;
  }
  const target = safeReturnTo || config.appBaseUrl;
  res.redirect(`${target}/#auth_token=${encodeURIComponent(token)}`);
}

function redirectToAdmin(res, returnTo = "", token = "") {
  const safeReturnTo = safeAuthReturnTo(returnTo);
  if (safeReturnTo.startsWith("fruitfitadmin://")) {
    const url = new URL(safeReturnTo);
    if (token) url.searchParams.set("auth_token", token);
    url.searchParams.set("admin", "1");
    res.redirect(url.toString());
    return;
  }
  const target = safeReturnTo || config.adminBaseUrl || "https://admin.tagirfruit.ru/admin";
  res.redirect(`${target.replace(/#.*$/, "")}#auth=ok`);
}

function yandexConfigured() {
  return Boolean(config.yandexClientId && config.yandexClientSecret);
}

function googleConfigured() {
  return Boolean(config.googleClientId && config.googleClientSecret);
}

function stateSecret() {
  return config.cookieSecret || config.jwtSecret || "fruitfit-auth-state";
}

function encodeAuthState(value = {}) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  const signature = crypto.createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function decodeAuthState(value) {
  const state = String(value || "");
  const [payload, signature] = state.split(".");
  if (!payload || !signature) return {};
  const expected = crypto.createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  if (expected.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    return {};
  }
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch (_) {
    return {};
  }
}

async function exchangeYandexProfile(req, code, overrideRedirectUri) {
  if (!yandexConfigured()) {
    const error = new Error("Yandex auth is not configured");
    error.status = 503;
    error.code = "YANDEX_NOT_CONFIGURED";
    throw error;
  }

  const redirectUri = yandexRedirectUri(req, overrideRedirectUri);
  const tokenRes = await fetch("https://oauth.yandex.ru/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: config.yandexClientId,
      client_secret: config.yandexClientSecret,
      redirect_uri: redirectUri
    })
  });
  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    const error = new Error("Yandex token exchange failed");
    error.status = tokenRes.status;
    throw error;
  }

  const profileRes = await fetch("https://login.yandex.ru/info?format=json", {
    headers: { Authorization: `OAuth ${tokenData.access_token}` }
  });
  const profileData = await profileRes.json().catch(() => ({}));
  if (!profileRes.ok) {
    const error = new Error("Yandex profile failed");
    error.status = profileRes.status;
    throw error;
  }

  const profile = {
    username: profileData.login || null,
    name: profileData.real_name || profileData.display_name || null,
    email: profileData.default_email || null,
    photo_url: profileData.is_avatar_empty ? null : `https://avatars.yandex.net/get-yapic/${profileData.default_avatar_id}/islands-200`,
    metadata: { provider: "yandex" }
  };
  return {
    provider: "yandex",
    providerUserId: String(profileData.id),
    profile,
    metadata: {
      provider: "yandex",
      defaultEmail: profileData.default_email || null,
      login: profileData.login || null
    }
  };
}

async function exchangeGoogleProfile(req, code, overrideRedirectUri) {
  if (!googleConfigured()) {
    const error = new Error("Google auth is not configured");
    error.status = 503;
    error.code = "GOOGLE_NOT_CONFIGURED";
    throw error;
  }

  const redirectUri = googleRedirectUri(req, overrideRedirectUri);
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: redirectUri
    })
  });
  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    const error = new Error("Google token exchange failed");
    error.status = tokenRes.status;
    error.code = tokenData.error || "GOOGLE_TOKEN_EXCHANGE_FAILED";
    throw error;
  }

  const profileRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` }
  });
  const profileData = await profileRes.json().catch(() => ({}));
  if (!profileRes.ok) {
    const error = new Error("Google profile failed");
    error.status = profileRes.status;
    error.code = "GOOGLE_PROFILE_FAILED";
    throw error;
  }
  if (!profileData.sub) {
    const error = new Error("Google profile is missing subject");
    error.status = 502;
    error.code = "GOOGLE_PROFILE_MISSING_SUB";
    throw error;
  }

  const profile = {
    username: profileData.email || profileData.name || null,
    name: profileData.name || null,
    email: profileData.email || null,
    photo_url: profileData.picture || null,
    metadata: {
      provider: "google",
      emailVerified: profileData.email_verified === true
    }
  };
  return {
    provider: "google",
    providerUserId: String(profileData.sub),
    profile,
    metadata: {
      provider: "google",
      email: profileData.email || null,
      emailVerified: profileData.email_verified === true,
      locale: profileData.locale || null
    }
  };
}

function providerLabel(provider) {
  return {
    telegram: "Telegram",
    yandex: "Yandex ID",
    google: "Google",
    apple: "Apple"
  }[provider] || provider;
}

function providerConfigured(provider) {
  if (provider === "telegram") return Boolean(config.telegramBotToken);
  if (provider === "yandex") return yandexConfigured();
  if (provider === "google") return googleConfigured();
  return false;
}

function providerStatus(provider) {
  if (provider === "apple") return "APPLE_NOT_CONFIGURED";
  if (provider === "google") return googleConfigured() ? "ready" : "GOOGLE_NOT_CONFIGURED";
  if (provider === "yandex") return yandexConfigured() ? "ready" : "YANDEX_NOT_CONFIGURED";
  if (provider === "telegram") return config.telegramBotToken ? "ready" : "TELEGRAM_NOT_CONFIGURED";
  return "NOT_CONFIGURED";
}

async function verifiedIdentityFromRequest(req, provider) {
  if (provider === "telegram") {
    if (!config.telegramBotToken) {
      const error = new Error("Telegram auth is not configured");
      error.status = 503;
      throw error;
    }
    const telegramOidcToken = extractTelegramOidcToken(req.body || {});
    if (telegramOidcToken) {
      const claims = await verifyTelegramOidcToken(telegramOidcToken);
      return identityFromTelegramOidcClaims(claims);
    }
    const telegramPayload = extractTelegramPayload(req.body || {});
    if (!verifyTelegramSignature(telegramPayload)) {
      const error = new Error("Invalid Telegram signature");
      error.status = 401;
      throw error;
    }
    const authDate = Number(telegramPayload.auth_date || 0);
    if (!authDate || Date.now() / 1000 - authDate > 86_400) {
      const error = new Error("Telegram auth expired");
      error.status = 401;
      throw error;
    }
    return {
      provider,
      providerUserId: String(telegramPayload.id),
      profile: {
        username: telegramPayload.username ? `@${telegramPayload.username}` : null,
        name: [telegramPayload.first_name, telegramPayload.last_name].filter(Boolean).join(" ") || null,
        photo_url: telegramPayload.photo_url || null,
        metadata: { provider }
      },
      metadata: { provider }
    };
  }

  if (provider === "yandex") {
    const code = String(req.body?.code || "");
    if (!code) {
      const error = new Error("Missing code");
      error.status = 400;
      throw error;
    }
    return exchangeYandexProfile(req, code, req.body?.redirectUri);
  }

  if (provider === "google") {
    const code = String(req.body?.code || "");
    if (!code) {
      const error = new Error("Missing code");
      error.status = 400;
      throw error;
    }
    return exchangeGoogleProfile(req, code, req.body?.redirectUri);
  }

  if (provider === "test") {
    if (!hasValidAdminToken(req)) {
      const error = new Error("Forbidden");
      error.status = 403;
      throw error;
    }
    const providerUserId = String(req.body?.providerUserId || req.body?.id || `test-${Date.now()}`);
    return {
      provider,
      providerUserId,
      profile: {
        username: req.body?.username || `test_${providerUserId}`.replace(/[^a-zA-Z0-9_.-]+/g, "_"),
        name: req.body?.name || "FruitFit Test Linked User",
        email: req.body?.email || null,
        photo_url: req.body?.photoUrl || req.body?.photo_url || null,
        metadata: { provider, testMode: true }
      },
      metadata: { provider, testMode: true }
    };
  }

  const error = new Error(`${providerLabel(provider)} auth is not configured`);
  error.status = 503;
  throw error;
}

deviceRouter.post("/register", async (req, res) => {
  const device = devicePayloadFromBody(req.body || {}, req);
  if (!device.installationId) {
    res.status(400).json({ error: "installation_id is required" });
    return;
  }

  const user = await optionalUserFromRequest(req);
  const result = await transaction((client) =>
    upsertUserDevice(client, device, {
      userId: user?.id || null,
      pushTokenId: req.body?.pushTokenId || req.body?.push_token_id || null
    })
  );
  res.status(201).json({
    device: serializeDevice(result),
    region: { country: result.country || device.country || null, source: result.region_source || device.regionSource || "unknown" }
  });
});

authRouter.get("/providers/available", async (req, res) => {
  const device = devicePayloadFromQuery(req.query || {}, req);
  const region = resolveRegion(req, device);
  const providerNames = availableProviderNames(region.country);
  const providers = providerNames.map((provider) => ({
    provider,
    label: providerLabel(provider),
    enabled: providerConfigured(provider),
    configured: providerConfigured(provider),
    status: providerStatus(provider)
  }));
  res.json({ region, providers });
});

authRouter.post("/email/register", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  const confirmPassword = String(req.body?.confirmPassword ?? req.body?.confirm_password ?? "");
  if (!emailAuthRateLimit(req, "register", email)) {
    res.status(429).json({ error: "RATE_LIMITED" });
    return;
  }
  if (!isValidEmail(email)) {
    res.status(400).json({ error: "INVALID_EMAIL" });
    return;
  }
  const passwordError = validatePassword(password, email);
  if (passwordError) {
    res.status(400).json({ error: passwordError });
    return;
  }
  if (!confirmPassword) {
    res.status(400).json({ error: "MISSING_PASSWORD_CONFIRMATION" });
    return;
  }
  if (password !== confirmPassword) {
    res.status(400).json({ error: "PASSWORD_CONFIRMATION_MISMATCH" });
    return;
  }
  if (config.nodeEnv === "production" && !isEmailSmtpConfigured()) {
    res.status(503).json({ error: "SMTP_NOT_CONFIGURED" });
    return;
  }

  let verification = null;
  try {
    verification = await transaction(async (client) => {
      const existingCredential = await client.query(
        `SELECT *
         FROM user_credentials
         WHERE email_normalized = $1
         FOR UPDATE`,
        [email]
      );
      if (existingCredential.rowCount) {
        const credential = existingCredential.rows[0];
        if (!credential.email_verified_at) {
          return rotateVerificationToken(client, credential);
        }
        return null;
      }

      const existingIdentity = await client.query(
        `SELECT user_id
         FROM auth_identities
         WHERE provider = 'email'
           AND provider_user_id = $1
         LIMIT 1`,
        [email]
      );
      const existingUser = existingIdentity.rowCount
        ? await client.query("SELECT * FROM users WHERE id = $1", [existingIdentity.rows[0].user_id])
        : await client.query("SELECT * FROM users WHERE lower(email) = $1 LIMIT 1", [email]);

      let user = existingUser.rows[0] || null;
      if (user) {
        const userCredential = await client.query(
          `SELECT *
           FROM user_credentials
           WHERE user_id = $1
           FOR UPDATE`,
          [user.id]
        );
        if (userCredential.rowCount) {
          const credential = userCredential.rows[0];
          if (!credential.email_verified_at && credential.email_normalized === email) {
            return rotateVerificationToken(client, credential);
          }
          return null;
        }
      } else {
        const id = crypto.randomUUID();
        const name = email.split("@")[0] || null;
        const created = await client.query(
          `INSERT INTO users (id, email, name)
           VALUES ($1, $2, $3)
           RETURNING *`,
          [id, email, name]
        );
        user = created.rows[0];
      }

      await client.query(
        `INSERT INTO auth_identities (
           user_id, provider, provider_user_id, provider_email, provider_username,
           profile, metadata_json, linked_at, last_login_at, updated_at
         )
         VALUES ($1, 'email', $2, $3, $4, $5, $6, now(), NULL, now())
         ON CONFLICT (provider, provider_user_id)
         DO UPDATE SET provider_email = COALESCE(auth_identities.provider_email, EXCLUDED.provider_email),
                       provider_username = COALESCE(auth_identities.provider_username, EXCLUDED.provider_username),
                       updated_at = now()`,
        [
          user.id,
          email,
          email,
          email,
          { email, provider: "email" },
          { provider: "email", passwordAuth: true }
        ]
      );
      await ensureUserDefaults(client, user.id);
      await upsertUserDevice(client, devicePayloadFromBody(req.body || {}, req), { userId: user.id });

      const passwordHash = await bcrypt.hash(password, 12);
      const token = createOpaqueToken();
      await client.query(
        `INSERT INTO user_credentials (
           user_id, email, email_normalized, password_hash,
           email_verification_token_hash, email_verification_expires_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, now())`,
        [user.id, email, email, passwordHash, hashOpaqueToken(token), emailVerificationExpiresAt()]
      );
      return { email, token, link: verificationLink(token) };
    });

    if (verification) {
      const emailResult = await sendVerificationEmail(verification.email, verification.link);
      if (config.nodeEnv === "production" && emailResult.status === "SMTP_NOT_CONFIGURED") {
        res.status(503).json({ error: "SMTP_NOT_CONFIGURED" });
        return;
      }
    }
    res.status(202).json(publicEmailAuthResponse());
  } catch (error) {
    if (error?.code === "23505") {
      res.status(202).json(publicEmailAuthResponse());
      return;
    }
    console.error("[fruitfit-auth] email register failed", { message: error?.message || "unknown" });
    res.status(500).json({ error: "EMAIL_REGISTER_FAILED" });
  }
});

authRouter.post("/email/resend-verification", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!emailAuthRateLimit(req, "resend", email)) {
    res.status(429).json({ error: "RATE_LIMITED" });
    return;
  }
  if (!isValidEmail(email)) {
    res.status(202).json(publicEmailAuthResponse());
    return;
  }
  if (config.nodeEnv === "production" && !isEmailSmtpConfigured()) {
    res.status(503).json({ error: "SMTP_NOT_CONFIGURED" });
    return;
  }

  try {
    const verification = await transaction(async (client) => {
      const credential = await client.query(
        `SELECT *
         FROM user_credentials
         WHERE email_normalized = $1
         FOR UPDATE`,
        [email]
      );
      if (!credential.rowCount || credential.rows[0].email_verified_at) return null;
      return rotateVerificationToken(client, credential.rows[0]);
    });
    if (verification) {
      const emailResult = await sendVerificationEmail(verification.email, verification.link);
      if (config.nodeEnv === "production" && emailResult.status === "SMTP_NOT_CONFIGURED") {
        res.status(503).json({ error: "SMTP_NOT_CONFIGURED" });
        return;
      }
    }
    res.status(202).json(publicEmailAuthResponse());
  } catch (error) {
    console.error("[fruitfit-auth] email verification resend failed", { message: error?.message || "unknown" });
    res.status(202).json(publicEmailAuthResponse());
  }
});

authRouter.post("/email/verify", async (req, res) => {
  const token = String(req.body?.token || req.query?.token || "").trim();
  if (!token) {
    res.status(400).json({ error: "MISSING_TOKEN" });
    return;
  }

  try {
    const result = await transaction(async (client) => {
      const credential = await client.query(
        `SELECT *
         FROM user_credentials
         WHERE email_verification_token_hash = $1
           AND email_verification_expires_at > now()
         FOR UPDATE`,
        [hashOpaqueToken(token)]
      );
      if (!credential.rowCount) return null;
      const row = credential.rows[0];
      await client.query(
        `UPDATE user_credentials
         SET email_verified_at = COALESCE(email_verified_at, now()),
             email_verification_token_hash = NULL,
             email_verification_expires_at = NULL,
             updated_at = now()
         WHERE user_id = $1`,
        [row.user_id]
      );
      const user = await client.query(
        `UPDATE users
         SET email = COALESCE(email, $2),
             email_verified_at = COALESCE(email_verified_at, now()),
             updated_at = now()
         WHERE id = $1
         RETURNING id, email, name, username, photo_url, role, email_verified_at, created_at, updated_at`,
        [row.user_id, row.email]
      );
      return user.rows[0] || null;
    });
    if (!result) {
      res.status(400).json({ error: "INVALID_OR_EXPIRED_TOKEN" });
      return;
    }
    res.json({ ok: true, emailVerified: true, user: result });
  } catch (error) {
    console.error("[fruitfit-auth] email verify failed", { message: error?.message || "unknown" });
    res.status(500).json({ error: "EMAIL_VERIFY_FAILED" });
  }
});

authRouter.post("/email/login", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  if (!emailAuthRateLimit(req, "login", email)) {
    res.status(429).json({ error: "RATE_LIMITED" });
    return;
  }
  if (!isValidEmail(email) || !password) {
    res.status(401).json({ error: "INVALID_CREDENTIALS" });
    return;
  }

  try {
    const credential = await query(
      `SELECT uc.*, u.id, u.email AS user_email, u.name, u.username, u.photo_url, u.role,
              u.email_verified_at AS user_email_verified_at, u.created_at, u.updated_at
       FROM user_credentials uc
       JOIN users u ON u.id = uc.user_id
       WHERE uc.email_normalized = $1`,
      [email]
    );
    if (!credential.rowCount) {
      res.status(401).json({ error: "INVALID_CREDENTIALS" });
      return;
    }
    const row = credential.rows[0];
    const passwordOk = await bcrypt.compare(password, row.password_hash);
    if (!passwordOk) {
      res.status(401).json({ error: "INVALID_CREDENTIALS" });
      return;
    }
    if (!row.email_verified_at) {
      res.status(403).json({ error: "EMAIL_NOT_VERIFIED" });
      return;
    }

    const user = {
      id: row.id,
      email: row.user_email,
      name: row.name,
      username: row.username,
      photo_url: row.photo_url,
      role: row.role,
      email_verified_at: row.user_email_verified_at,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
    await transaction(async (client) => {
      await touchIdentity(
        client,
        "email",
        email,
        { email, username: email, metadata: { provider: "email" } },
        { provider: "email", passwordAuth: true }
      );
      await upsertUserDevice(client, devicePayloadFromBody(req.body || {}, req), { userId: user.id });
    });
    const token = issueSession(res, user);
    res.json({ token, user });
  } catch (error) {
    console.error("[fruitfit-auth] email login failed", { message: error?.message || "unknown" });
    res.status(500).json({ error: "EMAIL_LOGIN_FAILED" });
  }
});

authRouter.post("/email/request-password-reset", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!emailAuthRateLimit(req, "resetRequest", email)) {
    res.status(429).json({ error: "RATE_LIMITED" });
    return;
  }
  if (!isValidEmail(email)) {
    res.status(202).json(publicPasswordResetResponse());
    return;
  }
  if (config.nodeEnv === "production" && !isEmailSmtpConfigured()) {
    res.status(503).json({ error: "SMTP_NOT_CONFIGURED" });
    return;
  }

  try {
    const reset = await transaction(async (client) => {
      const credential = await client.query(
        `SELECT *
         FROM user_credentials
         WHERE email_normalized = $1
           AND email_verified_at IS NOT NULL
         FOR UPDATE`,
        [email]
      );
      if (!credential.rowCount) return null;
      return rotatePasswordResetToken(client, credential.rows[0]);
    });
    if (reset) {
      const emailResult = await sendPasswordResetEmail(reset.email, reset.link);
      if (config.nodeEnv === "production" && emailResult.status === "SMTP_NOT_CONFIGURED") {
        res.status(503).json({ error: "SMTP_NOT_CONFIGURED" });
        return;
      }
    }
    res.status(202).json(publicPasswordResetResponse());
  } catch (error) {
    console.error("[fruitfit-auth] password reset request failed", { message: error?.message || "unknown" });
    res.status(202).json(publicPasswordResetResponse());
  }
});

authRouter.post("/email/reset-password", async (req, res) => {
  const token = String(req.body?.token || req.query?.token || "").trim();
  const password = String(req.body?.password || "");
  if (!emailAuthRateLimit(req, "resetPassword", token.slice(0, 16))) {
    res.status(429).json({ error: "RATE_LIMITED" });
    return;
  }
  if (!token) {
    res.status(400).json({ error: "MISSING_TOKEN" });
    return;
  }
  const passwordError = validatePassword(password);
  if (passwordError) {
    res.status(400).json({ error: passwordError });
    return;
  }

  try {
    const result = await transaction(async (client) => {
      const credential = await client.query(
        `SELECT *
         FROM user_credentials
         WHERE password_reset_token_hash = $1
           AND password_reset_expires_at > now()
           AND email_verified_at IS NOT NULL
         FOR UPDATE`,
        [hashOpaqueToken(token)]
      );
      if (!credential.rowCount) return null;
      const row = credential.rows[0];
      const rowPasswordError = validatePassword(password, row.email_normalized);
      if (rowPasswordError) {
        const error = new Error(rowPasswordError);
        error.status = 400;
        error.code = rowPasswordError;
        throw error;
      }
      const passwordHash = await bcrypt.hash(password, 12);
      await client.query(
        `UPDATE user_credentials
         SET password_hash = $2,
             password_reset_token_hash = NULL,
             password_reset_expires_at = NULL,
             updated_at = now()
         WHERE user_id = $1`,
        [row.user_id, passwordHash]
      );
      await client.query(
        `UPDATE auth_identities
         SET metadata_json = COALESCE(metadata_json, '{}'::jsonb) || jsonb_build_object('passwordResetAt', now()),
             updated_at = now()
         WHERE provider = 'email'
           AND provider_user_id = $1`,
        [row.email_normalized]
      );
      return { email: row.email };
    });
    if (!result) {
      res.status(400).json({ error: "INVALID_OR_EXPIRED_TOKEN" });
      return;
    }
    res.json({ ok: true, passwordReset: true });
  } catch (error) {
    if (error?.status) {
      res.status(error.status).json({ error: error.code || error.message });
      return;
    }
    console.error("[fruitfit-auth] password reset failed", { message: error?.message || "unknown" });
    res.status(500).json({ error: "PASSWORD_RESET_FAILED" });
  }
});

authRouter.post("/telegram", async (req, res) => {
  if (!config.telegramBotToken) {
    res.status(503).json({ error: "Telegram auth is not configured" });
    return;
  }
  const telegramOidcToken = extractTelegramOidcToken(req.body || {});
  if (telegramOidcToken) {
    try {
      const claims = await verifyTelegramOidcToken(telegramOidcToken);
      const identity = identityFromTelegramOidcClaims(claims);
      const currentUser = await optionalUserFromRequest(req);
      const device = devicePayloadFromBody(req.body || {}, req);
      const user = await findOrCreateUserByIdentity(identity.provider, identity.providerUserId, identity.profile, {
        req,
        device,
        currentUserId: currentUser?.id || null,
        metadata: identity.metadata
      });
      const token = issueSession(res, user);
      res.json({ token, user });
      return;
    } catch (error) {
      res.status(error.status || 401).json({ error: error.message || "Invalid Telegram id_token" });
      return;
    }
  }
  const telegramPayload = extractTelegramPayload(req.body || {});
  if (!verifyTelegramSignature(telegramPayload)) {
    res.status(401).json({ error: "Invalid Telegram signature" });
    return;
  }
  const authDate = Number(telegramPayload.auth_date || 0);
  if (!authDate || Date.now() / 1000 - authDate > 86_400) {
    res.status(401).json({ error: "Telegram auth expired" });
    return;
  }

  const profile = {
    username: telegramPayload.username ? `@${telegramPayload.username}` : null,
    name: [telegramPayload.first_name, telegramPayload.last_name].filter(Boolean).join(" ") || null,
    photo_url: telegramPayload.photo_url || null,
    metadata: { provider: "telegram" }
  };
  const currentUser = await optionalUserFromRequest(req);
  const device = devicePayloadFromBody(req.body || {}, req);
  const user = await findOrCreateUserByIdentity("telegram", String(telegramPayload.id), profile, {
    req,
    device,
    currentUserId: currentUser?.id || null,
    metadata: { provider: "telegram" }
  });
  const token = issueSession(res, user);
  res.json({ token, user });
});

authRouter.get("/google", async (req, res) => {
  if (!googleConfigured()) {
    res.status(503).json({ error: "GOOGLE_NOT_CONFIGURED" });
    return;
  }
  const currentUser = await optionalUserFromRequest(req);
  const device = devicePayloadFromQuery(req.query || {}, req);
  const mode = String(req.query.mode || "").trim().toLowerCase() === "admin" ? "admin" : "";
  const state = encodeAuthState({
    currentUserId: currentUser?.id || null,
    device,
    mode,
    returnTo: safeAuthReturnTo(req.query.returnTo || req.query.return_to || (mode === "admin" ? config.adminBaseUrl : ""))
  });
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", config.googleClientId);
  authUrl.searchParams.set("redirect_uri", googleRedirectUri(req));
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "select_account");
  res.redirect(authUrl.toString());
});

authRouter.post("/google", async (req, res) => {
  const code = String(req.body?.code || "");
  if (!code) {
    res.status(400).json({ error: "Missing code" });
    return;
  }

  try {
    const identity = await exchangeGoogleProfile(req, code, req.body?.redirectUri);
    const currentUser = await optionalUserFromRequest(req);
    const user = await findOrCreateUserByIdentity(identity.provider, identity.providerUserId, identity.profile, {
      req,
      device: devicePayloadFromBody(req.body || {}, req),
      currentUserId: currentUser?.id || null,
      metadata: identity.metadata
    });
    const token = issueSession(res, user);
    res.json({ token, user });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.code || error.message || "Google auth failed" });
  }
});

authRouter.get("/google/callback", async (req, res) => {
  const code = String(req.query.code || "");
  if (!code) {
    res.status(400).json({ error: "Missing code" });
    return;
  }
  try {
    const authState = decodeAuthState(req.query.state);
    const identity = await exchangeGoogleProfile(req, code);
    if (authState.mode === "admin") {
      if (identity.metadata.emailVerified !== true || !isAllowedAdminEmail(identity.profile.email)) {
        res.status(403).send("Google account is not allowed for FruitFit Admin");
        return;
      }
    }
    const user = await findOrCreateUserByIdentity(identity.provider, identity.providerUserId, identity.profile, {
      req,
      device: authState.device,
      currentUserId: authState.currentUserId || null,
      metadata: identity.metadata
    });
    if (authState.mode === "admin") {
      const adminUser = user.role === "admin" ? user : await setUserRole(user.id, "admin");
      await upsertAccess(adminUser.id, {
        status: "admin",
        plan: "admin",
        source: "google-admin",
        meta: { provider: "google", email: identity.profile.email || null }
      });
      const token = issueSession(res, adminUser);
      redirectToAdmin(res, authState.returnTo, token);
      return;
    }
    const token = issueSession(res, user);
    redirectWithAuthToken(res, token, authState.returnTo);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.code || error.message || "Google auth failed" });
  }
});

authRouter.get("/yandex", async (req, res) => {
  if (!yandexConfigured()) {
    res.status(503).json({ error: "YANDEX_NOT_CONFIGURED" });
    return;
  }
  const currentUser = await optionalUserFromRequest(req);
  const device = devicePayloadFromQuery(req.query || {}, req);
  const state = encodeAuthState({
    currentUserId: currentUser?.id || null,
    device,
    returnTo: safeAuthReturnTo(req.query.returnTo || req.query.return_to)
  });
  const authUrl = new URL("https://oauth.yandex.ru/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", config.yandexClientId);
  authUrl.searchParams.set("redirect_uri", yandexRedirectUri(req));
  authUrl.searchParams.set("state", state);
  res.redirect(authUrl.toString());
});

authRouter.post("/yandex", async (req, res) => {
  const code = String(req.body?.code || "");
  if (!code) {
    res.status(400).json({ error: "Missing code" });
    return;
  }

  try {
    const identity = await exchangeYandexProfile(req, code, req.body?.redirectUri);
    const currentUser = await optionalUserFromRequest(req);
    const user = await findOrCreateUserByIdentity(identity.provider, identity.providerUserId, identity.profile, {
      req,
      device: devicePayloadFromBody(req.body || {}, req),
      currentUserId: currentUser?.id || null,
      metadata: identity.metadata
    });
    const token = issueSession(res, user);
    res.json({ token, user });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.code || error.message || "Yandex auth failed" });
  }
});

authRouter.get("/yandex/callback", async (req, res) => {
  const code = String(req.query.code || "");
  if (!code) {
    res.status(400).json({ error: "Missing code" });
    return;
  }
  try {
    const authState = decodeAuthState(req.query.state);
    const identity = await exchangeYandexProfile(req, code);
    const user = await findOrCreateUserByIdentity(identity.provider, identity.providerUserId, identity.profile, {
      req,
      device: authState.device,
      currentUserId: authState.currentUserId || null,
      metadata: identity.metadata
    });
    const token = issueSession(res, user);
    redirectWithAuthToken(res, token, authState.returnTo);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.code || error.message || "Yandex auth failed" });
  }
});

authRouter.get("/me", requireUser, (req, res) => {
  res.json({ user: req.user });
});

authRouter.post("/link-provider", requireUser, async (req, res) => {
  const provider = normalizeProvider(req.body?.provider);
  try {
    const identity = await verifiedIdentityFromRequest(req, provider);
    const identities = await linkIdentityToUser(req.user.id, identity.provider, identity.providerUserId, identity.profile, {
      req,
      device: devicePayloadFromBody(req.body || {}, req),
      metadata: identity.metadata
    });
    res.status(201).json({ identities });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Provider link failed" });
  }
});

authRouter.delete("/unlink-provider", requireUser, async (req, res) => {
  const provider = normalizeProvider(req.body?.provider || req.query?.provider);
  const providerUserId = cleanText(req.body?.providerUserId || req.body?.provider_user_id || req.query?.providerUserId, 240);
  if (!PUBLIC_AUTH_PROVIDERS.has(provider) && provider !== "test") {
    res.status(400).json({ error: "Unsupported provider" });
    return;
  }

  const identities = await query("SELECT * FROM auth_identities WHERE user_id = $1", [req.user.id]);
  if (identities.rowCount <= 1) {
    res.status(400).json({ error: "Cannot unlink the last provider" });
    return;
  }

  const result = await query(
    `DELETE FROM auth_identities
     WHERE user_id = $1
       AND provider = $2
       AND ($3::text IS NULL OR provider_user_id = $3)
     RETURNING *`,
    [req.user.id, provider, providerUserId]
  );
  res.json({ removed: result.rows.map(serializeIdentity) });
});

authRouter.post("/logout", (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

authRouter.post("/admin-session", async (req, res) => {
  if (!hasValidAdminToken(req)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const user = await findOrCreateUserByIdentity("admin_session", "owner", {
    username: "fruitfit-admin",
    name: "FruitFit Admin",
    email: null,
    photo_url: null
  });
  const adminUser = user.role === "admin" ? user : await setUserRole(user.id, "admin");
  const access = await upsertAccess(adminUser.id, {
    status: "admin",
    plan: "admin",
    source: "admin-session",
    meta: { reason: "manual admin token login" }
  });
  const token = issueSession(res, adminUser);
  res.json({ token, user: adminUser, access });
});

authRouter.post("/test-login", async (req, res) => {
  if (!hasValidAdminToken(req)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const provider = normalizeProvider(req.body?.provider || "test");
  const providerUserId = String(req.body?.providerUserId || req.body?.id || `test-${Date.now()}`);
  const profile = {
    username: req.body?.username || `test_${providerUserId}`.replace(/[^a-zA-Z0-9_.-]+/g, "_"),
    name: req.body?.name || "FruitFit Test User",
    email: req.body?.email || null,
    photo_url: req.body?.photoUrl || req.body?.photo_url || null,
    metadata: { provider, testMode: true }
  };
  const requestedRole = normalizeRole(req.body?.role);
  const requestedStatus = normalizeAccessStatus(req.body?.access || req.body?.status || (requestedRole === "admin" ? "admin" : "free"));
  const currentUser = await optionalUserFromRequest(req);
  const user = await findOrCreateUserByIdentity(provider, providerUserId, profile, {
    req,
    device: devicePayloadFromBody(req.body || {}, req),
    currentUserId: currentUser?.id || null,
    metadata: { provider, testMode: true }
  });
  const role = requestedStatus === "admin" ? "admin" : requestedStatus === "trainer" ? "trainer" : requestedRole;
  const savedUser = user.role === role ? user : await setUserRole(user.id, role);
  const access = await upsertAccess(savedUser.id, {
    status: requestedStatus,
    plan: req.body?.plan || requestedStatus,
    startsAt: req.body?.startsAt,
    expiresAt: req.body?.expiresAt,
    premiumUntil: req.body?.premiumUntil,
    isVip: requestedStatus === "vip",
    isActive: req.body?.isActive !== false,
    source: "test-login",
    meta: { provider, providerUserId, reason: "protected e2e test login" }
  });
  const token = issueSession(res, savedUser);
  res.status(201).json({ token, user: savedUser, access });
});
