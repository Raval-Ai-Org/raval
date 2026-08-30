/**
 * Guards the pitch-deck-aligned OpenGraph, Twitter Card, and JSON-LD
 * structured data across public + authenticated routes. Reads raw SSR HTML
 * so we validate exactly what social crawlers and search engines see (no
 * client-side auth redirect interference).
 *
 * Run: bunx playwright test tests/integration/seo-og-twitter-jsonld.spec.ts --project=integration
 */
import { test, expect, type APIRequestContext } from "@playwright/test";

const CANONICAL_HOST = "https://raval6.lovable.app";

const FORBIDDEN = [
  /AI marketing OS/i,
  /marketing operator/i,
  /threereachaisaas/i,
  /raval3\.lovable\.app/i,
  /Lovable App/i,
  /Lovable Generated Project/i,
];

const DECK_TERMS = [
  /Marketing Intelligence Layer/i,
  /Brand DNA/i,
  /AEO/i,
  /GEO/i,
  /Ravi/i,
  /visible inside LLMs/i,
];

function pickAll(html: string, re: RegExp): string[] {
  const out: string[] = [];
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = g.exec(html)) !== null) out.push(m[1]);
  return out;
}

function metaContent(html: string, key: "name" | "property", value: string): string | null {
  const re = new RegExp(`<meta[^>]+${key}=["']${value}["'][^>]+content=["']([^"']+)["']`, "i");
  const m = html.match(re);
  if (m) return m[1];
  // Handle reverse attribute order (content first, then name/property).
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${key}=["']${value}["']`, "i");
  return html.match(re2)?.[1] ?? null;
}

function readOgTwitter(html: string) {
  return {
    ogTitle: metaContent(html, "property", "og:title"),
    ogDescription: metaContent(html, "property", "og:description"),
    ogUrl: metaContent(html, "property", "og:url"),
    ogType: metaContent(html, "property", "og:type"),
    ogSiteName: metaContent(html, "property", "og:site_name"),
    ogImage: metaContent(html, "property", "og:image"),
    twitterCard: metaContent(html, "name", "twitter:card"),
    twitterTitle: metaContent(html, "name", "twitter:title"),
    twitterDescription: metaContent(html, "name", "twitter:description"),
    twitterImage: metaContent(html, "name", "twitter:image"),
  };
}

function extractJsonLd(html: string): unknown[] {
  const blocks = pickAll(
    html,
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  const out: unknown[] = [];
  for (const raw of blocks) {
    const parsed = JSON.parse(raw);
    // Flatten @graph so tests can look up by @type without caring about wrapping.
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as any)["@graph"])) {
      for (const node of (parsed as any)["@graph"]) out.push(node);
    } else if (Array.isArray(parsed)) {
      for (const node of parsed) out.push(node);
    } else {
      out.push(parsed);
    }
  }
  return out;
}

function findByType(nodes: unknown[], type: string): Record<string, unknown> | undefined {
  return nodes.find((n) => n && typeof n === "object" && (n as any)["@type"] === type) as
    Record<string, unknown> | undefined;
}

function assertNoForbidden(blob: string, label: string) {
  for (const pattern of FORBIDDEN) {
    expect(blob, `[${label}] forbidden copy leaked: ${pattern}`).not.toMatch(pattern);
  }
}

async function fetchHtml(request: APIRequestContext, path: string): Promise<string> {
  const res = await request.get(path);
  expect(res.status(), `GET ${path}`).toBeLessThan(400);
  return res.text();
}

const ROUTES: Array<{ label: string; path: string; requireOgImage?: boolean }> = [
  { label: "Landing (/)", path: "/", requireOgImage: false },
  { label: "Login (/login)", path: "/login" },
  { label: "Signup (/signup)", path: "/signup" },
  { label: "Studio (/app)", path: "/app" },
  { label: "Onboarding (/onboarding)", path: "/onboarding" },
  { label: "Agency HQ (/agency)", path: "/agency" },
  { label: "Clients (/projects)", path: "/projects" },
];

