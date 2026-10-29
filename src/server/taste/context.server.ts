// context.server.ts — the brand's taste as generators see it (ADR-0038): the
// lean for Studio's pickers, a short prompt block and up to two loved
// captions. Cached briefly, dropped on every heart, and fail-open: a
// generation never waits on or fails because of it.
import "server-only";
import { isTasteEnabled } from "@/lib/feature-flags";
import { tasteBlock } from "@/lib/taste/block";
import type { Taste } from "@/lib/taste/contracts";

export type TasteContext = { taste: Taste | null; text: string; lovedSamples: string[] };

const NONE: TasteContext = { taste: null, text: "", lovedSamples: [] };
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: TasteContext }>();

export function invalidateTasteContext(workspaceId: string): void {
  cache.delete(workspaceId);
  void import("@/server/studio/context.server")
    .then((m) => m.invalidateStudioContext(workspaceId))
    .catch(() => undefined);
}

export async function tasteContextFor(workspaceId: string): Promise<TasteContext> {
  if (!isTasteEnabled(workspaceId)) return NONE;
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  try {
    const { readTaste } = await import("./service.server");
    const { taste, lovedSamples } = await readTaste(workspaceId);
    const value: TasteContext = { taste, text: tasteBlock(taste), lovedSamples };
    cache.set(workspaceId, { at: Date.now(), value });
    return value;
  } catch (error) {
    console.warn("[taste] context unavailable", error instanceof Error ? error.message : error);
    return NONE;
  }
}

/** The prompt block alone; "" when nothing is learned, the flag is off or the read fails. */
export async function tasteBlockFor(workspaceId: string): Promise<string> {
  return (await tasteContextFor(workspaceId)).text;
}
