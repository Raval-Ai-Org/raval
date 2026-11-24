// Round 9 campaign platform (flag `campaign_platform`): one look for every piece.
import { describe, expect, it } from "vitest";
import { CampaignBriefSchema, CampaignPlanSchema } from "./contracts";
import { groundPlatform } from "./ground";
import { playbookById } from "./playbooks";
import { PLAN_SYSTEM, pieceBrief, planSystem } from "./prompt";
import { buildCampaignSkeleton } from "./skeleton";

const brief = CampaignBriefSchema.parse({
  type: "product-launch",
  name: "Lamp launch",
  startsOn: "2026-11-02",
  keyDate: "2026-11-20",
  channels: ["instagram"],
  goal: { kind: "sales", link: "https://shop.example.com/lamp" },
});
const launch = playbookById("product-launch")!;
const opts = { known: (s: string) => !/\d/.test(s), link: null, competitors: ["Rivalco"] };

describe("campaign platform", () => {
  it("leaves the plan prompt unchanged when off", () => {
    expect(planSystem()).toBe(PLAN_SYSTEM);
    expect(planSystem({ platform: true })).toContain('"platform"');
  });

  it("keeps an older plan readable and a bad platform out", () => {
    const old = CampaignPlanSchema.parse({ phases: [], pieces: [] });
    expect(old.platform).toBeUndefined();
    const bad = CampaignPlanSchema.parse({ phases: [], pieces: [], platform: { tagline: 7 } });
    expect(bad.platform).toBeUndefined();
  });

  it("grounds the platform's words like the pieces", () => {
    const p = groundPlatform(
      {
        platform: {
          tagline: "Light that waits. Now 40% off.",
          keyVisual: "The lamp on a desk at dusk. Better than Rivalco.",
          motif: "A thin line of light",
          photoRule: "Our own photos, shown whole",
        },
      },
      opts,
    );
    expect(p?.tagline).toBe("Light that waits.");
    expect(p?.keyVisual).not.toContain("Rivalco");
    expect(groundPlatform({}, opts)).toBeNull();
  });

  it("adds the look to every piece only when the plan has one", () => {
    const s = buildCampaignSkeleton(launch, brief, [], "2026-11-01");
    const plan = {
      v: 1 as const,
      bigIdea: "",
      phases: s.phases,
      pieces: s.pieces,
      written: true,
      rev: 0,
    };
    const piece = { ...s.pieces[0], title: "Hint", idea: "A hint of the lamp." };
    const without = pieceBrief({ playbook: launch, brief, plan, piece });
    const withLook = pieceBrief({
      playbook: launch,
      brief,
      plan: {
        ...plan,
        platform: {
          tagline: "Light that waits.",
          keyVisual: "The lamp at dusk",
          motif: "",
          photoRule: "",
        },
      },
      piece,
    });
    expect(without).not.toContain("tagline");
    expect(withLook).toContain("Light that waits.");
    expect(withLook).toContain("deliverable");
  });
});
