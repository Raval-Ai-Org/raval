// context.server.ts — the confirmed marketing strategy as generators see it:
// one compact block added to the brand context. Cached briefly, dropped on
// every strategy write, and fail-open: a generation never waits on or fails
// because of it. A draft is never used — only what a person confirmed.
import "server-only";
import { strategyBlock } from "@/lib/strategy/ground";

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; text: string }>();

export function invalidateStrategyContext(workspaceId: string): void {
  cache.delete(workspaceId);
}

/** "" when there is no confirmed strategy or the read fails. */
export async function strategyBlockFor(workspaceId: string): Promise<string> {
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.text;
  try {
    const { readConfirmedStrategy } = await import("./service.server");
    const strategy = await readConfirmedStrategy(workspaceId);
    const text = strategy ? strategyBlock(strategy) : "";
    cache.set(workspaceId, { at: Date.now(), text });
    return text;
  } catch (error) {
    console.warn("[strategy] context unavailable", error instanceof Error ? error.message : error);
    return "";
  }
}
