import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("@/server/assets/persist.server", () => ({ persistAsset: vi.fn() }));
vi.mock("@/server/assets/storage.server", () => ({ signStoragePath: vi.fn() }));

const pages = new Map<string, { type: string; body: string }>();
vi.mock("@/server/safe-fetch", () => ({
  assertPublicUrl: (raw: string | URL) => (typeof raw === "string" ? new URL(raw) : raw),
  safeFetch: vi.fn(async (url: string | URL) => {
    const hit = pages.get(String(url));
    return {
      ok: !!hit,
      status: hit ? 200 : 404,
      url: String(url),
      headers: new Headers({ "content-type": hit?.type ?? "text/html" }),
      bytes: new TextEncoder().encode(hit?.body ?? ""),
      truncated: false,
      text: () => hit?.body ?? "",
    };
  }),
  fetchPublicText: vi.fn(async (url: string | URL) => pages.get(String(url))?.body ?? ""),
}));

const { findWebsiteProducts } = await import("./catalog.server");

beforeEach(() => pages.clear());

describe("findWebsiteProducts", () => {
  it("reads a Shopify store's public feed first", async () => {
    pages.set("https://shop.example.com/products.json?limit=30", {
      type: "application/json",
      body: JSON.stringify({
        products: [
          {
            title: "Cold Brew Kit",
            handle: "cold-brew-kit",
            images: [{ src: "https://cdn.shopify.com/kit.jpg" }],
            variants: [{ price: "29.00" }],
          },
        ],
      }),
    });
    const found = await findWebsiteProducts("https://shop.example.com/");
    expect(found.map((p) => [p.name, p.url, p.price])).toEqual([
      ["Cold Brew Kit", "https://shop.example.com/products/cold-brew-kit", "29.00"],
    ]);
  });

  it("falls back to product pages linked from the homepage and sitemap", async () => {
    pages.set("https://store.example.com/", {
      type: "text/html",
      body: `<a href="/product/linen-shirt/">Shirt</a><a href="/about">About</a>`,
    });
    pages.set("https://store.example.com/sitemap.xml", {
      type: "application/xml",
      body: `<sitemapindex><sitemap><loc>https://store.example.com/product-sitemap.xml</loc></sitemap></sitemapindex>`,
    });
    pages.set("https://store.example.com/product-sitemap.xml", {
      type: "application/xml",
      body: `<urlset><url><loc>https://store.example.com/product/wool-scarf/</loc></url></urlset>`,
    });
    const product = (name: string, img: string) => `<html><head>
      <script type="application/ld+json">${JSON.stringify({
        "@type": "Product",
        name,
        image: img,
        offers: { price: "40", priceCurrency: "EUR" },
      })}</script></head><body><h1>${name}</h1></body></html>`;
    pages.set("https://store.example.com/product/linen-shirt", {
      type: "text/html",
      body: product("Linen Shirt", "https://store.example.com/img/shirt.jpg"),
    });
    pages.set("https://store.example.com/product/wool-scarf", {
      type: "text/html",
      body: product("Wool Scarf", "https://store.example.com/img/scarf.jpg"),
    });
    const found = await findWebsiteProducts("https://store.example.com/");
    expect(found.map((p) => [p.name, p.price, p.images[0]])).toEqual([
      ["Linen Shirt", "EUR 40", "https://store.example.com/img/shirt.jpg"],
      ["Wool Scarf", "EUR 40", "https://store.example.com/img/scarf.jpg"],
    ]);
  });

  it("finds nothing on a site that sells no products", async () => {
    pages.set("https://saas.example.com/", {
      type: "text/html",
      body: `<a href="/pricing">Pricing</a><a href="/blog/post">Blog</a>`,
    });
    expect(await findWebsiteProducts("https://saas.example.com/")).toEqual([]);
  });
});
