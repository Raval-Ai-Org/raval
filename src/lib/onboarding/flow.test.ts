import { describe, expect, it } from "vitest";
import { CreateJobSchema } from "@/lib/studio/jobs";
import { decideGoals } from "@/lib/goals/decide";
import {
  blockedReason,
  firstPostBriefs,
  firstPostKey,
  firstPostPlatform,
  indicatorIndex,
  nextStep,
  type FlowState,
} from "./flow";

const WS = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "22222222-2222-4222-8222-222222222222";
const PHOTO = "33333333-3333-4333-8333-333333333333";
const site: FlowState = { mode: "site", scan: "loading", goalsSaved: true, activeProducts: 0 };

describe("nextStep", () => {
  it("asks the goal while the scan runs, then waits for it", () => {
    expect(nextStep("website", site)).toBe("goals");
    expect(nextStep("goals", site)).toBe("scan");
    expect(nextStep("goals", { ...site, scan: "ok" })).toBe("review");
    expect(nextStep("review", site)).toBe("products");
  });

  it("skips the scan without a website", () => {
    const manual: FlowState = { ...site, mode: "manual" };
    expect(nextStep("website", manual)).toBe("manual");
    expect(nextStep("goals", manual)).toBe("products");
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
    expect(indicatorIndex("site", "done")).toBe(6);
  });
});

describe("firstPostBriefs", () => {
  const goals = decideGoals(
    { focus: "leads", timeframeWeeks: 12, postsPerWeek: 3, channels: ["linkedin"] },
    new Date("2026-11-01T00:00:00Z"),
  );
  if (!goals.ok) throw new Error("expected ok");

  it("makes three valid Studio jobs with different aims and stable keys", () => {
    const briefs = firstPostBriefs({
      workspaceId: WS,
      brandName: "Acme",
      goals: goals.goals,
      product: { id: PRODUCT, kind: "product", name: "Blue Mug", primaryAssetId: PHOTO },
      platform: "linkedin",
    });
    expect(briefs).toHaveLength(3);
    expect(new Set(briefs.map((b) => b.aim)).size).toBe(3);
    for (const b of briefs) {
      expect(b.job.idempotencyKey).toBe(firstPostKey(WS, b.n));
      expect(b.job.controls.referenceAssetIds).toEqual([PHOTO]);
      expect(b.job.controls.referenceMode).toBe("preserve");
      expect(CreateJobSchema.safeParse(b.job).success).toBe(true);
    }
  });

  it("writes a service post without a photo", () => {
    const [b] = firstPostBriefs({
      workspaceId: WS,
      brandName: "Acme",
      goals: goals.goals,
      product: { id: PRODUCT, kind: "service", name: "Coaching", primaryAssetId: PHOTO },
      platform: "linkedin",
    });
    expect(b.job.controls.referenceAssetIds).toBeUndefined();
    expect(b.job.controls.includeImage).toBe(false);
  });

  it("prefers a goal channel that is connected", () => {
    expect(firstPostPlatform(goals.goals, ["instagram", "linkedin"])).toBe("linkedin");
    expect(firstPostPlatform(null, [])).toBe("instagram");
  });
});
