// A product the Brand DNA scan already found (workspace_products, ADR-0035)
// becomes a creator-video product without reading the page again. Pure and
// browser-safe: the facts are only what the catalogue row says, and the
// photos stay the workspace's own assets (the server re-checks them).

import type { Product as CatalogueProduct } from "@/lib/products/catalog";
import type { Product, ProductFact, ReferenceImageView } from "./schemas";

const MAX_REFS = 9;

const clip = (s: string, max: number) => s.trim().slice(0, max);
const isHttp = (u: string | null): u is string => !!u && /^https?:\/\//i.test(u);

export function ugcProductFromCatalogue(
  item: CatalogueProduct,
  brand: string | null | undefined,
): { product: Product; references: ReferenceImageView[] } {
  const facts: ProductFact[] = [];
  const price = clip(item.price, 40);
  if (price) facts.push({ id: "price", text: `Price: ${price}`, source: "page" });
  item.benefits
    .map((b) => clip(b, 300))
    .filter(Boolean)
    .slice(0, 12)
    .forEach((text, i) => facts.push({ id: `benefit-${i + 1}`, text, source: "page" }));

  // The main photo first, then the rest in the catalogue's order.
  const photos = [...item.images].sort(
    (a, b) => Number(b.assetId === item.primaryAssetId) - Number(a.assetId === item.primaryAssetId),
  );

  return {
    product: {
      name: clip(item.name, 160),
      brand: clip(brand ?? "", 120),
      url: isHttp(item.url) ? item.url : null,
      description: clip(item.description, 2000),
      price,
      category: clip(item.category, 120),
      images: photos
        .map((p) => p.url)
        .filter(isHttp)
        .slice(0, 12)
        .map((url) => ({ url, alt: clip(item.name, 200) })),
      facts,
      benefits: item.benefits
        .map((b) => clip(b, 200))
        .filter(Boolean)
        .slice(0, 12),
      audienceHints: [],
      useCases: [],
    },
    references: photos.slice(0, MAX_REFS).map((p, i) => ({
      assetId: p.assetId,
      url: p.url,
      filename: `${clip(item.name, 60) || "product"}-${i + 1}`,
    })),
  };
}
