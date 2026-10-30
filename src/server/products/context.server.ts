// context.server.ts — the product catalogue as generators see it (ADR-0035).
// The catalogue block is cached briefly, dropped on every product write and
// fail-open: a generation never waits on or fails because of it.
import "server-only";
import { productBlock } from "@/lib/products/block";

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; text: string }>();

export function invalidateProductContext(workspaceId: string): void {
  cache.delete(workspaceId);
}

const short = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** What the brand sells, one line each. "" when there is nothing or the read fails. */
export async function catalogBlockFor(workspaceId: string): Promise<string> {
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.text;
  try {
    const { readProductRows } = await import("./service.server");
    const rows = await readProductRows(workspaceId);
    const text = rows.length
      ? [
          "## What the brand sells (its own catalogue; use these exact names and prices)",
          ...rows.slice(0, 12).map((r) => {
            const head = [r.name, r.price].filter(Boolean).join(" — ");
            const kind = r.kind === "service" ? " (service)" : "";
            return `- ${head}${kind}${r.description ? `: ${short(r.description, 140)}` : ""}`;
          }),
        ].join("\n")
      : "";
    cache.set(workspaceId, { at: Date.now(), text });
    return text;
  } catch (error) {
    console.warn("[products] context unavailable", error instanceof Error ? error.message : error);
    return "";
  }
}

/** The one product a piece is about, checked against the workspace, with its photo id. */
export async function productContextFor(
  workspaceId: string,
  productId: string,
): Promise<{
  block: string;
  photoAssetId: string | null;
  photoAssetIds: string[];
  name: string;
  price: string;
  description: string;
  category: string;
  benefits: string[];
} | null> {
  const { productForGeneration } = await import("./service.server");
  const row = await productForGeneration(workspaceId, productId);
  if (!row) return null;
  return {
    block: productBlock(
      {
        kind: row.kind,
        name: row.name,
        description: row.description,
        price: row.price,
        url: row.url,
        category: row.category,
        benefits: row.benefits ?? [],
      },
      { hasPhoto: Boolean(row.photoAssetId) },
    ),
    photoAssetId: row.photoAssetId,
    photoAssetIds: row.photoAssetIds,
    name: row.name,
    price: row.price,
    description: row.description,
    category: row.category,
    benefits: row.benefits ?? [],
  };
}
