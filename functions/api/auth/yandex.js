// Cloudflare Pages Function: /api/auth/yandex
// Стартует Yandex OAuth flow — редиректит на oauth.yandex.ru
export async function onRequestGet({ request, env }) {
  const clientId = env.YANDEX_CLIENT_ID;
  const redirectUri = env.YANDEX_REDIRECT_URI || `${new URL(request.url).origin}/api/auth/yandex/callback`;

  if (!clientId) {
    return Response.json({ error: "YANDEX_CLIENT_ID не задан в переменных окружения Cloudflare Pages" }, { status: 500 });
  }

  const authUrl = new URL("https://oauth.yandex.ru/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("display", "popup");

  return Response.redirect(authUrl.toString(), 302);
}
