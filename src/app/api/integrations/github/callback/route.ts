// GET /api/integrations/github/callback — where GitHub may send the installer
// back (the App's Setup URL / Callback URL). Mellox sessions live in the
// browser, so a server route can't tell who is returning; it forwards the
// known parameters to the callback page, which completes the install with the
// signed-in user's token.
export const dynamic = "force-dynamic";

const FORWARDED = ["installation_id", "setup_action", "state", "code"] as const;

export function GET(request: Request) {
  const incoming = new URL(request.url);
  const target = new URL("/integrations/github/callback", incoming.origin);
  for (const key of FORWARDED) {
    const value = incoming.searchParams.get(key);
    if (value && value.length <= 256) target.searchParams.set(key, value);
  }
  return new Response(null, {
    status: 302,
    headers: {
      location: `${target.pathname}${target.search}`,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}
