import { describe, expect, it } from "vitest";
import { getPlanLimits, normalizePlanId } from "./plans";

describe("legacy workspace plan compatibility", () => {
  it("keeps Free and Scale distinct from Starter", () => {
    expect(normalizePlanId("free")).toBe("free");
    expect(normalizePlanId("scale")).toBe("scale");
    expect(normalizePlanId("unrecognized")).toBe("free");
    expect(getPlanLimits("free").maxConcurrentExperiments).toBe(0);
    expect(getPlanLimits("scale").maxConcurrentExperiments).toBe(50);
  });
});
