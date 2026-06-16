import crypto from "node:crypto";
import { config } from "./config.js";

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

let cachedAccessToken = null;

export function getFcmStatus() {
  const serviceAccount = parseServiceAccount();
  return {
    configured: Boolean(config.fcmProjectId && serviceAccount?.client_email && serviceAccount?.private_key),
    projectId: config.fcmProjectId || serviceAccount?.project_id || "",
    hasServiceAccount: Boolean(serviceAccount)
  };
}

export async function sendFcmMessage({ token, title, body, data = {} }) {
  const serviceAccount = parseServiceAccount();
  const projectId = config.fcmProjectId || serviceAccount?.project_id;
  if (!projectId || !serviceAccount?.client_email || !serviceAccount?.private_key) {
    throw new Error("FCM is not configured");
  }

  const accessToken = await getAccessToken(serviceAccount);
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        data: stringifyData(data),
        android: {
          priority: "NORMAL",
          notification: {
            channel_id: "fruitfit_motivation"
          }
        }
      }
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `FCM send failed: ${response.status}`);
  }
  return payload;
}

async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccessToken?.token && cachedAccessToken.expiresAt - 60 > now) return cachedAccessToken.token;

  const assertion = signJwt(serviceAccount, now);
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error_description || payload?.error || "FCM OAuth token failed");
  }

  cachedAccessToken = {
    token: payload.access_token,
    expiresAt: now + Number(payload.expires_in || 3600)
  };
  return cachedAccessToken.token;
}

function signJwt(serviceAccount, now) {
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: serviceAccount.client_email,
    scope: FCM_SCOPE,
    aud: OAUTH_TOKEN_URL,
    iat: now,
    exp: now + 3600
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(serviceAccount.private_key);
  return `${unsigned}.${base64Url(signature)}`;
}

function parseServiceAccount() {
  const raw = config.fcmServiceAccountJson;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    try {
      return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    } catch {
      return null;
    }
  }
}

function stringifyData(data) {
  const output = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (value === undefined || value === null) continue;
    output[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return output;
}

function base64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
