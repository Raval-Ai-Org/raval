// Detect actionable intents from a user prompt and produce inline chips
// that the chat surfaces so it can drive the Studio + AI Diagnostics panel.

import type { CanvasType } from "@/lib/studio";

export type ChatAction =
  | { kind: "audit"; label: string; hint: string }
  | { kind: "studio"; canvas: CanvasType; label: string; hint: string }
  | { kind: "memory"; label: string; hint: string }
  | { kind: "calendar"; label: string; hint: string };

const RE = {
  audit:
    /\b(audit|scan|ai\s*visibil|geo\b|aeo\b|llms?\.txt|robots\.txt|schema|structured\s*data|how\s*do\s*(ai|engines|chatgpt|gemini|perplexity)\s*see)/i,
  social: /\b(social\s*post|linkedin|instagram|tweet|x\s*post|tiktok|carousel|reel)\b/i,
  article: /\b(blog|article|long[-\s]?form|pillar\s*post)\b/i,
  landing: /\b(landing\s*page|hero\s*section|pricing\s*page|sales\s*page)\b/i,
  email: /\b(email|newsletter|drip|sequence|cold\s*email)\b/i,
  seo: /\b(seo\s*brief|keyword\s*research|content\s*brief|rank\s*for)\b/i,
  design: /\b(design|creative|banner|graphic|cover\s*image|thumbnail)\b/i,
  memory: /\b(brand\s*dna|memory|crawl\s*(my|the)\s*site|extract\s*(from|my)\s*website)\b/i,
  calendar: /\b(content\s*calendar|schedule|this\s*week|plan\s*(my|the)\s*week)\b/i,
};

export function detectChatActions(prompt: string): ChatAction[] {
  const out: ChatAction[] = [];
  const t = prompt;
  if (RE.audit.test(t))
    out.push({
      kind: "audit",
      label: "Run AI visibility audit",
      hint: "Scan your site for GEO + AEO issues",
    });
  if (RE.social.test(t))
    out.push({
      kind: "studio",
      canvas: "social-post",
      label: "Open Social Post studio",
      hint: "Draft LinkedIn / IG / X",
    });
  if (RE.article.test(t))
    out.push({
      kind: "studio",
      canvas: "article",
      label: "Open Article studio",
      hint: "Outline & draft long-form",
    });
  if (RE.landing.test(t))
    out.push({
      kind: "studio",
      canvas: "landing-page",
      label: "Open Landing Page studio",
      hint: "Hero · CTA · sections",
    });
  if (RE.email.test(t))
    out.push({
      kind: "studio",
      canvas: "email",
      label: "Open Email studio",
      hint: "Newsletter or drip",
    });
  if (RE.seo.test(t))
    out.push({
      kind: "studio",
      canvas: "seo-brief",
      label: "Open SEO Brief studio",
      hint: "AEO-ready outline",
    });
  if (RE.design.test(t))
    out.push({
      kind: "studio",
      canvas: "design-asset",
      label: "Open Design studio",
      hint: "Creative & brand kit",
    });
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

export function runChatAction(action: ChatAction): { toast?: string } {
  if (typeof window === "undefined") return {};
  switch (action.kind) {
    case "audit":
      window.dispatchEvent(new CustomEvent("geo:run-audit"));
      return { toast: "Running AI visibility audit…" };
    case "studio":
      window.dispatchEvent(new CustomEvent("open:canvas", { detail: { type: action.canvas } }));
      return { toast: `Opening ${action.label.replace(/^Open /, "")}` };
    case "memory":
      window.dispatchEvent(new CustomEvent("open:brand-dna"));
      return { toast: "Opening Memory" };
    case "calendar":
      window.dispatchEvent(new CustomEvent("open:analytics", { detail: { tab: "calendar" } }));
      return { toast: "Opening Content Calendar" };
  }
}
