/**
 * Guards the pitch-deck-aligned SEO/meta on public routes so future edits
 * can't silently drift back to legacy "AI marketing OS / operator" copy or
 * stale domains. Keeps assertions loose enough to allow copy polish while
 * pinning the required brand terms, canonical host, and tag structure.
 *
 * Run: bunx playwright test tests/integration/seo-meta-messaging.spec.ts --project=integration
 */
import { test, expect, type Page } from "@playwright/test";

const CANONICAL_HOST = "https://raval6.lovable.app";
// Legacy phrasing that must never come back on public routes.
const FORBIDDEN = [
  /AI marketing OS/i,
  /marketing operator/i,
  /threereachaisaas/i,
  /raval3\.lovable\.app/i,
];

async function readMeta(page: Page) {
  return page.evaluate(() => {
    const pick = (sel: string, attr = "content") =>
      document.querySelector(sel)?.getAttribute(attr) ?? null;
    return {
      title: document.title,
      description: pick('meta[name="description"]'),
      ogTitle: pick('meta[property="og:title"]'),
      ogDescription: pick('meta[property="og:description"]'),
      ogUrl: pick('meta[property="og:url"]'),
      ogSiteName: pick('meta[property="og:site_name"]'),
      ogType: pick('meta[property="og:type"]'),
      twitterCard: pick('meta[name="twitter:card"]'),
      canonical: pick('link[rel="canonical"]', "href"),
      robots: pick('meta[name="robots"]'),
    };
  });
}

function expectNoForbidden(values: Array<string | null>) {
  const blob = values.filter(Boolean).join(" \n ");
  for (const pattern of FORBIDDEN) {
    expect(blob, `forbidden legacy copy leaked: ${pattern}`).not.toMatch(pattern);
  }
}

test.describe("SEO meta — pitch-deck messaging", () => {
  test("landing page (/) advertises Marketing Intelligence Layer", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const meta = await readMeta(page);

    expect(meta.title).toMatch(/Raval AI/);
    expect(meta.title).toMatch(/Marketing Intelligence Layer/i);
    expect(meta.description).toMatch(/visible inside LLMs/i);
    expect(meta.description).toMatch(/brands and agencies/i);
    expect(meta.ogTitle).toMatch(/Marketing Intelligence Layer/i);
    expect(meta.ogDescription ?? "").not.toEqual("");
    expect(meta.ogType).toBe("website");
    expect(meta.ogSiteName).toBe("Raval AI");
    expect(meta.twitterCard).toBe("summary_large_image");
    expect(meta.ogUrl).toBe(`${CANONICAL_HOST}/`);
    expect(meta.canonical).toBe(`${CANONICAL_HOST}/`);
    // Landing must be indexable.
    expect(meta.robots ?? "").not.toMatch(/noindex/i);

    expectNoForbidden(Object.values(meta));
  });

  test("login page has deck-aligned copy, correct canonical, noindex", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    const meta = await readMeta(page);

    expect(meta.title).toMatch(/Sign in.*Raval AI/i);
    expect(meta.description).toMatch(/Raval AI/);
    expect(meta.ogUrl).toBe(`${CANONICAL_HOST}/login`);
    expect(meta.canonical).toBe(`${CANONICAL_HOST}/login`);
    expect(meta.robots).toMatch(/noindex/i);

    expectNoForbidden(Object.values(meta));
  });

  test("signup page has deck-aligned copy, correct canonical, noindex", async ({ page }) => {
    await page.goto("/signup", { waitUntil: "domcontentloaded" });
    const meta = await readMeta(page);

    expect(meta.title).toMatch(/Create account.*Raval AI/i);
    expect(meta.description).toMatch(/Raval AI/);
    expect(meta.ogDescription).toMatch(/visible inside LLMs|Brand DNA|AEO|GEO/i);
    expect(meta.ogUrl).toBe(`${CANONICAL_HOST}/signup`);
    expect(meta.canonical).toBe(`${CANONICAL_HOST}/signup`);
    expect(meta.robots).toMatch(/noindex/i);

    expectNoForbidden(Object.values(meta));
  });

  test("sitemap.xml uses the canonical published host", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const xml = await res.text();
    expect(xml).toContain(`<loc>${CANONICAL_HOST}/</loc>`);
    expect(xml).not.toMatch(/threereachaisaas/i);
    expect(xml).not.toMatch(/raval3\.lovable\.app/i);
  });

  test("llms.txt reflects Marketing Intelligence Layer positioning", async ({ request }) => {
    const res = await request.get("/llms.txt");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/Marketing Intelligence Layer/i);
    expect(body).toMatch(/visible inside LLMs/i);
    expect(body).toMatch(/Brand DNA/i);
    // Guard against legacy phrasing.
    expect(body).not.toMatch(/AI marketing OS/i);
    expect(body).not.toMatch(/marketing operator/i);
  });
});
