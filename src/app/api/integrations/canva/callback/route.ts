import { canvaOrigins } from "@/server/connectors/canva/config.server";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const input = new URL(request.url).searchParams;
  const query = new URLSearchParams();
  for (const key of ["state", "code", "error"]) {
    const value = input.get(key);
    if (value && value.length <= 2048) query.set(key, value);
  }
  // Canva calls back on 127.0.0.1 in development; the session lives on APP_URL.
  let origin = "";
  try {
    origin = canvaOrigins().appOrigin;
  } catch {
    /* Stay on this origin; the page reports the configuration problem. */
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
