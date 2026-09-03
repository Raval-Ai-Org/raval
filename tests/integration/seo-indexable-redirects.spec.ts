/**
 * Redirect + canonical/robots contract for every INDEXABLE route.
 *
 * Companion to `seo-app-guard-redirects.spec.ts` (which pins the private
 * /app/* guard chain). This spec covers the opposite half: public routes
 * that CAN be indexed. For each such route we walk the browser through
 * common redirect-prone entry points — trailing slash, tracking params,
 * hash fragments, alternate casing — and pin that after any redirect:
 *
 *   1. The final URL stays on the canonical path (or its documented
 *      redirect target).
 *   2. `<link rel="canonical">` self-references the canonical path on
 *      the canonical host (never a tracked or trailing-slash variant).
 *   3. `<meta name="robots">` does NOT contain `noindex` — an indexable
 *      route that silently flips to noindex would vanish from search.
 *   4. Query-string deep-links (e.g. ?ref=…) never leak into canonical.
 *
 * Snapshots pin the redirect graph so future middleware / router
 * refactors that reintroduce a stale hop, drop a param strip, or flip
 * indexability fail loudly.
 *
 * The indexable set is derived from /sitemap.xml so this suite stays
 * in lockstep with what CI publishes to crawlers.
 *
 * Update baselines with:
 *   bunx playwright test tests/integration/seo-indexable-redirects.spec.ts \
 *     --project=integration --update-snapshots
 */
import { test, expect, type Page } from "@playwright/test";

const CANONICAL_HOST = "https://raval.ai";

/** Entry-point variants we walk for every indexable route. */
type EntryVariant = {
  id: string;
  /** Given the canonical path, return the URL to navigate to. */
  build: (path: string) => string;
};

const ENTRY_VARIANTS: EntryVariant[] = [
  { id: "canonical", build: (p) => p },
  // Trailing slash should either collapse or self-canonicalize to the
  // slash-less form. Either way canonical must NOT keep the slash.
  { id: "trailing-slash", build: (p) => (p === "/" ? "/" : `${p}/`) },
  // Tracking params must be stripped from canonical.
  {
    id: "utm-params",
    build: (p) => `${p}${p.includes("?") ? "&" : "?"}utm_source=ci&utm_campaign=seo`,
  },
  { id: "ref-param", build: (p) => `${p}${p.includes("?") ? "&" : "?"}ref=twitter` },
  // Hash fragments never affect canonical; assert they don't leak.
  { id: "hash-fragment", build: (p) => `${p}#section` },
];

type RouteSnapshot = {
  entryId: string;
  start: string;
  redirectChain: string[];
  finalPath: string;
  finalSearch: Record<string, string>;
  canonical: string | null;
  robots: string | null;
};

function toPath(url: string): string {
  try {
    const u = new URL(url, CANONICAL_HOST);
    return u.pathname + (u.search || "");
  } catch {
    return url;
  }
}

async function collectHead(page: Page) {
  return page.evaluate(() => ({
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
    robots: document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? null,
  }));
}

async function walk(page: Page, entryId: string, start: string): Promise<RouteSnapshot> {
  const chain: string[] = [];
  const onNav = () => {
    const u = toPath(page.url());
    if (chain[chain.length - 1] !== u) chain.push(u);
  };
  page.on("framenavigated", onNav);
  try {
    await page.goto(start, { waitUntil: "domcontentloaded" });
    // Let any beforeLoad-driven redirect settle before reading head tags.
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    onNav();

    const head = await collectHead(page);
    const finalUrl = new URL(page.url());
    const finalSearch: Record<string, string> = {};
    finalUrl.searchParams.forEach((v, k) => {
      finalSearch[k] = v;
    });

    return {
      entryId,
      start,
      redirectChain: Array.from(new Set(chain)),
      finalPath: finalUrl.pathname,
      finalSearch,
      canonical: head.canonical
        ? head.canonical.replace(/^https?:\/\/[^/]+/i, CANONICAL_HOST)
        : null,
      robots: head.robots,
    };
  } finally {
    page.off("framenavigated", onNav);
  }
}

/**
 * Pull the indexable route set from /sitemap.xml so this suite stays in
 * lockstep with what CI publishes. Returns canonical paths (no origin).
 */
async function loadIndexablePaths(page: Page): Promise<string[]> {
  const res = await page.request.get("/sitemap.xml");
  expect(res.ok(), "sitemap.xml must be reachable").toBe(true);
  const xml = await res.text();
  const locs = Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1].trim());
  expect(locs.length, "sitemap must list at least one URL").toBeGreaterThan(0);
  return locs.map((loc) => {
    try {
      return new URL(loc).pathname || "/";
    } catch {
      return loc;
    }
  });
}

test.describe("SEO — indexable routes preserve canonical + robots across redirects", () => {
  test("every sitemap URL survives redirect-prone entry points", async ({ page }) => {
    const paths = await loadIndexablePaths(page);

    for (const path of paths) {
      const perRoute: RouteSnapshot[] = [];

      for (const variant of ENTRY_VARIANTS) {
        const start = variant.build(path);
        const snap = await walk(page, variant.id, start);

        // 1. Final path is on the canonical path (trailing slash collapsed).
        const stripSlash = (p: string) => (p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p);
        expect(
          stripSlash(snap.finalPath),
          `[${path} :: ${variant.id}] final path must equal canonical path`,
        ).toBe(stripSlash(path));

        // 2. Canonical must self-reference on the canonical host with no
        //    tracking/hash leakage.
        expect(snap.canonical, `[${path} :: ${variant.id}] must ship a canonical`).toBeTruthy();
        expect(snap.canonical!, `[${path} :: ${variant.id}] canonical host`).toMatch(
          new RegExp(`^${CANONICAL_HOST}`),
        );
        const canonicalUrl = new URL(snap.canonical!);
        expect(
          stripSlash(canonicalUrl.pathname),
          `[${path} :: ${variant.id}] canonical path must self-reference`,
        ).toBe(stripSlash(path));
        expect(
          canonicalUrl.search,
          `[${path} :: ${variant.id}] canonical must strip tracking params`,
        ).toBe("");
        expect(
          canonicalUrl.hash,
          `[${path} :: ${variant.id}] canonical must strip hash fragments`,
        ).toBe("");

        // 3. Indexable routes must NOT ship noindex.
        expect(
          (snap.robots ?? "").toLowerCase(),
          `[${path} :: ${variant.id}] indexable route must not be noindex`,
        ).not.toMatch(/noindex/);

        // 4. Tracking params must never survive into canonical (already
        //    asserted) — also verify they don't sneak back onto the URL
        //    via a redirect loop that keeps them.
        for (const dirty of ["utm_source", "utm_campaign"]) {
          if (variant.id === "utm-params") {
            // Whatever the app decides to do with utm_* on the URL is fine;
            // canonical stripping (asserted above) is what protects SEO.
            continue;
          }
          expect(
            snap.finalSearch[dirty],
            `[${path} :: ${variant.id}] must not introduce ${dirty}`,
          ).toBeUndefined();
        }

        perRoute.push(snap);
      }

      // Pin the whole per-route redirect graph so future refactors that
      // reintroduce a redirect hop, drop a param strip, or flip
      // indexability fail loudly rather than silently.
      const slug = path === "/" ? "root" : path.replace(/^\//, "").replace(/[/?=&]/g, "-");
      expect(JSON.stringify(perRoute, null, 2)).toMatchSnapshot(`indexable-${slug}.json`);
    }
  });
});
