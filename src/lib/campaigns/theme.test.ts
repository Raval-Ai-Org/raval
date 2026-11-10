import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLAYBOOKS } from "./playbooks";
import { allCampaignPhotos, campaignTheme } from "./theme";

// Emoji, pictographs and the variation selector that turns a symbol into one.
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}]/u;

describe("campaignTheme", () => {
  it("dresses a named moment in its own photo", () => {
    expect(campaignTheme({ title: "Halloween campaign", type: "seasonal" }).photo).toBe(
      "halloween",
    );
    expect(campaignTheme({ title: "Diwali campaign" }).photo).toBe("diwali");
    expect(campaignTheme({ title: "Black Friday campaign", type: "sale" }).photo).toBe(
      "black-friday",
    );
    expect(campaignTheme({ title: "Eid al-Fitr campaign" }).photo).toBe("eid-fitr");
    expect(campaignTheme({ title: "Eid al-Adha campaign" }).photo).toBe("eid-adha");
    expect(campaignTheme({ title: "Lunar New Year sale" }).photo).toBe("lunar-new-year");
    expect(campaignTheme({ title: "New Year countdown" }).photo).toBe("new-year");
    expect(campaignTheme({ title: "Pakistan Independence Day" }).photo).toBe("pakistan-day");
    expect(campaignTheme({ title: "Holiday season" }).photo).toBe("christmas");
  });

  it("falls back to the kind, then to a default", () => {
    expect(campaignTheme({ title: "Launch Accelerate", type: "product-launch" }).icon).toBe(
      "Rocket",
    );
    expect(campaignTheme({ title: "Something else", type: "unknown" }).photo).toBe("default");
  });

  it("has art for every playbook", () => {
    const fallback = campaignTheme({ type: "no-such-kind" });
    for (const p of PLAYBOOKS) expect(campaignTheme({ type: p.id })).not.toBe(fallback);
  });

  it("has a photo on disk with a credit for every theme, and no emoji", () => {
    const credits = readFileSync("public/campaigns/CREDITS.md", "utf8");
    for (const photo of allCampaignPhotos()) {
      expect(existsSync(`public/campaigns/${photo}.webp`), photo).toBe(true);
      expect(credits.includes(`\`${photo}.webp\``), `credit for ${photo}`).toBe(true);
    }
    for (const p of PLAYBOOKS)
      expect(EMOJI.test(JSON.stringify(campaignTheme({ type: p.id })))).toBe(false);
  });
});
