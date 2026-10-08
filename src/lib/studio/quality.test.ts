import { describe, expect, it } from "vitest";
import { studioOutputQualityIssue } from "./quality";
import type { StudioControls } from "./jobs";

const controls: StudioControls = { platforms: ["instagram"] };

describe("Studio output quality gate", () => {
  it("requires the requested platforms, not just the requested number of variants", () => {
    const issue = studioOutputQualityIssue(
      "social",
      {
        variants: [
          {
            platform: "instagram",
            title: "A",
            body: "Useful Instagram copy for readers.",
            hashtags: [],
            chars: 34,
          },
          {
            platform: "twitter",
            title: "B",
            body: "Useful Twitter copy for readers.",
            hashtags: [],
            chars: 32,
          },
        ],
      },
      { platforms: ["instagram", "linkedin"] },
      2,
    );
    expect(issue).toContain("missing");
  });

  it("rejects an incomplete carousel before it is saved", () => {
    const issue = studioOutputQualityIssue(
      "carousel",
      {
        variants: [
          {
            platform: "instagram",
            title: "Guide",
            body: "Five concrete ways to improve the weekly plan.",
            hashtags: [],
            chars: 46,
          },
        ],
        slides: [
          { heading: "Plan better", body: "" },
          { heading: "Ask customers", body: "Write down the questions they ask before buying." },
          { heading: "Try it", body: "" },
        ],
      },
      { ...controls, slideCount: 5 },
      1,
    );
    expect(issue).toContain("wrong number");
  });

  it("rejects a thin article and accepts one with the requested substance", () => {
    const article = {
      title: "Guide",
      dek: "",
      metaDescription: "",
      takeaways: [],
      markdown: "## First answer\nUseful detail.",
      wordCount: 100,
    };
    expect(studioOutputQualityIssue("article", { article }, controls, 0)).toContain("shorter");
    expect(
      studioOutputQualityIssue("article", { article: { ...article, wordCount: 700 } }, controls, 0),
    ).toBeNull();
  });
});
