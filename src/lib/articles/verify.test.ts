import { describe, expect, it } from "vitest";
import { openingWords, verifyArticleHtml } from "./verify";
import type { PublishableArticle } from "./render";

const article: PublishableArticle = {
  title: "Why small teams’ CRMs fail",
  dek: "",
  metaDescription: "",
  takeaways: [],
  markdown:
    "# H1\n\n## Intro\n\nMost **small teams** abandon their CRM within [three months](https://x.y) because nobody owns it.\n\nMore.",
  faq: [{ question: "Who should own the CRM?", answer: "One person." }],
  slug: "why",
  category: null,
  tags: [],
};

const page = (body: string, head = "") =>
  `<html><head><title>Why small teams&rsquo; CRMs fail | Acme</title>${head}</head><body><article><h1>Why small teams&#8217; CRMs fail</h1>${body}</article></body></html>`;

describe("live article verification", () => {
  it("takes the opening words of the first paragraph", () => {
    expect(openingWords(article.markdown)).toBe(
      "most small teams abandon their crm within three months because",
    );
  });

  it("passes when the page shows the article", () => {
    const html = page(
      "<p>Most <strong>small teams</strong> abandon their CRM within <a href='#'>three months</a> because nobody owns it.</p><h3>Who should own the CRM?</h3>",
      `<script type="application/ld+json">{"@context":"https://schema.org","@type":"BlogPosting","headline":"x"}</script>`,
    );
    const r = verifyArticleHtml(html, "https://acme.com/why", article, {
      status: 200,
      expectStructuredData: true,
    });
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("fails on an empty template, noindex or a coming-soon page", () => {
    const empty = verifyArticleHtml(page("<p>Template</p>"), "https://acme.com/why", article, {
      status: 200,
      expectStructuredData: false,
    });
    expect(empty.ok).toBe(false);
    expect(empty.checks.find((c) => c.id === "body")?.ok).toBe(false);
    const hidden = verifyArticleHtml(
      page(
        "<p>Most small teams abandon their CRM within three months because nobody</p>",
        `<meta name="robots" content="noindex">`,
      ),
      "https://acme.com/why",
      article,
      { status: 200, expectStructuredData: false },
    );
    expect(hidden.checks.find((c) => c.id === "indexable")?.ok).toBe(false);
    const soon = verifyArticleHtml(
      `<html><body class="wpcom-coming-soon-body">x</body></html>`,
      "https://acme.com/why",
      article,
      {
        status: 200,
        expectStructuredData: false,
      },
    );
    expect(soon.placeholder).toBe(true);
    expect(soon.ok).toBe(false);
  });
});
