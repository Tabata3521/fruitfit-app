const DEFAULT_MODEL = "gpt-5-nano";

export async function onRequestGet({ env }) {
  return Response.json(
    {
      ok: true,
      openaiKeyLoaded: Boolean(env.OPENAI_API_KEY),
      model: env.OPENAI_MODEL || DEFAULT_MODEL,
      endpoint: "responses",
      runtime: "cloudflare-pages-functions",
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
