import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const requireUserId = vi.hoisted(() => vi.fn());
const enforceRateLimit = vi.hoisted(() => vi.fn());
const resolveAdmin = vi.hoisted(() => vi.fn());
const recordAdminAudit = vi.hoisted(() => vi.fn());
const adminMfaRequired = vi.hoisted(() => vi.fn());

vi.mock("@/server/api-auth", async (importActual) => ({
  ...(await importActual<typeof import("@/server/api-auth")>()),
  requireUserId,
}));
vi.mock("@/server/rate-limit", async (importActual) => ({
  ...(await importActual<typeof import("@/server/rate-limit")>()),
  enforceRateLimit,
}));
vi.mock("./access.server", () => ({ resolveAdmin }));
vi.mock("./audit.server", async (importActual) => ({
  ...(await importActual<typeof import("./audit.server")>()),
  recordAdminAudit,
}));
vi.mock("./config.server", () => ({ adminMfaRequired }));
vi.mock("./db.server", () => ({ adminDb: {}, adminRpc: vi.fn(), httpErrorFromPg: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

import { defineAdminRoute } from "./route";

const ADMIN = {
  userId: "11111111-1111-1111-1111-111111111111",
  role: "support" as const,
  permissions: ["users.read", "users.notes.write"] as string[],
  source: "team" as const,
  billing: false,
};

function req(body?: unknown, url = "http://localhost/api/admin/test") {
  return new Request(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", authorization: "Bearer a.b.c" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function signedIn(claims: Record<string, unknown> = { aal: "aal2" }) {
  requireUserId.mockResolvedValue({ ok: true, userId: ADMIN.userId, claims, supabase: {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  resolveAdmin.mockResolvedValue(ADMIN);
  enforceRateLimit.mockResolvedValue(null);
  adminMfaRequired.mockReturnValue(false);
});

describe("defineAdminRoute", () => {
  const handler = vi.fn(async () => ({ ok: true }));
  const route = defineAdminRoute({
    name: "test.read",
    permission: "users.read",
    handler,
  });

  it("returns the sign-in failure untouched", async () => {
    requireUserId.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Authentication required" }, { status: 401 }),
    });
    expect((await route(req())).status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers 404, not 403, to someone who is not an admin", async () => {
    resolveAdmin.mockResolvedValue(null);
    const res = await route(req());
    expect(res.status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
    expect(recordAdminAudit).not.toHaveBeenCalled();
  });

  it("hides validation errors from non-admins", async () => {
    resolveAdmin.mockResolvedValue(null);
    const withBody = defineAdminRoute({
      name: "test.body",
      permission: "users.read",
      write: true,
      body: z.object({ n: z.number() }),
      handler,
    });
    expect((await withBody(req({ n: "not a number" }))).status).toBe(404);
  });

  it("refuses a missing permission and audits the attempt", async () => {
    const needsMore = defineAdminRoute({
      name: "test.suspend",
      permission: "users.suspend",
      write: true,
      handler,
    });
    const res = await needsMore(req());
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("forbidden");
    expect(handler).not.toHaveBeenCalled();
    expect(recordAdminAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.permission_denied",
        targetId: "test.suspend",
        success: false,
      }),
      expect.objectContaining({ requestId: expect.any(String) }),
    );
  });

  it("runs the handler for an allowed admin", async () => {
    const res = await route(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("demands a second factor when MFA is required", async () => {
    adminMfaRequired.mockReturnValue(true);
    signedIn({ aal: "aal1" });
    const res = await route(req());
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("mfa_required");
    expect(handler).not.toHaveBeenCalled();
  });

  it("lets a verified second factor through", async () => {
    adminMfaRequired.mockReturnValue(true);
    signedIn({ aal: "aal2" });
    expect((await route(req())).status).toBe(200);
  });

  it("asks for a recent second-factor check on dangerous routes", async () => {
    adminMfaRequired.mockReturnValue(true);
    const now = Math.floor(Date.now() / 1000);
    const danger = defineAdminRoute({
      name: "test.danger",
      permission: "users.read",
      danger: true,
      handler,
    });

    signedIn({ aal: "aal2", amr: [{ method: "totp", timestamp: now - 3600 }] });
    const stale = await danger(req());
    expect(stale.status).toBe(403);
    expect(((await stale.json()) as { code: string }).code).toBe("reauth_required");

    signedIn({ aal: "aal2", amr: [{ method: "totp", timestamp: now - 30 }] });
    expect((await danger(req())).status).toBe(200);
  });

  it("uses the stricter rate-limit tier for changes and dangerous changes", async () => {
    const write = defineAdminRoute({ name: "t.w", permission: "users.read", write: true, handler });
    const danger = defineAdminRoute({
      name: "t.d",
      permission: "users.read",
      danger: true,
      handler,
    });
    await route(req());
    await write(req());
    await danger(req());
    expect(enforceRateLimit.mock.calls.map((call) => call[0])).toEqual([
      "admin-read",
      "admin-write",
      "admin-danger",
    ]);
    expect(enforceRateLimit.mock.calls[0]?.[1]).toBe(ADMIN.userId);
  });

  it("returns the limiter response before running the handler", async () => {
    enforceRateLimit.mockResolvedValue(new Response("slow down", { status: 429 }));
    expect((await route(req())).status).toBe(429);
    expect(handler).not.toHaveBeenCalled();
  });

  it("validates the body and query after the admin checks", async () => {
    const withInput = defineAdminRoute({
      name: "test.input",
      permission: "users.read",
      write: true,
      body: z.object({ n: z.number() }),
      query: z.object({ id: z.string().uuid() }),
      handler: async ({ body, query }) => ({ n: body.n, id: query.id }),
    });
    const id = "22222222-2222-2222-2222-222222222222";
    expect((await withInput(req({ n: "x" }, `http://localhost/x?id=${id}`))).status).toBe(400);
    expect((await withInput(req({ n: 2 }, "http://localhost/x?id=nope"))).status).toBe(400);
    const ok = await withInput(req({ n: 2 }, `http://localhost/x?id=${id}`));
    expect(await ok.json()).toEqual({ n: 2, id });
  });

  it("maps a thrown HttpError to its status and hides other failures", async () => {
    const { HttpError } = await import("@/server/http-error");
    const notFound = defineAdminRoute({
      name: "test.404",
      permission: "users.read",
      handler: () => {
        throw new HttpError(404, "User not found.");
      },
    });
    expect((await notFound(req())).status).toBe(404);

    const boom = defineAdminRoute({
      name: "test.boom",
      permission: "users.read",
      handler: () => {
        throw new Error("secret detail");
      },
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await boom(req());
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret detail");
  });

  it("exposes can() for field-level decisions", async () => {
    let seen: boolean[] = [];
    const probe = defineAdminRoute({
      name: "test.can",
      permission: "users.read",
      handler: ({ can }) => {
        seen = [can("users.read"), can("users.pii.read")];
        return null;
      },
    });
    await probe(req());
    expect(seen).toEqual([true, false]);
  });
});
