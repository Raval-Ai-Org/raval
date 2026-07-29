// Deterministic suggestion/next-step engines.
// These used to be LLM calls, but the output is a pure function of a
// small set of workspace stats + brand keywords. No reasoning value was
// being added; the model was just picking from a rubric we can encode.

export type Intent =
  | "geo-audit" | "brand-dna" | "plan-week" | "schedule" | "review-drafts"
  | "seo-brief" | "share" | "ideate" | "social" | "email" | "blog";

export type SmartSuggestion = {
  label: string;
  hint: string;
  prompt: string;
  intent: Intent;
};

export type NextStepSuggestion = {
  label: string;
  prompt: string;
  agent?: "scout" | "spark" | "echo";
};

type Signals = {
  publishedLast7d: number;
  scheduledNext7d: number;
  pendingDrafts: number;
  hasBlog?: boolean;
  shares?: number;
  latestGeoScore?: number | null;
  insights?: string[];
};

/* ------------------------------------------------------------------ */
/* Brand-fact extraction (no AI)                                       */
/* ------------------------------------------------------------------ */

function grepLine(ctx: string | undefined | null, label: string): string {
  if (!ctx) return "";
  const rx = new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, "im");
  const m = ctx.match(rx);
  return m ? m[1].trim() : "";
}

export function extractBrandBits(ctx?: string | null) {
  return {
    brand: grepLine(ctx, "Brand") || grepLine(ctx, "Brand name") || "your brand",
    audience: grepLine(ctx, "Audience") || "your audience",
    offer: grepLine(ctx, "Products") || grepLine(ctx, "One-liner") || "your offer",
  };
}

/* ------------------------------------------------------------------ */
/* refreshSuggestions replacement (studio rail)                        */
/* ------------------------------------------------------------------ */

const ALL_SUGGESTIONS: Array<
  SmartSuggestion & { when: (s: Signals, hasBrand: boolean) => number }
> = [
  {
    label: "Set up Brand DNA",
    hint: "No brand context saved yet",
    prompt: "Help me set up my Brand DNA end-to-end",
    intent: "brand-dna",
    when: (_s, hasBrand) => (hasBrand ? 0 : 100),
  },
  {
    label: "Run AI Visibility scan",
    hint: "No visibility baseline yet",
    prompt: "Run a full AI visibility audit of my site",
    intent: "geo-audit",
    when: (s) => (s.latestGeoScore == null ? 90 : 5),
  },
  {
    label: "Re-scan visibility",
    hint: "Last score is aging — re-check GEO/AEO",
    prompt: "Re-run the AI visibility audit and highlight what changed",
    intent: "geo-audit",
    when: (s) => (s.latestGeoScore != null && s.latestGeoScore < 70 ? 80 : 20),
  },
  {
    label: "Review pending drafts",
    hint: (0 as unknown as string) as string, // placeholder, filled in build()
    prompt: "Show me pending drafts to approve",
    intent: "review-drafts",
    when: (s) => (s.pendingDrafts > 0 ? 85 : 0),
  },
  {
    label: "Plan this week",
    hint: "Nothing scheduled in the next 7 days",
    prompt: "Plan a marketing schedule for the next 7 days",
    intent: "plan-week",
    when: (s) => (s.scheduledNext7d === 0 ? 75 : 15),
  },
  {
    label: "Draft a LinkedIn post",
    hint: "Publish momentum — one post today",
    prompt: "Draft a LinkedIn post grounded in my brand DNA",
    intent: "social",
    when: (s) => (s.publishedLast7d < 2 ? 60 : 30),
  },
  {
    label: "Draft an email",
    hint: "Move an idea into the inbox",
    prompt: "Draft a short customer email grounded in my brand DNA",
    intent: "email",
    when: () => 40,
  },
  {
    label: "Outline a blog post",
    hint: "No long-form yet — build SEO surface",
    prompt: "Outline a blog post that ranks for a query my audience searches",
    intent: "blog",
    when: (s) => (s.hasBlog ? 20 : 55),
  },
  {
    label: "Ideate campaign angles",
    hint: "Get 5 concrete angles to test",
    prompt: "Give me 5 sharp campaign angles for this week grounded in my brand",
    intent: "ideate",
    when: () => 35,
  },
  {
    label: "Write an SEO brief",
    hint: "Turn a query into a ranking page",
    prompt: "Write an SEO brief for a query my audience is searching",
    intent: "seo-brief",
    when: (s) => (s.hasBlog ? 45 : 25),
  },
  {
    label: "Share progress with client",
    hint: "Package this week's wins into a share link",
    prompt: "Create a shareable client update with this week's work",
    intent: "share",
    when: (s) => ((s.publishedLast7d ?? 0) > 0 ? 50 : 10),
  },
];

