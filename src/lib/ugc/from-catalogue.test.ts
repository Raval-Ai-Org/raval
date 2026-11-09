import { describe, expect, it } from "vitest";
import type { Product as CatalogueProduct } from "@/lib/products/catalog";
import { ugcProductFromCatalogue } from "./from-catalogue";
import { ProductSchema } from "./schemas";

const item: CatalogueProduct = {
  id: "p1",
  kind: "product",
  name: "Morning Roast",
  description: "A medium roast for slow mornings.",
  price: "$18",
  url: "https://shop.example.com/roast",
  category: "Coffee",
  benefits: ["Roasted weekly", "  ", "Single origin"],
  images: [
    { assetId: "a1", url: "https://cdn.example.com/1.jpg" },
    { assetId: "a2", url: null },
    { assetId: "a3", url: "https://cdn.example.com/3.jpg" },
  ],
  primaryAssetId: "a3",
  source: "scan",
  position: 0,
  status: "active",
};

describe("ugcProductFromCatalogue", () => {
  it("keeps only what the catalogue says and validates", () => {
    const { product } = ugcProductFromCatalogue(item, "Bean Co");
    expect(ProductSchema.parse(product)).toBeTruthy();
    expect(product.name).toBe("Morning Roast");
    expect(product.brand).toBe("Bean Co");
    expect(product.facts.map((f) => f.text)).toEqual([
      "Price: $18",
      "Roasted weekly",
      "Single origin",
    ]);
    expect(product.benefits).toEqual(["Roasted weekly", "Single origin"]);
    expect(product.audienceHints).toEqual([]);
  });

  it("puts the main photo first and keeps assets as references", () => {
    const { product, references } = ugcProductFromCatalogue(item, null);
    expect(references.map((r) => r.assetId)).toEqual(["a3", "a1", "a2"]);
    expect(product.images.map((i) => i.url)).toEqual([
      "https://cdn.example.com/3.jpg",
      "https://cdn.example.com/1.jpg",
    ]);
  });

  it("drops a non-web link", () => {
    expect(ugcProductFromCatalogue({ ...item, url: "javascript:x" }, "").product.url).toBeNull();
  });
});
