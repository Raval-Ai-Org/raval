import { describe, expect, it } from "vitest";
import { PLAYBOOKS } from "./playbooks";
import { campaignTheme } from "./theme";

describe("campaignTheme", () => {
  it("dresses a named moment in its own art", () => {
    expect(campaignTheme({ title: "Halloween campaign", type: "seasonal" }).art[0]).toBe("🎃");
    expect(campaignTheme({ title: "Diwali campaign", type: "seasonal" }).art[0]).toBe("🪔");
    expect(campaignTheme({ title: "Black Friday campaign", type: "sale" }).art[0]).toBe("🛍️");
    expect(campaignTheme({ title: "Eid al-Fitr campaign" }).art[0]).toBe("🌙");
  });

  it("falls back to the kind, then to a default", () => {
    expect(campaignTheme({ title: "Launch Accelerate", type: "product-launch" }).art[0]).toBe("🚀");
    expect(campaignTheme({ title: "Something else", type: "unknown" }).art).toHaveLength(3);
  });

  it("has art for every playbook", () => {
    const fallback = campaignTheme({ type: "no-such-kind" });
    for (const p of PLAYBOOKS) expect(campaignTheme({ type: p.id })).not.toBe(fallback);
  });
});
