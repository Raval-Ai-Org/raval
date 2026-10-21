import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("@/integrations/supabase/client.user.server", () => ({ createUserClient: vi.fn() }));

import { checkWorkspaceMembership, type VerifiedUser } from "@/server/api-auth";
import {
  accessRefusal,
  setAccessReader,
  workspaceAccessMode,
  type AccessMode,
} from "./workspace-access.server";

const WS = "20000001-0000-4000-8000-000000000001";

function userWithRole(role: string | null): VerifiedUser {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: role ? { workspace_id: WS, role } : null, error: null }),
  };
  return {
    ok: true,
    userId: "u1",
    claims: {} as never,
    supabase: { from: () => query } as never,
  };
}

afterEach(() => setAccessReader(null));

describe("accessRefusal", () => {
  it("refuses everything when suspended", () => {
    expect(accessRefusal("suspended", false)?.code).toBe("workspace_suspended");
    expect(accessRefusal("suspended", true)?.code).toBe("workspace_suspended");
  });

  it("refuses only changes in read-only mode", () => {
    expect(accessRefusal("read_only", true)?.code).toBe("workspace_read_only");
    expect(accessRefusal("read_only", false)).toBeNull();
  });

  it("lets an active workspace through", () => {
    expect(accessRefusal("active", true)).toBeNull();
  });
});

describe("workspaceAccessMode", () => {
  it("reads once and caches", async () => {
    const reader = vi.fn(async (): Promise<AccessMode> => "read_only");
    setAccessReader(reader);
    expect(await workspaceAccessMode(WS)).toBe("read_only");
    expect(await workspaceAccessMode(WS)).toBe("read_only");
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it("treats an unreadable table as active", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    setAccessReader(async () => {
      throw new Error("down");
    });
    expect(await workspaceAccessMode(WS)).toBe("active");
    error.mockRestore();
  });
});

describe("checkWorkspaceMembership with an admin-set mode", () => {
  it("blocks a member of a suspended workspace, even for reads", async () => {
    setAccessReader(async () => "suspended");
    const result = await checkWorkspaceMembership(userWithRole("owner"), WS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
      expect(((await result.response.json()) as { code: string }).code).toBe("workspace_suspended");
    }
  });

  it("blocks an editor-level change but not a read in read-only mode", async () => {
    setAccessReader(async () => "read_only");
    const write = await checkWorkspaceMembership(userWithRole("editor"), WS, { minRole: "editor" });
    expect(write.ok).toBe(false);
    const read = await checkWorkspaceMembership(userWithRole("editor"), WS);
    expect(read.ok).toBe(true);
  });

  it("does not reveal a workspace's state to someone who is not a member", async () => {
    setAccessReader(async () => "suspended");
    const result = await checkWorkspaceMembership(userWithRole(null), WS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
    if (!result.ok) {
      expect(((await result.response.json()) as { error: string }).error).toMatch(/Not a member/);
    }
  });

  it("changes nothing for an active workspace", async () => {
    setAccessReader(async () => "active");
    const result = await checkWorkspaceMembership(userWithRole("editor"), WS, {
      minRole: "editor",
    });
    expect(result.ok).toBe(true);
  });
});
