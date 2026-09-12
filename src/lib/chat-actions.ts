// Detect actionable intents from a user prompt and produce inline chips
// that the chat surfaces so it can drive the Studio + AI Diagnostics panel.

import { emitAppEvent } from "@/lib/app-events";
import type { StudioType } from "@/lib/studio/formats";

export type ChatAction =
  | { kind: "audit"; label: string; hint: string }
  | { kind: "studio"; canvas: StudioType; label: string; hint: string }
  | { kind: "memory"; label: string; hint: string }
  | { kind: "calendar"; label: string; hint: string };

const RE = {
  audit:
    /\b(audit|scan|ai\s*visibil|geo\b|aeo\b|llms?\.txt|robots\.txt|schema|structured\s*data|how\s*do\s*(ai|engines|chatgpt|gemini|perplexity)\s*see)/i,
  carousel: /\b(carousel|swipe\s*post|slides?\s*post)\b/i,
  video: /\b(reels?|tiktok|shorts|video\s*script|short[-\s]?form\s*video)\b/i,
  social: /\b(social\s*post|linkedin|instagram|tweet|x\s*post|threads|facebook\s*post)\b/i,
  ad: /\b(ad\s*copy|ad\s*creative|facebook\s*ads?|meta\s*ads?|paid\s*social|advert)\b/i,
  article: /\b(blog|article|long[-\s]?form|pillar\s*post|seo\s*brief|content\s*brief)\b/i,
  design: /\b(design|creative|banner|graphic|cover\s*image|thumbnail|visual)\b/i,
  memory: /\b(brand\s*dna|memory|crawl\s*(my|the)\s*site|extract\s*(from|my)\s*website)\b/i,
  calendar: /\b(content\s*calendar|schedule|this\s*week|plan\s*(my|the)\s*week)\b/i,
};

const STUDIO_CHIPS: { re: RegExp; canvas: StudioType; label: string; hint: string }[] = [
  {
    re: RE.carousel,
    canvas: "carousel",
    label: "Create a carousel",
    hint: "Swipeable slides with a CTA",
  },
  {
    re: RE.video,
    canvas: "script",
    label: "Write a short-form script",
    hint: "Hook, beats, on-screen text",
  },
  {
    re: RE.social,
    canvas: "social",
    label: "Create a social post",
    hint: "A native version per platform",
  },
  { re: RE.ad, canvas: "ad", label: "Create an ad", hint: "Variants to test, sized to placement" },
  {
    re: RE.article,
    canvas: "article",
    label: "Write an article",
    hint: "Structured, readable long-form",
  },
  {
    re: RE.design,
    canvas: "image",
    label: "Create an image post",
    hint: "On-brand visual with captions",
  },
];

export function detectChatActions(prompt: string): ChatAction[] {
  const out: ChatAction[] = [];
  const t = prompt;
  if (RE.audit.test(t))
    out.push({
      kind: "audit",
      label: "Run AI visibility audit",
      hint: "Scan your site for GEO + AEO issues",
    });
  for (const chip of STUDIO_CHIPS) {
    if (chip.re.test(t))
      out.push({ kind: "studio", canvas: chip.canvas, label: chip.label, hint: chip.hint });
  }
  if (RE.memory.test(t))
    out.push({ kind: "memory", label: "Open Memory", hint: "Extract brand DNA from your site" });
  if (RE.calendar.test(t))
    out.push({
      kind: "calendar",
      label: "Open Content Calendar",
      hint: "Plan & schedule the week",
    });

  // Dedup by label, cap at 3 chips
  const seen = new Set<string>();
  return out.filter((a) => (seen.has(a.label) ? false : (seen.add(a.label), true))).slice(0, 3);
}

export function runChatAction(action: ChatAction, prompt?: string): { toast?: string } {
  if (typeof window === "undefined") return {};
  switch (action.kind) {
    case "audit":
      emitAppEvent("geo:run-audit");
      return { toast: "Running AI visibility audit…" };
    case "studio":
      emitAppEvent("open:canvas", { type: action.canvas, brief: prompt?.slice(0, 2000) });
      return { toast: "Opening Studio" };
    case "memory":
      emitAppEvent("open:brand-dna");
      return { toast: "Opening Memory" };
    case "calendar":
      emitAppEvent("open:analytics", { tab: "calendar" });
      return { toast: "Opening Content Calendar" };
  }
}
