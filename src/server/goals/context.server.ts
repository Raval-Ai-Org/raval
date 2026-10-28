// context.server.ts — the workspace's goal as generators see it (ADR-0035):
// one short block added to the brand context. Cached briefly, dropped on
// every goal write, and fail-open: a generation never waits on or fails
// because of it.
import "server-only";
import { goalBlock } from "@/lib/goals/block";

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; text: string }>();

export function invalidateGoalContext(workspaceId: string): void {
  cache.delete(workspaceId);
}

/** "" when no goal is set or the read fails. */
export async function goalBlockFor(workspaceId: string): Promise<string> {
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.text;
  try {
    const { readGoals } = await import("./service.server");
    const goals = await readGoals(workspaceId);
    const text = goals ? goalBlock(goals) : "";
    cache.set(workspaceId, { at: Date.now(), text });
    return text;
  } catch (error) {
    console.warn("[goals] context unavailable", error instanceof Error ? error.message : error);
    return "";
  }
}
