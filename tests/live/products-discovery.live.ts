// Live check of product and service discovery (ADR-0035) against real public
// sites, through the real SSRF-guarded fetcher. No model call, nothing
// written. Sites change, so each case asks for "some" results, not exact names.
//   npx vitest run --config vitest.live.config.ts tests/live/products-discovery.live.ts
//   PRODUCTS_LIVE_SITES=https://a.com,https://b.com   (print what is found on any site)
import { describe, expect, it } from "vitest";
import { discoverProducts } from "@/server/products/discover.server";

const SITES = [
  // A Shopify store: the public feed.
  { url: "https://www.allbirds.com", kind: "product" as const },
  // A WooCommerce store: the Store API.
  { url: "https://woocommerce.com", kind: null },
];

const extra = (process.env.PRODUCTS_LIVE_SITES ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

describe("product discovery on real sites", () => {
  for (const site of SITES) {
    it(`finds what ${new URL(site.url).hostname} sells`, { timeout: 40_000 }, async () => {
      const out = await discoverProducts(new URL(site.url), []);
      console.log(
        site.url,
        out.length,
        out.slice(0, 5).map((p) => `${p.kind ?? "product"}: ${p.name} (${p.images.length} photo)`),
      );
      if (site.kind) {
        expect(out.length).toBeGreaterThan(0);
        expect(out.some((p) => (p.kind ?? "product") === site.kind)).toBe(true);
        expect(out.some((p) => p.images.length > 0)).toBe(true);
      }
      for (const p of out) {
        expect(p.name.length).toBeGreaterThan(1);
        if (p.url)
          expect(new URL(p.url).hostname.replace(/^www\./, "")).toBe(
            new URL(site.url).hostname.replace(/^www\./, ""),
          );
      }
    });
  }

  for (const url of extra) {
    it(`prints what ${url} sells`, { timeout: 40_000 }, async () => {
      const out = await discoverProducts(new URL(url), []);
      console.log(
        url,
        out.map(
          (p) =>
            `${p.kind ?? "product"} · ${p.name} · ${p.price || "-"} · ${p.images.length} photo · ${p.url ?? ""}`,
        ),
      );
    });
  }
});
