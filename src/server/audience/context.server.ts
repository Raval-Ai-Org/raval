// context.server.ts — the audience as generators see it: one compact block
// appended to the brand context. Cached briefly, dropped on every audience
// write, and fail-open: a generation never waits on or fails because of it.
import "server-only";
import { isAudienceEnabled } from "@/lib/feature-flags";
import { audienceBlock } from "@/lib/audience/twins";
import { supabaseAudienceStore as store } from "./store.server";

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; text: string }>();

export function invalidateAudienceContext(workspaceId: string): void {
  cache.delete(workspaceId);
}

/** "" when the feature is off, there are no groups, or the read fails. */
export async function audienceBlockFor(workspaceId: string): Promise<string> {
  if (!isAudienceEnabled(workspaceId)) return "";
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.text;
  try {
    const text = audienceBlock(await store.listTwins(workspaceId));
    cache.set(workspaceId, { at: Date.now(), text });
    return text;
  } catch (error) {
    console.warn("[audience] context unavailable", error instanceof Error ? error.message : error);
    return "";
  }
}
