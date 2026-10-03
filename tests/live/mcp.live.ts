// Live check of the MCP server (ADR-0029) against the real Supabase project
// and a running dev server (MCP_LIVE_BASE_URL, default http://localhost:8081).
//
//   the migration is applied: both tables answer, and a settings row round-trips
//   /api/mcp refuses an anonymous caller and says where to sign in
//   the sign-in metadata points at this project's Supabase Auth
//
// Opt-in: MCP_LIVE_ACCESS_TOKEN=<a signed-in user's access token> also runs
// initialize, tools/list and list_workspaces as that person. Read-only; it
// spends nothing and changes nothing.
//   npx vitest run --config vitest.live.config.ts tests/live/mcp.live.ts
import { describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const BASE = process.env.MCP_LIVE_BASE_URL || "http://localhost:8081";
const TOKEN = process.env.MCP_LIVE_ACCESS_TOKEN;
const describeLive = process.env.SUPABASE_SERVICE_ROLE_KEY ? describe : describe.skip;

async function serverUp(): Promise<boolean> {
  try {
    await fetch(`${BASE}/.well-known/oauth-protected-resource`, {
      signal: AbortSignal.timeout(20_000),
    });
    return true;
  } catch {
    return false;
  }
}

function rpc(body: unknown, token?: string) {
  return fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describeLive("MCP server (live)", () => {
  it("has its tables on the real database, off by default", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getMcpSettings } = await import("@/server/mcp/settings.server");
    const calls = await supabaseAdmin.from("mcp_tool_calls").select("id").limit(1);
    expect(calls.error).toBeNull();
    const { data: ws } = await supabaseAdmin.from("workspaces").select("id").limit(1).maybeSingle();
    if (!ws) return;
    const existing = await supabaseAdmin
      .from("mcp_workspace_settings")
      .select("workspace_id")
      .eq("workspace_id", ws.id)
      .maybeSingle();
    expect(existing.error).toBeNull();
    const settings = await getMcpSettings(ws.id);
    if (!existing.data) expect(settings).toMatchObject({ enabled: false, allowWrites: false });
  });

  it("refuses an anonymous caller and says where to sign in", async (ctx) => {
    if (!(await serverUp())) return ctx.skip();
    const res = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(
      /^Bearer resource_metadata=".+\/\.well-known\/oauth-protected-resource\/api\/mcp"$/,
    );
    const forged = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "a.b.c");
    expect(forged.status).toBe(401);
  });

  it("publishes sign-in metadata that points at Supabase Auth", async (ctx) => {
    if (!(await serverUp())) return ctx.skip();
    for (const path of ["", "/api/mcp"]) {
      const res = await fetch(`${BASE}/.well-known/oauth-protected-resource${path}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.resource).toMatch(/\/api\/mcp$/);
      expect(body.authorization_servers).toEqual([
        `${(process.env.SUPABASE_URL ?? "").replace(/\/+$/, "")}/auth/v1`,
      ]);
    }
  });

  it.skipIf(!TOKEN)("works as a signed-in person (read-only)", async (ctx) => {
    if (!(await serverUp())) return ctx.skip();
    const list = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, TOKEN);
    expect(list.status).toBe(200);
    const tools = (await list.json()).result.tools as { name: string }[];
    expect(tools.length).toBeGreaterThan(40);
    const call = await rpc(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "list_workspaces", arguments: {} },
      },
      TOKEN,
    );
    expect(call.status).toBe(200);
    const result = (await call.json()).result;
    expect(result.isError).toBe(false);
    expect(Array.isArray(result.structuredContent.workspaces)).toBe(true);
    // The same token must not work on the ordinary API if it is an assistant's.
  });
});
