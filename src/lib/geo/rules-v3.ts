// rules-v3.ts — the checks added with score version 3: HTTP behaviour,
// redirects, sitemap hygiene and hreflang (after SiteOne Crawler's analyzers),
// passage citability and hidden instructions to AI systems (after GEO
// Optimizer), and lab / real-user speed (after Unlighthouse, measured through
// PageSpeed Insights and the Chrome UX Report). All three projects are MIT.
//
// Same contract as rules.ts: pure, stable ids, N/A whenever the evidence
// wasn't collected (older scans, quick scans, speed checks switched off), so a
// missing measurement never costs points.

import { isCacheFriendly } from "./http";
import { worstRating, formatVital } from "./performance";
import type { GeoRule } from "./rules";
import type { CrawledPage, PageAnalysis, RuleOutcome } from "./types";

const pass = (detail: string, evidence?: Record<string, unknown>): RuleOutcome => ({
  status: "pass",
  detail,
  evidence,
});
const warn = (detail: string, evidence?: Record<string, unknown>): RuleOutcome => ({
  status: "warn",
  detail,
  evidence,
});
const fail = (detail: string, evidence?: Record<string, unknown>): RuleOutcome => ({
  status: "fail",
  detail,
  evidence,
});
const na = (detail: string): RuleOutcome => ({ status: "na", detail });

const isContentPage = (a: PageAnalysis) => a.pageType !== "legal" && a.pageType !== "contact";
const isNoindex = (page: CrawledPage, a: PageAnalysis | null) =>
  Boolean(a?.robotsMeta?.noindex) || /noindex|none/.test((page.xRobotsTag ?? "").toLowerCase());

/** path(+query) without a trailing slash — how sitemap entries and pages are matched. */
const pathKey = (url: string): string => {
  try {
    const u = new URL(url);
    return `${u.pathname.replace(/\/+$/, "") || "/"}${u.search}`;
  } catch {
    return url;
  }
};
const sameUrl = (a: string, b: string): boolean => {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return a === b;
  }
};
const redirected = (p: CrawledPage) => Boolean(p.finalUrl && !sameUrl(p.url, p.finalUrl));

/* ───────────────────────── Technical & indexability ───────────────────────── */

