// The product block a generator reads (ADR-0035). Pure.
//
// It carries only what the brand stored about the product, and says plainly
// that nothing else may be claimed and that a real photo's label, text and
// packaging are never redrawn.
import type { Product } from "./catalog";

const line = (label: string, value: string | null | undefined) =>
  value && value.trim() ? `- ${label}: ${value.trim()}` : "";

export function productBlock(
  product: Pick<
    Product,
    "kind" | "name" | "description" | "price" | "url" | "category" | "benefits"
  >,
  opts: { hasPhoto?: boolean } = {},
): string {
  const kind = product.kind === "service" ? "Service" : "Product";
  const lines = [
    `## ${kind} this piece is about`,
    line("Name", product.name),
    line("What it is", product.description),
    line("Category", product.category),
    line("Price", product.price),
    line("Page", product.url),
    product.benefits.length
      ? `- Benefits:\n${product.benefits.map((b) => `  - ${b}`).join("\n")}`
      : "",
    "",
    "Rules for this piece:",
    "- Use only the facts above about this " +
      kind.toLowerCase() +
      ". Never add a feature, ingredient, result, price or offer that isn't listed.",
    "- Call it by its exact name.",
    opts.hasPhoto
      ? "- The real product photo shows how it looks. Never rewrite or change its label, text, logo or packaging."
      : "",
  ];
  return lines
    .filter((l) => l !== "")
    .join("\n")
    .slice(0, 2500);
}

/** A one-line offer for a post image ("Name — price"). */
export function productOffer(product: Pick<Product, "name" | "price">): string {
  return [product.name, product.price].filter(Boolean).join(" — ").slice(0, 160);
}
