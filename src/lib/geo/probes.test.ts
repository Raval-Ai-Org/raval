import { describe, expect, it } from "vitest";
import {
  buildProbeQueries,
  classifyIntent,
  detectMentions,
  extractCitations,
  summarizeProbes,
  type ProbeAnswer,
} from "./probes";

describe("probe queries", () => {
  it("builds a bounded, deduplicated set with intents", () => {
    const qs = buildProbeQueries({
      brandName: "Acme",
      topics: ["invoicing software", "late payments"],
      max: 5,
    });
    expect(qs).toHaveLength(5);
    expect(qs[0]).toEqual({ text: "What is Acme?", intent: "informational", source: "brand" });
    expect(qs[1].intent).toBe("comparison");
    expect(qs.find((q) => q.text.includes("best invoicing software"))?.intent).toBe("commercial");
    expect(buildProbeQueries({ brandName: null, topics: [] })).toEqual([]);
  });

  it("classifies intent", () => {
    expect(classifyIntent("How to fix late invoices")).toBe("problem_solving");
    expect(classifyIntent("Xero vs QuickBooks")).toBe("comparison");
  });
});

describe("answer detection", () => {
  it("finds brand and domain mentions, case-sensitively for generic brand words", () => {
    expect(
      detectMentions("We recommend acme and Acme.io for invoicing.", {
        brandName: "Acme",
        domain: "acme.io",
      }),
    ).toHaveLength(2);
    expect(
      detectMentions("Keep a linear process.", { brandName: "Linear", domain: "linear.app" }),
    ).toHaveLength(0);
    expect(
      detectMentions("Linear is a tracker.", { brandName: "Linear", domain: "linear.app" }),
    ).toHaveLength(1);
  });

  it("extracts, normalises and de-duplicates citations, flagging the target domain", () => {
    const text =
      "See [Acme](https://www.acme.io/pricing?utm_source=x) and https://rival.com/, also https://acme.io/pricing.";
    const cites = extractCitations(text, ["https://docs.acme.io/start", "not-a-url"], "acme.io");
    expect(cites.map((c) => c.url)).toEqual([
      "https://acme.io/pricing",
      "https://rival.com/",
      "https://docs.acme.io/start",
    ]);
    expect(cites.map((c) => c.isTarget)).toEqual([true, false, true]);
  });

  it("summarises rates over successful answers only", () => {
    const base = {
      query: { text: "q", intent: "informational" as const, source: "brand" as const },
      engine: "Perplexity",
      model: "m",
      mentions: [],
      excerpt: "",
    };
    const results: ProbeAnswer[] = [
      {
        ...base,
        status: "ok",
        mentioned: true,
        cited: true,
        citations: [{ url: "https://r.com", domain: "r.com", isTarget: false, position: 1 }],
      },
      { ...base, status: "ok", mentioned: false, cited: false, citations: [] },
      { ...base, status: "error", error: "x", mentioned: false, cited: false, citations: [] },
    ];
    const s = summarizeProbes(results, 2);
    expect(s).toMatchObject({ answers: 2, mentionRate: 0.5, citationRate: 0.5 });
    expect(s.competitorDomains).toEqual([{ domain: "r.com", count: 1 }]);
  });
});
