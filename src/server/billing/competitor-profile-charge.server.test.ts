import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ lookup: vi.fn(), begin: vi.fn() }));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: state.lookup }) }),
      }),
    }),
  },
}));
vi.mock("./metered.server", () => ({ beginDeferredMetered: state.begin }));

import { chargeCompetitorProfile } from "./async-charges.server";

beforeEach(() => {
  state.lookup.mockReset();
  state.begin.mockReset();
});

it("does not reserve credits for a competitor outside the verified workspace", async () => {
  state.lookup.mockResolvedValue({ data: null, error: null });
  await expect(
    chargeCompetitorProfile({
      workspaceId: "workspace-a",
      userId: "user-a",
      role: "editor",
      competitorId: "competitor-b",
      profileStatus: "pending",
    }),
  ).rejects.toMatchObject({ status: 404 });
  expect(state.begin).not.toHaveBeenCalled();
});

it("does not reserve credits for a full refresh of an ignored competitor", async () => {
  state.lookup.mockResolvedValue({ data: { id: "competitor-a", status: "ignored" }, error: null });
  await expect(
    chargeCompetitorProfile({
      workspaceId: "workspace-a",
      userId: "user-a",
      role: "editor",
      competitorId: "competitor-a",
      profileStatus: "pending",
      requireTracked: true,
    }),
  ).rejects.toMatchObject({ status: 404 });
  expect(state.begin).not.toHaveBeenCalled();
});
