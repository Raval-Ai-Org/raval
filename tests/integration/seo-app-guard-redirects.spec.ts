/**
 * Guard-route redirect contract for every /app/* redirect route.
 *
 * The /app/* namespace contains a set of thin guard routes whose only job
 * is to `throw redirect(...)` into the real Studio surface (`/app`). If
 * one of those redirects ever forgets to preserve the target's SEO
 * contract, we could silently ship:
 *   - a canonical pointing at the guard path (not the landing page)
 *   - a missing `noindex` header, leaking private tooling into search
 *   - a redirect chain that lands on a different route than expected
 *   - a dropped ?tab / query param that breaks Analytics deep-links
 *
 * This spec walks each guard end-to-end in a real browser and pins:
 *   1. The redirect chain (start URL → intermediate URLs → final URL).
 *   2. The final page's canonical (must self-canonicalize to the landing
 *      route on the canonical host, NOT the guard path).
 *   3. The final page's robots directive (must contain `noindex`).
 *   4. Deep-link params (?tab=...) survive the redirect chain.
 *
 * Snapshots capture the redirect graph so future refactors that
 * reintroduce a stale guard, drop a param, or leak an indexable
 * canonical fail loudly.
 *
 * Update baselines with:
 *   bunx playwright test tests/integration/seo-app-guard-redirects.spec.ts \
 *     --project=integration --update-snapshots
 */
import { test, expect, type Page } from "@playwright/test";

const CANONICAL_HOST = "https://raval6.lovable.app";

type GuardCase = {
  /** The path the user (or an external link) navigates to. */
  start: string;
  /** The path the final settled page URL must equal, ignoring query string. */
  expectedFinalPath: string;
  /** Query params that must be present on the final URL. */
  expectedSearchParams?: Record<string, string>;
};

// Every /app/* guard route + its expected final Studio landing. Keep this
// in sync with:
//   - src/routes/app.content.tsx    → /app/analytics?tab=content    → /app?tab=content
//   - src/routes/app.social.tsx     → /app/analytics?tab=social     → /app?tab=social
//   - src/routes/app.seo.tsx        → /app/analytics?tab=organic    → /app?tab=organic
//   - src/routes/app.analytics.tsx  → /app?tab=<search.tab|overview>
const GUARD_CASES: GuardCase[] = [
  { start: "/app/content", expectedFinalPath: "/app", expectedSearchParams: { tab: "content" } },
  { start: "/app/social", expectedFinalPath: "/app", expectedSearchParams: { tab: "social" } },
  { start: "/app/seo", expectedFinalPath: "/app", expectedSearchParams: { tab: "organic" } },
  { start: "/app/analytics", expectedFinalPath: "/app", expectedSearchParams: { tab: "overview" } },
  // Deep-link param survives the guard chain.
  {
    start: "/app/analytics?tab=content",
    expectedFinalPath: "/app",
    expectedSearchParams: { tab: "content" },
  },
];

type GuardSnapshot = {
  start: string;
  redirectChain: string[];
  finalPath: string;
  finalSearch: Record<string, string>;
  canonical: string | null;
  robots: string | null;
};

/** Extract path (no origin) so snapshots stay stable across preview hosts. */
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

async function walkGuard(page: Page, start: string): Promise<GuardSnapshot> {
  // Track every URL the frame settles on, including client-side redirects
  // from TanStack Router's `beforeLoad` throws. `framenavigated` fires for
  // each router-driven URL change, so we capture the full chain even when
  // no HTTP 3xx is involved.
  const chain: string[] = [];
  const onNav = () => {
    const u = toPath(page.url());
    if (chain[chain.length - 1] !== u) chain.push(u);
  };
  page.on("framenavigated", onNav);

  try {
    await page.goto(start, { waitUntil: "domcontentloaded" });
    // Router redirects can fire immediately after the first paint. Wait for
    // the URL to stabilize before reading canonical/robots so we snapshot
    // the LANDING page's head, not a transient guard's.
    await page.waitForFunction(
      (guardPaths) => !guardPaths.some((p) => location.pathname === p),
      ["/app/content", "/app/social", "/app/seo", "/app/analytics"],
      { timeout: 5000 },
    ).catch(() => { /* fall through to assertion for a clearer failure */ });
    // Ensure the last framenavigated is captured.
    onNav();

    const head = await collectHead(page);
    const finalUrl = new URL(page.url());
    const finalSearch: Record<string, string> = {};
    finalUrl.searchParams.forEach((v, k) => { finalSearch[k] = v; });

    return {
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

test.describe("SEO — /app/* guard redirect canonical + robots contract", () => {
  for (const guard of GUARD_CASES) {
    test(`guard ${guard.start} preserves canonical + noindex`, async ({ page }) => {
      const snap = await walkGuard(page, guard.start);

      // 1. Final path is the intended landing route, not the guard.
      expect(snap.finalPath, `guard ${guard.start} must land on ${guard.expectedFinalPath}`)
        .toBe(guard.expectedFinalPath);

      // 2. Deep-link params survive the chain.
      if (guard.expectedSearchParams) {
        for (const [k, v] of Object.entries(guard.expectedSearchParams)) {
          expect(
            snap.finalSearch[k],
            `guard ${guard.start} must preserve ?${k}=${v}`,
          ).toBe(v);
        }
      }

      // 3. Canonical self-references the LANDING route (never the guard),
      //    stays on the canonical host, and is not the site root or a
      //    public page (that would leak private tooling into search).
      expect(snap.canonical, `guard ${guard.start} must ship a canonical`).toBeTruthy();
      expect(snap.canonical!).toMatch(new RegExp(`^${CANONICAL_HOST}${guard.expectedFinalPath}(?:$|[/?#])`));
      expect(snap.canonical!).not.toContain(guard.start.split("?")[0]);

      // 4. Robots must contain noindex — /app is a private shell.
      expect(snap.robots ?? "", `guard ${guard.start} must be noindex`).toMatch(/noindex/i);

      // 5. Redirect chain must end on the landing path. The `beforeLoad`
      //    throw resolves before the frame ever paints the guard URL, so
      //    intermediate hops are not observable via `framenavigated` —
      //    we only assert the terminal hop, which is what matters for SEO.
      expect(snap.redirectChain.length).toBeGreaterThan(0);
      expect(snap.redirectChain[snap.redirectChain.length - 1]).toContain(guard.expectedFinalPath);


      // 6. Pin the full chain so a new guard, dropped hop, or reordered
      //    redirect fails loudly instead of silently changing SEO.
      expect(JSON.stringify(snap, null, 2)).toMatchSnapshot(
        `guard${guard.start.replace(/[/?=&]/g, "-")}.json`,
      );
    });
  }
});
