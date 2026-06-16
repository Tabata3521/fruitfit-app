const TEXT_LIMITS = Object.freeze({
  installationId: 160,
  deviceId: 160,
  platform: 40,
  appVersion: 80,
  manufacturer: 120,
  model: 160,
  osVersion: 120,
  timezone: 120,
  language: 40,
  country: 8,
  regionSource: 80
});

const RUSSIAN_TIMEZONES = new Set([
  "Europe/Kaliningrad",
  "Europe/Moscow",
  "Europe/Simferopol",
  "Europe/Kirov",
  "Europe/Samara",
  "Asia/Yekaterinburg",
  "Asia/Omsk",
  "Asia/Novosibirsk",
  "Asia/Barnaul",
  "Asia/Tomsk",
  "Asia/Novokuznetsk",
  "Asia/Krasnoyarsk",
  "Asia/Irkutsk",
  "Asia/Chita",
  "Asia/Yakutsk",
  "Asia/Khandyga",
  "Asia/Vladivostok",
  "Asia/Ust-Nera",
  "Asia/Magadan",
  "Asia/Sakhalin",
  "Asia/Srednekolymsk",
  "Asia/Kamchatka",
  "Asia/Anadyr"
]);

export const AUTH_PROVIDER_VALUES = new Set(["telegram", "yandex", "google", "apple", "email", "test", "admin_session"]);
export const PUBLIC_AUTH_PROVIDERS = new Set(["telegram", "yandex", "google", "apple"]);

export function normalizeProvider(value, fallback = "test") {
  const provider = String(value || fallback).trim().toLowerCase();
  return AUTH_PROVIDER_VALUES.has(provider) ? provider : fallback;
}

export function normalizeProfile(profile = {}) {
  const metadata = sanitizeObject(profile.metadata || profile.meta || {});
  return {
    email: cleanText(profile.email, 320),
    username: cleanText(profile.username || profile.login, 160),
    name: cleanText(profile.name || profile.displayName || profile.display_name, 240),
    photo_url: cleanText(profile.photo_url || profile.photoUrl, 1000),
    metadata
  };
}

export function normalizeDevicePayload(input = {}, req = null) {
  const source = input && typeof input === "object" ? input : {};
  const timezone = cleanText(source.timezone || source.timeZone, TEXT_LIMITS.timezone);
  const language = cleanText(source.language || source.locale, TEXT_LIMITS.language);
  const country = normalizeCountryCode(source.country || countryFromLanguage(language));
  const region = resolveRegion(req, { timezone, language, country });
  return {
    installationId: cleanText(source.installationId || source.installation_id, TEXT_LIMITS.installationId),
    deviceId: cleanText(source.deviceId || source.device_id, TEXT_LIMITS.deviceId),
    platform: cleanText(source.platform, TEXT_LIMITS.platform),
    appVersion: cleanText(source.appVersion || source.app_version, TEXT_LIMITS.appVersion),
    manufacturer: cleanText(source.manufacturer, TEXT_LIMITS.manufacturer),
    model: cleanText(source.model, TEXT_LIMITS.model),
    osVersion: cleanText(source.osVersion || source.os_version, TEXT_LIMITS.osVersion),
    timezone,
    language,
    country: region.country || country,
    regionSource: region.source
  };
}

export function devicePayloadFromBody(body = {}, req = null) {
  const source = body?.device || body?.deviceInfo || body?.device_info || body || {};
  return normalizeDevicePayload(source, req);
}

export function devicePayloadFromQuery(query = {}, req = null) {
  return normalizeDevicePayload(query || {}, req);
}

