import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const requireUserId = vi.hoisted(() => vi.fn());
const checkWorkspaceMembership = vi.hoisted(() => vi.fn());
const enforceRateLimit = vi.hoisted(() => vi.fn());

vi.mock("./api-auth", async (importActual) => ({
  ...(await importActual<typeof import("./api-auth")>()),
  requireUserId,
  checkWorkspaceMembership,
}));
vi.mock("./rate-limit", async (importActual) => ({
  ...(await importActual<typeof import("./rate-limit")>()),
  enforceRateLimit,
}));

import { defineRoute } from "./route";
import { SsrfBlockedError } from "./safe-fetch";
import { UpstreamError } from "./upstream";

const WORKSPACE = "22222222-2222-2222-2222-222222222222";
const supabase = { tag: "rls-client" };

function post(body: unknown, url = "http://localhost/api/test") {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer a.b.c" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUserId.mockResolvedValue({ ok: true, userId: "user-1", claims: {}, supabase });
  checkWorkspaceMembership.mockImplementation(async (_auth: unknown, workspaceId: string) => ({
    ok: true,
    workspaceId,
  }));
  enforceRateLimit.mockResolvedValue(null);
});

describe("defineRoute", () => {
  const handler = vi.fn(async (ctx: { body: { n: number } }) => ({ doubled: ctx.body.n * 2 }));
  const route = defineRoute({
    name: "test",
    auth: "user",
    body: z.object({ n: z.number() }),
    rateLimit: "generate",
    handler,
  });

  it("returns the auth failure before touching the body", async () => {
    requireUserId.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Authentication required" }, { status: 401 }),
    });
    const res = await route(post({ n: 1 }));
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    expect(enforceRateLimit).not.toHaveBeenCalled();
  });

  it("rejects an invalid body with 400 without consuming quota", async () => {
    const res = await route(post({ n: "nope" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/^Invalid request: n/);
    expect(enforceRateLimit).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await route(post("{not json"));
    expect(res.status).toBe(400);
  });

  it("returns the rate-limit response when over budget", async () => {
    enforceRateLimit.mockResolvedValue(new Response("slow down", { status: 429 }));
    const res = await route(post({ n: 1 }));
    expect(res.status).toBe(429);
    expect(enforceRateLimit).toHaveBeenCalledWith("generate", "user-1");
    expect(handler).not.toHaveBeenCalled();
  });

  it("wraps plain results as no-store JSON and passes the RLS client", async () => {
    const res = await route(post({ n: 21 }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ doubled: 42 });
    expect(handler.mock.calls[0][0]).toMatchObject({ userId: "user-1", supabase });
  });

  it("passes Response results through untouched (streams)", async () => {
    const stream = defineRoute({
      name: "stream",
      auth: "user",
      handler: () =>
        new Response("data: hi\n\n", { headers: { "content-type": "text/event-stream" } }),
    });
    const res = await stream(post({}));
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(await res.text()).toBe("data: hi\n\n");
  });

  it.each([
    [new UpstreamError(402, "AI credits exhausted", { provider: "openrouter" }), 402],
    [new SsrfBlockedError(), 400],
    [new Error("boom"), 500],
  ])("maps thrown %s to %i", async (error, status) => {
    const failing = defineRoute({
      name: "failing",
      auth: "user",
      handler: () => {
        throw error;
      },
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await failing(post({}));
    spy.mockRestore();
    expect(res.status).toBe(status);
    if (status === 500) expect((await res.json()).error).not.toMatch(/boom/);
  });
});

describe("defineRoute with workspace auth", () => {
  const handler = vi.fn(async (ctx: { workspaceId: string }) => ({ ws: ctx.workspaceId }));
  const route = defineRoute({
    name: "ws",
    auth: "workspace",
    body: z.object({ workspaceId: z.string() }),
    workspaceId: ({ body }) => body.workspaceId,
    rateLimit: ({ userId, workspaceId }) => ({
      tier: "audit",
      subject: `${userId}:${workspaceId}`,
    }),
    handler,
  });

  it("returns the membership failure", async () => {
    checkWorkspaceMembership.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Not a member" }, { status: 403 }),
    });
    const res = await route(post({ workspaceId: WORKSPACE }));
    expect(res.status).toBe(403);
    expect(enforceRateLimit).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("gives the handler the verified workspace and a custom rate-limit subject", async () => {
    const res = await route(post({ workspaceId: WORKSPACE }));
    expect(await res.json()).toEqual({ ws: WORKSPACE });
    expect(enforceRateLimit).toHaveBeenCalledWith("audit", `user-1:${WORKSPACE}`);
  });

  it("reads the workspace id from the query string", async () => {
    const byQuery = defineRoute({
      name: "ws-query",
      auth: "workspace",
      query: z.object({ workspaceId: z.string() }),
      workspaceId: ({ query }) => query.workspaceId,
      handler: ({ workspaceId }) => ({ workspaceId }),
    });
    const res = await byQuery(
      new Request(`http://localhost/api/x?workspaceId=${WORKSPACE}`, {
        headers: { authorization: "Bearer a.b.c" },
      }),
    );
    expect(await res.json()).toEqual({ workspaceId: WORKSPACE });
  });
});

describe("defineRoute role gate and workspace attribution", () => {
  it("passes minRole to the membership check", async () => {
    const route = defineRoute({
      name: "gated",
      auth: "workspace",
      body: z.object({ workspaceId: z.string() }),
      workspaceId: ({ body }) => body.workspaceId,
      minRole: "editor",
      handler: () => ({ ok: true }),
    });
    await route(post({ workspaceId: WORKSPACE }));
    expect(checkWorkspaceMembership).toHaveBeenCalledWith(expect.anything(), WORKSPACE, {
      minRole: "editor",
    });
  });

  it("attributes a user route to x-workspace-id only after membership is verified", async () => {
    const seen = vi.fn();
    const route = defineRoute({
      name: "attributed",
      auth: "user",
      handler: (ctx) => {
        seen(ctx.attributedWorkspaceId);
        return { ok: true };
      },
    });
    const withHeader = (ws: string) =>
      new Request("http://localhost/api/x", {
        headers: { authorization: "Bearer a.b.c", "x-workspace-id": ws },
      });

    await route(withHeader(WORKSPACE));
    expect(seen).toHaveBeenLastCalledWith(WORKSPACE);

    checkWorkspaceMembership.mockResolvedValueOnce({
      ok: false,
      response: Response.json({}, { status: 403 }),
    });
    const res = await route(withHeader(WORKSPACE));
    expect(res.status).toBe(200); // a foreign header never fails the request…
    expect(seen).toHaveBeenLastCalledWith(undefined); // …and never attributes spend to it

    await route(withHeader("not-a-uuid"));
    expect(seen).toHaveBeenLastCalledWith(undefined);
  });
});