test.describe("OpenGraph + Twitter Card — pitch-deck messaging", () => {
  for (const route of ROUTES) {
    test(`${route.label} ships aligned OG + Twitter tags`, async ({ request }) => {
      const html = await fetchHtml(request, route.path);
      const og = readOgTwitter(html);

      // Structural completeness — both crawlers need these.
      expect(og.ogTitle, "og:title").toBeTruthy();
      expect(og.ogDescription, "og:description").toBeTruthy();
      expect(og.ogType, "og:type").toBe("website");
      expect(og.ogUrl, "og:url").toBe(`${CANONICAL_HOST}${route.path}`);
      expect(og.twitterCard, "twitter:card").toBe("summary_large_image");
      expect(og.twitterTitle, "twitter:title").toBeTruthy();
      expect(og.twitterDescription, "twitter:description").toBeTruthy();

      // Titles/descriptions consistent across OG and Twitter (crawler parity).
      expect(og.twitterTitle).toBe(og.ogTitle);
      expect(og.twitterDescription).toBe(og.ogDescription);

      // Deck alignment — every OG/Twitter surface must carry at least one deck term.
      const blob = [og.ogTitle, og.ogDescription, og.twitterTitle, og.twitterDescription]
        .filter(Boolean)
        .join(" \n ");
      const hits = DECK_TERMS.filter((re) => re.test(blob));
      expect(hits.length, `[${route.label}] deck terms in OG/Twitter`).toBeGreaterThanOrEqual(1);

      assertNoForbidden(blob, route.label);

      // og:image is optional per project convention (hosting injects one when
      // omitted). If a route DOES set it, it must be absolute https on the
      // canonical host and og:image / twitter:image must agree.
      if (og.ogImage) {
        expect(og.ogImage, "og:image absolute https").toMatch(/^https:\/\//);
        if (og.twitterImage) expect(og.twitterImage).toBe(og.ogImage);
      }
    });
  }
});

test.describe("JSON-LD structured data — pitch-deck messaging", () => {
  test("root shell ships Organization + WebSite graph aligned with deck", async ({ request }) => {
    const html = await fetchHtml(request, "/");
    const nodes = extractJsonLd(html);

    const org = findByType(nodes, "Organization");
    expect(org, "Organization node").toBeTruthy();
    expect(org!["@id"]).toBe(`${CANONICAL_HOST}/#organization`);
    expect(org!.name).toBe("Raval AI");
    expect(org!.url).toBe(CANONICAL_HOST);
    expect(String(org!.description)).toMatch(/Marketing Intelligence Layer/i);
    expect(String(org!.description)).toMatch(/brands and agencies/i);
    assertNoForbidden(String(org!.description), "Organization.description");

    const site = findByType(nodes, "WebSite");
    expect(site, "WebSite node").toBeTruthy();
    expect(site!["@id"]).toBe(`${CANONICAL_HOST}/#website`);
    expect(site!.url).toBe(CANONICAL_HOST);
    expect(site!.name).toBe("Raval AI");
    expect(String(site!.description)).toMatch(/visible inside LLMs/i);
    expect((site!.publisher as any)?.["@id"]).toBe(`${CANONICAL_HOST}/#organization`);
    assertNoForbidden(String(site!.description), "WebSite.description");
  });

  test("landing page ships SoftwareApplication with deck-aligned pricing tiers", async ({
    request,
  }) => {
    const html = await fetchHtml(request, "/");
    const nodes = extractJsonLd(html);

    const app = findByType(nodes, "SoftwareApplication");
    expect(app, "SoftwareApplication node").toBeTruthy();
    expect(app!.name).toBe("Raval AI");
    expect(app!.url).toBe(`${CANONICAL_HOST}/`);
    expect(String(app!.description)).toMatch(/Brand DNA/i);
    expect(String(app!.description)).toMatch(/AEO|GEO/i);
    expect(String(app!.description)).toMatch(/Ravi/i);
    assertNoForbidden(String(app!.description), "SoftwareApplication.description");

    const offers = app!.offers as Array<Record<string, unknown>> | undefined;
    expect(Array.isArray(offers), "offers is array").toBe(true);
    // Pitch deck tiers: Starter $9, Growth $29, Agency OS $79.
    const byName = new Map(offers!.map((o) => [String(o.name), o]));
    for (const [name, price] of [
      ["Starter", "9"],
      ["Growth", "29"],
      ["Agency OS", "79"],
    ] as const) {
      const offer = byName.get(name);
      expect(offer, `${name} offer present`).toBeTruthy();
      expect(offer!.price, `${name} price`).toBe(price);
      expect(offer!.priceCurrency, `${name} currency`).toBe("USD");
      expect(offer!["@type"]).toBe("Offer");
    }
  });

  test("landing page FAQPage covers deck concepts (AEO/GEO, Ravi, Brand DNA)", async ({
    request,
  }) => {
    const html = await fetchHtml(request, "/");
    const nodes = extractJsonLd(html);

    const faq = findByType(nodes, "FAQPage");
    expect(faq, "FAQPage node").toBeTruthy();
    const questions = faq!.mainEntity as Array<Record<string, any>>;
    expect(Array.isArray(questions)).toBe(true);
    expect(questions.length).toBeGreaterThanOrEqual(3);

    const answerBlob = questions
      .map((q) => `${q.name} :: ${q.acceptedAnswer?.text ?? ""}`)
      .join(" \n ");

    // Every deck pillar must be answered somewhere in the FAQ.
    expect(answerBlob).toMatch(/Marketing Intelligence Layer/i);
    expect(answerBlob).toMatch(/Brand DNA/i);
    expect(answerBlob).toMatch(/AEO\/GEO|AEO|GEO/i);
    expect(answerBlob).toMatch(/Ravi/i);
    expect(answerBlob).toMatch(/ChatGPT|Perplexity|Gemini|Claude/i);

    // Every question must have a schema-valid Answer node.
    for (const q of questions) {
      expect(q["@type"]).toBe("Question");
      expect(q.acceptedAnswer?.["@type"]).toBe("Answer");
      expect(String(q.acceptedAnswer?.text ?? "")).not.toEqual("");
    }

    assertNoForbidden(answerBlob, "FAQPage");
  });

  test("agency + projects ship WebPage schema tied to Organization/WebSite", async ({
    request,
  }) => {
    for (const path of ["/agency", "/projects"]) {
      const html = await fetchHtml(request, path);
      const nodes = extractJsonLd(html);
      const page = findByType(nodes, "WebPage");
      expect(page, `${path} WebPage node`).toBeTruthy();
      expect(page!.url).toBe(`${CANONICAL_HOST}${path}`);
      expect(String(page!.name)).toMatch(/Raval AI/);
      expect(String(page!.description)).toMatch(/Marketing Intelligence Layer/i);

      const publisher = page!.publisher as Record<string, unknown> | undefined;
      expect(publisher?.["@type"]).toBe("Organization");
      expect(publisher?.name).toBe("Raval AI");
      expect(publisher?.url).toBe(CANONICAL_HOST);

      const partOf = page!.isPartOf as Record<string, unknown> | undefined;
      expect(partOf?.["@type"]).toBe("WebSite");
      expect(partOf?.name).toBe("Raval AI");

      assertNoForbidden(JSON.stringify(page), `${path} WebPage`);
    }
  });

  test("all JSON-LD blocks across audited routes parse and contain no legacy strings", async ({
    request,
  }) => {
    for (const route of ROUTES) {
      const html = await fetchHtml(request, route.path);
      const blocks = pickAll(
        html,
        /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i,
      );
      // Public + agency/projects intentionally ship JSON-LD via root + route.
      // Login/signup/app/onboarding may only carry the root graph — still must parse.
      expect(blocks.length, `${route.label} has JSON-LD`).toBeGreaterThanOrEqual(1);
      for (const raw of blocks) {
        // Throws on malformed JSON — surfaces regressions immediately.
        const parsed = JSON.parse(raw);
        assertNoForbidden(JSON.stringify(parsed), `${route.label} JSON-LD`);
      }
    }
  });
});
