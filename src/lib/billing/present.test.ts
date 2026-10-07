import { describe, expect, it } from "vitest";
import {
  addonForLimit,
  blockHeadline,
  formatMeter,
  formatVideos,
  ledgerLabel,
  nextPlan,
  planForLimit,
  planForMeter,
  freeNudge,
  planPrice,
  suggestedPlan,
} from "./present";

describe("free plan nudges", () => {
  const now = new Date("2026-10-07T00:00:00Z");
  it("says nothing while there is plenty left", () => {
    expect(freeNudge({ credits: 80, nextExpiry: "2026-11-01T00:00:00Z", now })).toBeNull();
    expect(freeNudge({ credits: 80, nextExpiry: null, now })).toBeNull();
  });
  it("speaks up when credits are low, gone or about to end", () => {
    expect(freeNudge({ credits: 16, nextExpiry: null, now })?.title).toBe("16 free credits left");
    expect(freeNudge({ credits: 1, nextExpiry: null, now })?.title).toBe("1 free credit left");
    expect(freeNudge({ credits: 0, nextExpiry: null, now })?.id).toBe("empty");
    expect(freeNudge({ credits: 80, nextExpiry: "2026-10-10T00:00:00Z", now })?.title).toBe(
      "Your free credits end in 3 days",
    );
    expect(freeNudge({ credits: 80, nextExpiry: "2026-10-01T00:00:00Z", now })).toBeNull();
  });
});

describe("billing presentation helpers", () => {
  it("formats video units as videos", () => {
    expect(formatVideos(400)).toBe("4");
    expect(formatVideos(350)).toBe("3.5");
    expect(formatVideos(125)).toBe("1.25");
    expect(formatMeter("video", 100)).toBe("1 video");
    expect(formatMeter("credits", 2000)).toBe("2,000 credits");
  });

  it("prices annual plans at ten months", () => {
    expect(planPrice("growth", "year")).toEqual({ perMonth: 124.17, billed: 1490, savings: 298 });
    expect(planPrice("starter", "month").perMonth).toBe(49);
  });

  it("suggests the cheapest plan that fixes the block", () => {
    expect(nextPlan("free")).toBe("starter");
    expect(nextPlan("scale")).toBeNull();
    expect(planForLimit("starter", "brands", 2)).toBe("growth");
    expect(planForLimit("growth", "brands", 4)).toBe("agency");
    expect(planForLimit("growth", "seats", 6)).toBe("agency");
    expect(planForMeter("free", "credits", 5000)).toBe("growth");
    expect(
      suggestedPlan(
        { code: "upgrade_required", feature: "campaigns", requiredPlan: "growth" },
        "free",
      ),
    ).toBe("growth");
    // Never suggest a plan at or below the current one.
    expect(
      suggestedPlan(
        { code: "upgrade_required", feature: "studio", requiredPlan: "free" },
        "starter",
      ),
    ).toBe("growth");
    expect(
      suggestedPlan({ code: "insufficient_balance", meter: "video", needed: 100 }, "free"),
    ).toBe("starter");
  });

  it("only offers add-ons that are sold on the plan", () => {
    expect(addonForLimit("growth", "brands")?.key).toBe("extra_brand");
    expect(addonForLimit("starter", "brands")).toBeNull();
    expect(addonForLimit("starter", "seats")?.key).toBe("extra_seat");
    expect(addonForLimit("agency", "seats")).toBeNull();
  });

  it("names ledger rows in plain words", () => {
    expect(ledgerLabel({ kind: "capture", action: "article_premium", meter: "credits" })).toBe(
      "Premium article",
    );
    expect(ledgerLabel({ kind: "grant", action: null, meter: "credits" })).toBe("Added to balance");
    expect(blockHeadline({ code: "insufficient_balance", meter: "video" })).toBe(
      "Not enough videos left",
    );
  });
});
