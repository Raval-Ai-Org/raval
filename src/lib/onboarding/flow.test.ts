import { describe, expect, it } from "vitest";
import {
  blockedReason,
  nextStep,
  previousStep,
  progressOf,
  screensLeft,
  type FlowState,
} from "./flow";

const site: FlowState = {
  mode: "site",
  scan: "loading",
  goalsSaved: true,
  activeProducts: 0,
  audienceOptions: 3,
};

describe("nextStep", () => {
  it("asks the questions while the scan runs, then waits for it", () => {
    expect(nextStep("website", site)).toBe("ask");
    expect(nextStep("ask", site)).toBe("scan");
    expect(nextStep("ask", { ...site, scan: "ok" })).toBe("review");
    expect(nextStep("review", site)).toBe("audience");
    expect(nextStep("audience", site)).toBe("products");
    expect(nextStep("products", site)).toBe("language");
    expect(nextStep("language", site)).toBe("connect");
    expect(nextStep("connect", site)).toBe("first");
  });

  it("skips the audience question when the scan offered no groups", () => {
    const none = { ...site, audienceOptions: 0 };
    expect(nextStep("review", none)).toBe("products");
    expect(previousStep("products", none)).toBe("review");
  });

  it("skips the scan without a website", () => {
    const manual: FlowState = { ...site, mode: "manual" };
    expect(nextStep("website", manual)).toBe("manual");
    expect(nextStep("manual", manual)).toBe("ask");
    expect(nextStep("ask", manual)).toBe("products");
    expect(previousStep("products", manual)).toBe("ask");
    expect(previousStep("ask", manual)).toBe("manual");
  });

  it("goes back one step at a time", () => {
    expect(previousStep("ask", site)).toBe("website");
    expect(previousStep("review", site)).toBe("ask");
    expect(previousStep("language", site)).toBe("products");
    expect(previousStep("connect", site)).toBe("language");
    expect(previousStep("first", site)).toBe("connect");
  });
});

describe("gates", () => {
  it("needs a product or service", () => {
    expect(blockedReason("products", site)).toMatch(/at least one/);
    expect(blockedReason("products", { ...site, activeProducts: 1 })).toBeNull();
  });

  it("needs a goal before leaving the questions", () => {
    expect(blockedReason("ask", { ...site, goalsSaved: false })).not.toBeNull();
    expect(blockedReason("ask", site)).toBeNull();
  });
});

describe("progress", () => {
  it("only moves forward through the flow", () => {
    const ask = { index: 0, count: 15 };
    const order = [
      progressOf("website", ask, "site"),
      progressOf("ask", { index: 0, count: 15 }, "site"),
      progressOf("ask", { index: 14, count: 15 }, "site"),
      progressOf("review", ask, "site"),
      progressOf("products", ask, "site"),
      progressOf("first", ask, "site"),
      progressOf("done", ask, "site"),
    ];
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
    expect(order.at(-1)).toBe(1);
  });

  it("counts the screens still to come", () => {
    const ask = { index: 3, count: 15 };
    expect(screensLeft("ask", ask, site)).toBe(11 + 6);
    expect(screensLeft("first", ask, site)).toBe(0);
  });
});
