import { returnOrigin } from "@/server/integrations/accounts.server";

export const dynamic = "force-dynamic";
// Composio appends `status` and `connected_account_id` (camelCase from older
// flows); the state is the one Mellox put in the callback URL.
const FORWARDED: Record<string, string> = {
  state: "state",
  status: "status",
  connected_account_id: "connected_account_id",
  connectedAccountId: "connected_account_id",
};

export async function GET(request: Request) {
  const incoming = new URL(request.url);
  const query = new URLSearchParams();
  for (const [from, to] of Object.entries(FORWARDED)) {
    const value = incoming.searchParams.get(from);
    if (value && value.length <= 200 && !query.has(to)) query.set(to, value);
  }
  const state = query.get("state");
  const origin = state ? await returnOrigin(state).catch(() => null) : null;
  return new Response(null, {
    status: 302,
    headers: {
      location: `${origin ?? ""}/integrations/apps/callback${query.size ? `?${query}` : ""}`,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}
