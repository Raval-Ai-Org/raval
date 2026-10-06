// block.ts — memory as a generator reads it: one short, stable block. Rules
// come first and are the last thing cut when space is tight.
import type { Memory, MemoryKind, MemoryTopic } from "./contracts";
import { isExpired, shortId } from "./normalize";

/** Who is reading: chat sees everything; a picture doesn't need writing rules. */
export type MemorySurface = "chat" | "text" | "image" | "video";

const TOPICS: Record<MemorySurface, readonly MemoryTopic[] | null> = {
  chat: null,
  text: null,
  image: ["visual", "other"],
  video: ["visual", "other"],
};

const BUDGET: Record<MemorySurface, number> = {
  chat: 2600,
  text: 1800,
  image: 700,
  video: 700,
};

const KIND_ORDER: Record<MemoryKind, number> = { rule: 0, preference: 1, fact: 2, context: 3 };

export const MEMORY_HEADING = "## Brand memory (your team told Mellox this. Follow it.)";

export type MemoryBlockOptions = {
  surface: MemorySurface;
  now: Date;
  maxChars?: number;
  /** Chat only: show each memory's handle so the model can update or remove it. */
  withIds?: boolean;
};

/** What a surface should read, most important first. */
export function memoriesFor(
  memories: readonly Memory[],
  surface: MemorySurface,
  now: Date,
): Memory[] {
  const topics = TOPICS[surface];
  return memories
    .filter((m) => !isExpired(m.expiresAt, now))
    .filter((m) => !topics || topics.includes(m.topic))
    .slice()
    .sort(
      (a, b) =>
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        // A picture reads its own rules before the general ones.
        (surface === "image" || surface === "video"
          ? Number(b.topic === "visual") - Number(a.topic === "visual")
          : 0) ||
        b.createdAt.localeCompare(a.createdAt) ||
        a.id.localeCompare(b.id),
    );
}

/** "" when there is nothing to say. */
export function memoryBlock(memories: readonly Memory[], opts: MemoryBlockOptions): string {
  const list = memoriesFor(memories, opts.surface, opts.now);
  if (!list.length) return "";
  const budget = opts.maxChars ?? BUDGET[opts.surface];
  const line = (m: Memory) => `- ${opts.withIds ? `[${shortId(m.id)}] ` : ""}${m.body}`;

  const always: string[] = [];
  const forNow: string[] = [];
  let used = MEMORY_HEADING.length;
  for (const m of list) {
    const text = line(m);
    if (used + text.length + 1 > budget) continue;
    used += text.length + 1;
    (m.expiresAt ? forNow : always).push(text);
  }
  if (!always.length && !forNow.length) return "";
  return [
    MEMORY_HEADING,
    ...always,
    ...(forNow.length ? ["For now (temporary, it ends by itself):", ...forNow] : []),
  ].join("\n");
}
