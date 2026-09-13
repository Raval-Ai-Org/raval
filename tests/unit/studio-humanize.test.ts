import { describe, expect, it } from "vitest";
import { humanizeOutput, humanizeText } from "@/lib/studio/humanize";

const DASH = /[—–]/;

describe("humanizeText", () => {
  it.each([
    ["Not as charity — as quality control.", "Not as charity, as quality control."],
    ["Not as charity—as quality control.", "Not as charity, as quality control."],
    ["Steep 2–4 hours longer.", "Steep 2-4 hours longer."],
    ["A well–known roaster.", "A well-known roaster."],
    ["— Maria, head roaster", "Maria, head roaster"],
    ["Ripe cherries only —", "Ripe cherries only"],
    ["Good coffee —.", "Good coffee."],
    ["No dashes here.", "No dashes here."],
  ])("%s", (input, expected) => {
    expect(humanizeText(input)).toBe(expected);
  });

  it("keeps line breaks and ordinary hyphens", () => {
    const text = "Line one — still one\nLine two: first-class beans";
    expect(humanizeText(text)).toBe("Line one, still one\nLine two: first-class beans");
  });
});

describe("humanizeOutput", () => {
  it("cleans every copy field, recounts characters, and leaves media alone", () => {
    const out = humanizeOutput({
      title: "Pay the farmer — taste it",
      angle: "Behind the scenes",
      variants: [
        {
          platform: "linkedin",
          title: "Sourcing — why",
          body: "We pay more — on purpose.",
          hashtags: ["#coffee"],
          chars: 999,
        },
      ],
      slides: [{ heading: "Myth — fact", body: "Brew 12–18 hours" }],
      article: {
        title: "Decaf — a guide",
        dek: "How it works — simply",
        metaDescription: "Swiss Water — explained",
        markdown: "## Why\n\nIt matters — a lot.",
        takeaways: ["Fresh — always"],
        wordCount: 5,
      },
      media: [
        { slot: "main", kind: "image", ratio: "1:1", status: "ready", url: "https://x/a—b.png" },
      ],
    });
    const { media, ...copy } = out;
    expect(JSON.stringify(copy)).not.toMatch(DASH);
    expect(out.variants?.[0].chars).toBe(out.variants?.[0].body.length);
    expect(out.slides?.[0].body).toBe("Brew 12-18 hours");
    expect(media?.[0].url).toBe("https://x/a—b.png");
  });
});
