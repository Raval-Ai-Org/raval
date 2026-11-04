import { describe, expect, it } from "vitest";
import { blockedReason, indicatorIndex, nextStep, previousStep, type FlowState } from "./flow";

const site: FlowState = { mode: "site", scan: "loading", goalsSaved: true, activeProducts: 0 };

describe("nextStep", () => {
  it("asks the goal while the scan runs, then waits for it", () => {
    expect(nextStep("website", site)).toBe("goals");
    expect(nextStep("goals", site)).toBe("scan");
    expect(nextStep("goals", { ...site, scan: "ok" })).toBe("review");
    expect(nextStep("review", site)).toBe("language");
    expect(nextStep("language", site)).toBe("products");
  });

  it("skips the scan without a website", () => {
    const manual: FlowState = { ...site, mode: "manual" };
    expect(nextStep("website", manual)).toBe("manual");
    expect(nextStep("goals", manual)).toBe("language");
    expect(previousStep("language", manual)).toBe("goals");
  });

  it("asks the language before products, and goes back to it", () => {
    expect(previousStep("language", site)).toBe("review");
    expect(previousStep("products", site)).toBe("language");
    expect(blockedReason("language", site)).toBeNull();
  });
});

describe("gates", () => {
  it("needs a product or service", () => {
    expect(blockedReason("products", site)).toMatch(/at least one/);
    expect(blockedReason("products", { ...site, activeProducts: 1 })).toBeNull();
  });

  it("needs a goal", () => {
    expect(blockedReason("goals", { ...site, goalsSaved: false })).not.toBeNull();
  });

  it("puts the scan under the goal step in the header", () => {
    expect(indicatorIndex("site", "scan")).toBe(indicatorIndex("site", "goals"));
    expect(indicatorIndex("site", "done")).toBe(7);
    expect(indicatorIndex("site", "language")).toBe(3);
  });
});
