// GET /api/integrations/google/callback — Google's OAuth redirect URI for the
// Analytics / Search Console connector. Mellox sessions live in the browser,
// so a server route can't tell who is returning; it forwards the known
// parameters to the callback page, which completes the connection with the
// signed-in user's token (the single-use state proves they started it).
//
// Google has one registered redirect URI per environment, but Mellox runs on
// several origins; when the state names the allowlisted origin that started
// the flow, the user is sent back there.
import { authReturnOrigin } from "@/server/analytics/google/oauth.server";

export const dynamic = "force-dynamic";

// `error` is how Google reports a cancelled consent (error=access_denied).
const FORWARDED = ["state", "code", "error"] as const;
const CALLBACK_PAGE = "/integrations/google/callback";

export async function GET(request: Request) {
  const incoming = new URL(request.url);
  const target = new URLSearchParams();
  for (const key of FORWARDED) {
    const value = incoming.searchParams.get(key);
    if (value && value.length <= 1024) target.set(key, value);
  }
  const query = target.size ? `?${target.toString()}` : "";

  let origin: string | null = null;
  const state = target.get("state");
  if (state) {
    try {
      origin = await authReturnOrigin(state);
    } catch (e) {
      console.warn(
        "[google] callback return origin lookup failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  return new Response(null, {
    status: 302,
    headers: {
      location: `${origin ?? ""}${CALLBACK_PAGE}${query}`,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}
