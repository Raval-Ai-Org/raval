// Tests for the score-version-2 rules: tiered crawlers, live access, snippet
// eligibility, canonical targets, schema quality, sitemap health, freshness,
// evidence — and that a well-built site can reach exactly 100.
import { describe, expect, it } from "vitest";
import { analyzePage } from "./analyze-page";
import { ruleOutcomes, scoreScan } from "./score";
import type { CrawledPage, SiteArtifacts } from "./types";

const NOW = Date.parse("2026-10-01T00:00:00Z");

function page(url: string, html: string, extra: Partial<CrawledPage> = {}): CrawledPage {
  return {
    url,
    finalUrl: url,
    depth: 0,
    state: "fetched",
    statusCode: 200,
    contentType: "text/html",
    fetchMs: 300,
    skipReason: null,
    xRobotsTag: null,
    analysis: analyzePage(html, url),
    ...extra,
  };
}

function site(over: Partial<SiteArtifacts> = {}): SiteArtifacts {
  return {
    origin: "https://acme.io",
    host: "acme.io",
    https: true,
    robots: {
      status: "found",
      text: "User-agent: *\nAllow: /\nSitemap: https://acme.io/sitemap.xml",
      sitemaps: ["https://acme.io/sitemap.xml"],
    },
    llms: { found: true, bytes: 120, full: false, issues: [], links: ["https://acme.io/"] },
    sitemap: {
      found: true,
      urls: 1,
      isIndex: false,
      sources: ["https://acme.io/sitemap.xml"],
      withLastmod: 1,
      paths: ["/"],
    },
    botAccess: {
      baselineStatus: 200,
      checks: [{ bot: "OAI-SearchBot", status: 200, blocked: false, reason: null }],
    },
    ...over,
  };
}

const outcome = (
  s: SiteArtifacts,
  pages: CrawledPage[],
  ruleId: string,
  mode: "quick" | "full" = "quick",
) => ruleOutcomes(s, pages, ruleId, { mode, now: NOW })![0].outcome;

const VOCAB =
  "studios designers freelancers agencies clients projects budgets deadlines reminders receipts ledgers reports taxes payroll banks cards transfers currencies contracts estimates quotes retainers milestones deposits refunds disputes approvals exports imports templates branding logos signatures schedules calendars dashboards alerts summaries forecasts audits records statements balances accounts teams partners owners managers bookkeepers accountants advisors suppliers vendors customers markets regions offices laptops phones tablets browsers".split(
    " ",
  );
/** `n` short sentences of varied words, so no term is over-repeated. */
const filler = (n: number, seed = 0) =>
  Array.from({ length: n }, (_, i) => {
    const w = (k: number) => VOCAB[(seed + i * 5 + k) % VOCAB.length];
    const n = seed + i;
    return [
      `Acme invoicing gives ${w(0)} one place for ${w(1)}, ${w(2)} and ${w(3)}`,
      `Many ${w(0)} track ${w(1)} beside ${w(2)}, then share ${w(3)} with ${w(4)}`,
      `Each month ${w(0)} review ${w(1)} so that ${w(2)} never miss ${w(3)}`,
      `Acme invoicing also links ${w(0)} to ${w(1)} when ${w(2)} need ${w(3)} quickly`,
      `Later ${w(0)} can compare ${w(1)} against ${w(2)} before ${w(3)} close`,
    ][n % 5];
  }).join(". ");
/** Paragraphs of ~60 words each. */
const paragraphs = (count: number, seed = 0) =>
  Array.from({ length: count }, (_, i) => `<p>${filler(5, seed + i * 25)}.</p>`).join("\n");

/** A homepage built to the letter of every check. */
const PERFECT_HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Acme invoicing software for small studios</title>
<meta name="description" content="Acme invoicing sends invoices, chases late payments and reconciles your books so small studios get paid on time.">
<link rel="canonical" href="https://acme.io/">
<meta property="og:title" content="Acme invoicing"><meta property="og:description" content="Invoicing for studios">
<meta property="og:image" content="https://acme.io/og.png"><meta property="og:site_name" content="Acme">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
 {"@type":"Organization","name":"Acme","url":"https://acme.io/","logo":"https://acme.io/logo.png","sameAs":["https://www.linkedin.com/company/acme"]},
 {"@type":"WebSite","name":"Acme","url":"https://acme.io/"},
 {"@type":"FAQPage","mainEntity":[
  {"@type":"Question","name":"How does Acme invoicing work?","acceptedAnswer":{"@type":"Answer","text":"Acme invoicing works by connecting to your bank."}},
  {"@type":"Question","name":"What does Acme invoicing cost?","acceptedAnswer":{"@type":"Answer","text":"Acme invoicing is free for one user."}}]}]}</script>