export const technicalV3: GeoRule[] = [
  {
    id: "tech.redirects",
    scope: "site",
    category: "technical",
    title: "Links go straight to the final URL",
    weight: 2,
    severity: "medium",
    recommendation: "Point links at final URLs and remove redirect chains",
    fixId: "redirects",
    safety: "assisted",
    effort: "low",
    confidence: 0.85,
    evidence: "documented",
    evaluate: ({ analyzed, pages, mode }): RuleOutcome => {
      const chains = analyzed
        .filter(({ a }) => (a.http?.redirects.length ?? 0) >= 2)
        .map(({ page, a }) => ({ url: page.url, hops: a.http!.redirects.map((h) => h.status) }));
      const crawled = new Set(pages.map((p) => p.url));
      const redirecting = new Map<string, string>();
      for (const p of pages) if (redirected(p)) redirecting.set(p.url, p.finalUrl!);
      const links: { from: string; to: string; final: string }[] = [];
      let internalTargets = 0;
      for (const { a } of analyzed) {
        for (const l of a.links.internal) {
          if (!crawled.has(l.href)) continue;
          internalTargets++;
          const final = redirecting.get(l.href);
          if (final) links.push({ from: a.url, to: l.href, final });
        }
      }
      if (mode === "quick" && !chains.length) return na("Needs a multi-page scan.");
      const evidence = { chains: chains.slice(0, 10), links: links.slice(0, 10) };
      if (!chains.length && !links.length) {
        return pass("Internal links point at final URLs, with no redirect chains.");
      }
      const parts = [
        links.length ? `${links.length} internal link(s) go through a redirect` : "",
        chains.length ? `${chains.length} page(s) sit behind a chain of 2+ redirects` : "",
      ].filter(Boolean);
      const detail = `${parts.join("; ")} — each hop costs crawlers a request and can lose the page.`;
      const share = internalTargets ? links.length / internalTargets : 0;
      return share > 0.2 || chains.length > 3 ? fail(detail, evidence) : warn(detail, evidence);
    },
  },
  {
    id: "tech.soft_404",
    scope: "site",
    category: "technical",
    title: "Missing pages return 404",
    weight: 3,
    severity: "high",
    recommendation: "Return a real 404 status for pages that don't exist",
    fixId: "soft-404",
    safety: "manual_review",
    effort: "low",
    confidence: 0.9,
    evidence: "documented",
    evaluate: ({ site }) => {
      const nf = site.http?.notFound;
      if (!nf) return na("Not checked on this scan.");
      const evidence = { url: nf.url, status: nf.status };
      if (nf.status === 404 || nf.status === 410)
        return pass(`A missing page returns ${nf.status}.`, evidence);
      if (nf.status !== null && nf.status >= 200 && nf.status < 300) {
        return nf.looksLikeHome
          ? fail(
              "A page that doesn't exist returns 200 with your homepage — engines can't tell missing pages from real ones.",
              evidence,
            )
          : fail(
              'A page that doesn\'t exist returns 200 — engines may index error pages as content (a "soft 404").',
              evidence,
            );
      }
      return warn(
        `A missing page returns HTTP ${nf.status ?? "no response"} instead of 404.`,
        evidence,
      );
    },
  },
  {
    id: "tech.https_redirect",
    scope: "site",
    category: "technical",
    title: "http:// redirects to https://",
    weight: 2,
    severity: "medium",
    recommendation: "Redirect every http:// request to https://",
    fixId: "https",
    safety: "manual_review",
    effort: "low",
    confidence: 0.9,
    evidence: "documented",
    evaluate: ({ site }) => {
      if (!site.https) return na("The site isn't served over https yet (see the HTTPS check).");
      const r = site.http?.httpsRedirect;
      if (!r) return na("Not checked on this scan.");
      if (r.redirected) return pass("http:// requests are sent to https://.");
      if (r.status === null) return pass("Plain http:// isn't served at all.");
      return fail(
        `http://${site.host}/ answers with HTTP ${r.status} instead of redirecting — two copies of the site compete.`,
        { status: r.status, finalUrl: r.finalUrl },
      );
    },
  },
  {
    id: "tech.compression",
    scope: "page",
    category: "technical",
    title: "HTML is sent compressed",
    weight: 1,
    severity: "low",
    recommendation: "Turn on gzip or Brotli compression",
    fixId: "compression",
    safety: "manual_review",
    effort: "low",
    confidence: 0.9,
    evidence: "documented",
    evaluate: ({ a }) => {
      if (!a.http) return na("Not checked on this scan.");
      if (a.bytes < 1500) return na("Too small to matter.");
      return a.http.contentEncoding
        ? pass(`Sent with ${a.http.contentEncoding} compression.`)
        : warn(
            `${Math.round(a.bytes / 1024)} KB of HTML sent uncompressed — crawlers download several times more than they need.`,
          );
    },
  },
  {
    id: "tech.http_caching",
    scope: "page",
    category: "technical",
    title: "Crawlers can re-check pages cheaply",
    weight: 1,
    severity: "low",
    recommendation: "Send ETag or Last-Modified headers",
    fixId: "caching",
    safety: "manual_review",
    effort: "low",
    confidence: 0.8,
    evidence: "documented",
    evaluate: ({ a }) => {
      if (!a.http) return na("Not checked on this scan.");
      const evidence = {
        etag: a.http.etag,
        lastModified: a.http.lastModified,
        cacheControl: a.http.cacheControl,
      };
      return isCacheFriendly(a.http)
        ? pass("The response carries a validator or a cache lifetime.", evidence)
        : warn(
            "No ETag, Last-Modified or cache lifetime — crawlers must download the whole page on every visit.",
            evidence,
          );
    },
  },
  {
    id: "tech.mixed_content",
    scope: "page",
    category: "technical",
    title: "No insecure http:// resources",
    weight: 2,
    severity: "medium",
    recommendation: "Load every resource over https://",
    fixId: "mixed-content",
    safety: "assisted",
    effort: "low",
    confidence: 0.9,
    evidence: "documented",
    evaluate: ({ a }) => {
      if (!/^https:/i.test(a.url)) return na("Not an https page.");
      if (!a.hygiene) return na("Not checked on this scan.");
      const n = a.hygiene.mixedContentCount;
      return n
        ? fail(`${n} resource(s) load over insecure http:// — browsers block or flag them.`, {
            resources: a.hygiene.mixedContent,
          })
        : pass("Every resource loads over https://.");
    },
  },
  {
    id: "tech.security_headers",
    scope: "site",
    category: "technical",
    title: "Security headers set",
    weight: 1,
    severity: "low",
    recommendation: "Add the standard security headers",
    fixId: "security-headers",
    safety: "manual_review",
    effort: "low",
    confidence: 0.85,
    evaluate: ({ site }) => {
      const h = site.http?.home;
      if (!h) return na("Not checked on this scan.");
      const missing = [
        site.https && !h.security.hsts ? "Strict-Transport-Security" : "",
        !h.security.contentTypeOptions ? "X-Content-Type-Options" : "",
        !h.security.frameProtection ? "X-Frame-Options or CSP frame-ancestors" : "",
        !h.security.referrerPolicy ? "Referrer-Policy" : "",
      ].filter(Boolean);
      if (!missing.length) return pass("The homepage sends the standard security headers.");
      return missing.length >= 3
        ? warn(`Missing ${missing.join(", ")}.`, { missing })
        : pass(`Mostly set; still missing ${missing.join(", ")}.`, { missing });
    },
  },
  {
    id: "tech.sitemap_quality",
    scope: "site",
    category: "technical",
    title: "Sitemap lists only real, indexable pages",
    weight: 2,
    severity: "medium",
    recommendation: "Remove redirects, errors and noindex pages from the sitemap",
    fixId: "sitemap-clean",
    safety: "assisted",
    effort: "low",
    confidence: 0.85,
    evidence: "documented",
    evaluate: ({ pages, sitemapPaths }) => {
      if (!sitemapPaths) return na("The sitemap wasn't read in full.");
      const listed = pages.filter(
        (p) => (p.state === "fetched" || p.state === "failed") && sitemapPaths.has(pathKey(p.url)),
      );
      if (!listed.length) return na("No sitemap page was crawled.");
      const bad: { url: string; problem: string }[] = [];
      for (const p of listed) {
        const a = p.analysis;
        const final = p.finalUrl ?? p.url;
        const canonical = a?.canonicals[0];
        const problem =
          p.state === "failed" || (p.statusCode ?? 0) >= 400
            ? `returns ${p.statusCode ?? "an error"}`
            : redirected(p) && pathKey(final) !== pathKey(p.url)
              ? "redirects"
              : isNoindex(p, a)
                ? "is noindex"
                : canonical && pathKey(canonical) !== pathKey(final)
                  ? "names another page as canonical"
                  : null;
        if (problem) bad.push({ url: p.url, problem });
      }
      if (!bad.length)
        return pass(`All ${listed.length} sitemap page(s) checked are live and indexable.`);
      const detail = `${bad.length} of ${listed.length} sitemap page(s) checked aren't indexable (e.g. ${bad[0].url} ${bad[0].problem}).`;
      const evidence = { pages: bad.slice(0, 15) };
      return bad.length / listed.length > 0.1 ? fail(detail, evidence) : warn(detail, evidence);
    },
  },
  {
    id: "tech.hreflang_targets",
    scope: "page",
    category: "technical",
    title: "hreflang alternates exist and link back",
    weight: 1,
    severity: "low",
    recommendation: "Make every hreflang alternate live and reciprocal",
    fixId: "hreflang",
    safety: "assisted",
    effort: "low",
    confidence: 0.85,
    evidence: "documented",
    evaluate: ({ a, site }) => {
      if (!a.hreflang.length) return na("No hreflang declared.");
      if (site.mode === "quick") return na("Needs a multi-page scan.");
      const self = pathKey(a.url);
      const broken: string[] = [];
      const oneWay: string[] = [];
      let checked = 0;
      for (const h of a.hreflang) {
        if (pathKey(h.href) === self) continue;
        const status = site.statusByUrl.get(h.href);
        if (status === undefined) continue;
        checked++;
        if ((status ?? 0) >= 400 || status === null) {
          broken.push(h.href);
          continue;
        }
        const target = site.analyzed.find(
          ({ page, a: t }) => sameUrl(t.url, h.href) || sameUrl(page.url, h.href),
        );
        if (target && !target.a.hreflang.some((b) => pathKey(b.href) === self)) oneWay.push(h.href);
      }
      if (!checked) return na("No alternate was crawled in this scan.");
      if (broken.length) {
        return fail(`${broken.length} hreflang alternate(s) return errors.`, {
          broken: broken.slice(0, 10),
        });
      }
      return oneWay.length
        ? warn(`${oneWay.length} alternate(s) don't link back — engines ignore one-way hreflang.`, {
            oneWay: oneWay.slice(0, 10),
          })
        : pass(`${checked} alternate(s) are live and link back.`);
    },
  },
];

