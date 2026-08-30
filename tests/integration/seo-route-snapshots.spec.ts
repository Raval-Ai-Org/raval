/**
 * Snapshot tests that pin the entire rendered head / robots / sitemap output
 * for key routes against approved pitch-deck messaging.
 *
 * Instead of a raw HTML string diff (which is noisy and flakes on hydration
 * markers), we build a normalized, deterministic snapshot object per route
 * that includes:
 *   - the resolved title / description / OG / Twitter tags
 *   - canonical + hreflang link tags
 *   - meta robots directive
 *   - the H1 text and any pitch-deck phrases actually rendered on the page
 *
 * The snapshot files live next to this spec under
 *   tests/integration/__snapshots__/seo-route-snapshots.spec.ts-snapshots/
 * and are the "approved pitch-deck text" contract. Update with:
 *   bunx playwright test tests/integration/seo-route-snapshots.spec.ts \
 *     --project=integration --update-snapshots
 *
 * Run: bunx playwright test tests/integration/seo-route-snapshots.spec.ts --project=integration
 */
import { test, expect, type Page } from "@playwright/test";

const CANONICAL_HOST = "https://raval6.lovable.app";

// Phrases from the approved Raval AI pitch deck. Every public route snapshot
// must contain at least one; app/private route snapshots are exempt because
// they are noindex shells.
const APPROVED_PHRASES = [
  "Marketing Intelligence Layer",
  "Get visible inside LLMs",
  "Brand DNA",
  "AEO",
  "GEO",
  "Ravi",
  "Raval AI",
];

// Legacy phrasing that must never appear anywhere.
const FORBIDDEN_PHRASES = [
  /AI marketing OS/i,
  /marketing operator/i,
  /threereachaisaas/i,
  /raval3\.lovable\.app/i,
  /Lovable App/i,
  /Lovable Generated Project/i,
];

type JsonLdNode = {
  type: string;
  id: string | null;
  url: string | null;
  name: string | null;
  hasDescription: boolean;
  publisherRef: string | null;
  logoUrl: string | null;
  offersCount: number | null;
  offerPrices: string[] | null;
  faqQuestionCount: number | null;
  breadcrumbDepth: number | null;
  inLanguage: string | null;
};

type RouteSnapshot = {
  path: string;
  title: string;
  description: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogType: string | null;
  ogSiteName: string | null;
  ogUrl: string | null;
  twitterCard: string | null;
  twitterTitle: string | null;
  twitterDescription: string | null;
  canonical: string | null;
  hreflang: Array<{ hreflang: string; href: string }>;
  robots: string | null;
  h1: string | null;
  jsonLdTypes: string[];
  jsonLdNodes: JsonLdNode[];
  approvedPhrasesPresent: string[];
};

// Required fields per JSON-LD @type. Every route that ships a node of
// this type must expose all listed fields — missing any is a hard
// failure so structured-data regressions can't sneak through.
const JSONLD_REQUIRED_FIELDS: Record<string, Array<keyof JsonLdNode>> = {
  Organization: ["name", "url", "logoUrl"],
  WebSite: ["name", "url"],
  WebPage: ["name", "url"],
  SoftwareApplication: ["name", "offersCount"],
  FAQPage: ["faqQuestionCount"],
  BreadcrumbList: ["breadcrumbDepth"],
};

/**
 * Normalize a string so snapshots stay stable across environments.
 * Strips values that legitimately vary run-to-run:
 *   - ISO timestamps / dates / times
 *   - UUIDs and long hex/base64 IDs (build hashes, request IDs, nonces)
 *   - Long digit runs (epoch millis, counters)
 *   - Cache-busting query params (?v=..., ?t=..., &_=...)
 *   - Non-canonical hosts (localhost, lovable preview subdomains) → CANONICAL_HOST
 *   - Whitespace runs → single space, trimmed
 * Keeps every messaging-relevant token intact.
 */
