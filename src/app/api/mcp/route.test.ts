import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticateMcp = vi.hoisted(() => vi.fn());
vi.mock("@/server/mcp/access.server", () => ({ authenticateMcp, requireMcpWorkspace: vi.fn() }));
vi.mock("@/server/mcp/settings.server", () => ({
  getMcpSettings: vi.fn(),
  getMcpSettingsFor: vi.fn(async () => new Map()),
  recordToolCall: vi.fn(),
}));
vi.mock("@/server/mcp/bridge.server", () => ({ callFn: vi.fn(), callRoute: vi.fn() }));
vi.mock("@/server/audit.server", () => ({
  recordAudit: vi.fn(),
  scrubAuditPayload: (p: unknown) => p,
}));

import { GET, OPTIONS, POST } from "./route";

const rpc = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });

const caller = { userId: "user-1", claims: {}, supabase: {}, clientId: "app", token: "a.b.c" };

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.FEATURE_FLAG_MCP_ENABLED;
  process.env.APP_URL = "https://app.example.com";
});

describe("/api/mcp", () => {
  it("answers 401 with where to sign in when there is no valid token", async () => {
    authenticateMcp.mockResolvedValue({
      ok: false,
      status: 401,
      message: "Authentication required",
    });
    const res = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="https://app.example.com/.well-known/oauth-protected-resource/api/mcp"',
    );
  });

  it("answers 404 when the kill switch is off, before looking at the token", async () => {
    process.env.FEATURE_FLAG_MCP_ENABLED = "false";
    const res = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    expect(res.status).toBe(404);
    expect(authenticateMcp).not.toHaveBeenCalled();
  });

  it("initializes and lists the tools for a signed-in caller", async () => {
    authenticateMcp.mockResolvedValue({ ok: true, caller });
    const init = await POST(
      rpc({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      }),
    );
    expect(init.status).toBe(200);
    const initBody = await init.json();
    expect(initBody.result.serverInfo.name).toBe("mellox");

    const list = await POST(rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
    expect(list.status).toBe(200);
    const body = await list.json();
    const names = body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("list_workspaces");
    expect(names).toContain("schedule_content");
    const publish = body.result.tools.find(
      (t: { name: string }) => t.name === "publish_content_now",
    );
    expect(publish.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(publish.inputSchema.required).toContain("workspaceId");
  });

  it("returns a tool failure as a structured error, not a transport error", async () => {
    authenticateMcp.mockResolvedValue({ ok: true, caller });
    const res = await POST(
      rpc({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "list_content", arguments: { workspaceId: "not-a-uuid" } },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const payload = body.result ?? body.error;
    expect(JSON.stringify(payload)).toMatch(/invalid/i);
  });

  it("allows cross-origin calls and refuses GET", async () => {
    expect(OPTIONS().headers.get("access-control-allow-origin")).toBe("*");
    expect(GET().status).toBe(405);
  });
});
