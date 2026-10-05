// Brain — the one place a workspace's four brains and its strategy live
// (ADR-0032). This file is the pure half: what the brains are called, how
// "ready" each one is, how their news is merged, and what is still missing.
// Browser-safe; no data is invented here, only counted and ordered.

export const BRAINS = ["brand", "audience", "competitors", "market"] as const;
export type BrainId = (typeof BRAINS)[number];
export const BRAIN_SECTIONS = ["home", ...BRAINS, "strategy"] as const;
export type BrainSection = (typeof BRAIN_SECTIONS)[number];

export function isBrainSection(value: unknown): value is BrainSection {
  return typeof value === "string" && (BRAIN_SECTIONS as readonly string[]).includes(value);
}

/** Identity colours of the four brains (the Mellox Micro 5 glyph set). */
export const BRAIN_META: Record<
  BrainId | "strategy" | "home",
  { label: string; color: string; blurb: string }
> = {
  home: { label: "Brain", color: "hsl(var(--primary))", blurb: "Everything Mellox knows" },
  brand: { label: "Brand", color: "#B489D1", blurb: "Who you are" },
  audience: { label: "Audience", color: "#0756E7", blurb: "Who it's for" },
  competitors: { label: "Competitors", color: "#EE3445", blurb: "Who you're up against" },
  market: { label: "Market", color: "#FE7032", blurb: "What's moving" },
  strategy: { label: "Strategy", color: "hsl(var(--primary))", blurb: "The plan" },
};

export type BrainUpdate = {
  id: string;
  brain: BrainId | "strategy";
  title: string;
  detail?: string;
  /** ISO time the thing happened or was found. */
  at: string;
  /** The outside page this came from, when it came from the web. */
  url?: string;
};

export type BrainCard = {
  /** Has anything in it at all. */
  ready: boolean;
  /** 0..100: how much Mellox has to work with. */
  health: number;
  /** One short line: the freshest thing in this brain, or what to do first. */
  headline: string;
  updatedAt: string | null;
  /** Turned off for this workspace (flag): the tab is not shown. */
  enabled: boolean;
  /** A few real numbers for the card ("4 groups", "6 tracked"). */
  facts: string[];
};

export type BrainNeed = {
  id: string;
  brain: BrainId | "strategy";
  label: string;
  cta: string;
};

export type BrainOverview = {
  brains: Record<BrainId, BrainCard>;
  strategy: {
    status: "draft" | "confirmed" | null;
    stale: boolean;
    updatedAt: string | null;
    pillars: Array<{ title: string; share: number }>;
    headline: string;
  };
  updates: BrainUpdate[];
  needs: BrainNeed[];
  generatedAt: string;
};

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const filled = (v: unknown): boolean =>
  typeof v === "string" ? v.trim().length > 0 : Array.isArray(v) ? v.length > 0 : !!v;

/** How complete the Brand DNA is, from the fields generators actually lean on. */
export function brandHealth(dna: Record<string, unknown> | null | undefined): number {
  if (!dna) return 0;
  const look = (dna.look ?? {}) as Record<string, unknown>;
  const checks = [
    dna.brandName,
    dna.oneLiner,
    dna.about,
    dna.voice,
    dna.audience,
    dna.products,
    dna.positioning,
    dna.uniqueValueProp,
    dna.colors,
    dna.fonts,
    dna.logoUrl,
    dna.doRules,
    look.visual,
    look.writing,
  ];
  return clamp((checks.filter(filled).length / checks.length) * 100);
}

export function audienceHealth(input: { groups: number; measured: number }): number {
  if (!input.groups) return 0;
  // Groups are a start; real reactions from published posts are what make it solid.
  return clamp(40 + Math.min(input.groups, 3) * 10 + Math.min(input.measured, 3) * 10);
}

export function competitorsHealth(input: { tracked: number; profiled: number }): number {
  if (!input.tracked) return 0;
  const coverage = input.profiled / input.tracked;
  return clamp(30 + Math.min(input.tracked, 4) * 10 + coverage * 30);
}

export function marketHealth(input: { hasResult: boolean; ageDays: number | null }): number {
  if (!input.hasResult || input.ageDays == null) return 0;
  if (input.ageDays <= 2) return 100;
  if (input.ageDays <= 7) return 85;
  if (input.ageDays <= 21) return 60;
  return 35;
}

/** Newest first, one row per id, capped. Rows with no usable time are dropped. */
export function mergeUpdates(lists: BrainUpdate[][], limit = 30): BrainUpdate[] {
  const seen = new Set<string>();
  const out: BrainUpdate[] = [];
  for (const update of lists.flat()) {
    const time = Date.parse(update.at);
    if (!update.title.trim() || Number.isNaN(time) || seen.has(update.id)) continue;
    seen.add(update.id);
    out.push(update);
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
}

/** How many updates per brain are newer than the last time this person looked. */
export function newsSince(
  updates: BrainUpdate[],
  seenAt: number | null,
): Record<BrainId | "strategy", number> {
  const counts = { brand: 0, audience: 0, competitors: 0, market: 0, strategy: 0 };
  for (const u of updates) {
    if (seenAt == null || Date.parse(u.at) > seenAt) counts[u.brain] += 1;
  }
  return counts;
}

/** What is still missing, in the order worth fixing. */
export function readiness(input: {
  hasWebsite: boolean;
  brandHealth: number;
  lookSet: boolean;
  audienceEnabled: boolean;
  groups: number;
  tracked: number;
  suggested: number;
  marketFresh: boolean;
  strategy: "draft" | "confirmed" | null;
  strategyStale: boolean;
}): BrainNeed[] {
  const needs: BrainNeed[] = [];
  if (input.brandHealth < 40) {
    needs.push({
      id: "brand",
      brain: "brand",
      label: input.hasWebsite ? "Finish your Brand DNA" : "Add your website to build Brand DNA",
      cta: "Open",
    });
  } else if (!input.lookSet) {
    needs.push({ id: "look", brain: "brand", label: "Choose your look and voice", cta: "Choose" });
  }
  if (input.audienceEnabled && !input.groups) {
    needs.push({
      id: "audience",
      brain: "audience",
      label: "Build your audience groups",
      cta: "Build",
    });
  }
  if (!input.tracked) {
    needs.push({
      id: "competitors",
      brain: "competitors",
      label: input.suggested
        ? `Pick who to track (${input.suggested} suggested)`
        : "Find your competitors",
      cta: input.suggested ? "Pick" : "Find",
    });
  }
  if (!input.marketFresh) {
    needs.push({
      id: "market",
      brain: "market",
      label: "Check what's moving in your market",
      cta: "Check",
    });
  }
  if (input.brandHealth >= 40) {
    if (!input.strategy) {
      needs.push({
        id: "strategy",
        brain: "strategy",
        label: "Get your marketing strategy",
        cta: "Create",
      });
    } else if (input.strategy === "draft") {
      needs.push({
        id: "strategy",
        brain: "strategy",
        label: "Review and confirm your strategy",
        cta: "Review",
      });
    } else if (input.strategyStale) {
      needs.push({
        id: "strategy",
        brain: "strategy",
        label: "Your brains changed — refresh the strategy",
        cta: "Open",
      });
    }
  }
  return needs;
}

/** "3h ago" — short and stable, for update rows. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const diff = now - Date.parse(iso);
  if (Number.isNaN(diff)) return "";
  const mins = Math.max(0, Math.round(diff / 60_000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  return `${Math.round(days / 30)}mo`;
}
