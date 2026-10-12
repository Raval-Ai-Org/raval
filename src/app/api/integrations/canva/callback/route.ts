import { canvaOrigins } from "@/server/connectors/canva/config.server";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const input = new URL(request.url).searchParams;
  const query = new URLSearchParams();
  for (const key of ["state", "code", "error", "error_description"]) {
    const value = input.get(key);
    if (value && value.length <= 2048) query.set(key, value);
  }
  if (query.has("error") || !query.has("code"))
    console.warn(
      "[connector]",
      JSON.stringify({
        provider: "canva",
        operation: "oauth_callback",
        status: "failed",
        reason: query.has("error") ? "authorization_rejected" : "no_code",
      }),
    );
  // Canva calls back on 127.0.0.1 in development; the session lives on APP_URL.
  let origin = "";
  try {
    origin = canvaOrigins().appOrigin;
  } catch {
    return new Response("Canva callback URL is not configured.", {
      status: 503,
      headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
    });
  }
  return new Response(null, {
    status: 302,
    headers: {
      location: `${origin}/integrations/canva/callback?${query}`,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}
