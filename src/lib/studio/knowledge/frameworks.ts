// Persuasion frameworks and awareness stages, chosen per piece by code.
//
// A framework is a shape for the argument, never a script: one is picked for
// what the piece must do (the goal, the ad objective, the kind of post) and
// where the reader stands (their awareness), and the writer follows its steps
// in its own words. No framework is forced on a meme or a relatable post.
// Distilled from the Round 5 research (docs/studio/marketing-knowledge.md).
// Pure and browser-safe. Ids may be stored: add, never rename.

export type FrameworkId =
  | "aida"
  | "pas"
  | "bab"
  | "pastor"
  | "fab"
  | "four-ps"
  | "acca"
  | "scqa"
  | "story-brand"
  | "star"
  | "hook-story-offer"
  | "sir";

export type Framework = { id: FrameworkId; name: string; steps: string; useWhen: string };

export const FRAMEWORKS: readonly Framework[] = [
  {
    id: "aida",
    name: "AIDA",
    steps:
      "Attention (a specific hook) → Interest (why it matters to them) → Desire (the benefit felt, with proof) → Action (one step).",
    useWhen: "a general offer to a warm reader",
  },
  {
    id: "pas",
    name: "PAS",
    steps:
      "Problem (in their words) → Agitate (what it costs them, honestly) → Solution (the product as the way out).",
    useWhen: "a pain the reader already feels; leads and direct response",
  },
  {
    id: "bab",
    name: "Before–After–Bridge",
    steps:
      "Before (their situation now) → After (life with it solved) → Bridge (how the product gets them there).",
    useWhen: "a transformation; before/after and launches",
  },
  {
    id: "pastor",
    name: "PASTOR",
    steps:
      "Problem → Amplify → Story (a real moment) → Transformation or testimony (only real) → Offer → Response.",
    useWhen: "longer sales copy, a carousel or a video that sells",
  },
  {
    id: "fab",
    name: "FAB",
    steps:
      "Feature (what it is) → Advantage (what it does) → Benefit (what that means for them: 'which means…').",
    useWhen: "a product showcase or a product description",
  },
  {
    id: "four-ps",
    name: "4Ps",
    steps:
      "Picture (the outcome) → Promise (what it does) → Proof (why believe it) → Push (one action now).",
    useWhen: "a promotion or a sale with a real deadline",
  },
  {
    id: "acca",
    name: "ACCA",
    steps:
      "Awareness (name the situation) → Comprehension (explain simply) → Conviction (proof) → Action.",
    useWhen: "teaching that leads to a sale; educational carousels",
  },
  {
    id: "scqa",
    name: "SCQA",
    steps: "Situation → Complication → Question → Answer.",
    useWhen: "B2B and professional audiences; insight posts",
  },
  {
    id: "story-brand",
    name: "Customer as hero",
    steps:
      "The customer wants something → meets a problem → the brand is the guide with a plan → the plan works → what they avoided.",
    useWhen: "brand stories, founder stories and testimonials",
  },
  {
    id: "star",
    name: "STAR",
    steps: "Situation → Task or obstacle → Action → Result (only a real result).",
    useWhen: "case studies and proof posts",
  },
  {
    id: "hook-story-offer",
    name: "Hook–Story–Offer",
    steps: "Hook (stop the scroll) → Story (one real moment) → Offer (what to do next).",
    useWhen: "short video ads and creator videos",
  },
  {
    id: "sir",
    name: "State–Illustrate–Relate",
    steps:
      "State the point → Illustrate it with one concrete example → Relate it to the reader's own situation.",
    useWhen: "tips, myths and how-to posts",
  },
];

export function frameworkById(id: unknown): Framework | null {
  return FRAMEWORKS.find((f) => f.id === id) ?? null;
}

/** Schwartz's awareness stages: what to say depends on what the reader already knows. */
export type AwarenessId = "unaware" | "problem" | "solution" | "product" | "most";