/* ───────────────────────── Answer-ready content ───────────────────────── */

export const contentV3: GeoRule[] = [
  {
    id: "content.self_contained",
    scope: "page",
    category: "content",
    title: "Paragraphs make sense on their own",
    weight: 2,
    severity: "medium",
    recommendation: "Name the subject at the start of each paragraph",
    fixId: "self-contained",
    safety: "assisted",
    effort: "medium",
    confidence: 0.65,
    // Answer engines retrieve and quote passages, not pages.
    evidence: "emerging",
    evaluate: ({ a }) => {
      const c = a.citability;
      if (!c) return na("Not checked on this scan.");
      if (!isContentPage(a) || c.paragraphs < 4) return na("Too little running text to judge.");
      const share = c.vagueOpeners / c.paragraphs;
      return c.vagueOpeners >= 3 && share >= 0.25
        ? warn(
            `${c.vagueOpeners} of ${c.paragraphs} paragraphs open with "this", "it" or "as mentioned above" — quoted alone, they lose their subject.`,
            { samples: c.vagueSamples },
          )
        : pass("Paragraphs name their subject.");
    },
  },
  {
    id: "content.quotable_passages",
    scope: "page",
    category: "content",
    title: "Has quotable, fact-dense passages",
    weight: 2,
    severity: "medium",
    recommendation: "Write short paragraphs that state one concrete fact each",
    fixId: "quotable-passages",
    safety: "assisted",
    effort: "medium",
    confidence: 0.6,
    // Aggarwal et al. (KDD 2024): statistics and specifics raised citation the most.
    evidence: "measured",
    evaluate: ({ a }) => {
      const c = a.citability;
      if (!c) return na("Not checked on this scan.");
      if (!isContentPage(a) || a.text.words < 300) return na("Too little running text to judge.");
      return c.quotablePassages
        ? pass(`${c.quotablePassages} paragraph(s) of 40–150 words carry a concrete fact.`)
        : warn(
            "No paragraph is a self-contained 40–150 word passage with a figure or a name — the size engines lift into answers.",
          );
    },
  },
  {
    id: "content.readability",
    scope: "page",
    category: "content",
    title: "Easy to read",
    weight: 1,
    severity: "low",
    recommendation: "Shorten long sentences",
    fixId: "readability",
    safety: "assisted",
    effort: "medium",
    confidence: 0.6,
    // Aggarwal et al. (KDD 2024): fluency and easy-to-understand rewrites lifted visibility.
    evidence: "measured",
    evaluate: ({ a }) => {
      const r = a.citability?.readability;
      if (!r) return na("Not checked on this scan.");
      if (!r.english) return na("Readability is only scored for English.");
      if (!isContentPage(a) || r.fleschEase === null)
        return na("Too little running text to judge.");
      const evidence = {
        fleschEase: r.fleschEase,
        avgSentenceWords: r.avgSentenceWords,
        longSentences: r.longSentences,
      };
      if (r.fleschEase < 30 || r.avgSentenceWords > 28) {
        return warn(
          `Hard to read (reading ease ${r.fleschEase}/100, ${r.avgSentenceWords} words per sentence on average).`,
          evidence,
        );
      }
      return pass(`Reading ease ${r.fleschEase}/100.`, evidence);
    },
  },
  {
    id: "content.agent_usable",
    scope: "page",
    category: "content",
    title: "Buttons, links and fields are labelled",
    weight: 1,
    severity: "low",
    recommendation: "Give every button, link and form field a name",
    fixId: "accessible-controls",
    safety: "assisted",
    effort: "low",
    confidence: 0.8,
    // AI browsing agents read the accessibility tree to act on a page.
    evidence: "emerging",
    evaluate: ({ a }) => {
      const h = a.hygiene;
      if (!h) return na("Not checked on this scan.");
      const total = h.unlabeledControls + h.unnamedControls + h.iframesWithoutTitle;
      const evidence = {
        unlabeledFields: h.unlabeledControls,
        unnamedButtonsOrLinks: h.unnamedControls,
        iframesWithoutTitle: h.iframesWithoutTitle,
      };
      return total >= 3
        ? warn(
            `${total} control(s) have no name (${h.unlabeledControls} field(s), ${h.unnamedControls} button(s) or link(s), ${h.iframesWithoutTitle} frame(s)) — screen readers and AI agents can't tell what they do.`,
            evidence,
          )
        : pass("Controls are labelled.", evidence);
    },
  },
];

