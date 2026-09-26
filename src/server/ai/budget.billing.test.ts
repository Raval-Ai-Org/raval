import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  workspace: vi.fn(),
  enforcement: vi.fn(),
  summary: vi.fn(),
}));

vi.mock("@/server/billing/accounts.server", () => ({
  accountForWorkspace: mocked.workspace,
  accountForUser: vi.fn(),
}));
vi.mock("@/server/billing/entitlements.server", () => ({
  enforcementFor: mocked.enforcement,
  entitledPlanFor: () => "growth",
}));
vi.mock("@/server/cache/store", () => ({
  cache: { get: async () => null, set: async () => {}, del: async () => {}, incr: async () => 1 },
}));
vi.mock("@/server/guardrails/events", () => ({ logGuardrailEvent: vi.fn() }));

import { checkBudget, setBudgetDeps } from "./budget";

beforeEach(() => {
  vi.clearAllMocks();
  mocked.workspace.mockResolvedValue({ account: { id: "acct-1" } });
  mocked.summary.mockResolvedValue({
    todayCostUsd: 0,
    monthCostUsd: 0,
    monthImages: 100_000,
    monthVideos: 100_000,
    monthCalls: 0,
    monthCachedCalls: 0,
    monthSavedUsd: 0,
  });
  setBudgetDeps({ summary: mocked.summary, plan: async () => "starter" });
});

afterEach(() => setBudgetDeps(null));

describe("account safety budget", () => {
  it("uses the owner account scope and removes image quantity quotas in on mode", async () => {
    mocked.enforcement.mockReturnValue("on");
    const result = await checkBudget("image", { workspaceId: "workspace-1" });
    expect(result.scope).toBe("account");
    expect(result.mode).toBe("ok");
    expect(mocked.summary).toHaveBeenCalledWith("acct:acct-1");
  });

  it("keeps workspace quotas during shadow rollout", async () => {
    mocked.enforcement.mockReturnValue("shadow");
    const result = await checkBudget("image", { workspaceId: "workspace-1" });
    expect(result.scope).toBe("workspace");
    expect(result.mode).toBe("block");
    expect(mocked.summary).toHaveBeenCalledWith("ws:workspace-1");
  });
});
