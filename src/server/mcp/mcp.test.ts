import { beforeEach, describe, expect, it, vi } from "vitest";

const checkWorkspaceMembership = vi.hoisted(() => vi.fn());
const getMcpSettings = vi.hoisted(() => vi.fn());
const getMcpSettingsFor = vi.hoisted(() => vi.fn());
const recordToolCall = vi.hoisted(() => vi.fn());
const recordAudit = vi.hoisted(() => vi.fn());
const consumeRateLimit = vi.hoisted(() => vi.fn());
const callFn = vi.hoisted(() => vi.fn());
const callRoute = vi.hoisted(() => vi.fn());

vi.mock("@/server/api-auth", async (importActual) => ({
  ...(await importActual<typeof import("@/server/api-auth")>()),
  checkWorkspaceMembership,
}));
vi.mock("./settings.server", () => ({
  getMcpSettings,
  getMcpSettingsFor,
  recordToolCall,
}));
vi.mock("@/server/audit.server", () => ({ recordAudit, scrubAuditPayload: (p: unknown) => p }));
vi.mock("@/server/rate-limit", async (importActual) => ({
  ...(await importActual<typeof import("@/server/rate-limit")>()),
  consumeRateLimit,
}));
vi.mock("./bridge.server", () => ({ callFn, callRoute }));
vi.mock("@/app/api/sdr/schedule/route", () => ({ POST: vi.fn() }));
vi.mock("@/app/api/sdr/publish/route", () => ({ POST: vi.fn() }));

import { HttpError } from "@/server/http-error";
import { InsufficientBalanceError } from "@/server/billing/errors";
import type { McpCaller } from "./access.server";
import { McpError, toMcpError } from "./errors.server";
import { MCP_TOOLS, runTool, toolInputShape } from "./registry.server";
import { cleanOutput } from "./tool";

const WS = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";

function callerWith(items: { id: string; status: string; meta?: unknown }[] = []): McpCaller {
  const query = {
    select: () => query,
    eq: () => query,
    in: async () => ({ data: items, error: null }),
  };
  return {
    userId: "user-1",
    claims: {} as never,
    supabase: { from: () => query } as never,
    clientId: "claude-app",
    token: "a.b.c",
  };
}

const tool = (name: string) => {
  const found = MCP_TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.FEATURE_FLAG_MCP_ENABLED;
  checkWorkspaceMembership.mockResolvedValue({ ok: true, workspaceId: WS, role: "editor" });
  getMcpSettings.mockResolvedValue({ enabled: true, allowWrites: true, updatedAt: null });
  getMcpSettingsFor.mockResolvedValue(new Map());
  consumeRateLimit.mockResolvedValue({ ok: true, limit: 1, remaining: 1, retryAfterSeconds: 0 });
});

describe("the tool list", () => {
  it("has unique snake_case names and a description for each", () => {
    const names = MCP_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of MCP_TOOLS) {
      expect(t.name).toMatch(/^[a-z][a-z0-9_]{2,63}$/);
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.title.length).toBeGreaterThan(2);
    }
  });

  it("gives every workspace tool a workspaceId input", () => {
    for (const t of MCP_TOOLS.filter((x) => x.scope === "workspace")) {
      expect(Object.keys(toolInputShape(t))).toContain("workspaceId");
    }
  });

  it("marks everything that changes or spends as a write", () => {
    const reads = MCP_TOOLS.filter((t) => !t.write).map((t) => t.name);
    for (const name of reads) {
      expect(name).toMatch(/^(list|get|suggest)_/);
    }
    for (const t of MCP_TOOLS.filter((x) => x.destructive)) expect(t.write).toBe(true);
  });

  it("needs at least editor for every workspace change", () => {
    for (const t of MCP_TOOLS.filter((x) => x.write && x.scope === "workspace")) {
      // The briefing is readable by anyone but spends, so it is a write for viewers too.
      if (t.name === "get_marketing_briefing") continue;
      expect(["editor", "admin", "owner"]).toContain(t.minRole);
    }
  });

  it("has no tool that deletes a workspace, approves a website fix or touches billing", () => {
    const names = MCP_TOOLS.map((t) => t.name).join(" ");
    expect(names).not.toMatch(/delete_workspace|approve_geo|apply_|billing|credit|invite|member/);
  });
});

