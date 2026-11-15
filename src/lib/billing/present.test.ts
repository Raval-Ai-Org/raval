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

describe("no-plan nudge", () => {
  const now = new Date("2026-10-07T00:00:00Z");
  it("says nothing while there are credits left", () => {
    expect(freeNudge({ credits: 80, nextExpiry: "2026-11-01T00:00:00Z", now })).toBeNull();
  });
  it("asks for a plan once nothing is left", () => {
    const nudge = freeNudge({ credits: 0, nextExpiry: null, now });
    expect(nudge?.id).toBe("empty");
    expect(nudge?.title).toBe("Choose a plan to start");
    expect(nudge?.text).toContain("150 credits");
  });
});

describe("billing presentation helpers", () => {
  it("formats video units as videos", () => {
    expect(formatVideos(400)).toBe("4");
    expect(formatVideos(350)).toBe("3.5");
    expect(formatVideos(125)).toBe("1.25");
    expect(formatMeter("video", 100)).toBe("1 video credit");
    expect(formatMeter("credits", 2000)).toBe("66 credits");
    expect(formatMeter("credits", 30)).toBe("1 credit");
  });

  it("prices yearly plans at the yearly rate", () => {
    expect(planPrice("growth", "year")).toEqual({ perMonth: 119, billed: 1428, savings: 360 });
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
      "Not enough credits left",
    );
  });
});
