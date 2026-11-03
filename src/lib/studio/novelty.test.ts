import { describe, expect, it } from "vitest";
import { findSimilarRecent, hasResearchCitation, withResearchSources } from "./novelty";
import type { StudioContext } from "./prompts";

const recent: StudioContext["recent"] = [
  {
    title: "A practical guide to choosing a CRM",
    type: "article",
    channel: "blog",
    angle: "how-to",
    createdAt: "2026-09-20",
    excerpt:
      "Start by listing the customer details your team needs each day. Compare tools using the same workflow, then test data import and reporting with real examples from your sales process.",
  },
];

describe("Studio novelty gate", () => {
  it("finds a repeated article passage", () => {
    const match = findSimilarRecent(
      "article",
      {
        title: "A practical guide to choosing a CRM",
        article: {
          title: "A practical guide to choosing a CRM",
          dek: "",
          metaDescription: "",
          takeaways: [],
          wordCount: 33,
          markdown:
            "Start by listing the customer details your team needs each day. Compare tools using the same workflow, then test data import and reporting with real examples from your sales process.",
        },
      },
      recent,
    );
    expect(match?.title).toBe(recent[0].title);
  });

  it("allows a different answer to the same topic", () => {
    const match = findSimilarRecent(
      "article",
      {
        title: "A practical guide to choosing a CRM",
        article: {
          title: "A practical guide to choosing a CRM",
          dek: "",
          metaDescription: "",
          takeaways: [],
          wordCount: 30,
          markdown:
            "Interview your support team about missed follow-ups. Ask three vendors to demonstrate routing a new enquiry, then measure setup time and the effort required to train staff.",
        },
      },
      recent,
    );
    expect(match).toBeNull();
  });

  it("requires a supplied research URL in researched articles", () => {
    const sources = ["https://example.org/research/report"];
    expect(
      hasResearchCitation(
        "The [report](https://example.org/research/report) found a change.",
        sources,
      ),
    ).toBe(true);
    expect(hasResearchCitation("A report found a change.", sources)).toBe(false);
    expect(hasResearchCitation("See https://unrelated.example/report", sources)).toBe(false);
  });

  it("accepts a cited link that ends a sentence or drops www", () => {
    const sources = ["https://www.example.org/research/report/"];
    expect(hasResearchCitation("See https://example.org/research/report.", sources)).toBe(true);
    expect(hasResearchCitation("(http://www.example.org/research/report)", sources)).toBe(true);
  });

  it("lists only the supplied sources under an article that forgot them", () => {
    const out = withResearchSources("# Title\n\nBody.", [
      { title: "The [2026] report", url: "https://example.org/r" },
      { title: "Plain", url: "http://insecure.example/x" },
    ]);
    expect(out).toBe(
      "# Title\n\nBody.\n\n## Sources\n\n- [The 2026 report](https://example.org/r)\n",
    );
    expect(hasResearchCitation(out, ["https://example.org/r"])).toBe(true);
    expect(withResearchSources("Body", [])).toBe("Body");
  });
});