describe("runTool access", () => {
  it("requires an opted-in workspace before an assistant creates another workspace", async () => {
    callFn.mockResolvedValueOnce([{ id: WS, name: "Existing" }]);
    const denied = await runTool(tool("create_workspace"), { name: "New" }, callerWith());
    expect(denied).toMatchObject({ ok: false, error: { code: "read_only" } });
    expect(callFn).toHaveBeenCalledTimes(1);

    callFn.mockReset();
    callFn
      .mockResolvedValueOnce([{ id: WS, name: "Existing" }])
      .mockResolvedValueOnce({ id: ITEM });
    getMcpSettingsFor.mockResolvedValueOnce(
      new Map([[WS, { enabled: true, allowWrites: true, updatedAt: null }]]),
    );
    const allowed = await runTool(tool("create_workspace"), { name: "New" }, callerWith());
    expect(allowed).toMatchObject({ ok: true });
    expect(callFn).toHaveBeenCalledWith(
      expect.anything(),
      "workspaces",
      "createWorkspace",
      expect.objectContaining({ name: "New" }),
    );
  });

  it("refuses when the kill switch is off", async () => {
    process.env.FEATURE_FLAG_MCP_ENABLED = "false";
    const out = await runTool(tool("list_content"), { workspaceId: WS }, callerWith());
    expect(out).toMatchObject({ ok: false, error: { code: "mcp_disabled" } });
    expect(callFn).not.toHaveBeenCalled();
  });

  it("refuses a workspace the caller isn't in", async () => {
    checkWorkspaceMembership.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Not a member of this workspace" }, { status: 403 }),
    });
    const out = await runTool(tool("list_content"), { workspaceId: WS }, callerWith());
    expect(out).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(getMcpSettings).not.toHaveBeenCalled();
    expect(callFn).not.toHaveBeenCalled();
  });

  it("asks for the tool's own minimum role", async () => {
    await runTool(tool("stop_autopilot"), { workspaceId: WS }, callerWith());
    expect(checkWorkspaceMembership.mock.calls[0][2]).toEqual({ minRole: "admin" });
  });

  it("refuses a workspace that hasn't turned assistants on", async () => {
    getMcpSettings.mockResolvedValue({ enabled: false, allowWrites: false, updatedAt: null });
    const out = await runTool(tool("list_content"), { workspaceId: WS }, callerWith());
    expect(out).toMatchObject({ ok: false, error: { code: "mcp_disabled" } });
  });

  it("lets a read-only workspace read but not change", async () => {
    getMcpSettings.mockResolvedValue({ enabled: true, allowWrites: false, updatedAt: null });
    callFn.mockResolvedValue([]);
    expect(await runTool(tool("list_content"), { workspaceId: WS }, callerWith())).toMatchObject({
      ok: true,
    });
    const out = await runTool(
      tool("set_autopilot_paused"),
      { workspaceId: WS, paused: true },
      callerWith(),
    );
    expect(out).toMatchObject({ ok: false, error: { code: "read_only" } });
    expect(callFn).toHaveBeenCalledTimes(1);
  });

  it("rejects bad input before anything runs", async () => {
    const out = await runTool(tool("list_content"), { workspaceId: "nope" }, callerWith());
    expect(out).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(checkWorkspaceMembership).not.toHaveBeenCalled();
  });

  it("reports a rate limit as a structured error", async () => {
    consumeRateLimit.mockResolvedValue({ ok: false, limit: 1, remaining: 0, retryAfterSeconds: 9 });
    const out = await runTool(tool("list_content"), { workspaceId: WS }, callerWith());
    expect(out).toMatchObject({
      ok: false,
      error: { code: "rate_limited", details: { retryAfterSeconds: 9 } },
    });
  });
});

