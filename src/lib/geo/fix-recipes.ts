// fix-recipes.ts — copy-paste fixes for AI Visibility findings, keyed by the
// rules' `fixId` and filled in with the scanned site's real origin and brand
// name, so a snippet can be pasted without hunting for "example.com".
//
// Recipes never invent facts about the business: where a fix needs real
// information (credentials, sources, legal pages) it gives steps, not copy.

export type FixRecipe = {
  title: string;
  /** Where the snippet goes, in one line. */
  placement: string;
  lang?: "txt" | "html" | "xml";
  code?: string;
  /** Guidance for fixes that are configuration or editorial rather than a snippet. */
  steps?: string[];
};

export type FixContext = {
  url: string;
  /** The page a page-level finding is about; defaults to `url`. */
  pageUrl?: string | null;
  brandName?: string | null;
  /** The site's current meta description, used as the llms.txt summary. */
  description?: string | null;
};

const AI_CRAWLERS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "Claude-Web",
  "PerplexityBot",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
];

function resolveOrigin(url: string): { origin: string; host: string } {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return { origin: u.origin, host: u.hostname.replace(/^www\./, "") };
  } catch {
    return { origin: "https://example.com", host: "example.com" };
  }
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function jsonLd(value: unknown): string {
  return `<script type="application/ld+json">\n${JSON.stringify(value, null, 2)}\n</script>`;
}

