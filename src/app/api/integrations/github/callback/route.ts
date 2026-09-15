// GET /api/integrations/github/callback — where GitHub sends the installer
// back (the App's Callback URL / Setup URL). Mellox sessions live in the
// browser, so a server route can't tell who is returning; it forwards the
// known parameters to the callback page, which completes the install with the
// signed-in user's token.
//
// The App has one callback URL but Mellox runs on several origins (custom
// domain, Railway domain, localhost). When the install state names the
// allowlisted origin that started the flow, the installer is sent back there —
// otherwise they would land signed out on a different origin.
import { installReturnOrigin } from "@/server/connectors/github/service.server";

export const dynamic = "force-dynamic";

const FORWARDED = ["installation_id", "setup_action", "state", "code"] as const;
const CALLBACK_PAGE = "/integrations/github/callback";

export async function GET(request: Request) {
  const incoming = new URL(request.url);
  const target = new URLSearchParams();
  for (const key of FORWARDED) {
    const value = incoming.searchParams.get(key);
    if (value && value.length <= 256) target.set(key, value);
  }
  const query = target.size ? `?${target.toString()}` : "";

  let origin: string | null = null;
  const state = target.get("state");
  if (state) {
    try {
      origin = await installReturnOrigin(state);
    } catch (e) {
      console.warn(
        "[github] callback return origin lookup failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  return new Response(null, {
    status: 302,
    headers: {
      // Relative unless handing back to another origin — this origin's own host
      // may be an internal proxy address behind Railway.
      location: `${origin ?? ""}${CALLBACK_PAGE}${query}`,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}
