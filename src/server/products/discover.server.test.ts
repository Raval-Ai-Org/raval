import { describe, expect, it } from "vitest";
import { discoverProducts } from "./discover.server";

const origin = new URL("https://shop.example.com/");

const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;

const productHtml = (name: string) => `<html><head>
${ld({
  "@context": "https://schema.org",
  "@type": "Product",
  name,
  image: "https://cdn.example.com/a.jpg",
  offers: { price: "18", priceCurrency: "USD" },
})}</head><body><h1>${name}</h1></body></html>`;

describe("discoverProducts", () => {
  it("uses the Shopify feed and doesn't crawl product pages", async () => {
    const pages: string[] = [];
    const out = await discoverProducts(origin, ["/products/blue-mug"], {
      fetchJson: async (url) =>
        url.includes("products.json")
          ? { products: [{ title: "Blue Mug", handle: "blue-mug", images: [] }] }
          : null,
      fetchPage: async (url) => {
        pages.push(url);
        return "";
      },
    });
    expect(out.map((p) => p.name)).toEqual(["Blue Mug"]);
    expect(out[0].source).toBe("shopify");
    expect(pages.some((u) => u.endsWith("/products/blue-mug"))).toBe(false);
  });

  it("reads WooCommerce's Store API", async () => {
    const out = await discoverProducts(origin, [], {
      fetchJson: async (url) =>
        url.includes("wc/store")
          ? [
              {
                name: "Linen Apron",
                permalink: "https://shop.example.com/product/linen-apron/",
                prices: { price: "2450", currency_code: "EUR", currency_minor_unit: 2 },
                images: [{ src: "https://shop.example.com/wp-content/uploads/apron.jpg" }],
                short_description: "<p>Washed linen.</p>",
                categories: [{ name: "Kitchen" }],
              },
            ]
          : null,
      fetchPage: async () => "",
    });
    expect(out[0]).toMatchObject({
      name: "Linen Apron",
      price: "EUR 24.50",
      description: "Washed linen.",
      category: "Kitchen",
      kind: "product",
    });
  });

  it("falls back to product pages with structured data", async () => {
    const out = await discoverProducts(
      origin,
      ["/products/blue-mug", "/products/red-mug", "/about"],
      {
        fetchJson: async () => null,
        fetchPage: async (url) => (url.endsWith("blue-mug") ? productHtml("Blue Mug") : ""),
      },
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: "Blue Mug", price: "USD 18", source: "scan" });
  });

  it("finds services in a business's offer catalogue and on service pages", async () => {
    const services = `<html><head>${ld({
      "@type": "LocalBusiness",
      name: "Bright Smiles",
      hasOfferCatalog: {
        "@type": "OfferCatalog",
        itemListElement: [
          { "@type": "Offer", itemOffered: { "@type": "Service", name: "Teeth whitening" } },
          { "@type": "Offer", itemOffered: { "@type": "Service", name: "Invisalign" } },
        ],
      },
    })}</head><body><a href="/services/dental-implants">Implants</a></body></html>`;
    const implants = `<html><head><title>Dental implants | Bright Smiles</title></head><body><h1>Dental implants</h1></body></html>`;
    const out = await discoverProducts(origin, [], {
      fetchJson: async () => null,
      fetchPage: async (url) =>
        url.endsWith("/services") ? services : url.endsWith("/dental-implants") ? implants : "",
    });
    expect(out.map((p) => [p.name, p.kind])).toEqual(
      expect.arrayContaining([
        ["Teeth whitening", "service"],
        ["Invisalign", "service"],
        ["Dental implants", "service"],
      ]),
    );
  });

  it("reads product sitemaps from a sitemap index", async () => {
    const index = `<sitemapindex><sitemap><loc>https://shop.example.com/product-sitemap.xml</loc></sitemap><sitemap><loc>https://shop.example.com/post-sitemap.xml</loc></sitemap></sitemapindex>`;
    const child = `<urlset><url><loc>https://shop.example.com/product/oak-board/</loc></url></urlset>`;
    const out = await discoverProducts(
      origin,
      [],
      {
        fetchJson: async () => null,
        fetchPage: async (url) =>
          url.endsWith("product-sitemap.xml")
            ? child
            : url.includes("oak-board")
              ? productHtml("Oak Board")
              : "",
      },
      undefined,
      { sitemapXml: index },
    );
    expect(out.map((p) => p.name)).toEqual(["Oak Board"]);
  });

  it("gives up quietly when the budget runs out", async () => {
    const out = await discoverProducts(
      origin,
      [],
      { fetchJson: () => new Promise(() => {}), fetchPage: async () => "" },
      20,
    );
    expect(out).toEqual([]);
  });

  it("keeps what it already had when the budget runs out", async () => {
    const out = await discoverProducts(
      origin,
      [],
      {
        fetchJson: async (url) =>
          url.includes("products.json") ? { products: [{ title: "Blue Mug", handle: "b" }] } : null,
        fetchPage: () => new Promise(() => {}),
      },
      50,
      { sitemapXml: "" },
    );
    expect(out.map((p) => p.name)).toEqual(["Blue Mug"]);
  });
});
