import { returnOrigin } from "@/server/connectors/wix/service.server";

export const dynamic = "force-dynamic";
// Wix adds instanceId and signedInstance after an install and keeps our state.
const FORWARDED = ["state", "instanceId", "signedInstance", "error"] as const;

export async function GET(request: Request) {
  const incoming = new URL(request.url);
  const query = new URLSearchParams();
  for (const key of FORWARDED) {
    const value = incoming.searchParams.get(key);
    if (value && value.length <= 4096) query.set(key, value);
  }
  const state = query.get("state");
  const origin = state ? await returnOrigin(state).catch(() => null) : null;
  return new Response(null, {
    status: 302,
    headers: {
      location: `${origin ?? ""}/integrations/wix/callback${query.size ? `?${query}` : ""}`,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}
