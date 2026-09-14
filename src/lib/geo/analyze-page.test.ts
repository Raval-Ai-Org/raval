import { describe, expect, it } from "vitest";
import { analyzePage } from "./analyze-page";
import { decodeEntities, tokenizeHtml } from "./html-tokenizer";
import { evaluateAnswerDirectness, isQuestionText, titleH1Alignment } from "./analyze/content";
import { ACME_HOME } from "./test-fixtures";

describe("html tokenizer", () => {
  it("decodes entities and keeps script bodies raw", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &#169; &#x2014; &bogus;")).toBe(
      "a & b <c> © — &bogus;",
    );
    const tokens = [
      ...tokenizeHtml('<script>if (a < b) x = "</p>";</script><p title="x > y">Hi</p>'),
    ];
    expect(tokens[1]).toEqual({ type: "text", text: 'if (a < b) x = "</p>";' });
    expect(tokens.find((t) => t.type === "start" && t.name === "p")).toMatchObject({
      attrs: { title: "x > y" },
    });
  });

  it("never throws on malformed markup", () => {
    expect(() => [...tokenizeHtml("<div <p>unterminated <a href='x")]).not.toThrow();
    expect(() =>
      analyzePage("<html><body><h1>Hi<h2>there<!-- open comment", "https://x.io/"),
    ).not.toThrow();
  });
});

describe("analyzePage", () => {
  const a = analyzePage(ACME_HOME, "https://acme.io/");

  it("extracts metadata, canonicals and social tags", () => {
    expect(a.pageType).toBe("home");
    expect(a.title).toBe("Acme Invoicing — Get paid faster");
    expect(a.metaDescription?.length).toBeGreaterThan(70);
    expect(a.canonicals).toEqual(["https://acme.io/"]);
    expect(a.lang).toBe("en");
    expect(a.viewport && a.charset).toBe(true);
    expect(a.og["og:site_name"]).toBe("Acme");
    expect(a.twitter["twitter:card"]).toBe("summary");
    expect(a.robotsMeta).toBeNull();
  });

  it("summarises JSON-LD including @graph entities", () => {
    expect(a.schema.blocks).toBe(1);
    expect(a.schema.parseErrors).toBe(0);
    expect(a.schema.types).toEqual(expect.arrayContaining(["Organization", "WebSite"]));
    expect(a.schema.organizations[0]).toMatchObject({ name: "Acme", hasLogo: true });
    expect(a.schema.organizations[0].sameAs).toHaveLength(1);
    expect(a.schema.hasWebSite).toBe(true);
  });

  it("reads headings and outline problems, ignoring script content", () => {
    expect(a.h1Count).toBe(1);
    expect(a.headings.map((h) => h.text)).not.toContain("not a heading");
    expect(a.structure.hierarchyValid).toBe(false);
    expect(a.hierarchyIssues.join(" ")).toMatch(/H2 to H4/);
    expect(a.text.words).toBeGreaterThan(60);
    expect(a.landmarks).toEqual(expect.arrayContaining(["footer", "header", "main", "nav"]));
  });

  it("classifies links, images and contact details", () => {
    expect(a.links.internal.map((l) => l.href)).toEqual(
      expect.arrayContaining([
        "https://acme.io/about",
        "https://acme.io/contact",
        "https://acme.io/privacy",
      ]),
    );
    expect(a.links.external.map((l) => l.href)).toEqual(["https://www.census.gov/report"]);
    expect(a.links.mailto).toEqual(["mailto:hello@acme.io"]);
    expect(a.images).toEqual({ total: 2, missingAlt: 1, emptyAlt: 0 });
  });

  it("detects answered and unanswered questions", () => {
    const heading = a.questions.items.filter((q) => q.source === "heading");
    expect(heading.find((q) => q.text.startsWith("How does"))).toMatchObject({
      answered: true,
      direct: true,
    });
    expect(heading.find((q) => q.text.startsWith("What does it cost"))).toMatchObject({
      answered: false,
    });
    expect(a.questions.unansweredHeadings).toEqual(["What does it cost?"]);
    expect(a.questions.faqSchema).toBe(false);
  });

  it("finds first-party trust signals, sources and supported claims", () => {
    expect(a.trust.aboutLink).toBe("https://acme.io/about");
    expect(a.trust.privacyLink).toBe("https://acme.io/privacy");
    expect(a.trust.termsLink).toBe("https://acme.io/terms");
    expect(a.trust.emails).toContain("hello@acme.io");
    expect(a.trust.copyrightName).toBe("Acme Inc");
    expect(a.trust.siteName).toBe("Acme");
    expect(a.sources.citationCandidates).toBe(1);
    expect(a.sources.primary).toBe(1);
    expect(a.claims.statistical).toBe(1);
    expect(a.claims.statisticalUnsupported).toBe(0);
  });

  it("infers the topic and entities", () => {
    expect(a.topic.primary).toContain("invoicing");
    expect(a.topic.inTitle || a.topic.inH1).toBe(true);
    expect(a.entities.hasOrganization).toBe(true);
    expect(a.readiness.score).toBeGreaterThan(0);
    expect(["high", "moderate", "low"]).toContain(a.readiness.level);
  });

  it("flags noindex, missing metadata and unsourced statistics", () => {
    const bare = analyzePage(
      `<html><head><meta name="robots" content="noindex, nofollow"></head><body>
       <p>Our platform is the best in the world. It makes teams 40% faster than before.</p></body></html>`,
      "https://bare.io/features",
    );
    expect(bare.robotsMeta).toMatchObject({ noindex: true, nofollow: true });
    expect(bare.title).toBeNull();
    expect(bare.metaDescription).toBeNull();
    expect(bare.schema.blocks).toBe(0);
    expect(bare.claims.statisticalUnsupported).toBe(1);
    expect(bare.claims.superlativeUnsupported).toBe(1);
  });

  it("counts invalid JSON-LD as a parse error", () => {
    const broken = analyzePage(
      `<html><head><script type="application/ld+json">{"@type": "Organization",}</script></head></html>`,
      "https://x.io/",
    );
    expect(broken.schema).toMatchObject({ blocks: 1, parseErrors: 1 });
  });
});

describe("content heuristics", () => {
  it("recognises questions and direct answers", () => {
    expect(isQuestionText("How do I export invoices")).toBe(true);
    expect(isQuestionText("Pricing?")).toBe(false);
    expect(isQuestionText("Do you accept cookies on this site?")).toBe(false);
    expect(evaluateAnswerDirectness("Yes — exports are available on every plan.")).toBe(true);
    expect(evaluateAnswerDirectness("Great question, let's dive in together.")).toBe(false);
  });

  it("aligns titles and H1s by shared tokens", () => {
    expect(titleH1Alignment("Acme Invoicing — Get paid faster", "Acme invoicing")).toBe(true);
    expect(titleH1Alignment("Acme — Home", "Welcome to our blog about cats")).toBe(false);
    expect(titleH1Alignment(null, null)).toBeNull();
  });
});
