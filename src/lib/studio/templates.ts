// Studio templates: proven post structures per format. A template pre-fills
// the brief with fill-in-the-blank text, applies sensible settings, and — via
// `templateDirective` — tells the generator which structure to follow.
// Pure (no React, no server) so the prompt engine and the UI share it.
import type { StudioType } from "./formats";
import type { GoalId, StudioControls } from "./jobs";

export type ThumbLayout =
  "list" | "split" | "quote" | "steps" | "hero" | "story" | "question" | "compare";

export type StudioTemplate = {
  /** Globally unique, ≤ 40 chars — stored on jobs and content rows. */
  id: string;
  types: StudioType[];
  label: string;
  tagline: string;
  /** The structure, in order — shown to the user and sent to the model. */
  beats: string[];
  /** Brief starter with [bracketed] blanks to fill in. */
  starter: string;
  /** How the model should build it. */
  directive: string;
  goal?: GoalId;
  controls?: Partial<StudioControls>;
  thumb: ThumbLayout;
};

export const STUDIO_TEMPLATES: StudioTemplate[] = [
  /* ── Social post ── */
  {
    id: "social-hot-take",
    types: ["social"],
    label: "Hot take",
    tagline: "A bold opinion your audience will debate",
    beats: ["Bold claim", "Why", "Proof", "Question"],
    starter:
      "Share our honest take that [bold opinion] for [audience], backed by [proof or experience].",
    directive:
      "Open with a confident, specific opinion in the first line. Defend it with one clear reason and one concrete proof point. End with a genuine question that invites disagreement.",
    goal: "engagement",
    thumb: "quote",
  },
  {
    id: "social-behind-scenes",
    types: ["social"],
    label: "Behind the scenes",
    tagline: "Show how the work really gets done",
    beats: ["Moment", "What's happening", "Why it matters", "Invite"],
    starter:
      "Take people behind the scenes of [process or place] and show why [detail] makes our [product or service] better.",
    directive:
      "Write as an insider: one specific moment, a sensory detail, what most people never see, and why it matters to the customer. Warm and human, never corporate.",
    goal: "awareness",
    thumb: "story",
  },
  {
    id: "social-customer-story",
    types: ["social"],
    label: "Customer story",
    tagline: "Before, turning point, after",
    beats: ["Before", "Turning point", "After", "Takeaway"],
    starter:
      "Tell how [customer type] went from [problem] to [result] with [our product or service].",
    directive:
      "Tell a mini story: the customer's situation before, the moment things changed, the concrete result, and one takeaway for readers. Never invent names or figures that were not provided.",
    goal: "leads",
    thumb: "compare",
  },
  {
    id: "social-tips",
    types: ["social"],
    label: "Tips list",
    tagline: "Quick, saveable, genuinely useful",
    beats: ["Hook", "Tip", "Tip", "Tip", "Save it"],
    starter: "Share [number] practical tips to help [audience] [achieve outcome].",
    directive:
      "Promise a specific outcome in the hook, then give 3–5 short, actionable tips as a scannable list, each starting with a verb. End with a save-or-share call to action.",
    goal: "education",
    thumb: "list",
  },
  {
    id: "social-announcement",
    types: ["social"],
    label: "Announcement",
    tagline: "News people can act on",
    beats: ["News", "Benefit", "Who it's for", "Next step"],
    starter:
      "Announce [launch or news]. It helps [audience] [benefit] and is available [when or where].",
    directive:
      "Lead with the news itself, then the single most important benefit, who it's for, and exactly what to do next. Energetic but not hype.",
    goal: "launch",
    thumb: "hero",
  },
  {
    id: "social-ask-audience",
    types: ["social"],
    label: "Ask your audience",
    tagline: "A question that starts a conversation",
    beats: ["Relatable setup", "Question", "Options"],
    starter: "Ask our audience about [topic]: do they prefer [option A] or [option B]?",
    directive:
      "Set up a relatable situation in one or two lines, ask one clear question, and offer 2–3 answer options people can reply with.",
    goal: "engagement",
    thumb: "question",
  },

  /* ── Carousel ── */
  {
    id: "carousel-step-by-step",
    types: ["carousel"],
    label: "Step-by-step guide",
    tagline: "One step per slide, easy to follow",
    beats: ["Promise", "Step 1", "Step 2", "Step 3", "Recap"],
    starter: "A step-by-step guide to [outcome] for [audience], in [number] simple steps.",
    directive:
      "Slide 1 promises the outcome. One step per slide with a short imperative heading and a one-line how-to. The final slide recaps and asks people to save it.",
    goal: "education",
    controls: { slideCount: 6 },
    thumb: "steps",
  },
  {
    id: "carousel-myth-fact",
    types: ["carousel"],
    label: "Myth vs fact",
    tagline: "Correct what people get wrong",
    beats: ["Hook", "Myth", "Fact", "Myth", "Fact", "CTA"],
    starter: "Bust [number] common myths about [topic] that [audience] still believe.",
    directive:
      "Slide 1 hooks with the most surprising myth. Then alternate: state each myth plainly on one slide, and correct it with the fact and a concrete reason on the next. End with a call to action.",
    goal: "education",
    controls: { slideCount: 6 },
    thumb: "compare",
  },
  {
    id: "carousel-mistakes",
    types: ["carousel"],
    label: "Mistakes to avoid",
    tagline: "Each slide: a mistake and its fix",
    beats: ["Hook", "Mistake", "Fix", "Mistake", "Fix", "CTA"],
    starter: "The [number] mistakes [audience] make with [topic], and how to fix each one.",
    directive:
      "Each slide names one mistake as the heading and gives the fix in the body. Order from most common to most costly. End with a call to action.",
    goal: "education",
    controls: { slideCount: 7 },
    thumb: "list",
  },
  {
    id: "carousel-before-after",
    types: ["carousel"],
    label: "Before / after",
    tagline: "A transformation, and what caused it",
    beats: ["Hook", "Before", "What changed", "After", "CTA"],
    starter:
      "Show the before and after of [transformation] for [customer or project], and what made the difference.",
    directive:
      "Contrast a vivid before with a concrete after. The middle slides explain the 2–3 changes that caused it. Use specifics, not superlatives.",
    goal: "leads",
    controls: { slideCount: 5 },
    thumb: "split",
  },
  {
    id: "carousel-checklist",
    types: ["carousel"],
    label: "Checklist",
    tagline: "Something people save for later",
    beats: ["Hook", "Item", "Item", "Item", "Save it"],
    starter: "A checklist for [audience] before they [task].",
    directive:
      "Frame it as a checklist people will save: one checkable item per slide with a short reason why. The final slide says to save it for next time.",
    goal: "education",
    controls: { slideCount: 6 },
    thumb: "list",
  },

  /* ── Image post ── */
  {
    id: "image-product-hero",
    types: ["image"],
    label: "Product hero",
    tagline: "Your product, beautifully lit",
    beats: ["Product", "Setting", "Benefit"],
    starter: "A hero shot of [product] in [setting], highlighting [key benefit].",
    directive:
      "The visual centres the product as the clear hero with premium lighting and an uncluttered background that hints at the setting. Captions lead with the single most compelling benefit.",
    goal: "launch",
    thumb: "hero",
  },
  {
    id: "image-quote-card",
    types: ["image"],
    label: "Quote card",
    tagline: "A line worth sharing",
    beats: ["Quote", "Attribution", "Why it matters"],
    starter: "A quote card with [quote or insight] from [person or brand], for [audience].",
    directive:
      "Design the visual around short, legible quote text with generous negative space in brand colours. Captions add one line of context on why it matters.",
    goal: "awareness",
    thumb: "quote",
  },
  {
    id: "image-lifestyle",
    types: ["image"],
    label: "Lifestyle moment",
    tagline: "Real people, real use",
    beats: ["Person", "Moment", "Feeling"],
    starter: "A real-life moment of [customer type] using [product] while [situation].",
    directive:
      "Show a natural, candid moment of a person using the product in context: authentic, not staged. Captions describe the feeling and the moment, not the specs.",
    goal: "awareness",
    thumb: "story",
  },
  {
    id: "image-offer",
    types: ["image"],
    label: "Offer",
    tagline: "A promotion that reads at a glance",
    beats: ["Offer", "Deadline", "CTA"],
    starter: "Promote [offer] for [audience], ending [deadline].",
    directive:
      "The visual makes the offer instantly readable with bold hierarchy and space for a short headline. Captions state the offer, the deadline and one clear call to action.",
    goal: "offer",
    thumb: "hero",
  },

  /* ── Ad creative ── */
  {
    id: "ad-problem-solution",
    types: ["ad"],
    label: "Problem → solution",
    tagline: "Name the pain, show the fix",
    beats: ["Pain", "Solution", "Proof", "CTA"],
    starter: "Show how [product] solves [specific pain] for [audience].",
    directive:
      "Each variant opens on a sharply specific pain, positions the product as the fix, adds one proof point and ends with a direct call to action.",
    goal: "leads",
    thumb: "split",
  },
  {
    id: "ad-social-proof",
    types: ["ad"],
    label: "Social proof",
    tagline: "Let results do the selling",
    beats: ["Result", "Who says so", "CTA"],
    starter: "Use [review, rating or result] to show [audience] why [product] is trusted.",
    directive:
      "Lead with the proof (rating, review, customer count or result) exactly as provided; never invent figures. Then who it's for, and a call to action.",
    goal: "leads",
    thumb: "quote",
  },
  {
    id: "ad-limited-offer",
    types: ["ad"],
    label: "Limited offer",
    tagline: "An honest reason to act now",
    beats: ["Offer", "Urgency", "CTA"],
    starter: "Drive sign-ups for [offer] before [deadline].",
    directive:
      "State the offer plainly, give an honest reason to act now (deadline or limited stock), and one call to action. Vary the urgency angle across variants.",
    goal: "offer",
    thumb: "hero",
  },
  {
    id: "ad-feature-spotlight",
    types: ["ad"],
    label: "Feature spotlight",
    tagline: "One feature, one clear benefit",
    beats: ["Feature", "Benefit", "Example", "CTA"],
    starter: "Spotlight [feature] and how it helps [audience] [outcome].",
    directive:
      "Translate one feature into a customer benefit with a concrete example of it in use. Headlines stay benefit-first.",
    goal: "awareness",
    thumb: "steps",
  },

  /* ── Video post ── */
  {
    id: "video-product-reveal",
    types: ["video"],
    label: "Product reveal",
    tagline: "Build anticipation, then reveal",
    beats: ["Tease", "Reveal", "Hero shot"],
    starter: "A cinematic reveal of [product], ending on a hero shot with [setting or mood].",
    directive:
      "Plan shots that build anticipation with close details and partial views, then reveal the full product in a clean hero shot. Captions tease, then name the product.",
    goal: "launch",
    controls: { durationSec: 6 },
    thumb: "hero",
  },
  {
    id: "video-process",
    types: ["video"],
    label: "Process",
    tagline: "Satisfying, start to finish",
    beats: ["Raw material", "Craft", "Finished"],
    starter: "Show the process of making [product], from [start] to [finished result].",
    directive:
      "Plan a satisfying sequence from raw material through hands-on craft to the finished result, with smooth tactile motion. Captions highlight the care involved.",
    goal: "awareness",
    controls: { durationSec: 8 },
    thumb: "steps",
  },
  {
    id: "video-transformation",
    types: ["video"],
    label: "Transformation",
    tagline: "A striking before and after",
    beats: ["Before", "Change", "After"],
    starter: "A before-and-after transformation of [subject] using [product or service].",
    directive:
      "Clearly show the before state, a smooth transition, and a striking after state. Captions state the change in concrete terms.",
    goal: "leads",
    controls: { durationSec: 6 },
    thumb: "split",
  },
  {
    id: "video-mood-broll",
    types: ["video"],
    label: "Mood b-roll",
    tagline: "Atmosphere that feels like the brand",
    beats: ["Atmosphere", "Detail", "Brand moment"],
    starter: "Atmospheric b-roll of [place or scene] that captures [feeling] for our brand.",
    directive:
      "Plan slow, atmospheric shots with rich detail that evoke a mood rather than explain. Captions carry the message the visuals imply.",
    goal: "awareness",
    controls: { durationSec: 8 },
    thumb: "story",
  },

  /* ── Short-form script ── */
  {
    id: "script-hook-value-cta",
    types: ["script"],
    label: "Hook · value · CTA",
    tagline: "The classic that keeps people watching",
    beats: ["Hook", "Value", "Proof", "CTA"],
    starter:
      "A short video that teaches [audience] [one useful thing] and ends with [call to action].",
    directive:
      "Hook in under two seconds with a pattern-interrupt line, deliver one clear piece of value in 2–3 beats, show quick proof, and end with a single call to action.",
    goal: "education",
    thumb: "steps",
  },
  {
    id: "script-myth-reality",
    types: ["script"],
    label: "Myth vs reality",
    tagline: "Call out the myth, show the truth",
    beats: ["Myth", "Reality", "Demo", "CTA"],
    starter: "Bust the myth that [common belief] about [topic].",
    directive:
      "Open by stating the myth on screen, cut to the reality with a demonstration, explain briefly, and close with a call to action.",
    goal: "education",
    thumb: "compare",
  },
  {
    id: "script-pov",
    types: ["script"],
    label: "POV",
    tagline: "Relatable, quick, shareable",
    beats: ["POV setup", "Moment", "Twist", "CTA"],
    starter: "A POV video: you're [audience] when [relatable situation].",
    directive:
      "Write in POV format with a highly relatable situation, a quick escalation or twist that features the brand naturally, and a light call to action.",
    goal: "engagement",
    thumb: "story",
  },
  {
    id: "script-tutorial",
    types: ["script"],
    label: "30-second tutorial",
    tagline: "Result first, then three fast steps",
    beats: ["Result", "Step 1", "Step 2", "Step 3", "CTA"],
    starter: "A 30-second tutorial showing [audience] how to [task].",
    directive:
      "Show the end result first, then three fast steps with on-screen text for each, then a call to follow for more.",
    goal: "education",
    controls: { durationSec: 30 },
    thumb: "list",
  },

  /* ── Article ── */
  {
    id: "article-how-to",
    types: ["article"],
    label: "How-to guide",
    tagline: "From first step to finished",
    beats: ["Problem", "Steps", "Pitfalls", "Summary"],
    starter: "A practical guide to [task] for [audience], from first step to finished.",
    directive:
      "Frame the problem in the intro, use numbered H2 steps with specifics, add a section on common pitfalls, and close with a concise summary.",
    goal: "education",
    controls: { length: "standard" },
    thumb: "steps",
  },
  {
    id: "article-listicle",
    types: ["article"],
    label: "Listicle",
    tagline: "Numbered, skimmable, useful",
    beats: ["Promise", "Items", "Wrap-up"],
    starter: "[Number] things every [audience] should know about [topic].",
    directive:
      "Use one numbered H2 per item, each with a clear takeaway and an example. Order by usefulness and keep the intro and wrap-up short.",
    goal: "awareness",
    controls: { length: "standard" },
    thumb: "list",
  },
  {
    id: "article-comparison",
    types: ["article"],
    label: "Comparison",
    tagline: "A fair, clear recommendation",
    beats: ["Options", "Criteria", "Head-to-head", "Verdict"],
    starter: "Compare [option A] and [option B] for [audience] deciding on [decision].",
    directive:
      "Define the options, set 3–5 decision criteria, compare them head-to-head under each (use a table where useful), and end with a clear recommendation by use case. Be fair.",
    goal: "education",
    controls: { length: "long" },
    thumb: "compare",
  },
  {
    id: "article-thought-leadership",
    types: ["article"],
    label: "Thought leadership",
    tagline: "A point of view worth reading",
    beats: ["Belief", "Evidence", "Implications", "Call"],
    starter:
      "Argue that [point of view] about [industry trend], and what [audience] should do about it.",
    directive:
      "Lead with a distinctive point of view, support it with evidence and experience, explore what it means for the reader, and close with a call to action or reflection.",
    goal: "awareness",
    controls: { length: "standard" },
    thumb: "quote",
  },
];

