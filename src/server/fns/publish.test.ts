import { beforeEach, describe, expect, it, vi } from "vitest";
import { getPublishQueue } from "./publish";

const mocks = vi.hoisted(() => ({ db: undefined as unknown, role: vi.fn(), proof: vi.fn() }));
vi.mock("@/server/middleware", () => ({
  runMiddleware: async () => ({ supabase: mocks.db, userId: "user", claims: {} }),
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/server/workspace-access.server", () => ({ requireWorkspaceRole: mocks.role }));
vi.mock("@/lib/feature-flags", () => ({ isProofEngineEnabled: mocks.proof }));

const workspaceId = "22222222-2222-4222-8222-222222222222";
function database(failing: string[] = [], hasPost = true) {
  return {
    from: vi.fn((table: string) => {
      const data =
        table === "content_items" && hasPost
          ? [
              {
                id: "post",
                title: "Ready post",
                body: "Copy",
                kind: "post",
                channel: "linkedin",
                status: "approved",
                scheduled_at: null,
                updated_at: null,
              },
            ]
          : [];
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        order: () => query,
        is: () => query,
        limit: () => query,
        then: (resolve: (result: unknown) => unknown) =>
          Promise.resolve({
            data: failing.includes(table) ? null : data,
            error: failing.includes(table) ? { message: "private-database-diagnostics" } : null,
          }).then(resolve),
      };
      return query;
    }),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.role.mockResolvedValue("viewer");
  mocks.proof.mockReturnValue(true);
});

describe("publish list completeness", () => {
  it.each([
    ["site_publications", "Articles"],
    ["geo_fix_proposals", "Website fixes"],
    ["geo_fix_batches", "Website fixes"],
    ["site_blog_settings", "Blog setup"],
    ["experiment_deliveries", "Experiments"],
  ])("keeps readable posts while identifying an unavailable source: %s", async (table, label) => {
    mocks.db = database([table]);
    const queue = await getPublishQueue.invoke({ workspaceId });
    expect(queue.ready[0].title).toBe("Ready post");
    expect(queue.unavailableSources).toEqual([label]);
    expect(JSON.stringify(queue)).not.toContain("private-database-diagnostics");
  });

  it("does not describe failed website reads as a complete empty list", async () => {
    mocks.db = database(["site_publications", "geo_fix_proposals", "geo_fix_batches"], false);
    const queue = await getPublishQueue.invoke({ workspaceId });
    expect(queue.ready).toEqual([]);
    expect(queue.unavailableSources).toEqual(["Articles", "Website fixes"]);
  });

  it("does not call disabled experiment features unavailable", async () => {
    const db = database(["experiment_deliveries"]);
    mocks.db = db;
    mocks.proof.mockReturnValue(false);
    const queue = await getPublishQueue.invoke({ workspaceId });
    expect(queue.unavailableSources).toBeUndefined();
    expect(db.from).not.toHaveBeenCalledWith("experiment_deliveries");
  });

  it("fails when the primary content read fails", async () => {
    mocks.db = database(["content_items"]);
    await expect(getPublishQueue.invoke({ workspaceId })).rejects.toThrow("Could not load");
  });
});
