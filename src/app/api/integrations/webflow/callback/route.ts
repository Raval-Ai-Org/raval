import { returnOrigin } from "@/server/connectors/webflow/service.server";

export const dynamic = "force-dynamic";
const FORWARDED = ["state", "code", "error", "error_description"] as const;

export async function GET(request: Request) {
  const incoming = new URL(request.url);
  const query = new URLSearchParams();
  for (const key of FORWARDED) {
    const value = incoming.searchParams.get(key);
    if (value && value.length <= 2048) query.set(key, value);
  }
  const state = query.get("state");
  const origin = state ? await returnOrigin(state).catch(() => null) : null;
  return new Response(null, {
    status: 302,
    headers: {
      location: `${origin ?? ""}/integrations/webflow/callback${query.size ? `?${query}` : ""}`,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}
