/**
 * Guards the pitch-deck-aligned SEO/meta on authenticated app + studio
 * routes (Studio, Onboarding, Agency HQ, Clients). These routes gate their
 * UI behind auth in the component, but head() still runs at route match on
 * SSR — so the tags shipped in the initial HTML are what social crawlers
 * and search engines actually see. We assert them by reading the raw HTML
 * response instead of driving the browser, which sidesteps the /login
 * redirect while still validating the exact tags the framework emitted.
 *
 * Run: bunx playwright test tests/integration/seo-meta-app-routes.spec.ts --project=integration
 */
import { test, expect } from "@playwright/test";

const CANONICAL_HOST = "https://raval6.lovable.app";

// Legacy phrasing / stale domains that must never come back.
const FORBIDDEN: RegExp[] = [
  /AI marketing OS/i,
  /marketing operator/i,
  /threereachaisaas/i,
  /raval3\.lovable\.app/i,
  /Lovable App/i,
  /Lovable Generated Project/i,
];

// Terms from the pitch deck that at least one meta signal per route must carry.
const DECK_TERMS = [
  /Marketing Intelligence Layer/i,
  /Brand DNA/i,
  /AEO/i,
  /GEO/i,
  /Ravi/i,
  /visible inside LLMs/i,
];

type MetaSnapshot = {
  title: string | null;
  description: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogUrl: string | null;
  ogType: string | null;
  ogSiteName: string | null;
  twitterCard: string | null;
  canonical: string | null;
  robots: string | null;
  raw: string;
};

function pick(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? m[1] : null;
}

function snapshot(html: string): MetaSnapshot {
  return {
    title: pick(html, /<title[^>]*>([^<]*)<\/title>/i),
    description: pick(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i),
    ogTitle: pick(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i),
    ogDescription: pick(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i),
    ogUrl: pick(html, /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i),
    ogType: pick(html, /<meta[^>]+property=["']og:type["'][^>]+content=["']([^"']+)["']/i),
    ogSiteName: pick(html, /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i),
    twitterCard: pick(html, /<meta[^>]+name=["']twitter:card["'][^>]+content=["']([^"']+)["']/i),
    canonical: pick(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i),
    robots: pick(html, /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)["']/i),
    raw: html,
  };
}

function assertNoForbidden(meta: MetaSnapshot, label: string) {
  const blob = [
    meta.title, meta.description, meta.ogTitle, meta.ogDescription,
    meta.ogUrl, meta.ogSiteName, meta.canonical,
  ].filter(Boolean).join(" \n ");
  for (const pattern of FORBIDDEN) {
    expect(blob, `[${label}] forbidden legacy copy leaked: ${pattern}`).not.toMatch(pattern);
  }
}

function assertDeckAligned(meta: MetaSnapshot, label: string) {
  const blob = [meta.title, meta.description, meta.ogTitle, meta.ogDescription]
    .filter(Boolean).join(" \n ");
  const hits = DECK_TERMS.filter((re) => re.test(blob));
  expect(
    hits.length,
    `[${label}] expected at least one pitch-deck term in title/description/og; got: ${blob}`,
  ).toBeGreaterThanOrEqual(1);
}

function assertCommonShape(meta: MetaSnapshot, path: string, label: string) {
  expect(meta.title, `[${label}] <title>`).toBeTruthy();
  expect(meta.title!).toMatch(/Raval AI/);
  expect(meta.description, `[${label}] description`).toBeTruthy();
  expect(meta.ogTitle, `[${label}] og:title`).toBeTruthy();
  expect(meta.ogDescription, `[${label}] og:description`).toBeTruthy();
  expect(meta.ogType, `[${label}] og:type`).toBe("website");
  expect(meta.twitterCard, `[${label}] twitter:card`).toBe("summary_large_image");
  expect(meta.ogUrl, `[${label}] og:url`).toBe(`${CANONICAL_HOST}${path}`);
  expect(meta.canonical, `[${label}] canonical`).toBe(`${CANONICAL_HOST}${path}`);
}

/**
 * Authenticated + studio surfaces. Each entry pins path → required brand
 * terms (in addition to the shared deck-term assertion) so a rename or
 * accidental copy-paste from another route surfaces immediately.
 */
const ROUTES: Array<{
  label: string;
  path: string;
  mustContain: RegExp[];
  // Auth-only surfaces should be noindex so Google doesn't crawl the shell.
  noindex: boolean;
}> = [
  {
    label: "Studio (/app)",
    path: "/app",
    mustContain: [/Studio/i, /Ravi/i],
    noindex: true,
  },
  {
    label: "Onboarding (/onboarding)",
    path: "/onboarding",
    mustContain: [/Brand DNA/i, /AEO|GEO/i],
    noindex: true,
  },
  {
    label: "Agency HQ (/agency)",
    path: "/agency",
    mustContain: [/Agency/i, /Marketing Intelligence Layer/i],
    noindex: true,
  },
  {
    label: "Clients (/projects)",
    path: "/projects",
    mustContain: [/Clients|client brand/i, /Marketing Intelligence Layer/i],
    noindex: true,
  },
];

test.describe("SEO meta — authenticated app + studio routes", () => {
  for (const route of ROUTES) {
    test(`${route.label} ships pitch-deck-aligned head metadata`, async ({ request }) => {
      const res = await request.get(route.path);
      // These routes never 404 — even when auth redirects fire client-side,
      // the SSR HTML (with head tags) is served with a 200.
      expect(res.status(), `${route.label} status`).toBeLessThan(400);
      const html = await res.text();
      const meta = snapshot(html);

      assertCommonShape(meta, route.path, route.label);
      assertDeckAligned(meta, route.label);
      assertNoForbidden(meta, route.label);

      for (const pattern of route.mustContain) {
        const blob = [meta.title, meta.description, meta.ogTitle, meta.ogDescription]
          .filter(Boolean).join(" \n ");
        expect(blob, `[${route.label}] must contain ${pattern}`).toMatch(pattern);
      }

      if (route.noindex) {
        expect(meta.robots, `[${route.label}] robots noindex`).toMatch(/noindex/i);
      }
    });
  }

  test("no authenticated route reuses another's title (unique per surface)", async ({ request }) => {
    const titles = new Map<string, string>();
    for (const route of ROUTES) {
      const html = await (await request.get(route.path)).text();
      const meta = snapshot(html);
      expect(meta.title, `${route.label} has title`).toBeTruthy();
      const prior = [...titles.entries()].find(([, t]) => t === meta.title);
      expect(
        prior,
        `${route.label} title "${meta.title}" duplicates ${prior?.[0]}`,
      ).toBeUndefined();
      titles.set(route.label, meta.title!);
    }
  });

  test("no authenticated route falls back to the root default title/description", async ({ request }) => {
    // Read the root shell so we know exactly what the fallback string is,
    // then assert every surface overrode both fields.
    const rootHtml = await (await request.get("/")).text();
    const rootMeta = snapshot(rootHtml);

    for (const route of ROUTES) {
      const html = await (await request.get(route.path)).text();
      const meta = snapshot(html);
      expect(meta.title, `${route.label} title vs root`).not.toBe(rootMeta.title);
      expect(
        meta.description,
        `${route.label} description vs root`,
      ).not.toBe(rootMeta.description);
    }
  });
});
