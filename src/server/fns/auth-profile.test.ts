import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ upsert: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: mocks.from } }));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/server/middleware", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/middleware")>()),
  runMiddleware: async () => ({
    userId: "verified-user",
    claims: { email: "verified@example.test", user_metadata: { full_name: "Verified User" } },
  }),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { ensureAuthWorkspace } from "./workspaces";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockReturnValue({ upsert: mocks.upsert });
  mocks.upsert.mockResolvedValue({ error: null });
});

describe("verified account profile setup", () => {
  it("reports profile persistence failure so confirmation can retry setup", async () => {
    mocks.upsert.mockResolvedValueOnce({ error: { message: "private database diagnostics" } });
    await expect(ensureAuthWorkspace.invoke(undefined)).rejects.toThrow(
      "Could not finish account setup. Please retry.",
    );
    await expect(ensureAuthWorkspace.invoke(undefined)).resolves.toBeNull();
    expect(mocks.upsert).toHaveBeenCalledTimes(2);
  });

  it("upserts only the authenticated profile and leaves workspace selection to projects", async () => {
    await ensureAuthWorkspace.invoke(undefined);
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith("profiles");
    expect(mocks.upsert).toHaveBeenCalledWith(
      { id: "verified-user", name: "Verified User", avatar_url: null },
      { onConflict: "id" },
    );
  });
});
