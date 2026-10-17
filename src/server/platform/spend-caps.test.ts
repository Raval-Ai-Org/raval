import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

import { capDecision, capReached, setSpendReader } from "./spend-caps.server";

afterEach(() => setSpendReader(null));

const none = async () => null;

describe("capReached", () => {
  it("checks daily then monthly, and treats a missing cap as none", () => {
    expect(capReached(null, { todayUsd: 99, monthUsd: 99 })).toBeNull();
    expect(capReached({ dailyUsd: 10, monthlyUsd: null }, { todayUsd: 10, monthUsd: 0 })).toBe(
      "daily",
    );
    expect(capReached({ dailyUsd: null, monthlyUsd: 50 }, { todayUsd: 1, monthUsd: 51 })).toBe(
      "monthly",
    );
    expect(
      capReached({ dailyUsd: 10, monthlyUsd: 50 }, { todayUsd: 9.99, monthUsd: 49 }),
    ).toBeNull();
  });

  it("a zero cap is reached at once", () => {
    expect(capReached({ dailyUsd: 0, monthlyUsd: null }, { todayUsd: 0, monthUsd: 0 })).toBe(
      "daily",
    );
  });
});

describe("capDecision", () => {
  it("blocks every kind once the platform cap is reached", async () => {
    setSpendReader({
      caps: async () => ({ global: { dailyUsd: 100, monthlyUsd: null }, workspaces: {} }),
      platformSpend: async () => ({ todayUsd: 100, monthUsd: 100 }),
    });
    for (const kind of ["text", "image", "video", "search"] as const) {
      expect((await capDecision(kind, "w1", none))?.mode).toBe("block");
    }
  });

  it("lets calls through under the platform cap", async () => {
    setSpendReader({
      caps: async () => ({ global: { dailyUsd: 100, monthlyUsd: 1000 }, workspaces: {} }),
      platformSpend: async () => ({ todayUsd: 5, monthUsd: 50 }),
    });
    expect(await capDecision("text", "w1", none)).toBeNull();
  });

  it("degrades text but blocks images for a workspace over its cap", async () => {
    setSpendReader({
      caps: async () => ({ global: null, workspaces: { w1: { dailyUsd: 5, monthlyUsd: null } } }),
    });
    const spend = async () => ({ todayUsd: 6, monthUsd: 6 });
    expect((await capDecision("text", "w1", spend))?.mode).toBe("degrade");
    expect((await capDecision("image", "w1", spend))?.mode).toBe("block");
  });

  it("does not touch other workspaces or calls with no workspace", async () => {
    setSpendReader({
      caps: async () => ({ global: null, workspaces: { w1: { dailyUsd: 5, monthlyUsd: null } } }),
    });
    const spend = async () => ({ todayUsd: 6, monthUsd: 6 });
    expect(await capDecision("text", "w2", spend)).toBeNull();
    expect(await capDecision("text", null, spend)).toBeNull();
  });

  it("fails open when the caps can't be read", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    setSpendReader({
      caps: async () => {
        throw new Error("down");
      },
    });
    expect(await capDecision("text", "w1", none)).toBeNull();
    error.mockRestore();
  });
});
