import { describe, expect, it } from "vitest";
import { emptyDna } from "@/hooks/use-brand-dna";
import { mergeExtractionIntoDna } from "@/lib/brand-dna-merge";
import type { BrandExtractResult } from "@/lib/brand-extract-events";

const URL = "https://acme.com";

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

const result: BrandExtractResult = {
  brandName: "Acme",
  voice: "Confident, technical",
  industry: "B2B SaaS",
  colors: [{ name: "Primary", hex: "#112233" }],
  keywords: ["Automation", "automation", "Ops"],
  competitors: [{ name: "Globex", positioning: "Enterprise suite" }],
  customerSignals: { painPoints: "Manual reporting", jobsToBeDone: "Ship faster" },
  insights: [{ title: "Targets ops leads", body: "Not engineers" }],
  logoUrl: "https://acme.com/logo.svg",
  faviconUrl: "https://acme.com/favicon.ico",
  socials: [{ platform: "linkedin", url: "https://linkedin.com/company/acme" }],
  extras: {
    pagesCrawled: [URL, `${URL}/about`],
    externalMentions: [
      {
        bucket: "Reviews/Feedback",
        title: "G2",
        url: "https://g2.com/acme",
        snippet: "Great tool",
      },
      { bucket: "Competitors", title: "Alt", url: "https://x.test", snippet: "Other" },
    ],
  },
  missing: ["vision"],
};

describe("mergeExtractionIntoDna", () => {
  it("maps the extraction payload onto BrandDna shapes", () => {
    const { dna, stats } = mergeExtractionIntoDna(emptyDna, result, URL, ids());

    expect(dna.brandName).toBe("Acme");
    expect(dna.websiteUrl).toBe(URL);
    expect(dna.status).toBe("ok");
    expect(dna.competitors).toEqual([
      expect.objectContaining({ id: expect.any(String), name: "Globex" }),
    ]);
    expect(dna.customer.painPoints).toBe("Manual reporting");
    expect(dna.customer.jobsToBeDone).toBe("Ship faster");
    expect(dna.customer.feedbackSources.map((s) => s.text)).toEqual(["Great tool"]);
    expect(dna.userInsights.map((i) => i.title)).toEqual(["Targets ops leads"]);
    expect(dna.keywords).toEqual(["automation", "ops"]);
    expect(dna.assets.map((a) => a.kind)).toEqual(["logo", "image", "link"]);
    expect(dna.notes[0].body).toContain("Crawled 2 pages.");
    expect(dna.missing).toEqual(["vision"]);
    expect(stats).toEqual({ pages: 2, competitors: 1, newInsights: 1 });
  });

  it("never leaks raw payload keys into stored Brand DNA", () => {
    const { dna } = mergeExtractionIntoDna(emptyDna, result, URL, ids());
    expect(dna).not.toHaveProperty("customerSignals");
    expect(dna).not.toHaveProperty("insights");
    expect(dna).not.toHaveProperty("extras");
  });

  it("keeps existing text and de-duplicates evidence on re-scan", () => {
    const first = mergeExtractionIntoDna(emptyDna, result, URL, ids()).dna;
    const edited = { ...first, voice: "Warm and plain-spoken" };
    const { dna, stats } = mergeExtractionIntoDna(edited, result, URL, ids());

    expect(dna.voice).toBe("Warm and plain-spoken");
    expect(dna.competitors).toHaveLength(1);
    expect(dna.userInsights).toHaveLength(1);
    expect(dna.assets).toHaveLength(3);
    expect(dna.customer.feedbackSources).toHaveLength(1);
    expect(stats.newInsights).toBe(0);
  });
});