export const AWARENESS: Record<AwarenessId, { label: string; say: string }> = {
  unaware: {
    label: "Unaware",
    say: "Lead with a story, an identity or a surprising observation about their world; don't mention the product until they care.",
  },
  problem: {
    label: "Problem aware",
    say: "Name the problem in their words and promise a way out; the product comes after they feel understood.",
  },
  solution: {
    label: "Solution aware",
    say: "Show why this way of solving it is better: the mechanism, the difference, the proof.",
  },
  product: {
    label: "Product aware",
    say: "Remove the last doubt: proof, the answer to the main objection, a guarantee only if real.",
  },
  most: { label: "Most aware", say: "Lead with the offer and the action; keep it short." },
};

/** Where the reader most likely stands, from what the piece is for. */
export function awarenessFor(args: {
  goal?: string | null;
  adObjective?: string | null;
  category?: string | null;
  stage?: string | null;
}): AwarenessId {
  if (args.stage === "attract") return "unaware";
  if (args.stage === "convince") return "solution";
  if (args.stage === "convert") return "product";
  if (args.stage === "keep") return "most";
  if (args.adObjective === "retarget") return "product";
  if (args.adObjective === "sales" || args.category === "sale" || args.goal === "offer")
    return "most";
  if (args.adObjective === "leads" || args.adObjective === "app" || args.goal === "leads")
    return "problem";
  if (args.adObjective === "awareness" || args.goal === "awareness") return "unaware";
  if (args.category === "proof" || args.category === "before-after") return "product";
  if (args.goal === "education" || args.category === "tips" || args.category === "myth")
    return "problem";
  if (args.goal === "launch" || args.category === "launch" || args.category === "product")
    return "solution";
  return "problem";
}

/** Kinds where an argument shape would kill the piece. */
const NO_FRAMEWORK = new Set(["meme", "relatable", "trend", "aesthetic", "quote", "this-or-that"]);

/** The one framework for this piece, or null when the piece is not an argument. */
export function pickFramework(args: {
  goal?: string | null;
  adObjective?: string | null;
  category?: string | null;
  format?: string | null;
}): Framework | null {
  const { category, adObjective, goal, format } = args;
  if (category && NO_FRAMEWORK.has(category)) return null;
  const id: FrameworkId =
    category === "proof"
      ? "star"
      : category === "before-after"
        ? "bab"
        : category === "storytime" || category === "behind-scenes"
          ? "story-brand"
          : category === "product"
            ? "fab"
            : category === "tips" || category === "myth" || category === "list"
              ? format === "carousel"
                ? "acca"
                : "sir"
              : adObjective === "leads" || adObjective === "app" || goal === "leads"
                ? "pas"
                : adObjective === "retarget"
                  ? "pastor"
                  : category === "sale" || goal === "offer" || adObjective === "sales"
                    ? format === "carousel" || format === "video"
                      ? "pastor"
                      : "four-ps"
                    : category === "launch" || goal === "launch"
                      ? "bab"
                      : format === "video" || format === "script"
                        ? "hook-story-offer"
                        : "aida";
  return frameworkById(id);
}

/**
 * What every selling piece must make clear in the first glance. Read by the
 * sale, ad and offer writers and checked in the picture review.
 */
export const SALES_CLARITY =
  "A selling piece answers five things at a glance: who it is for, what is offered (exactly as the brand gave it), why it matters to them, why now (only a true reason), and the one action to take. Never invent a discount, a deadline, a guarantee, a testimonial, a result or a feature.";

/** What a funnel step is for and what proves it worked: engagement is not revenue. */
export const FUNNEL_JOBS: Record<string, string> = {
  awareness: "Be remembered: reach and replays count; no hard sell.",
  engagement: "Start a conversation: saves, sends and comments count.",
  traffic: "Earn the click: one clear reason to visit and where it goes.",
  leads:
    "Earn a contact: a valuable, specific next step (a trial, a check, a guide) with low effort.",
  registrations: "Earn a sign-up: what they get, when, and how little it takes.",
  sales: "Earn the purchase: the offer, the proof and the action.",
  retention: "Earn the return: help existing customers get more from it.",
};
