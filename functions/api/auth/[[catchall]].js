export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const backendBase = env.APP_BASE_URL || "https://tagirfruit-mini.duckdns.org";
  
  // Create a new URL that points to the VDS backend
  const targetUrl = new URL(url.pathname + url.search, backendBase);
  
  try {
    const proxyRequest = new Request(targetUrl.toString(), request);
    
    // Cloudflare handles headers automatically but we can override Origin/Host if needed
    proxyRequest.headers.set("X-Forwarded-Host", url.host);
    proxyRequest.headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""));
    
    return await fetch(proxyRequest);
  } catch (error) {
    console.error("[FruitFit Auth Proxy] Error proxying to backend", error);
    return Response.json({ error: "Backend proxy error" }, { status: 502 });
  }
}