export function resolveRegion(req = null, device = {}) {
  const headerCountry = normalizeCountryCode(
    req?.headers?.["cf-ipcountry"] ||
      req?.headers?.["x-vercel-ip-country"] ||
      req?.headers?.["x-country-code"] ||
      req?.headers?.["x-client-country"]
  );
  if (headerCountry && headerCountry !== "XX") {
    return { country: headerCountry, source: "edge_header" };
  }

  const headerLanguage = String(req?.headers?.["accept-language"] || "").split(",")[0];
  const deviceCountry = normalizeCountryCode(device.country);
  if (deviceCountry) return { country: deviceCountry, source: "client_locale" };

  if (device.timezone && RUSSIAN_TIMEZONES.has(String(device.timezone))) {
    return { country: "RU", source: "timezone_fallback" };
  }

  if (String(device.language || headerLanguage || "").toLowerCase().startsWith("ru")) {
    return { country: "RU", source: "language_fallback" };
  }

  return { country: null, source: "unknown" };
}

export function availableProviderNames(country) {
  return ["telegram", "yandex", "google", "apple"];
}

export async function upsertUserDevice(client, device, { userId = null, pushTokenId = null } = {}) {
  if (!device?.installationId) return null;
  const result = await client.query(
    `INSERT INTO user_devices (
       user_id, installation_id, device_id, platform, app_version, manufacturer, model, os_version,
       timezone, language, country, region_source, push_token_id, first_seen_at, last_seen_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), now())
     ON CONFLICT (installation_id)
     DO UPDATE SET user_id = CASE
                     WHEN EXCLUDED.user_id IS NOT NULL THEN EXCLUDED.user_id
                     ELSE user_devices.user_id
                   END,
                   device_id = COALESCE(EXCLUDED.device_id, user_devices.device_id),
                   platform = COALESCE(EXCLUDED.platform, user_devices.platform),
                   app_version = COALESCE(EXCLUDED.app_version, user_devices.app_version),
                   manufacturer = COALESCE(EXCLUDED.manufacturer, user_devices.manufacturer),
                   model = COALESCE(EXCLUDED.model, user_devices.model),
                   os_version = COALESCE(EXCLUDED.os_version, user_devices.os_version),
                   timezone = COALESCE(EXCLUDED.timezone, user_devices.timezone),
                   language = COALESCE(EXCLUDED.language, user_devices.language),
                   country = COALESCE(EXCLUDED.country, user_devices.country),
                   region_source = COALESCE(EXCLUDED.region_source, user_devices.region_source),
                   push_token_id = COALESCE(EXCLUDED.push_token_id, user_devices.push_token_id),
                   last_seen_at = now()
     RETURNING *`,
    [
      userId,
      device.installationId,
      device.deviceId,
      device.platform,
      device.appVersion,
      device.manufacturer,
      device.model,
      device.osVersion,
      device.timezone,
      device.language,
      device.country,
      device.regionSource,
      pushTokenId
    ]
  );
  return result.rows[0] || null;
}

export async function userIdForInstallation(client, installationId) {
  if (!installationId) return null;
  const result = await client.query(
    `SELECT user_id
     FROM user_devices
     WHERE installation_id = $1
       AND user_id IS NOT NULL`,
    [installationId]
  );
  return result.rows[0]?.user_id || null;
}

export function serializeDevice(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id || null,
    installationId: row.installation_id,
    deviceId: row.device_id,
    platform: row.platform,
    appVersion: row.app_version,
    manufacturer: row.manufacturer,
    model: row.model,
    osVersion: row.os_version,
    timezone: row.timezone,
    language: row.language,
    country: row.country,
    regionSource: row.region_source,
    pushTokenId: row.push_token_id,
    firstSeenAt: toIso(row.first_seen_at),
    lastSeenAt: toIso(row.last_seen_at)
  };
}

export function serializeIdentity(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    providerUserId: row.provider_user_id,
    providerEmail: row.provider_email,
    providerUsername: row.provider_username,
    profile: row.profile || {},
    metadata: row.metadata_json || {},
    linkedAt: toIso(row.linked_at || row.created_at),
    lastLoginAt: toIso(row.last_login_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

export function cleanText(value, maxLength = 240) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

export function sanitizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value));
}

function normalizeCountryCode(value) {
  const country = cleanText(value, TEXT_LIMITS.country);
  if (!country) return null;
  const normalized = country.toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

function countryFromLanguage(language) {
  const match = String(language || "").match(/[-_]([a-zA-Z]{2})$/);
  return match ? match[1] : null;
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
