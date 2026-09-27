import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
const optionalWorkspaceEntitlements = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc,
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { name: "Acme", domain: "acme.test" } }) }),
      }),
    }),
  },
}));
vi.mock("@/server/billing/readiness.server", () => ({ optionalWorkspaceEntitlements }));

import { createOrGetWorkspace } from "./service.server";

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: { workspace_id: "workspace-1", created: true }, error: null });
});

describe("workspace creation during billing rollout", () => {
  it("uses the legacy idempotent creator before billing migrations are installed", async () => {
    optionalWorkspaceEntitlements.mockResolvedValue(null);
    await expect(
      createOrGetWorkspace({
        userId: "user-1",
        name: "Acme",
        websiteUrl: "https://acme.test",
        idempotencyKey: "request-1",
      }),
    ).resolves.toMatchObject({ id: "workspace-1", created: true });
    expect(rpc).toHaveBeenCalledWith("create_workspace_for_user", {
      p_user_id: "user-1",
      p_name: "Acme",
      p_website_url: "https://acme.test",
      p_idempotency_key: "user-1:request-1",
    });
  });

  it("uses the atomic billed creator after enforcement is enabled", async () => {
    optionalWorkspaceEntitlements.mockResolvedValue({
      enforcement: "on",
      limits: { brands: 3 },
      usage: { brands: 1 },
    });
    await createOrGetWorkspace({
      userId: "user-1",
      name: "Acme",
      websiteUrl: null,
      idempotencyKey: null,
    });
    expect(rpc).toHaveBeenCalledWith("create_billed_workspace_for_user", {
      p_user_id: "user-1",
      p_name: "Acme",
      p_website_url: null,
      p_idempotency_key: null,
      p_brand_limit: 3,
    });
  });
});
