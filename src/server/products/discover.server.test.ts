import { describe, expect, it } from "vitest";
import { discoverProducts } from "./discover.server";

const origin = new URL("https://shop.example.com/");

const productHtml = (name: string) => `<html><head>
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Product",
  name,
  image: "https://cdn.example.com/a.jpg",
  offers: { price: "18", priceCurrency: "USD" },
})}</script></head><body><h1>${name}</h1></body></html>`;

describe("discoverProducts", () => {
  it("uses the Shopify feed when there is one", async () => {
    const out = await discoverProducts(origin, [], {
      fetchJson: async () => ({
        products: [{ title: "Blue Mug", handle: "blue-mug", images: [] }],
      }),
      fetchPage: async () => {
        throw new Error("should not crawl");
      },
    });
    expect(out.map((p) => p.name)).toEqual(["Blue Mug"]);
    expect(out[0].source).toBe("shopify");
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

  it("gives up quietly when the budget runs out", async () => {
    const out = await discoverProducts(
      origin,
      [],
      { fetchJson: () => new Promise(() => {}), fetchPage: async () => "" },
      20,
    );
    expect(out).toEqual([]);
  });
});