function normalize(input: string | null | undefined): string | null {
  if (input == null) return input ?? null;
  let out = String(input);
  // Absolute non-canonical hosts → canonical host, so preview URLs don't leak
  // into snapshots but the *path* is still asserted.
  out = out.replace(
    /https?:\/\/(?:localhost(?::\d+)?|127\.0\.0\.1(?::\d+)?|[\w.-]*lovable(?:project)?\.app)/gi,
    CANONICAL_HOST,
  );
  // ISO 8601 timestamps (with or without fractional seconds / TZ).
  out = out.replace(
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g,
    "<TIMESTAMP>",
  );
  // Plain dates.
  out = out.replace(/\b\d{4}-\d{2}-\d{2}\b/g, "<DATE>");
  // UUIDs.
  out = out.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<UUID>");
  // Long hex/base64 IDs (build hashes, cache keys, tokens) — 24+ chars.
  out = out.replace(/\b[0-9a-f]{24,}\b/gi, "<HASH>");
  out = out.replace(/\b[A-Za-z0-9_-]{32,}\b/g, (m) =>
    /[A-Z]/.test(m) && /[a-z]/.test(m) && /\d/.test(m) ? "<TOKEN>" : m,
  );
  // Cache-busting query params (?v=123, ?t=..., &_=..., ?ver=...).
  out = out.replace(/([?&])(v|t|ts|ver|_)=[^&#]+/gi, "$1$2=<CB>");
  // Long digit runs (epoch ms, counters).
  out = out.replace(/\b\d{10,}\b/g, "<NUM>");
  // Collapse whitespace.
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

function normalizeBody(body: string): string {
  return (normalize(body) ?? "").trim();
}

async function collectSnapshot(page: Page, path: string): Promise<RouteSnapshot> {
  const raw = await page.evaluate(() => {
    const pick = (sel: string, attr = "content") =>
      document.querySelector(sel)?.getAttribute(attr) ?? null;
    const hreflang = Array.from(document.querySelectorAll('link[rel="alternate"][hreflang]')).map(
      (el) => ({
        hreflang: el.getAttribute("hreflang") ?? "",
        href: el.getAttribute("href") ?? "",
      }),
    );
    const jsonLdTypes: string[] = [];
    const jsonLdNodes: Array<Record<string, unknown>> = [];
    for (const node of Array.from(
      document.querySelectorAll('script[type="application/ld+json"]'),
    )) {
      try {
        const parsed = JSON.parse(node.textContent ?? "null");
        const asStr = (v: unknown): string | null => (typeof v === "string" ? v : null);
        const summarize = (obj: Record<string, unknown>, typeName: string) => {
          const offers = obj.offers as unknown;
          const offerList = Array.isArray(offers) ? offers : offers ? [offers] : [];
          const offerPrices = offerList
            .map((o) => {
              if (!o || typeof o !== "object") return null;
              const price = (o as Record<string, unknown>).price;
              const currency = (o as Record<string, unknown>).priceCurrency;
              if (price == null) return null;
              return `${currency ?? ""}${price}`.trim();
            })
            .filter((v): v is string => !!v)
            .sort();
          const mainEntity = obj.mainEntity as unknown;
          const mainEntityArr = Array.isArray(mainEntity)
            ? mainEntity
            : mainEntity
              ? [mainEntity]
              : [];
          const itemListElement = obj.itemListElement as unknown;
          const breadcrumb = Array.isArray(itemListElement) ? itemListElement : [];
          const logo = obj.logo as unknown;
          const logoUrl =
            typeof logo === "string"
              ? logo
              : logo && typeof logo === "object"
                ? asStr((logo as Record<string, unknown>).url)
                : null;
          const publisher = obj.publisher as unknown;
          const publisherRef =
            publisher && typeof publisher === "object"
              ? (asStr((publisher as Record<string, unknown>)["@id"]) ??
                asStr((publisher as Record<string, unknown>).name))
              : null;
          jsonLdNodes.push({
            type: typeName,
            id: asStr(obj["@id"]),
            url: asStr(obj.url),
            name: asStr(obj.name),
            hasDescription: typeof obj.description === "string" && obj.description.length > 0,
            publisherRef,
            logoUrl,
            offersCount: offerList.length ? offerList.length : null,
            offerPrices: offerPrices.length ? offerPrices : null,
            faqQuestionCount: typeName === "FAQPage" ? mainEntityArr.length : null,
            breadcrumbDepth: typeName === "BreadcrumbList" ? breadcrumb.length : null,
            inLanguage: asStr(obj.inLanguage),
          });
        };
        const walk = (v: unknown) => {
          if (!v) return;
          if (Array.isArray(v)) {
            v.forEach(walk);
            return;
          }
          if (typeof v === "object") {
            const obj = v as Record<string, unknown>;
            const t = obj["@type"];
            const typeNames: string[] = [];
            if (typeof t === "string") typeNames.push(t);
            else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && typeNames.push(x));
            for (const tn of typeNames) {
              jsonLdTypes.push(tn);
              summarize(obj, tn);
            }
            const graph = obj["@graph"];
            if (graph) walk(graph);
          }
        };
        walk(parsed);
      } catch {
        /* ignore malformed JSON-LD */
      }
    }
    return {
      title: document.title,
      description: pick('meta[name="description"]'),
      ogTitle: pick('meta[property="og:title"]'),
      ogDescription: pick('meta[property="og:description"]'),
      ogType: pick('meta[property="og:type"]'),
      ogSiteName: pick('meta[property="og:site_name"]'),
      ogUrl: pick('meta[property="og:url"]'),
      twitterCard: pick('meta[name="twitter:card"]'),
      twitterTitle: pick('meta[name="twitter:title"]'),
      twitterDescription: pick('meta[name="twitter:description"]'),
      canonical: pick('link[rel="canonical"]', "href"),
      hreflang,
      robots: pick('meta[name="robots"]'),
      h1: document.querySelector("h1")?.textContent?.trim() ?? null,
      bodyText: document.body?.innerText ?? "",
      jsonLdTypes,
      jsonLdNodes,
    };
  });

  const searchBlob = [
    raw.title,
    raw.description,
    raw.ogTitle,
    raw.ogDescription,
    raw.twitterTitle,
    raw.twitterDescription,
    raw.h1,
    raw.bodyText,
  ]
    .filter(Boolean)
    .join(" \n ");

  const approvedPhrasesPresent = APPROVED_PHRASES.filter((p) =>
    searchBlob.toLowerCase().includes(p.toLowerCase()),
  );

  // Sort hreflang for deterministic ordering and normalize href hosts.
  const hreflang = raw.hreflang
    .map((h) => ({ hreflang: h.hreflang, href: normalize(h.href) ?? "" }))
    .sort((a, b) => a.hreflang.localeCompare(b.hreflang));

  // Dedup + sort JSON-LD types so ordering changes don't churn snapshots.
  const jsonLdTypes = Array.from(new Set(raw.jsonLdTypes)).sort();

  // Normalize + deterministically sort JSON-LD nodes so a re-ordering
  // in the @graph or an added scanner tag can't churn snapshots, while
  // still asserting each node's structural fields are present.
  const jsonLdNodes: JsonLdNode[] = (raw.jsonLdNodes as JsonLdNode[])
    .map((n) => ({
      type: n.type,
      id: normalize(n.id ?? null),
      url: normalize(n.url ?? null),
      name: normalize(n.name ?? null),
      hasDescription: !!n.hasDescription,
      publisherRef: normalize(n.publisherRef ?? null),
      logoUrl: normalize(n.logoUrl ?? null),
      offersCount: n.offersCount ?? null,
      offerPrices: n.offerPrices ? [...n.offerPrices].sort() : null,
      faqQuestionCount: n.faqQuestionCount ?? null,
      breadcrumbDepth: n.breadcrumbDepth ?? null,
      inLanguage: normalize(n.inLanguage ?? null),
    }))
    .sort((a, b) => {
      const t = a.type.localeCompare(b.type);
      if (t !== 0) return t;
      return (a.id ?? a.url ?? a.name ?? "").localeCompare(b.id ?? b.url ?? b.name ?? "");
    });

  return {
    path,
    title: normalize(raw.title) ?? "",
    description: normalize(raw.description),
    ogTitle: normalize(raw.ogTitle),
    ogDescription: normalize(raw.ogDescription),
    ogType: normalize(raw.ogType),
    ogSiteName: normalize(raw.ogSiteName),
    ogUrl: normalize(raw.ogUrl),
    twitterCard: normalize(raw.twitterCard),
    twitterTitle: normalize(raw.twitterTitle),
    twitterDescription: normalize(raw.twitterDescription),
    canonical: normalize(raw.canonical),
    hreflang,
    robots: normalize(raw.robots),
    h1: normalize(raw.h1),
    jsonLdTypes,
    jsonLdNodes,
    approvedPhrasesPresent,
  };
}

function assertNoForbidden(snapshot: RouteSnapshot | string, label: string) {
  const blob = typeof snapshot === "string" ? snapshot : JSON.stringify(snapshot);
  for (const pattern of FORBIDDEN_PHRASES) {
    expect(blob, `forbidden legacy phrase in ${label}: ${pattern}`).not.toMatch(pattern);
  }
}

/**
 * Assert structural invariants of every JSON-LD node on a route:
 *   - every node has a non-empty @type
 *   - every node exposes either @id or url so it can be referenced/crawled
 *   - every known @type includes its required fields (per
 *     JSONLD_REQUIRED_FIELDS)
 *   - any url/@id that looks absolute stays on the canonical host
 */
function assertJsonLdStructure(snap: RouteSnapshot, label: string) {
  for (const node of snap.jsonLdNodes) {
    expect(node.type, `${label}: JSON-LD node missing @type`).toBeTruthy();
    // FAQPage / BreadcrumbList are structural containers — they don't
    // need their own @id or url, they're validated via faqQuestionCount /
    // breadcrumbDepth instead.
    if (!["FAQPage", "BreadcrumbList"].includes(node.type)) {
      const identifier = node.id ?? node.url;
      expect(identifier, `${label}: JSON-LD ${node.type} node must expose @id or url`).toBeTruthy();
    }
    for (const abs of [node.id, node.url, node.logoUrl, node.publisherRef]) {
      if (abs && /^https?:\/\//i.test(abs)) {
        expect(abs, `${label}: JSON-LD absolute URL must stay on canonical host`).toContain(
          CANONICAL_HOST,
        );
      }
    }
    const required = JSONLD_REQUIRED_FIELDS[node.type];
    if (required) {
      for (const field of required) {
        expect(
          node[field],
          `${label}: JSON-LD ${node.type} missing required field "${String(field)}"`,
        ).toBeTruthy();
      }
    }
  }
}

// Routes covered by the snapshot contract. Public routes must expose at
// least one approved pitch-deck phrase; private shells only need the
// noindex + canonical guarantees.
const PUBLIC_ROUTES = ["/", "/login", "/signup", "/reset-password"];
// Studio surfaces (analytics is the live "studio" landing after
// /app/content, /app/social, /app/seo redirect into it) plus the app
// shell and agency/projects hubs. They must all stay noindex +
// self-canonical so future refactors can't leak private tooling into
// search.
const PRIVATE_ROUTES = ["/onboarding", "/app", "/agency", "/projects"];
// Studio-adjacent routes that redirect into /app. We don't snapshot their
// resolved head (that's covered by /app), but we DO assert the redirect
// still lands on a noindex private shell so a broken redirect can't leak
// a public studio surface into search.
const STUDIO_REDIRECT_ROUTES = ["/app/content", "/app/social", "/app/seo", "/app/analytics"];
// Unmatched paths — pins the root NotFoundComponent's SEO surface so a
// missing/renamed route can never silently ship an indexable 404.
const NOT_FOUND_ROUTES = ["/this-route-should-never-exist-404"];

test.describe("SEO route snapshots — approved pitch-deck text", () => {
  for (const path of PUBLIC_ROUTES) {
    test(`snapshot: public ${path}`, async ({ page }) => {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      const snap = await collectSnapshot(page, path);

      // Structural invariants.
      expect(snap.ogSiteName).toBe("Raval AI");
      expect(snap.twitterCard).toBe("summary_large_image");
      expect(snap.canonical).toBe(`${CANONICAL_HOST}${path === "/" ? "/" : path}`);
      expect(snap.ogUrl).toBe(`${CANONICAL_HOST}${path === "/" ? "/" : path}`);
      expect(snap.approvedPhrasesPresent.length).toBeGreaterThan(0);

      assertNoForbidden(snap, `public ${path}`);
      assertJsonLdStructure(snap, `public ${path}`);
      // Every public route must ship both Organization + WebSite so
      // rich results and sitelinks searchbox eligibility never regress.
      expect(snap.jsonLdTypes, `public ${path} JSON-LD types`).toEqual(
        expect.arrayContaining(["Organization", "WebSite"]),
      );

      expect(JSON.stringify(snap, null, 2)).toMatchSnapshot(
        `public${path === "/" ? "-root" : path.replace(/\//g, "-")}.json`,
      );
    });
  }

  for (const path of PRIVATE_ROUTES) {
    test(`snapshot: private ${path}`, async ({ page }) => {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      const snap = await collectSnapshot(page, path);

      // Private shells must be noindex and self-canonical.
      expect(snap.robots ?? "").toMatch(/noindex/i);
      expect(snap.canonical).toBe(`${CANONICAL_HOST}${path}`);
      expect(snap.ogSiteName).toBe("Raval AI");

      assertNoForbidden(snap, `private ${path}`);
      assertJsonLdStructure(snap, `private ${path}`);

      expect(JSON.stringify(snap, null, 2)).toMatchSnapshot(
        `private${path.replace(/\//g, "-")}.json`,
      );
    });
  }

  for (const path of STUDIO_REDIRECT_ROUTES) {
    test(`snapshot: studio redirect ${path} → /app`, async ({ page }) => {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      const snap = await collectSnapshot(page, path);

      // Whatever it lands on must be noindex + branded — never public search.
      expect(snap.robots ?? "").toMatch(/noindex/i);
      expect(snap.ogSiteName).toBe("Raval AI");
      expect(snap.canonical ?? "").toMatch(new RegExp(`^${CANONICAL_HOST}/app`));

      assertNoForbidden(snap, `studio redirect ${path}`);
    });
  }

  for (const path of NOT_FOUND_ROUTES) {
    test(`snapshot: not-found ${path}`, async ({ page }) => {
      const res = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(res, "navigation response for not-found route").not.toBeNull();
      // Give the client-side NotFoundComponent effect a tick to inject
      // the runtime noindex meta, strip stale canonicals, and set the 404
      // title — wait for the full deterministic end state so the snapshot
      // never races the hydration effect.
      await page
        .waitForFunction(
          () =>
            !!document.querySelector('meta[name="robots"]') &&
            document.title.includes("Page not found"),
          null,
          { timeout: 15000 },
        )
        .catch(() => {
          /* fall through to assertion for a clearer failure */
        });
      const snap = await collectSnapshot(page, "/__not_found__");

      // A 404 must never be indexable and must not claim to be another URL.
      expect(snap.robots ?? "").toMatch(/noindex/i);
      expect(snap.ogSiteName).toBe("Raval AI");
      if (snap.canonical) {
        expect(snap.canonical).not.toBe(`${CANONICAL_HOST}/`);
        expect(snap.canonical).not.toContain("this-route-should-never-exist");
      }

      assertNoForbidden(snap, `not-found ${path}`);
      expect(JSON.stringify(snap, null, 2)).toMatchSnapshot("not-found.json");
    });
  }

  test("snapshot: robots.txt", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    const raw = (await res.text()).trim();

    // Assert against raw text (line-based directives are stable already).
    for (const p of PRIVATE_ROUTES) {
      expect(raw).toMatch(new RegExp(`Disallow:\\s*${p}\\b`));
    }
    expect(raw).toMatch(new RegExp(`Sitemap:\\s*${CANONICAL_HOST}/sitemap\\.xml`));

    assertNoForbidden(raw, "robots.txt");
    expect(normalizeBody(raw)).toMatchSnapshot("robots.txt");
  });

  test("snapshot: sitemap.xml", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const raw = (await res.text()).trim();

    // Canonical host + at least the root URL must be present before normalization.
    expect(raw).toContain(`<loc>${CANONICAL_HOST}/</loc>`);
    assertNoForbidden(raw, "sitemap.xml");

    // Strip <lastmod>…</lastmod> entirely — timestamps drift every build.
    const stripped = raw.replace(/<lastmod>[^<]*<\/lastmod>\s*/g, "");
    expect(normalizeBody(stripped)).toMatchSnapshot("sitemap.xml");
  });

  test("snapshot: llms.txt reflects deck positioning", async ({ request }) => {
    const res = await request.get("/llms.txt");
    expect(res.status()).toBe(200);
    const raw = (await res.text()).trim();

    expect(raw).toMatch(/Marketing Intelligence Layer/i);
    expect(raw).toMatch(/visible inside LLMs/i);
    expect(raw).toMatch(/Brand DNA/i);
    assertNoForbidden(raw, "llms.txt");

    expect(normalizeBody(raw)).toMatchSnapshot("llms.txt");
  });
});
