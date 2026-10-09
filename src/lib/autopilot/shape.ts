// The shape of a week before a word is written: what each post is for and
// which of the brand's themes it sits under. Decided here so a week is a mix
// by construction (never five posts of one kind), and so the same theme and
// the same aim don't lead two weeks running. The plan then fills in the idea.
// Pure: no I/O.
import { HOOK_STYLES } from "@/lib/studio/memory";
import { aimSequence, type ShareAimId } from "@/lib/studio/viral";
import type { CycleSlot } from "./policy";

export type SlotShape = {
  aim: ShareAimId;
  /** A content theme from the brand's strategy, when it has one. */
  pillar: string | null;
  /** How the piece opens (a HOOK_STYLES id): no two in a week open the same way. */
  hook: string;
};

/** Feed posts only: a Story follows its own theme, and an article is for search. */
function shaped(slot: CycleSlot): boolean {
  return slot.type !== "story" && slot.type !== "article";
}

export function shapeWeek(
  slots: readonly CycleSlot[],
  args: { goal: string; pillars: readonly string[]; cycle: number },
): Map<number, SlotShape> {
  const posts = [...slots].filter(shaped).sort((a, b) => a.at.localeCompare(b.at));
  const offset = Math.max(0, args.cycle - 1) * posts.length;
  const aims = aimSequence(args.goal, posts.length, offset);
  const pillars = args.pillars.map((p) => p.trim()).filter(Boolean);
  const out = new Map<number, SlotShape>();
  posts.forEach((slot, i) => {
    out.set(slot.index, {
      aim: aims[i].id,
      pillar: pillars.length ? pillars[(offset + i) % pillars.length] : null,
      hook: HOOK_STYLES[(offset + i) % HOOK_STYLES.length].id,
    });
  });
  return out;
}