</head><body>
<header><nav><a href="/about">About Acme</a> <a href="/contact">Contact</a> <a href="/privacy">Privacy policy</a>
<a href="/terms">Terms of service</a> <a href="/pricing">Pricing</a> <a href="/blog">Blog</a></nav></header>
<main><article>
<h1>Acme invoicing software</h1>
<p>Acme invoicing is software that sends your invoices, follows up on late payments and keeps your books in order.</p>
${paragraphs(4)}
<h2>How does Acme invoicing work?</h2>
<p>Acme invoicing works by connecting to your bank and matching every payment to its invoice each day.</p>
${paragraphs(2, 7)}
<h2>What does Acme invoicing cost?</h2>
<p>Acme invoicing is free for one user and grows with your studio.</p>
${paragraphs(2, 13)}
<img src="/a.png" alt="Acme invoicing dashboard">
<p><a href="mailto:hello@acme.io">Email us</a></p>
</article></main>
<footer><p>© 2026 Acme Inc. All rights reserved.</p></footer>
</body></html>`;

describe("a well-built site", () => {
  const scored = scoreScan(site(), [page("https://acme.io/", PERFECT_HOME)], {
    mode: "quick",
    now: NOW,
  });

  it("reaches exactly 100 with nothing left to fix", () => {
    expect(
      scored.findings.map((f) => `${f.ruleId}: ${f.detail}`),
      "no findings expected",
    ).toEqual([]);
    expect(scored.report.overall).toBe(100);
    expect(scored.report.scoreVersion).toBe(2);
  });

  it("keeps 100 when the owner blocks training crawlers", () => {
    const robots =
      "User-agent: GPTBot\nDisallow: /\n\nUser-agent: CCBot\nDisallow: /\n\nUser-agent: Google-Extended\nDisallow: /\n\nUser-agent: *\nAllow: /\nSitemap: https://acme.io/sitemap.xml";
    const s = site({
      robots: { status: "found", text: robots, sitemaps: ["https://acme.io/sitemap.xml"] },
    });
    const r = scoreScan(s, [page("https://acme.io/", PERFECT_HOME)], { mode: "quick", now: NOW });
    expect(r.report.overall).toBe(100);
    expect(r.findings.filter((f) => f.ruleId.startsWith("ai.bot."))).toEqual([]);
    expect(r.report.engines.find((e) => e.id === "chatgpt")).toMatchObject({
      state: "open",
      trainingBlocked: ["GPTBot"],
    });
  });
});

describe("crawler access", () => {
  const home = [page("https://acme.io/", PERFECT_HOME)];

  it("fails a blocked search crawler and warns on a partial block", () => {
    const blocked = site({
      robots: { status: "found", text: "User-agent: OAI-SearchBot\nDisallow: /", sitemaps: [] },
    });
    expect(outcome(blocked, home, "ai.bot.oai-searchbot").status).toBe("fail");
    expect(outcome(blocked, home, "ai.bot.perplexitybot").status).toBe("pass");

    const partial = site({
      robots: {
        status: "found",
        text: "User-agent: PerplexityBot\nDisallow: /blog/",
        sitemaps: [],
      },
    });
    const pages = [
      ...home,
      page("https://acme.io/pricing", PERFECT_HOME),
      page("https://acme.io/blog/a", PERFECT_HOME),
    ];
    const o = outcome(partial, pages, "ai.bot.perplexitybot", "full");
    expect(o.status).toBe("warn");
    expect(o.evidence).toMatchObject({ blockedPaths: ["/blog/a"] });
  });

  it("warns, never fails, when a firewall turns a crawler away", () => {
    const s = site({
      botAccess: {
        baselineStatus: 200,
        checks: [
          { bot: "OAI-SearchBot", status: 403, blocked: true, reason: "HTTP 403" },
          { bot: "PerplexityBot", status: 200, blocked: false, reason: null },
        ],
      },
    });
    const o = outcome(s, home, "ai.live_access");
    expect(o.status).toBe("warn");
    expect(o.detail).toContain("OAI-SearchBot (HTTP 403)");
    expect(outcome(site({ botAccess: undefined }), home, "ai.live_access").status).toBe("na");
  });

  it("asks for a valid llms.txt, not just any file", () => {
    const s = site({
      llms: { found: true, bytes: 20, full: false, issues: ["It lists no pages"], links: [] },
    });
    expect(outcome(s, home, "ai.llms_txt").status).toBe("warn");
    expect(outcome(site(), home, "ai.llms_txt").status).toBe("pass");
  });
});

describe("snippets and canonicals", () => {
  const withHead = (head: string) => PERFECT_HOME.replace("</head>", `${head}</head>`);

  it("fails nosnippet and max-snippet:0, from meta or header", () => {
    const s = site();
    const meta = [page("https://acme.io/", withHead('<meta name="robots" content="nosnippet">'))];
    expect(outcome(s, meta, "tech.snippet").status).toBe("fail");
    const zero = [
      page("https://acme.io/", withHead('<meta name="robots" content="max-snippet:0">')),
    ];
    expect(outcome(s, zero, "tech.snippet").status).toBe("fail");
    const header = [page("https://acme.io/", PERFECT_HOME, { xRobotsTag: "nosnippet" })];
    expect(outcome(s, header, "tech.snippet").status).toBe("fail");
    const open = [
      page("https://acme.io/", withHead('<meta name="robots" content="max-snippet:-1">')),
    ];
    expect(outcome(s, open, "tech.snippet").status).toBe("pass");
  });

  it("warns when most of the text is inside data-nosnippet", () => {
    const html = PERFECT_HOME.replace("<article>", "<article data-nosnippet>");
    const o = outcome(site(), [page("https://acme.io/", html)], "tech.snippet");
    expect(o.status).toBe("warn");
  });

  it("fails a canonical that points off-site or at a broken page", () => {
    const off = PERFECT_HOME.replace('href="https://acme.io/"', 'href="https://other.io/"');
    expect(outcome(site(), [page("https://acme.io/", off)], "tech.canonical").status).toBe("fail");

    const toGone = PERFECT_HOME.replace('href="https://acme.io/"', 'href="https://acme.io/gone"');
    const pages = [
      page("https://acme.io/", toGone),
      { ...page("https://acme.io/gone", ""), statusCode: 404, analysis: null },
    ];
    expect(outcome(site(), pages, "tech.canonical", "full").status).toBe("fail");
  });
});

describe("schema quality", () => {
  const article = (ld: string, h1 = "Ten ways to get paid faster") =>
    `<html lang="en"><head><title>${h1}</title><script type="application/ld+json">${ld}</script></head>
     <body><main><h1>${h1}</h1><p>Body text.</p></main></body></html>`;

  it("flags missing required fields on a top-level node only", () => {
    const ld = `{"@context":"https://schema.org","@type":"Article","headline":"Ten ways to get paid faster","publisher":{"@type":"Organization","name":"Acme"}}`;
    const o = outcome(site(), [page("https://acme.io/blog/x", article(ld))], "schema.valid");
    expect(o.status).toBe("warn");
    expect(o.evidence).toEqual({ issues: ["Article: author", "Article: datePublished"] });

    const full = `{"@type":"Article","headline":"Ten ways to get paid faster","author":{"@type":"Person","name":"Jo"},"datePublished":"2026-05-01"}`;
    expect(
      outcome(site(), [page("https://acme.io/blog/x", article(full))], "schema.valid").status,
    ).toBe("pass");
  });

  it("flags markup that says what the page doesn't", () => {
    const ld = `{"@type":"Article","headline":"Something else entirely","author":"Jo","datePublished":"2026-05-01"}`;
    const o = outcome(site(), [page("https://acme.io/blog/x", article(ld))], "schema.matches_page");
    expect(o.status).toBe("warn");

    const faq = `{"@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Is this question on the page?","acceptedAnswer":{"@type":"Answer","text":"No."}}]}`;
    const hidden = outcome(
      site(),
      [page("https://acme.io/blog/x", article(faq))],
      "schema.matches_page",
    );
    expect(hidden.status).toBe("warn");
    expect(
      outcome(site(), [page("https://acme.io/", PERFECT_HOME)], "schema.matches_page").status,
    ).toBe("pass");
  });
});

describe("sitemap health and links", () => {
  const simple = (links: string) =>
    `<html lang="en"><head><title>Page</title></head><body><main><h1>Page</h1>${links}</main></body></html>`;

  it("wants lastmod dates", () => {
    const s = site({ sitemap: { ...site().sitemap, urls: 10, withLastmod: 2 } });
    expect(outcome(s, [], "tech.sitemap_lastmod").status).toBe("warn");
    expect(outcome(site(), [], "tech.sitemap_lastmod").status).toBe("pass");
  });

  it("catches broken sitemap entries and pages left out", () => {
    const pages = [
      page("https://acme.io/", simple('<a href="/a">a</a>')),
      { ...page("https://acme.io/gone", ""), statusCode: 404, analysis: null },
    ];
    const s = site({ sitemap: { ...site().sitemap, urls: 2, paths: ["/", "/gone"] } });
    const o = outcome(s, pages, "tech.sitemap_coverage", "full");
    expect(o.status).toBe("warn");
    expect(o.evidence).toMatchObject({ listedButBroken: ["https://acme.io/gone"] });
    expect(outcome(s, pages, "tech.sitemap_coverage", "quick").status).toBe("na");
  });

  it("finds pages nothing links to, only on a complete crawl", () => {
    const pages = [
      page("https://acme.io/", simple('<a href="/a">a</a>')),
      page("https://acme.io/a", simple('<a href="/">home</a>')),
      page("https://acme.io/b", simple('<a href="/">home</a>')),
    ];
    const outcomes = ruleOutcomes(site(), pages, "tech.orphan_pages", { mode: "full", now: NOW })!;
    expect(outcomes.map((o) => o.outcome.status)).toEqual(["na", "pass", "warn"]);

    const capped = [
      ...pages,
      {
        ...page("https://acme.io/c", ""),
        state: "skipped" as const,
        skipReason: "Page limit reached",
        analysis: null,
      },
    ];
    expect(
      ruleOutcomes(site(), capped, "tech.orphan_pages", { mode: "full", now: NOW })!.every(
        (o) => o.outcome.status === "na",
      ),
    ).toBe(true);
  });
});

describe("articles", () => {
  const post = (date: string, body: string) =>
    `<html lang="en"><head><title>Getting paid on time</title>
     <script type="application/ld+json">{"@type":"Article","headline":"Getting paid on time","author":"Jo","datePublished":"${date}"}</script>
     </head><body><main><h1>Getting paid on time</h1>${body}</main></body></html>`;
  const long = paragraphs(12);

  it("warns on an article not touched in 18 months", () => {
    const old = [page("https://acme.io/blog/x", post("2024-01-10", long))];
    expect(outcome(site(), old, "trust.freshness").status).toBe("warn");
    const fresh = [page("https://acme.io/blog/x", post("2026-06-10", long))];
    expect(outcome(site(), fresh, "trust.freshness").status).toBe("pass");
  });

  it("wants a figure, a quote or a source in a long article", () => {
    const bare = [page("https://acme.io/blog/x", post("2026-06-10", long))];
    expect(outcome(site(), bare, "content.evidence").status).toBe("warn");
    const quoted = [
      page(
        "https://acme.io/blog/x",
        post("2026-06-10", `${long}<blockquote>We were paid in two days.</blockquote>`),
      ),
    ];
    expect(outcome(site(), quoted, "content.evidence").status).toBe("pass");
  });

  it("doesn't treat a discount as an unsourced statistic", () => {
    const html = post("2026-06-10", "<p>Save 20% on annual plans this month only.</p>");
    expect(analyzePage(html, "https://acme.io/blog/x").claims.statistical).toBe(0);
  });
});

describe("page title", () => {
  it("doesn't count an icon's <svg><title> as a page title", () => {
    const html = `<html lang="en"><head><title>Pricing and plans for teams</title></head><body>
      <svg><title>Arrow</title></svg><svg><title>Logo</title></svg><main><h1>Pricing</h1></main></body></html>`;
    const a = analyzePage(html, "https://acme.io/pricing");
    expect(a.titleCount).toBe(1);
    expect(a.title).toBe("Pricing and plans for teams");
  });
});

describe("outline heuristics", () => {
  it("ignores headings in page chrome and parent headings with sub-sections", () => {
    const html = `<html lang="en"><head><title>Guide</title></head><body>
      <aside><h3>Menu</h3></aside>
      <main><h1>Guide</h1><p>Intro text for the guide goes here today.</p>
      <h2>Plans</h2><h3>Starter</h3><p>The starter plan covers one user and ten invoices.</p></main>
      </body></html>`;
    const a = analyzePage(html, "https://acme.io/guide");
    expect(a.structure.hierarchyValid).toBe(true);
    expect(a.structure.emptySections).toEqual([]);
  });
});
