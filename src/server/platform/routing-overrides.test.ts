import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

import { knownModels, planFor, PREMIUM, WORKHORSE, ECONOMY } from "@/server/ai/task-models";
import { refreshRoutingOverrides, setOverrideReader } from "./routing-overrides.server";

afterEach(() => {
  setOverrideReader(null);
  delete process.env.AI_MODEL_BRAND_EXTRACT;
  delete process.env.AI_EFFORT_BRAND_EXTRACT;
});

describe("routing overrides in planFor", () => {
  it("leaves the built-in plan alone with no override", async () => {
    setOverrideReader(async () => ({}));
    await refreshRoutingOverrides(true);
    expect(planFor("brand-extract").models[0]).toBe(PREMIUM);
  });

  it("applies an admin override to the models and effort", async () => {
    setOverrideReader(async () => ({ "brand-extract": { models: [ECONOMY], effort: "low" } }));
    await refreshRoutingOverrides(true);
    const plan = planFor("brand-extract");
    expect(plan.models).toEqual([ECONOMY]);
    expect(plan.effort).toBe("low");
  });

  it("ignores a model the registry does not use", async () => {
    setOverrideReader(async () => ({ "brand-extract": { models: ["evil/unknown-model"] } }));
    await refreshRoutingOverrides(true);
    expect(planFor("brand-extract").models[0]).toBe(PREMIUM);
  });

  it("lets an environment variable outrank the override", async () => {
    setOverrideReader(async () => ({ "brand-extract": { models: [ECONOMY], effort: "low" } }));
    await refreshRoutingOverrides(true);
    process.env.AI_MODEL_BRAND_EXTRACT = WORKHORSE;
    process.env.AI_EFFORT_BRAND_EXTRACT = "high";
    const plan = planFor("brand-extract");
    expect(plan.models).toEqual([WORKHORSE]);
    expect(plan.effort).toBe("high");
  });

  it("keeps the last snapshot when a refresh fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let fail = false;
    setOverrideReader(async () => {
      if (fail) throw new Error("down");
      return { "brand-extract": { models: [ECONOMY] } };
    });
    await refreshRoutingOverrides(true);
    fail = true;
    await refreshRoutingOverrides(true);
    expect(planFor("brand-extract").models).toEqual([ECONOMY]);
    error.mockRestore();
  });

  it("only offers models the plans already use", () => {
    const models = knownModels();
    expect(models.has(PREMIUM)).toBe(true);
    expect(models.has("evil/unknown-model")).toBe(false);
  });
});
