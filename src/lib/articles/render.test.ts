import { describe, expect, it } from "vitest";
import {
  articleBodyHtml,
  articleJsonLd,
  geoGate,
  markdownToHtml,
  slugify,
  type PublishableArticle,
} from "./render";

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i % 40}`).join(" ");

const article: PublishableArticle = {
  title: "How to choose a CRM for a small team",
  dek: "A practical guide to picking a CRM that your team will actually use.",
  metaDescription:
    "How to choose a CRM for a small team: the features that matter, what to skip, and how to test two tools in a week before you commit.",
  takeaways: ["Start from your sales process.", "Test two tools with real deals."],
  markdown: `Picking a CRM is mostly about habits.\n\n## What is a CRM for a small team?\n\nA CRM for a small team is a shared place to track every lead, deal and follow-up so nothing slips. ${words(120)}\n\n## Which features matter?\n\n- Pipeline view\n- Email sync\n\n${words(150)}\n\n## Next step\n\nPick two tools and test them this week. ${words(60)}`,
  faq: [
    {
      question: "How much should a small team pay for a CRM?",
      answer: "Most small teams pay per seat each month; start with a free tier.",
    },
    {
      question: "How long does setup take?",
      answer: "A basic pipeline can be ready in an afternoon if you import contacts first.",
    },
  ],
  slug: "choose-a-crm-small-team",
  category: "Sales",
  tags: ["crm", "small business"],
};

describe("article rendering", () => {
  it("slugifies titles", () => {
    expect(slugify("How to Choose a CRM — for Small Teams!")).toBe(
      "how-to-choose-a-crm-for-small-teams",
    );
    expect(slugify("Crème brûlée & you")).toBe("creme-brulee-and-you");
    expect(slugify("!!!")).toBe("article");
  });

  it("sanitizes markdown: no scripts, handlers or raw html", () => {
    const html = markdownToHtml(
      "Hi <script>alert(1)</script> [x](javascript:alert(1)) <img src=x onerror=alert(1)>\n\n## Head",
    );
    expect(html).not.toMatch(/<script|onerror|javascript:/i);
    expect(html).toContain("<h2>Head</h2>");
  });

  it("puts takeaways first and a visible FAQ last", () => {
    const html = articleBodyHtml(article);
    expect(html.indexOf("Key takeaways")).toBeLessThan(html.indexOf("What is a CRM"));
    expect(html).toMatch(
      /<h2>Frequently asked questions<\/h2>[\s\S]*<h3>How long does setup take\?<\/h3>/,
    );
  });

  it("builds BlogPosting, FAQPage and BreadcrumbList from real fields", () => {
    const ld = articleJsonLd({
      article,
      url: "https://acme.com/blog/choose-a-crm-small-team",
      origin: "https://acme.com",
      blogUrl: "https://acme.com/blog",
      brandName: "Acme",
      authorName: null,
      datePublished: "2026-09-24T10:00:00Z",
    });
    expect(ld.map((x) => x["@type"])).toEqual(["BlogPosting", "FAQPage", "BreadcrumbList"]);
    expect(ld[0].author).toEqual({
      "@type": "Organization",
      name: "Acme",
      url: "https://acme.com/",
    });
  });

  it("passes the GEO gate for a well-formed article and fails a thin one", () => {
    const url = "https://acme.com/blog/choose-a-crm-small-team";
    const ld = articleJsonLd({
      article,
      url,
      origin: "https://acme.com",
      blogUrl: null,
      brandName: "Acme",
      authorName: "Sam Lee",
      datePublished: "2026-09-24T10:00:00Z",
    });
    const gate = geoGate(article, url, ld);
    expect(gate.checks.filter((c) => !c.ok)).toEqual([]);
    const thin = geoGate({ ...article, markdown: "Too short.", faq: [] }, url, ld.slice(0, 1));
    expect(thin.ok).toBe(false);
    expect(thin.checks.find((c) => c.id === "substance")?.ok).toBe(false);
  });
});
