import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { adImagePrompt } = await import("./visual-prompts.server");
const { getAdFormat } = await import("@/lib/studio/ad-formats");

const base = {
  format: getAdFormat("big-number")!,
  copy: { headline: "Cold brew in 5 minutes", support: "", badge: "", points: [], cta: "Shop now" },
  scene: "The kit on a sunny kitchen counter",
  brandName: "Brewly",
  brandContext: "Brewly makes cold brew kits.",
  palette: ["#0B3D2E", "#F4C430"],
  fonts: ["Inter"],
  ratio: "4:5",
  style: null,
};

describe("adImagePrompt", () => {
  it("asks for a finished ad with the layout, exact words and brand colours", () => {
    const prompt = adImagePrompt(base);
    expect(prompt).toContain("ready-to-run paid social ad for Brewly");
    expect(prompt).toContain(base.format.layout);
    expect(prompt).toContain('Headline: "Cold brew in 5 minutes"');
    expect(prompt).toContain('Button label: "Shop now"');
    expect(prompt).toContain("#0B3D2E, #F4C430");
    expect(prompt).toContain("Do not draw a logo.");
    expect(prompt).not.toContain("PRODUCT:");
  });

  it("keeps the logo corner clear", () => {
    const prompt = adImagePrompt({ ...base, logoCorner: "bottom-right" });
    expect(prompt).toContain("Leave the bottom-right corner clear");
  });

  it("keeps vertical ads clear of the platform's buttons", () => {
    expect(adImagePrompt({ ...base, ratio: "9:16" })).toContain("bottom 20% free of text");
  });
});
