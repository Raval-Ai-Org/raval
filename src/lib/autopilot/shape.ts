// The shape of a week before a word is written: what each post is for and
// which of the brand's themes it sits under. Decided here so a week is a mix
// by construction (never five posts of one kind), and so the same theme and
// the same aim don't lead two weeks running. The plan then fills in the idea.
// Pure: no I/O.
import { HOOK_STYLES } from "@/lib/studio/memory";
import { aimSequence, type ShareAimId } from "@/lib/studio/viral";
import type { CycleSlot } from "./policy";

/** Where the reader is in getting to know the brand (the strategy's stages). */
export type FunnelStage = "attract" | "convince" | "convert" | "keep";

export type SlotShape = {
  aim: ShareAimId;
  /** A content theme from the brand's strategy, when it has one. */
  pillar: string | null;
  /** How the piece opens (a HOOK_STYLES id): no two in a week open the same way. */
  hook: string;
  /** The funnel stage this piece serves, from its aim. */
  stage?: FunnelStage;
  /** What the confirmed strategy says at that stage, when it says something. */
  stageMessage?: string;
};

/**
 * What an aim does for a stranger: being recognised or passed on gets the
 * brand noticed, being kept or answered builds trust, one clear step converts.
 */
export const AIM_STAGE: Record<ShareAimId, FunnelStage> = {
  relate: "attract",
  send: "attract",
  save: "convince",
  reply: "convince",
  act: "convert",
};

export type PillarInput = string | { title: string; share?: number };

/**
 * Themes in proportion to their share of posts (smooth weighted round robin):
 * a 50/30/20 strategy gets that mix over the weeks, and a theme never repeats
 * while another is owed. Equal turns when no share is given.
 */
export function pillarSequence(
  pillars: readonly PillarInput[],
  count: number,
  offset = 0,
): string[] {
  const items = pillars
    .map((p) =>
      typeof p === "string"
        ? { title: p.trim(), share: 0 }
        : { title: p.title.trim(), share: p.share ?? 0 },
    )
    .filter((p) => p.title);
  if (!items.length) return [];
  const anyShare = items.some((p) => p.share > 0);
  const weights = items.map((p) => (anyShare ? Math.max(p.share, 1) : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const current = weights.map(() => 0);
  const out: string[] = [];
  for (let i = 0; i < offset + count; i++) {
    weights.forEach((w, k) => (current[k] += w));
    let best = 0;
    for (let k = 1; k < current.length; k++) if (current[k] > current[best]) best = k;
    current[best] -= total;
    if (i >= offset) out.push(items[best].title);
  }
  return out;
}

/** Feed posts only: a Story follows its own theme, and an article is for search. */
function shaped(slot: CycleSlot): boolean {
  return slot.type !== "story" && slot.type !== "article";
}

export function shapeWeek(
  slots: readonly CycleSlot[],
  args: {
    goal: string;
    pillars: readonly PillarInput[];
    cycle: number;
    /** The confirmed strategy's message per stage. */
    messages?: Partial<Record<FunnelStage, string>>;
  },
): Map<number, SlotShape> {
  const posts = [...slots].filter(shaped).sort((a, b) => a.at.localeCompare(b.at));
  const offset = Math.max(0, args.cycle - 1) * posts.length;
  const aims = aimSequence(args.goal, posts.length, offset);
  const pillars = pillarSequence(args.pillars, posts.length, offset);
  const out = new Map<number, SlotShape>();
  posts.forEach((slot, i) => {
    const stage = AIM_STAGE[aims[i].id];
    const message = args.messages?.[stage]?.trim();
    out.set(slot.index, {
      aim: aims[i].id,
      pillar: pillars[i] ?? null,
      hook: HOOK_STYLES[(offset + i) % HOOK_STYLES.length].id,
      stage,
      ...(message ? { stageMessage: message } : {}),
    });
  });
  return out;
}