/** A cross-format shortlist for the start screen. */
export const POPULAR_TEMPLATE_IDS = [
  "carousel-myth-fact",
  "social-behind-scenes",
  "image-product-hero",
  "script-hook-value-cta",
  "ad-problem-solution",
  "article-how-to",
];

export function templatesFor(type: StudioType): StudioTemplate[] {
  return STUDIO_TEMPLATES.filter((t) => t.types.includes(type));
}

export function getTemplate(id: string | null | undefined): StudioTemplate | null {
  return id ? (STUDIO_TEMPLATES.find((t) => t.id === id) ?? null) : null;
}

export function templateFits(id: string | null | undefined, type: StudioType): boolean {
  return !!getTemplate(id)?.types.includes(type);
}

/** The prompt section for a template, or null when there isn't one. */
export function templateDirective(id: string | null | undefined): string | null {
  const t = getTemplate(id);
  if (!t) return null;
  return `${t.label}. ${t.directive}\nFollow this structure in order: ${t.beats.join(" → ")}.`;
}

const BLANK = /\[[^\]\n]{1,60}\]/g;

/** Start and end of the first [blank], for selecting it in the brief. */
export function firstBlank(text: string): [number, number] | null {
  BLANK.lastIndex = 0;
  const m = BLANK.exec(text);
  return m ? [m.index, m.index + m[0].length] : null;
}

export function countBlanks(text: string): number {
  return text.match(BLANK)?.length ?? 0;
}

export function isTemplateStarter(text: string): boolean {
  const t = text.trim();
  return STUDIO_TEMPLATES.some((x) => x.starter === t);
}