/* ───────────────────────── Authority & trust ───────────────────────── */

export const authorityV3: GeoRule[] = [
  {
    id: "trust.hidden_instructions",
    scope: "page",
    category: "authority",
    title: "No hidden instructions to AI systems",
    weight: 4,
    severity: "critical",
    recommendation: "Remove hidden text aimed at AI systems",
    fixId: "hidden-instructions",
    safety: "manual_review",
    effort: "low",
    confidence: 0.85,
    // Hidden text is a documented spam policy; engines discount pages that try to steer them.
    evidence: "documented",
    evaluate: ({ a }) => {
      const h = a.hygiene;
      if (!h) return na("Not checked on this scan.");
      const evidence = {
        hidden: h.hiddenInstructions,
        comments: h.commentInstructions,
        promptAttributes: h.promptAttributes,
        invisibleChars: h.invisibleChars,
      };
      const found = h.hiddenInstructions.length + h.commentInstructions.length + h.promptAttributes;
      if (found) {
        return fail(
          `${found} hidden instruction(s) addressed to AI systems${h.hiddenInstructions[0] ? ` (e.g. "${h.hiddenInstructions[0]}")` : ""} — engines treat this as manipulation.`,
          evidence,
        );
      }
      if (h.invisibleChars >= 20) {
        return warn(
          `${h.invisibleChars} invisible control characters in the visible text.`,
          evidence,
        );
      }
      return pass("No hidden text aimed at AI systems.");
    },
  },
  {
    id: "trust.headline_year",
    scope: "page",
    category: "authority",
    title: "Headline year is current",
    weight: 1,
    severity: "low",
    recommendation: "Update headlines that name a past year",
    fixId: "refresh-content",
    safety: "manual_review",
    effort: "medium",
    confidence: 0.75,
    evidence: "measured",
    evaluate: ({ a, site }) => {
      const year = a.citability?.headlineYear;
      if (year == null) return na("No year in the headline.");
      const current = new Date(site.now).getUTCFullYear();
      return year < current - 1
        ? warn(`The headline says ${year} — answers for "${current}" questions skip it.`, { year })
        : pass(`The headline's year (${year}) is current.`);
    },
  },
  {
    id: "trust.date_consistency",
    scope: "page",
    category: "authority",
    title: "Visible and structured dates agree",
    weight: 1,
    severity: "low",
    recommendation: "Make the visible date match the structured date",
    fixId: "dates-match",
    safety: "assisted",
    effort: "low",
    confidence: 0.75,
    evidence: "documented",
    evaluate: ({ a }) => {
      const visible = a.citability?.visibleUpdated;
      const structured = a.schema.dateModified ?? a.schema.datePublished;
      if (!visible || !structured) return na("Needs both a visible and a structured date.");
      const v = Date.parse(visible);
      const s = Date.parse(structured);
      if (Number.isNaN(v) || Number.isNaN(s)) return na("A date couldn't be read.");
      const days = Math.abs(v - s) / (24 * 3600 * 1000);
      return days > 3
        ? warn(`The page says "${visible}" but its structured data says ${structured}.`, {
            visible,
            structured,
          })
        : pass("Visible and structured dates agree.");
    },
  },
];

