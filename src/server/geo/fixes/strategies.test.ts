import { describe, expect, it } from "vitest";
import { addedTextFragments, groundingCheck } from "./grounding";
import { isAgentFixable, rulesWithoutStrategy, strategyForRule } from "./strategies";
import { allowedImportsFor, playbookFor } from "../agents/framework-playbooks";

describe("fix strategies", () => {
  it("covers every rule in the catalog", () => {
    expect(rulesWithoutStrategy()).toEqual([]);
  });

  it("keeps legal, sourcing and business-fact rules manual with steps", () => {
    for (const id of [
      "trust.privacy",
      "trust.terms",
      "trust.claims_sourced",
      "tech.https",
      "content.substance",
    ]) {
      const s = strategyForRule(id);
      expect(s.mode, id).toBe("manual");
      expect(s.manualSteps.length, id).toBeGreaterThan(0);
      expect(s.validationSteps.length, id).toBeGreaterThan(0);
    }
  });

  it("routes discovery files through the deterministic fast path", () => {
    expect(strategyForRule("ai.llms_txt")).toMatchObject({
      mode: "deterministic",
      fastPath: "llms",
    });
    expect(strategyForRule("ai.bot.GPTBot")).toMatchObject({
      mode: "deterministic",
      fastPath: "robots",
    });
  });

  it("marks multi-page rules as needing a full rescan and facts as inputs", () => {
    expect(strategyForRule("tech.duplicate_title").verifyScope).toBe("full");
    expect(strategyForRule("trust.dates").inputs.map((i) => i.key)).toContain("date_published");
    expect(strategyForRule("content.faq_schema").grounding).toBe("page_text");
    expect(isAgentFixable("content.direct_answers")).toBe(true);
    expect(isAgentFixable("trust.terms")).toBe(false);
  });
});

describe("grounding", () => {
  const siteText = [
    "Three Reach Ai - Get Your Business Recommended by ChatGPT, Claude, Gemini, Grok, DeepSeek and Google Overviews",
    "We track how AI assistants describe your brand and show what to fix.",
    "Founded in 2024 in Lahore.",
  ];

  it("extracts readable text a patch adds, not code", () => {
    const frags = addedTextFragments(
      "index.html",
      "<head>\n</head>",
      '<head>\n<meta name="description" content="We track how AI assistants describe your brand.">\n<div class="flex items-center gap-2"></div>\n</head>',
    );
    expect(frags).toContain("We track how AI assistants describe your brand.");
    expect(frags.some((f) => f.includes("items-center"))).toBe(false);
  });

  it("accepts restructured existing copy", () => {
    const r = groundingCheck({
      files: [
        {
          path: "index.html",
          before: "<head><title>Three Reach Ai</title></head>",
          after:
            '<head><title>Three Reach Ai</title><meta name="description" content="Get your business recommended by ChatGPT, Claude, Gemini and Google Overviews."></head>',
        },
      ],
      siteText,
      inputs: [],
    });
    expect(r.ok, JSON.stringify(r.ungrounded)).toBe(true);
    expect(r.checked).toBeGreaterThan(0);
  });

  it("rejects invented numbers, dates, names and claims", () => {
    const r = groundingCheck({
      files: [
        {
          path: "src/pages/About.tsx",
          before: "export const About = () => <main></main>;",
          after:
            'export const About = () => <main><p>Trusted by 5,000 companies since 2019.</p><p>Our award-winning platform doubles revenue overnight.</p></main>;\nconst schema = { author: "John Smith Jr" };',
        },
      ],
      siteText,
      inputs: [],
    });
    expect(r.ok).toBe(false);
    const reasons = r.ungrounded.map((u) => u.text).join(" | ");
    expect(reasons).toMatch(/5,000/);
    expect(reasons).toMatch(/award-winning/);
    expect(reasons).toMatch(/John Smith/);
  });

  it("accepts facts the user supplied", () => {
    const files = [
      {
        path: "src/pages/Blog.tsx",
        before: "const x = 1;",
        after:
          'const x = 1;\nconst schema = { author: "Zain Iqbal", datePublished: "2026-03-14" };',
      },
    ];
    expect(groundingCheck({ files, siteText, inputs: [] }).ok).toBe(false);
    expect(groundingCheck({ files, siteText, inputs: ["Zain Iqbal", "2026-03-14"] }).ok).toBe(true);
  });
});

describe("framework playbooks", () => {
  it("picks conventions from the framework and layout", () => {
    expect(playbookFor("Next.js", ["app/layout.tsx"]).id).toBe("next-app");
    expect(playbookFor("Next.js", ["pages/_app.tsx"]).id).toBe("next-pages");
    expect(playbookFor("Vite", ["index.html"]).id).toBe("vite-spa");
    expect(playbookFor(null, []).id).toBe("generic");
  });

  it("only allows head-manager imports the repository already depends on", () => {
    const spa = playbookFor("Vite", []);
    expect([...allowedImportsFor(spa, ["react", "vite"])]).toEqual([]);
    expect([...allowedImportsFor(spa, ["react-helmet-async"])]).toEqual(["react-helmet-async"]);
    expect(allowedImportsFor(playbookFor("Nuxt", []), []).has("#app")).toBe(true);
    expect(
      allowedImportsFor(playbookFor("Next.js", ["app/layout.tsx"]), ["next"]).has("next/script"),
    ).toBe(true);
  });
});
