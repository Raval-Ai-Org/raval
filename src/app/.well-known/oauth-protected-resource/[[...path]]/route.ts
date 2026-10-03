// OAuth protected-resource metadata (RFC 9728) for the MCP server. An MCP
// client reads this after a 401 from /api/mcp to learn that people sign in
// through Supabase Auth's OAuth server (ADR-0029). Public by design: it holds
// only addresses.
import { getAppUrl } from "@/server/env";

export const dynamic = "force-dynamic";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "mcp-protocol-version, authorization, content-type",
};

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

export function GET(): Response {
  const supabaseUrl = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  if (!supabaseUrl) {
    return Response.json({ error: "Server not configured" }, { status: 500, headers: CORS });
  }
  return Response.json(
    {
      resource: `${getAppUrl()}/api/mcp`,
      authorization_servers: [`${supabaseUrl}/auth/v1`],
      bearer_methods_supported: ["header"],
      resource_name: "Mellox",
    },
    { headers: { ...CORS, "Cache-Control": "public, max-age=300" } },
  );
}