export function buildSmartSuggestions(
  signals: Signals,
  brandContext?: string,
  max = 5,
): SmartSuggestion[] {
  const hasBrand = Boolean(brandContext && brandContext.trim().length > 20);
  const scored = ALL_SUGGESTIONS
    .map((s) => ({ s, score: s.when(signals, hasBrand) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const picked: SmartSuggestion[] = [];
  const seenIntents = new Set<Intent>();
  for (const { s } of scored) {
    if (seenIntents.has(s.intent) && picked.length > 2) continue;
    seenIntents.add(s.intent);
    let hint = s.hint;
    // Special-case dynamic hints.
    if (s.intent === "review-drafts") hint = `${signals.pendingDrafts} draft${signals.pendingDrafts === 1 ? "" : "s"} pending`;
    if (s.intent === "geo-audit" && signals.latestGeoScore != null) hint = `Current GEO score ${signals.latestGeoScore}/100`;
    picked.push({ label: s.label, hint: String(hint), prompt: s.prompt, intent: s.intent });
    if (picked.length >= max) break;
  }
  return picked;
}

/* ------------------------------------------------------------------ */
/* suggestNextSteps replacement (chat inline)                          */
/* ------------------------------------------------------------------ */

const NEXT_STEP_RULES: Array<{
  when: (
    stats: { pending: number; scheduled: number; published: number; recentTitles: string[] },
    lastMessage: string,
    hasBrand: boolean,
  ) => number;
  build: (bits: ReturnType<typeof extractBrandBits>) => NextStepSuggestion;
}> = [
  {
    when: (_st, _lm, hasBrand) => (hasBrand ? 0 : 100),
    build: () => ({ label: "Set up Brand DNA", prompt: "Help me set up my Brand DNA end-to-end", agent: "scout" }),
  },
  {
    when: (st) => (st.pending > 0 ? 90 : 0),
    build: () => ({ label: "Approve pending drafts", prompt: "Show pending drafts I need to approve", agent: "spark" }),
  },
  {
    when: (st) => (st.scheduled === 0 ? 70 : 15),
    build: () => ({ label: "Schedule this week", prompt: "Schedule content across LinkedIn, Instagram, and X for the next 7 days", agent: "echo" }),
  },
  {
    when: (st) => (st.published < 3 ? 60 : 25),
    build: (b) => ({
      label: "Draft LinkedIn post",
      prompt: `Draft a LinkedIn post for ${b.audience} about ${b.offer}`,
      agent: "spark",
    }),
  },
  {
    when: () => 40,
    build: (b) => ({
      label: "Outline a blog post",
      prompt: `Outline a blog post for ${b.audience} that ranks and reflects ${b.brand}'s voice`,
      agent: "scout",
    }),
  },
  {
    when: (_st, lm) => (/\b(competitor|vs|compare)\b/i.test(lm) ? 85 : 20),
    build: (b) => ({
      label: "Scan competitors",
      prompt: `Compare ${b.brand} to top competitors and list 3 openings`,
      agent: "scout",
    }),
  },
  {
    when: () => 30,
    build: (b) => ({
      label: "Draft a customer email",
      prompt: `Draft a short lifecycle email for ${b.audience} about ${b.offer}`,
      agent: "echo",
    }),
  },
];

export function buildNextSteps(
  stats: { pending: number; scheduled: number; published: number; recentTitles: string[] },
  brandContext?: string,
  lastUserMessage?: string,
): NextStepSuggestion[] {
  const bits = extractBrandBits(brandContext);
  const hasBrand = Boolean(brandContext && brandContext.trim().length > 20);
  const lm = lastUserMessage ?? "";
  const scored = NEXT_STEP_RULES
    .map((r) => ({ r, score: r.when(stats, lm, hasBrand) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const picked: NextStepSuggestion[] = [];
  const seenLabels = new Set<string>();
  for (const { r } of scored) {
    const s = r.build(bits);
    if (seenLabels.has(s.label)) continue;
    seenLabels.add(s.label);
    picked.push({
      label: s.label.slice(0, 40),
      prompt: s.prompt.slice(0, 600),
      agent: s.agent,
    });
    if (picked.length >= 4) break;
  }
  return picked;
}

/* ------------------------------------------------------------------ */
/* Agent-tasks (deterministic template)                                */
/* ------------------------------------------------------------------ */

export function buildAgentTasks(args: {
  agentName: string;
  agentRole: string;
  missions: Array<{ label: string; description: string }>;
  existing?: string[];
}): Array<{ title: string; note?: string; due?: string }> {
  const seen = new Set((args.existing ?? []).map((s) => s.toLowerCase().trim()));
  const soon = () => {
    const d = new Date(Date.now() + 24 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  };
  const week = () => {
    const d = new Date(Date.now() + 5 * 24 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  };
  const out: Array<{ title: string; note?: string; due?: string }> = [];
  const push = (title: string, note: string, due: string) => {
    if (seen.has(title.toLowerCase())) return;
    seen.add(title.toLowerCase());
    out.push({ title, note, due });
  };
  const first = args.missions[0]?.label ?? "primary mission";
  const second = args.missions[1]?.label ?? args.missions[0]?.label ?? first;

  push(`Kick off: ${first}`, `${args.agentName} owns the first-pass deliverable.`, soon());
  push(`Review last output`, `Check tone, facts, and links before publishing.`, soon());
  push(`Advance: ${second}`, `Move the second mission from 0 → first artifact.`, week());
  push(`Weekly recap`, `Summarize wins, gaps, and next 3 asks for the human operator.`, week());
  return out.slice(0, 4);
}
