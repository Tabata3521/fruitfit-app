// Cloudflare Pages Function: /api/auth/me
// Валидирует JWT токен из заголовка Authorization и возвращает данные пользователя
export async function onRequestGet({ request, env }) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jwtSecret = env.JWT_SECRET || "fruitfit_super_secret_jwt_key_2026";

  try {
    const user = await verifyJwt(token, jwtSecret);
    if (!user) throw new Error("Invalid token");
    return Response.json({ user });
  } catch (err) {
    console.error("[FruitFit Auth] /me verify failed", err.message);
    return Response.json({ error: "Invalid token" }, { status: 401 });
  }
}

async function verifyJwt(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed JWT");

  const [headerB64, payloadB64, sigB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  // Restore padding and decode signature
  const sigBytes = Uint8Array.from(atob(sigB64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const valid = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(signingInput));
  if (!valid) throw new Error("Invalid signature");

  // Decode payload
  const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
    throw new Error("Token expired");
  }

  return payload;
}
