// Cloudflare Pages Function: /api/auth/yandex/callback
// Обменивает code на token, получает профиль Яндекса, создаёт JWT, редиректит в PWA
export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const appBaseUrl = env.APP_BASE_URL || url.origin;

    if (!code) {
      return Response.redirect(`${appBaseUrl}/#auth_error=no_code`, 302);
    }

    const clientId = env.YANDEX_CLIENT_ID;
    const clientSecret = env.YANDEX_CLIENT_SECRET;
    const redirectUri = env.YANDEX_REDIRECT_URI || `${url.origin}/api/auth/yandex/callback`;

    if (!clientId || !clientSecret) {
      return Response.json({ 
        error: "Yandex credentials не настроены",
        env_keys: Object.keys(env) // Покажем, какие ключи вообще есть (без значений)
      }, { status: 500 });
    }

    // 1. Обменять code на access_token
    let tokenData;
    try {
      const tokenRes = await fetch("https://oauth.yandex.ru/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
        }),
      });
      tokenData = await tokenRes.json();
      if (!tokenRes.ok || !tokenData.access_token) {
        return Response.json({ error: "Token exchange failed", details: tokenData }, { status: 400 });
      }
    } catch (err) {
      return Response.json({ error: "Token fetch exception", message: err.message }, { status: 500 });
    }

    // 2. Получить профиль пользователя
    let profileData;
    try {
      const profileRes = await fetch("https://login.yandex.ru/info?format=json", {
        headers: { Authorization: `OAuth ${tokenData.access_token}` },
      });
      profileData = await profileRes.json();
      if (!profileRes.ok) {
        return Response.json({ error: "Profile fetch failed", details: profileData }, { status: 400 });
      }
    } catch (err) {
      return Response.json({ error: "Profile fetch exception", message: err.message }, { status: 500 });
    }

    // 3. Сформировать JWT
    const jwtSecret = env.JWT_SECRET || "fruitfit_super_secret_jwt_key_2026";
    const user = {
      id: `yandex_${profileData.id}`,
      provider: "yandex",
      name: profileData.real_name || profileData.display_name || profileData.login,
      username: profileData.login,
      email: profileData.default_email || null,
      photo_url: profileData.is_avatar_empty
        ? null
        : `https://avatars.yandex.net/get-yapic/${profileData.default_avatar_id}/islands-200`,
    };

    const token = await makeJwt(user, jwtSecret);

    // 4. Вернуть в PWA с токеном в хеше
    return Response.redirect(`${appBaseUrl}/#auth_token=${token}`, 302);
  } catch (globalError) {
    // Возвращаем чистый JSON с ошибкой вместо краша воркера 1101
    return Response.json({
      error: "Worker runtime exception",
      message: globalError.message,
      stack: globalError.stack
    }, { status: 500 });
  }
}

// Минимальная реализация JWT (HS256) для Cloudflare Workers
async function makeJwt(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60; // 30 дней
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
