// The taste as words: a short prompt section for generators and the chips the
// Library shows. Pure; only learned values (contracts.ts thresholds) appear.

import { TRAIT_KINDS, type Taste, type TasteChip, type TasteSummary } from "./contracts";
import { KIND_LABEL, traitLabel } from "./labels";
import { lovesToLearn } from "./learn";

const MAX_CHIPS = 8;

export function tasteChips(taste: Taste): TasteChip[] {
  const out: TasteChip[] = [];
  for (const tone of ["liked", "avoided"] as const) {
    for (const kind of TRAIT_KINDS) {
      for (const value of taste.lean[kind]?.[tone] ?? []) {
        const label = traitLabel(kind, value);
        if (label) out.push({ kind, value, label, tone });
      }
    }
  }
  return out.slice(0, MAX_CHIPS);
}

export function tasteSummary(taste: Taste): TasteSummary {
  return {
    loves: taste.loves,
    lesses: taste.lesses,
    chips: tasteChips(taste),
    toLearn: lovesToLearn(taste),
  };
}

function lines(taste: Taste, tone: "liked" | "avoided"): string[] {
  const out: string[] = [];
  for (const kind of TRAIT_KINDS) {
    const values = (taste.lean[kind]?.[tone] ?? [])
      .map((v) => traitLabel(kind, v))
      .filter((v): v is string => !!v);
    if (values.length) out.push(`- ${KIND_LABEL[kind]}: ${values.join(", ")}`);
  }
  return out;
}

/**
 * "What this team loved": the section generators read. Empty until something
 * is learned. Loved captions go in as voice references through
 * `consistencySection` (memory.ts), not here.
 */
export function tasteBlock(taste: Taste | null | undefined): string {
  if (!taste) return "";
  const liked = lines(taste, "liked");
  const avoided = lines(taste, "avoided");
  if (!liked.length && !avoided.length) return "";
  const parts = ["What this brand's team loved in its Library (their own hearts on past posts):"];
  if (liked.length)
    parts.push(
      "They loved posts with:",
      ...liked,
      "Lean toward these when they fit the brief. Never copy a loved post's words or idea.",
    );
  if (avoided.length) parts.push("They asked for less of:", ...avoided, "Steer away from these.");
  return parts.join("\n");
}
