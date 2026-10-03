// /api/mcp — the Mellox MCP server (ADR-0029), Streamable HTTP, stateless.
// Claude, ChatGPT and other MCP clients sign the person in through OAuth and
// call tools here as that person. Every tool goes through the existing Mellox
// functions and routes (src/server/mcp/bridge.server.ts).
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isMcpEnabled } from "@/lib/feature-flags";
import { getAppUrl } from "@/server/env";
import { authenticateMcp } from "@/server/mcp/access.server";
import { buildMcpServer } from "@/server/mcp/server.server";
import { runWithRequest } from "@/server/request-context";

export const dynamic = "force-dynamic";
// Text generation runs inside the request, like the Studio route.
export const maxDuration = 120;

// Bearer tokens only (no cookies), so any origin may call; the token is the gate.
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
  "Access-Control-Max-Age": "600",
};

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...CORS,
      ...headers,
    },
  });
}

function rpcError(status: number, message: string, headers?: Record<string, string>): Response {
  return json(status, { jsonrpc: "2.0", error: { code: -32000, message }, id: null }, headers);
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(request: Request): Promise<Response> {
  if (!isMcpEnabled()) return rpcError(404, "Not found");

  const auth = await authenticateMcp(request);
  if (!auth.ok) {
    if (auth.status === 500) return rpcError(500, "Server not configured");
    // Tells the client where to sign the person in (RFC 9728).
    const metadata = `${getAppUrl()}/.well-known/oauth-protected-resource/api/mcp`;
    return rpcError(401, "Sign in to Mellox to continue.", {
      "WWW-Authenticate": `Bearer resource_metadata="${metadata}"`,
    });
  }

  return runWithRequest(request, async () => {
    const server = buildMcpServer(auth.caller);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request);
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(CORS)) headers.set(key, value);
      headers.set("Cache-Control", "no-store");
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      console.error("[mcp] request failed", error);
      return rpcError(500, "Request failed. Please try again.");
    } finally {
      void server.close().catch(() => undefined);
    }
  });
}

// No server-initiated stream and no sessions: there is nothing to GET or DELETE.
function notAllowed(): Response {
  return rpcError(405, "Method not allowed", { Allow: "POST, OPTIONS" });
}
export const GET = notAllowed;
export const DELETE = notAllowed;
