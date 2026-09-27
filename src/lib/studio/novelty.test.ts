import { describe, expect, it } from "vitest";
import { findSimilarRecent, hasResearchCitation } from "./novelty";
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
});