export function fixRecipeFor(fixId: string, ctx: FixContext): FixRecipe | null {
  const { origin, host } = resolveOrigin(ctx.url);
  const page = ctx.pageUrl && /^https?:\/\//i.test(ctx.pageUrl) ? ctx.pageUrl : `${origin}/`;
  const brand = ctx.brandName?.trim() || host;
  const summary =
    ctx.description?.trim() || `One sentence on what ${brand} does and who it is for.`;

  switch (fixId) {
    case "llms":
      return {
        title: "Publish /llms.txt",
        placement: `Serve as plain text at ${origin}/llms.txt`,
        lang: "txt",
        code: [
          `# ${brand}`,
          "",
          `> ${summary}`,
          "",
          "## Key pages",
          "",
          `- [Home](${origin}/): What ${brand} offers`,
          `- [About](${origin}/about): Who we are and why to trust us`,
          `- [Pricing](${origin}/pricing): Plans and what each includes`,
          "",
          "## Optional",
          "",
          `- [Sitemap](${origin}/sitemap.xml): Every public URL`,
        ].join("\n"),
      };
    case "bots":
    case "robots":
      return {
        title: fixId === "bots" ? "Allow AI crawlers in robots.txt" : "Publish robots.txt",
        placement: `Serve at ${origin}/robots.txt — replace any Disallow: / rules for these agents`,
        lang: "txt",
        code: [
          ...AI_CRAWLERS.flatMap((bot) => [`User-agent: ${bot}`, "Allow: /", ""]),
          "User-agent: *",
          "Allow: /",
          "",
          `Sitemap: ${origin}/sitemap.xml`,
        ].join("\n"),
      };
    case "robots-sitemap":
      return {
        title: "Declare your sitemap",
        placement: `Add at the end of ${origin}/robots.txt`,
        lang: "txt",
        code: `Sitemap: ${origin}/sitemap.xml`,
      };
    case "ld":
    case "org-schema":
      return {
        title: "Add Organization + WebSite JSON-LD",
        placement: "Inside <head> on every page (your root layout)",
        lang: "html",
        code: jsonLd({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "@id": `${origin}/#organization`,
              name: brand,
              url: `${origin}/`,
              logo: `${origin}/logo.png`,
              sameAs: ["https://www.linkedin.com/company/…", "https://x.com/…"],
            },
            {
              "@type": "WebSite",
              "@id": `${origin}/#website`,
              name: brand,
              url: `${origin}/`,
              publisher: { "@id": `${origin}/#organization` },
            },
          ],
        }),
      };
    case "org-sameas":
      return {
        title: "Link your Organization to its official profiles",
        placement: "In the Organization JSON-LD on every page",
        lang: "html",
        code: `"sameAs": [\n  "https://www.linkedin.com/company/…",\n  "https://x.com/…",\n  "https://www.wikidata.org/wiki/Q…"\n]`,
        steps: [
          "Only list profiles your organization actually owns — engines cross-check them.",
          "A Wikidata or Wikipedia entry, where one exists, is the strongest disambiguation signal.",
        ],
      };
    case "faq":
      return {
        title: "Add FAQPage JSON-LD",
        placement: "On the page that shows these questions and answers visibly",
        lang: "html",
        code: jsonLd({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: [
            {
              "@type": "Question",
              name: `What is ${brand}?`,
              acceptedAnswer: { "@type": "Answer", text: summary },
            },
            {
              "@type": "Question",
              name: `Who is ${brand} for?`,
              acceptedAnswer: { "@type": "Answer", text: "Answer in one or two sentences." },
            },
          ],
        }),
        steps: ["Mark up only questions and answers that are visible on the page, word for word."],
      };
    case "article-schema":
      return {
        title: "Mark up the article",
        placement: `Inside <head> on ${page}`,
        lang: "html",
        code: jsonLd({
          "@context": "https://schema.org",
          "@type": "Article",
          headline: "The article's H1",
          datePublished: "2026-01-31",
          dateModified: "2026-02-14",
          author: { "@type": "Person", name: "Author name", url: `${origin}/team/author-name` },
          publisher: { "@id": `${origin}/#organization` },
          mainEntityOfPage: page,
        }),
        steps: ["Use the real author and the real publish / update dates shown on the page."],
      };
    case "breadcrumbs":
      return {
        title: "Add BreadcrumbList JSON-LD",
        placement: `Inside <head> on ${page}`,
        lang: "html",
        code: jsonLd({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: `${origin}/` },
            { "@type": "ListItem", position: 2, name: "Section", item: `${origin}/section` },
            { "@type": "ListItem", position: 3, name: "This page", item: page },
          ],
        }),
      };
    case "sitemap":
      return {
        title: "Publish sitemap.xml",
        placement: `Serve at ${origin}/sitemap.xml — list every public page`,
        lang: "xml",
        code: [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          `  <url><loc>${origin}/</loc></url>`,
          `  <url><loc>${origin}/about</loc></url>`,
          `  <url><loc>${origin}/pricing</loc></url>`,
          `</urlset>`,
        ].join("\n"),
      };
    case "canonical":
      return {
        title: "Add a canonical link",
        placement: "Inside <head> — each page points at its own clean URL",
        lang: "html",
        code: `<link rel="canonical" href="${escHtml(page)}" />`,
      };
    case "meta-desc":
      return {
        title: "Write a quotable meta description",
        placement: "Inside <head> — 70 to 165 characters, one clear sentence, unique per page",
        lang: "html",
        code: `<meta name="description" content="${escHtml(`${brand} helps [who] [do what] — [the proof or differentiator].`)}" />`,
      };
    case "title":
      return {
        title: "Tighten the title tag",
        placement: "Inside <head> — 20 to 65 characters, unique per page",
        lang: "html",
        code: `<title>${escHtml(`What this page is about — ${brand}`)}</title>`,
      };
    case "og":
      return {
        title: "Complete Open Graph + Twitter tags",
        placement: "Inside <head>",
        lang: "html",
        code: [
          `<meta property="og:title" content="${escHtml(brand)}" />`,
          `<meta property="og:description" content="${escHtml(summary)}" />`,
          `<meta property="og:image" content="${origin}/og.jpg" />`,
          `<meta property="og:url" content="${escHtml(page)}" />`,
          `<meta property="og:site_name" content="${escHtml(brand)}" />`,
          `<meta name="twitter:card" content="summary_large_image" />`,
        ].join("\n"),
      };
    case "viewport":
      return {
        title: "Declare a mobile viewport",
        placement: "Inside <head>",
        lang: "html",
        code: `<meta name="viewport" content="width=device-width, initial-scale=1" />`,
      };
    case "charset":
      return {
        title: "Declare the character set",
        placement: "First element inside <head>",
        lang: "html",
        code: `<meta charset="utf-8" />`,
      };
    case "lang":
      return {
        title: "Declare the page language",
        placement: "On the <html> element",
        lang: "html",
        code: `<html lang="en">`,
      };
    case "alt":
      return {
        title: "Describe every image",
        placement: 'On each <img> — say what it shows; use alt="" only for decoration',
        lang: "html",
        code: `<img src="/hero.jpg" alt="${escHtml(`${brand} dashboard showing this week's results`)}" />`,
      };
    case "h1":
      return {
        title: "Use one descriptive H1",
        placement: "Top of <main> — demote other H1s to H2, and match the title's topic",
        lang: "html",
        code: `<h1>${escHtml(`${brand}: the one-line promise of this page`)}</h1>\n<h2>Section heading</h2>`,
      };
    case "heading-hierarchy":
      return {
        title: "Keep heading levels in order",
        placement: "In the page template",
        lang: "html",
        code: "<h1>Page topic</h1>\n  <h2>Section</h2>\n    <h3>Sub-section</h3>\n  <h2>Next section</h2>",
        steps: [
          "Never jump from H2 to H4 — style with CSS instead of picking a heading level for its size.",
        ],
      };
    case "answer-blocks":
      return {
        title: "Answer each question directly",
        placement: "Immediately below each question heading",
        lang: "html",
        code: `<h2>How does ${escHtml(brand)} work?</h2>\n<p>${escHtml(brand)} [does X] by [how] — so [who] can [result]. (40–60 words)</p>\n<ul>\n  <li>Supporting detail</li>\n</ul>`,
        steps: [
          "Open with a one-sentence answer that makes sense on its own — that's the part engines quote.",
          "Follow with detail, a list or an example.",
        ],
      };
    case "thin-content":
      return {
        title: "Expand thin pages",
        placement: "In the page body",
        steps: [
          "Explain what the page offers, who it is for, and how it works in at least 300–400 words.",
          "Add the questions customers actually ask, each with a direct answer.",
          "Merge or noindex pages that have nothing unique to say.",
        ],
      };
    case "semantic-html":
      return {
        title: "Use semantic landmarks",
        placement: "In your layout",
        lang: "html",
        code: "<header>…</header>\n<nav>…</nav>\n<main>\n  <article>…</article>\n</main>\n<footer>…</footer>",
      };
    case "internal-links":
      return {
        title: "Link related pages",
        placement: "In body copy and navigation",
        steps: [
          "Link each page to 3–5 closely related pages with descriptive anchor text.",
          "Link important deep pages from the homepage or a hub page so they're within three clicks.",
        ],
      };
    case "broken-links":
      return {
        title: "Fix broken internal links",
        placement: "In the pages listed in the evidence",
        steps: [
          "Update each link to the page's current URL.",
          "Where a page was removed on purpose, 301-redirect its old URL to the closest replacement.",
        ],
      };
    case "broken-pages":
      return {
        title: "Fix pages returning errors",
        placement: "At your host or CMS",
        steps: [
          "Restore pages that should exist, or 301-redirect removed URLs to their replacement.",
          "Remove error URLs from your sitemap and internal links.",
          "Investigate 5xx responses in your server logs — they often only affect crawlers.",
        ],
      };
    case "noindex":
      return {
        title: "Let engines index the page",
        placement: "Inside <head> — or delete the robots meta tag entirely",
        lang: "html",
        code: `<meta name="robots" content="index, follow" />`,
        steps: [
          "Check your CMS or framework for a “discourage search engines” or staging setting.",
          "Also remove any X-Robots-Tag: noindex response header.",
          "Leave noindex on pages that really should stay out of search (thank-you pages, internal search).",
        ],
      };
    case "https":
      return {
        title: "Serve the site over HTTPS",
        placement: "At your host or CDN",
        steps: [
          "Turn on a free TLS certificate (Let's Encrypt, or your host's one-click SSL).",
          `Redirect every http:// URL to ${origin.replace(/^http:/, "https:")} with a 301.`,
          "Update canonical tags and your sitemap to the https:// URLs.",
        ],
      };
    case "ssr":
      return {
        title: "Put real text in the initial HTML",
        placement: "In your page templates",
        steps: [
          "Render the headline, value proposition and key sections on the server (SSR or static generation).",
          "Avoid pages whose HTML is only an empty root <div> filled in by JavaScript.",
          "Verify with “View source” — the copy should be readable there.",
        ],
      };
    case "about":
      return {
        title: "Publish an About page",
        placement: `At ${origin}/about, linked from the header or footer`,
        steps: [
          `Say who is behind ${brand}, when it started, where it operates and what it stands for.`,
          "Name the leadership team with real roles and profile links.",
          "Link it from every page's footer.",
        ],
      };
    case "contact":
      return {
        title: "Make contact details easy to find",
        placement: `At ${origin}/contact, linked from the footer`,
        steps: [
          "Publish a contact page with an email on your own domain, and a phone number or address where relevant.",
          "Add a ContactPoint to your Organization schema with the same details.",
        ],
      };
    case "privacy":
      return {
        title: "Link your legal pages",
        placement: "In the footer of every page",
        steps: [
          "Publish a privacy policy and terms of service that reflect how you actually operate — have them reviewed.",
          "Link both from the footer so crawlers find them from any page.",
        ],
      };
    case "author-byline":
      return {
        title: "Attribute articles to real authors",
        placement: "Under each article headline and in its Article schema",
        lang: "html",
        code: `<p class="byline">By <a href="${origin}/team/author-name" rel="author">Author Name</a>, Role</p>`,
        steps: [
          "Use the person who actually wrote or reviewed the piece — never invent credentials.",
          "Give each author a profile page with their background and links to their public profiles.",
        ],
      };
    case "cite-sources":
      return {
        title: "Cite sources for claims",
        placement: "Next to each statistic or strong claim",
        steps: [
          "Link each statistic to the study, dataset or report it came from, using the source's name as the link text.",
          "Remove or soften figures you can't source.",
          "Never fabricate citations — engines and readers check them.",
        ],
      };
    default:
      return null;
  }
}
