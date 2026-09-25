import { describe, expect, it } from "vitest";
import {
  breadcrumbList,
  canonicalFor,
  extractFaqPairs,
  faqPage,
  imagesMissingAlt,
  mergeJsonLd,
  organizationGraph,
  robotsAdditions,
  withAlt,
} from "./cms-values";

describe("cms values", () => {
  it("builds a self-referencing canonical", () => {
    expect(canonicalFor("https://acme.com/blog/post/?utm_source=x#top")).toBe(
      "https://acme.com/blog/post/",
    );
  });

  it("links Organization and WebSite in one graph", () => {
    const g = organizationGraph({ origin: "https://acme.com/", name: "Acme" }) as {
      "@graph": Record<string, unknown>[];
    };
    expect(g["@graph"].map((x) => x["@type"])).toEqual(["Organization", "WebSite"]);
    expect(g["@graph"][1].publisher).toEqual({ "@id": "https://acme.com/#organization" });
    expect(g["@graph"][0]).not.toHaveProperty("logo");
  });

  it("names breadcrumbs from crawled titles, else the slug", () => {
    const b = breadcrumbList("https://acme.com/guides/seo-basics", {
      "https://acme.com/guides": "Guides | Acme",
    }) as { itemListElement: { name: string; item: string }[] };
    expect(b.itemListElement.map((i) => i.name)).toEqual(["Home", "Guides", "Seo Basics"]);
    expect(breadcrumbList("https://acme.com/")).toBeNull();
  });

  it("extracts only answered question headings", () => {
    const html = `<h2>What is GEO?</h2><p>GEO is the practice of making content easy for AI answer engines to cite.</p>
      <h2>Why now?</h2><p>Short.</p><h3>Pricing</h3><p>From ten dollars a month for small teams.</p>`;
    const pairs = extractFaqPairs(html);
    expect(pairs).toEqual([
      {
        question: "What is GEO?",
        answer: "GEO is the practice of making content easy for AI answer engines to cite.",
      },
    ]);
    expect((faqPage(pairs) as { mainEntity: unknown[] }).mainEntity).toHaveLength(1);
    expect(faqPage([])).toBeNull();
  });

  it("replaces JSON-LD of the same type and keeps the rest", () => {
    const merged = mergeJsonLd(
      [{ "@type": "FAQPage", v: 1 }, { "@type": "Article" }],
      [{ "@type": "FAQPage", v: 2 }],
    );
    expect(merged).toEqual([{ "@type": "Article" }, { "@type": "FAQPage", v: 2 }]);
  });

  it("adds robots lines once", () => {
    const once = robotsAdditions({ ruleId: "ai.bot.gptbot", existingAppend: "", sitemapUrl: null });
    expect(once).toBe("User-agent: GPTBot\nAllow: /");
    expect(
      robotsAdditions({ ruleId: "ai.bot.gptbot", existingAppend: once, sitemapUrl: null }),
    ).toBe(once);
    expect(
      robotsAdditions({
        ruleId: "tech.robots_sitemap",
        existingAppend: "",
        sitemapUrl: "https://acme.com/wp-sitemap.xml",
      }),
    ).toBe("Sitemap: https://acme.com/wp-sitemap.xml");
  });

  it("finds images without alt text and sets it safely", () => {
    const html = `<img src="/a.jpg" class="wp-image-12"><img src="/b.jpg" alt="Logo"><img alt="" src="/c.png">`;
    const missing = imagesMissingAlt(html);
    expect(missing.map((m) => [m.src, m.mediaId])).toEqual([
      ["/a.jpg", 12],
      ["/c.png", null],
    ]);
    expect(withAlt(missing[1].tag, 'Team "photo"')).toBe(
      '<img alt="Team &quot;photo&quot;" src="/c.png">',
    );
    expect(withAlt(missing[0].tag, "Chart")).toBe(
      '<img alt="Chart" src="/a.jpg" class="wp-image-12">',
    );
  });
});
