// Cloudflare Pages Function: /api/auth/telegram/callback
// Принимает данные от Telegram Login Widget, проверяет подпись, создаёт JWT, редиректит в PWA
export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const params = Object.fromEntries(url.searchParams.entries());
    const { hash, ...data } = params;
    const appBaseUrl = env.APP_BASE_URL || url.origin;

    if (!hash) {
      return Response.redirect(`${appBaseUrl}/#auth_error=no_hash`, 302);
    }

    const botToken = env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return Response.json({ error: "TELEGRAM_BOT_TOKEN не задан" }, { status: 500 });
    }

    // 1. Проверить подпись Telegram
    const dataCheckString = Object.keys(data)
      .sort()
      .map((key) => `${key}=${data[key]}`)
      .join("\n");

    const secretKey = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(botToken));
    const sigKey = await crypto.subtle.importKey(
      "raw", secretKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", sigKey, new TextEncoder().encode(dataCheckString));
    const calculatedHash = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");

    if (calculatedHash !== hash) {
      console.error("[FruitFit Telegram] Invalid signature");
      return Response.redirect(`${appBaseUrl}/#auth_error=invalid_signature`, 302);
    }

    // 2. Проверить срок действия (не старше 24ч)
    const authDate = Number(data.auth_date);
    if (Date.now() / 1000 - authDate > 86400) {
      return Response.redirect(`${appBaseUrl}/#auth_error=expired`, 302);
    }

    // 3. Сформировать JWT
    const jwtSecret = env.JWT_SECRET || "fruitfit_super_secret_jwt_key_2026";
    const user = {
      id: `telegram_${data.id}`,
      provider: "telegram",
      name: [data.first_name, data.last_name].filter(Boolean).join(" "),
      username: data.username ? `@${data.username}` : null,
      email: null,
      photo_url: data.photo_url || null,
    };

    const token = await makeJwt(user, jwtSecret);

    return Response.redirect(`${appBaseUrl}/#auth_token=${token}`, 302);
  } catch (globalError) {
    return Response.json({
      error: "Worker runtime exception",
      message: globalError.message,
      stack: globalError.stack
    }, { status: 500 });
  }
}

async function makeJwt(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  const data = { ...payload, iat: Math.floor(Date.now() / 1000), exp };

  const encode = (obj) => {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  };
  const headerB64 = encode(header);
  const payloadB64 = encode(data);
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  return `${signingInput}.${sigB64}`;
}
