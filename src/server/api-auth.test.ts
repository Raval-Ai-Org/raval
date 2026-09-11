import { beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client.user.server", () => ({
  createUserClient: () => ({ auth: { getClaims } }),
}));

import { checkWorkspaceMembership, roleAtLeast, verifyBearer, type VerifiedUser } from "./api-auth";

const withAuth = (value?: string) =>
  new Request("http://localhost/api/x", value ? { headers: { authorization: value } } : {});

// Braces matter: a function returned from beforeEach is run as teardown.
beforeEach(() => {
  getClaims.mockReset();
});

describe("verifyBearer", () => {
  it("requires a Bearer header", async () => {
    expect(await verifyBearer(withAuth())).toMatchObject({ ok: false, status: 401 });
    expect(await verifyBearer(withAuth("Basic abc"))).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects non-JWT tokens without a network call", async () => {
    expect(await verifyBearer(withAuth("Bearer not-a-jwt"))).toMatchObject({ status: 401 });
    expect(getClaims).not.toHaveBeenCalled();
  });

  it("maps a getClaims error result to 401", async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error("expired") });
    expect(await verifyBearer(withAuth("Bearer a.b.c"))).toMatchObject({ ok: false, status: 401 });
  });

  it("maps a getClaims throw (undecodable token) to 401, not 500", async () => {
    getClaims.mockImplementation(async () => {
      throw new Error("Invalid UTF-8 sequence");
    });
    expect(await verifyBearer(withAuth("Bearer aaa.bbb.ccc"))).toMatchObject({
      ok: false,
      status: 401,
      message: "Invalid session",
    });
  });

  it("returns the user id and the RLS client for a valid token", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } }, error: null });
    const result = await verifyBearer(withAuth("Bearer a.b.c"));
    expect(result).toMatchObject({ ok: true, userId: "user-1" });
  });
});

describe("checkWorkspaceMembership roles", () => {
  const WS = "22222222-2222-2222-2222-222222222222";
  const authWithRole = (role: string | null): VerifiedUser => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.maybeSingle = async () => ({
      data: role ? { workspace_id: WS, role } : null,
      error: null,
    });
    return {
      ok: true,
      userId: "user-1",
      claims: {} as VerifiedUser["claims"],
      supabase: { from: () => chain } as unknown as VerifiedUser["supabase"],
    };
  };

  it("ranks roles owner > admin > editor > viewer", () => {
    expect(roleAtLeast("owner", "editor")).toBe(true);
    expect(roleAtLeast("editor", "editor")).toBe(true);
    expect(roleAtLeast("viewer", "editor")).toBe(false);
    expect(roleAtLeast(undefined, "viewer")).toBe(false);
  });

  it("returns the member's role", async () => {
    expect(await checkWorkspaceMembership(authWithRole("admin"), WS)).toEqual({
      ok: true,
      workspaceId: WS,
      role: "admin",
    });
  });

  it("403s a viewer on a route that needs editor (publish/schedule/OAuth)", async () => {
    const out = await checkWorkspaceMembership(authWithRole("viewer"), WS, { minRole: "editor" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.response.status).toBe(403);
  });

  it("403s a non-member regardless of minRole", async () => {
    const out = await checkWorkspaceMembership(authWithRole(null), WS);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.response.status).toBe(403);
  });
});