/* ───────────────────────── Rendering & performance ───────────────────────── */

export const performanceV3: GeoRule[] = [
  {
    id: "perf.core_web_vitals",
    scope: "site",
    category: "performance",
    title: "Real visitors get a fast page",
    weight: 4,
    severity: "high",
    recommendation: "Bring Core Web Vitals into the good range",
    fixId: "web-vitals",
    safety: "manual_review",
    effort: "high",
    confidence: 0.9,
    evidence: "documented",
    evaluate: ({ site }) => {
      const f = site.performance?.field?.origin;
      if (!f) return na(site.performance?.unavailable ?? "Real-user data wasn't measured.");
      const rating = worstRating([f.lcp?.rating, f.inp?.rating, f.cls?.rating]);
      if (!rating) return na("No Core Web Vitals in the real-user data.");
      const parts = [
        f.lcp ? `LCP ${formatVital("lcp", f.lcp.p75)}` : "",
        f.inp ? `INP ${formatVital("inp", f.inp.p75)}` : "",
        f.cls ? `CLS ${formatVital("cls", f.cls.p75)}` : "",
      ].filter(Boolean);
      const detail = `Real visitors on phones (75th percentile): ${parts.join(", ")}.`;
      const evidence = { lcp: f.lcp, inp: f.inp, cls: f.cls, periodEnd: f.periodEnd };
      return rating === "good"
        ? pass(detail, evidence)
        : rating === "needs_improvement"
          ? warn(detail, evidence)
          : fail(detail, evidence);
    },
  },
  {
    id: "perf.lab_score",
    scope: "page",
    category: "performance",
    title: "Lighthouse performance",
    weight: 2,
    severity: "medium",
    recommendation: "Fix the biggest Lighthouse opportunities",
    fixId: "lab-speed",
    safety: "manual_review",
    effort: "high",
    confidence: 0.75,
    evaluate: ({ a, site }) => {
      const run = site.site.performance?.lab.find((r) => r.ok && sameUrl(r.url, a.url));
      const score = run?.scores?.performance;
      if (!run || score == null) return na("Not one of the pages sampled for a speed test.");
      const evidence = {
        scores: run.scores,
        metrics: run.metrics,
        opportunities: run.opportunities,
        group: run.group,
      };
      const top = run.opportunities?.[0];
      const detail = `Lighthouse performance ${score}/100 on mobile${top ? ` — biggest saving: ${top.title} (~${(top.savingsMs / 1000).toFixed(1)} s)` : ""}.`;
      return score >= 90
        ? pass(detail, evidence)
        : score >= 50
          ? warn(detail, evidence)
          : fail(detail, evidence);
    },
  },
  {
    id: "perf.render_blocking",
    scope: "page",
    category: "performance",
    title: "Few render-blocking scripts",
    weight: 1,
    severity: "low",
    recommendation: "Defer scripts in the page head",
    fixId: "render-blocking",
    safety: "assisted",
    effort: "medium",
    confidence: 0.7,
    evaluate: ({ a }) => {
      const h = a.hygiene;
      if (!h) return na("Not checked on this scan.");
      return h.blockingScripts >= 3
        ? warn(
            `${h.blockingScripts} scripts in the head block the first paint (no async or defer).`,
          )
        : pass(`${h.blockingScripts} blocking script(s) in the head.`);
    },
  },
  {
    id: "perf.image_dimensions",
    scope: "page",
    category: "performance",
    title: "Images reserve their space",
    weight: 1,
    severity: "low",
    recommendation: "Give images width and height",
    fixId: "image-dimensions",
    safety: "assisted",
    effort: "low",
    confidence: 0.75,
    evidence: "documented",
    evaluate: ({ a }) => {
      const img = a.hygiene?.images;
      if (!img) return na("Not checked on this scan.");
      if (!img.total) return na("No images.");
      return img.withoutDimensions >= 3 && img.withoutDimensions / img.total > 0.5
        ? warn(
            `${img.withoutDimensions} of ${img.total} images have no width and height — the layout jumps as they load (CLS).`,
          )
        : pass("Images reserve their space.");
    },
  },
  {
    id: "perf.dom_size",
    scope: "page",
    category: "performance",
    title: "Reasonable page size (DOM)",
    weight: 1,
    severity: "low",
    recommendation: "Reduce the number of HTML elements",
    fixId: "dom-size",
    safety: "manual_review",
    effort: "high",
    confidence: 0.7,
    evaluate: ({ a }) => {
      const d = a.hygiene?.dom;
      if (!d) return na("Not checked on this scan.");
      const detail = `${d.elements.toLocaleString()} elements, nested ${d.maxDepth} deep.`;
      return d.elements > 3000 ? fail(detail) : d.elements > 1500 ? warn(detail) : pass(detail);
    },
  },
];
