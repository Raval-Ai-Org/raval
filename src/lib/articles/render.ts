// render.ts — a Studio article → the HTML, JSON-LD and checks a website gets.
//
//   html      key takeaways + the article body (markdown → sanitized HTML)
//             + a visible FAQ section. No scripts, no inline styles, no
//             iframes: sanitized with rehype-sanitize's GitHub schema.
//   jsonld    BlogPosting + FAQPage + BreadcrumbList, built from the article's
//             own fields and the site's real URLs — never written by a model.
//   geoGate   the AI Visibility page rules run on the rendered article before
//             it is published; failing checks block publishing.
//
// Pure (no network, no secrets); used by the server publisher and the preview.

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { analyzePage } from "@/lib/geo/analyze-page";

export type ArticleFaq = { question: string; answer: string };

export type PublishableArticle = {
  title: string;
  dek: string;
  metaDescription: string;
  takeaways: string[];
  markdown: string;
  faq: ArticleFaq[];
  slug: string;
  category: string | null;
  tags: string[];
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** URL-safe slug: lowercase ascii words joined by hyphens, ≤ 80 chars. */
export function slugify(text: string): string {
  return (
    text
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+[^-]*$/, (m) => (m.length > 1 && text.length > 80 ? "" : m))
      .replace(/^-+|-+$/g, "") || "article"
  );
}

const schema = {
  ...defaultSchema,
  // Keep heading ids off (the site's theme adds its own); allow nothing active.
  clobberPrefix: "",
};

export function markdownToHtml(markdown: string): string {
  const file = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSanitize, schema)
    .use(rehypeStringify)
    .processSync(markdown.replace(/^#\s+.+\n+/, ""));
  return String(file).trim();
}

/** The article body a CMS stores: takeaways, the body, then a visible FAQ. */
export function articleBodyHtml(a: PublishableArticle): string {
  const parts: string[] = [];
  if (a.takeaways.length) {
    parts.push(
      `<h2>Key takeaways</h2>\n<ul>\n${a.takeaways.map((t) => `<li>${escapeHtml(t)}</li>`).join("\n")}\n</ul>`,
    );
  }
  parts.push(markdownToHtml(a.markdown));
  if (a.faq.length) {
    parts.push(
      `<h2>Frequently asked questions</h2>\n${a.faq
        .map((f) => `<h3>${escapeHtml(f.question)}</h3>\n<p>${escapeHtml(f.answer)}</p>`)
        .join("\n")}`,
    );
  }
  return parts.join("\n\n");
}

export type ArticleJsonLdInput = {
  article: PublishableArticle;
  url: string;
  origin: string;
  blogUrl: string | null;
  brandName: string;
  authorName: string | null;
  datePublished: string;
  dateModified?: string;
  imageUrl?: string | null;
};

export function articleJsonLd(input: ArticleJsonLdInput): Record<string, unknown>[] {
  const origin = input.origin.replace(/\/+$/, "");
  const posting: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: input.article.title.slice(0, 110),
    description: input.article.metaDescription,
    url: input.url,
    mainEntityOfPage: { "@type": "WebPage", "@id": input.url },
    datePublished: input.datePublished,
    dateModified: input.dateModified ?? input.datePublished,
    author: input.authorName
      ? { "@type": "Person", name: input.authorName }
      : { "@type": "Organization", name: input.brandName, url: `${origin}/` },
    publisher: { "@type": "Organization", name: input.brandName, url: `${origin}/` },
  };
  if (input.imageUrl) posting.image = input.imageUrl;
  if (input.article.tags.length) posting.keywords = input.article.tags.join(", ");
  const out: Record<string, unknown>[] = [posting];
  if (input.article.faq.length)
    out.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: input.article.faq.map((f) => ({
        "@type": "Question",
        name: f.question,
        acceptedAnswer: { "@type": "Answer", text: f.answer },
      })),
    });
  const crumbs = [
    { name: "Home", item: `${origin}/` },
    ...(input.blogUrl ? [{ name: "Blog", item: input.blogUrl }] : []),
    { name: input.article.title, item: input.url },
  ];
  out.push({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, ...c })),
  });
  return out;
}

/** A complete HTML document of the article as a crawler would see it. */
export function articleDocument(
  a: PublishableArticle,
  url: string,
  jsonld: Record<string, unknown>[],
): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(a.title)}</title><meta name="description" content="${escapeHtml(a.metaDescription)}">
<link rel="canonical" href="${escapeHtml(url)}">
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`).join("\n")}
</head><body><main><article><h1>${escapeHtml(a.title)}</h1><p>${escapeHtml(a.dek)}</p>
${articleBodyHtml(a)}
</article></main></body></html>`;
}

export type GateCheck = { id: string; label: string; ok: boolean; detail: string };

/** AI Visibility checks on the rendered article; publishing needs every blocking one. */
export function geoGate(
  a: PublishableArticle,
  url: string,
  jsonld: Record<string, unknown>[],
): { ok: boolean; checks: GateCheck[] } {
  const page = analyzePage(articleDocument(a, url, jsonld), url);
  const checks: GateCheck[] = [
    {
      id: "title",
      label: "Clear title",
      ok: a.title.length >= 20 && a.title.length <= 110,
      detail: `${a.title.length} characters`,
    },
    {
      id: "meta_description",
      label: "Meta description",
      ok: a.metaDescription.length >= 70 && a.metaDescription.length <= 170,
      detail: `${a.metaDescription.length} characters (aim for 120–155)`,
    },
    {
      id: "one_h1",
      label: "One main heading",
      ok: page.h1Count === 1,
      detail: `${page.h1Count} H1 heading(s)`,
    },
    {
      id: "hierarchy",
      label: "Headings in order",
      ok: page.structure.hierarchyValid,
      detail: page.hierarchyIssues[0] ?? "No skipped heading levels",
    },
    {
      id: "substance",
      label: "Enough substance",
      ok: page.text.words >= 350,
      detail: `${page.text.words} words`,
    },
    {
      id: "direct_answer",
      label: "Answers questions directly",
      ok: page.questions.total === 0 || page.questions.direct > 0,
      detail: `${page.questions.direct} of ${page.questions.total} questions answered directly`,
    },
    {
      id: "faq",
      label: "FAQ with structured data",
      ok: a.faq.length >= 2 && page.schema.types.includes("FAQPage"),
      detail: `${a.faq.length} question(s)`,
    },
    {
      id: "article_schema",
      label: "Article structured data",
      ok: page.schema.types.includes("BlogPosting") && page.schema.parseErrors === 0,
      detail: page.schema.types.join(", ") || "none",
    },
  ];
  return { ok: checks.every((c) => c.ok), checks };
}
