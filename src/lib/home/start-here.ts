// Home's "Start here" card and the top bar's "Mox knows your brand" count
// (Mellox 2.0, Holo's checklist). Pure: it only reads facts the app already
// has for free (Brain overview, the workspace pulse, the saved look), never
// starts anything, and never estimates.

export type StartHereId = "brand" | "products" | "look" | "goal";

export type StartHereStep = {
  id: StartHereId;
  label: string;
  /** One short line under the label. */
  hint: string;
  done: boolean;
};

export type StartHereFacts = {
  /** Brand DNA completeness, 0..100 (`brains.brand.health`). */
  brandHealth: number | null;
  /** Products in the catalogue (`pulse.products`). */
  products: number | null;
  /** A look was saved in Inspo (`dna.look` has anything in it). */
  hasLook: boolean;
  /** The team set a goal (`pulse.goal`). */
  hasGoal: boolean;
};

/** Brand DNA counts as set up from this health on (Brain's own "needs" line). */
export const BRAND_READY = 40;

export function startHere(facts: StartHereFacts): {
  steps: StartHereStep[];
  done: number;
  total: number;
  /** Every step is done: the card can step aside. */
  complete: boolean;
  /** The first step still open, for "Continue". */
  next: StartHereStep | null;
} {
  const steps: StartHereStep[] = [
    {
      id: "brand",
      label: "Brand",
      hint: "Who you are",
      done: (facts.brandHealth ?? 0) >= BRAND_READY,
    },
    {
      id: "products",
      label: "Products",
      hint: "What you sell",
      done: (facts.products ?? 0) > 0,
    },
    { id: "look", label: "Look", hint: "Your style", done: facts.hasLook },
    { id: "goal", label: "Goal", hint: "What you want", done: facts.hasGoal },
  ];
  const done = steps.filter((s) => s.done).length;
  return {
    steps,
    done,
    total: steps.length,
    complete: done === steps.length,
    next: steps.find((s) => !s.done) ?? null,
  };
}

/** A saved look has at least one non-empty part. */
export function hasSavedLook(look: unknown): boolean {
  if (!look || typeof look !== "object") return false;
  return Object.values(look as Record<string, unknown>).some((v) =>
    v && typeof v === "object" ? Object.keys(v as object).length > 0 : Boolean(v),
  );
}
