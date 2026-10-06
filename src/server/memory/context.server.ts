// context.server.ts — a brand's memory as generators see it: one short block
// added to the prompt. Cached briefly, dropped on every memory change, and
// fail-open: a generation never waits on or fails because of it. Empty when
// memory is switched off for the brand or by the flag.
//
// These are the team's own words, so the block is not fenced as untrusted data
// (a generator is meant to follow it). Instead each line is refused at write
// time if it reads like an attempt to steer the model, and defanged again here.
import "server-only";
import type { Memory } from "@/lib/memory/contracts";
import { memoryBlock, type MemorySurface } from "@/lib/memory/block";
import { neutralizeUntrusted } from "@/server/guardrails/untrusted";

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; memories: Memory[] }>();

export function invalidateMemoryContext(workspaceId: string): void {
  cache.delete(workspaceId);
  // Studio caches its own snapshot of the workspace; keep the two in step.
  void import("@/server/studio/context.server")
    .then((m) => m.invalidateStudioContext(workspaceId))
    .catch(() => {});
}

/** Active memories for a brand. [] when off, empty or unreadable. */
export async function loadMemories(workspaceId: string): Promise<Memory[]> {
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.memories;
  try {
    const { readActiveMemories } = await import("./service.server");
    const memories = (await readActiveMemories(workspaceId)).map((m) => ({
      ...m,
      body: neutralizeUntrusted(m.body),
    }));
    cache.set(workspaceId, { at: Date.now(), memories });
    return memories;
  } catch (error) {
    console.warn("[memory] context unavailable", error instanceof Error ? error.message : error);
    return [];
  }
}

/** Whether memory is on for this brand (the flag and the brand's own switch). */
export async function isMemoryOn(workspaceId: string): Promise<boolean> {
  try {
    const { isMemoryEnabled } = await import("@/lib/feature-flags");
    if (!isMemoryEnabled(workspaceId)) return false;
    const { readEnabled } = await import("./service.server");
    return await readEnabled(workspaceId);
  } catch {
    return false;
  }
}

/** "" when there is nothing to follow. */
export async function memoryBlockFor(
  workspaceId: string,
  surface: MemorySurface,
  opts: { withIds?: boolean; maxChars?: number } = {},
): Promise<string> {
  const memories = await loadMemories(workspaceId);
  return memoryBlock(memories, { surface, now: new Date(), ...opts });
}