describe("runTool records", () => {
  it("records every call, and audits a change", async () => {
    callFn.mockResolvedValue({ ok: true });
    await runTool(tool("set_autopilot_paused"), { workspaceId: WS, paused: true }, callerWith());
    expect(recordToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WS,
        userId: "user-1",
        clientId: "claude-app",
        tool: "set_autopilot_paused",
        isWrite: true,
        ok: true,
      }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WS, action: "mcp.set_autopilot_paused" }),
    );
  });

  it("records a refused call with its code and never stores what was written", async () => {
    getMcpSettings.mockResolvedValue({ enabled: true, allowWrites: false, updatedAt: null });
    await runTool(
      tool("write_content_draft"),
      { workspaceId: WS, body: "A private draft about our launch" },
      callerWith(),
    );
    const entry = recordToolCall.mock.calls[0][0];
    expect(entry).toMatchObject({ ok: false, errorCode: "read_only" });
    expect(JSON.stringify(entry.summary)).not.toContain("private draft");
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("approval is never skipped", () => {
  it("won't schedule a post that isn't approved", async () => {
    const out = await runTool(
      tool("schedule_content"),
      { workspaceId: WS, items: [{ contentItemId: ITEM, scheduledAt: "2030-01-01T10:00:00Z" }] },
      callerWith([{ id: ITEM, status: "draft" }]),
    );
    expect(out).toMatchObject({ ok: false, error: { code: "not_approved" } });
    expect(callRoute).not.toHaveBeenCalled();
  });

  it("won't post a pending post now", async () => {
    const out = await runTool(
      tool("publish_content_now"),
      { workspaceId: WS, contentItemIds: [ITEM] },
      callerWith([{ id: ITEM, status: "pending" }]),
    );
    expect(out).toMatchObject({ ok: false, error: { code: "not_approved" } });
    expect(callRoute).not.toHaveBeenCalled();
  });

  it("schedules an approved post through the app's own route", async () => {
    callRoute.mockResolvedValue({
      results: [{ contentItemId: ITEM, status: "publishing", providerPostId: "secret-id" }],
    });
    const out = await runTool(
      tool("schedule_content"),
      { workspaceId: WS, items: [{ contentItemId: ITEM, scheduledAt: "2030-01-01T10:00:00Z" }] },
      callerWith([{ id: ITEM, status: "approved" }]),
    );
    expect(out).toMatchObject({ ok: true });
    expect(callRoute.mock.calls[0][2]).toBe("/api/sdr/schedule");
    expect(JSON.stringify(out)).not.toContain("secret-id");
  });

  it("won't act on a post from another workspace", async () => {
    const out = await runTool(
      tool("delete_content"),
      { workspaceId: WS, contentItemId: ITEM },
      callerWith([]),
    );
    expect(out).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(callFn).not.toHaveBeenCalled();
  });
});

describe("toMcpError", () => {
  it("keeps billing codes and details", () => {
    const body = toMcpError(
      new InsufficientBalanceError({
        meter: "credits",
        needed: 5,
        available: 1,
        options: [],
      } as never),
    );
    expect(body.code).toBe("insufficient_balance");
    expect(body.details).toMatchObject({ needed: 5, available: 1 });
  });

  it("maps HTTP errors by status", () => {
    expect(toMcpError(new HttpError(404, "Nope")).code).toBe("not_found");
    expect(toMcpError(new HttpError(409, "Changed")).code).toBe("conflict");
    expect(toMcpError(new McpError("read_only", "x")).code).toBe("read_only");
  });

  it("never leaks an unknown error's message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const body = toMcpError(new Error("relation secret_table does not exist"));
    expect(body).toEqual({
      code: "internal_error",
      message: "Something went wrong. Please try again.",
    });
    spy.mockRestore();
  });
});

describe("cleanOutput", () => {
  it("drops credentials, storage paths, provider ids and emails", () => {
    const out = cleanOutput({
      title: "Post",
      access_token: "x",
      meta: { storage_path: "workspace/1/a.png", postforme_post_id: "p", note: "keep" },
      user: { email: "a@b.c", name: "A" },
    });
    expect(out).toEqual({ title: "Post", meta: { note: "keep" }, user: { name: "A" } });
  });
});
