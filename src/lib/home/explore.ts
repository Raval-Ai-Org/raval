// Home's lower sections (Mellox 2.0, ADR-0044): what the brand's brains hold,
// what is happening right now, and questions to ask Mox. Pure and
// browser-safe: everything is read from rows that already exist (the free
// Brain overview and workspace pulse). Nothing here is estimated; a section
// with nothing real to show says what it is for instead.

import type { BrainId, BrainOverview } from "@/lib/brain/brain";
import type { WorkspacePulse } from "@/lib/pulse/pulse";

export type BrainTileId = BrainId | "strategy";

export type BrainTile = {
  id: BrainTileId;
  label: string;
  /** The freshest real line, or what this brain is for. */
  line: string;
  /** A few real numbers ("4 groups"); empty until the overview arrives. */
  facts: string[];
  /** 0..1, or null when unknown (no bar is drawn). */
  health: number | null;
  ready: boolean;
};

const BRAIN_COPY: Record<BrainTileId, { label: string; line: string }> = {
  brand: { label: "Brand DNA", line: "Your voice, look and products" },
  audience: { label: "Audience", line: "The groups you sell to" },
  competitors: { label: "Competitors", line: "What rivals post and change" },
  market: { label: "Market", line: "News and trends in your space" },
  strategy: { label: "Strategy", line: "Your plan, pillars and pace" },
};

const ORDER: BrainTileId[] = ["brand", "audience", "competitors", "market", "strategy"];

/** One tile per brain that is switched on, in the sidebar's order. */
export function brainTiles(overview: BrainOverview | null | undefined): BrainTile[] {
  return ORDER.flatMap((id): BrainTile[] => {
    const copy = BRAIN_COPY[id];
    if (!overview) return [{ id, ...copy, facts: [], health: null, ready: false }];
    if (id === "strategy") {
      const s = overview.strategy;
      const line =
        s.status === "confirmed"
          ? s.headline || "Confirmed"
          : s.status === "draft"
            ? "A draft waits for your OK"
            : copy.line;
      return [
        {
          id,
          label: copy.label,
          line,
          facts: s.pillars.slice(0, 3).map((p) => p.title),
          health: null,
          ready: s.status === "confirmed",
        },
      ];
    }
    const card = overview.brains[id];
    if (!card || !card.enabled) return [];
    return [
      {
        id,
        label: copy.label,
        line: card.headline || copy.line,
        facts: card.facts.slice(0, 3),
        health: Math.max(0, Math.min(1, card.health / 100)),
        ready: card.ready,
      },
    ];
  });
}

export type RightNowItem =
  | { id: "waiting"; label: string; count: number }
  | { id: `campaign:${string}`; label: string; detail: string | null; campaignId: string }
  | { id: "goal"; label: string };

/** What is happening now, only from the pulse's own rows. Empty when unknown. */
export function rightNow(pulse: WorkspacePulse | null | undefined): RightNowItem[] {
  if (!pulse) return [];
  const items: RightNowItem[] = [];
  if (pulse.waiting > 0) {
    items.push({
      id: "waiting",
      count: pulse.waiting,
      label: `${pulse.waiting} ${pulse.waiting === 1 ? "post waits" : "posts wait"} for you`,
    });
  }
  for (const c of pulse.campaigns.slice(0, 2)) {
    items.push({ id: `campaign:${c.id}`, campaignId: c.id, label: c.name, detail: c.phase });
  }
  if (pulse.goal) items.push({ id: "goal", label: `Goal: ${pulse.goal.label}` });
  return items;
}

const FALLBACK_ASKS = [
  "Plan my posts for next week",
  "What are my competitors posting?",
  "Give me 5 post ideas for this week",
  "What is working on my social accounts?",
  "Write a launch post for my next offer",
];

export const MAX_ASKS = 4;

/**
 * Questions to put in the message box (never sent by themselves). The brand's
 * own product, campaign and goal lead, then everyday asks fill the rest.
 */
export function askPrompts(pulse: WorkspacePulse | null | undefined): string[] {
  const own: string[] = [];
  const product = pulse?.products[0]?.trim();
  if (product) own.push(`Write 3 hooks for ${product}`);
  const campaign = pulse?.campaigns[0]?.name.trim();
  if (campaign) own.push(`What should I post next for ${campaign}?`);
  const goal = pulse?.goal?.label.trim();
  if (goal) own.push(`Plan a week of posts for my goal: ${goal.toLowerCase()}`);
  const seen = new Set<string>();
  return [...own, ...FALLBACK_ASKS]
    .filter((q) => {
      const key = q.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_ASKS);
}

export type HomeNeed = { id: string; brain: BrainTileId; label: string };
export type HomeUpdate = { id: string; brain: BrainTileId; title: string; when: string };

/** What is left to finish, straight from Brain's own list (never invented). */
export function homeNeeds(overview: BrainOverview | null | undefined, max = 4): HomeNeed[] {
  if (!overview) return [];
  return overview.needs.slice(0, max).map((n) => ({ id: n.id, brain: n.brain, label: n.label }));
}

/** "now", "5m", "3h", "2d", or a short date past a week. Unknown → "". */
export function timeAgo(at: string, now: Date = new Date()): string {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now.getTime() - t) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d ago`;
  return new Date(t).toLocaleDateString("en", { month: "short", day: "numeric" });
}

/** The newest things the brains found, newest first. */
export function latestUpdates(
  overview: BrainOverview | null | undefined,
  max = 3,
  now: Date = new Date(),
): HomeUpdate[] {
  if (!overview) return [];
  return [...overview.updates]
    .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))
    .slice(0, max)
    .map((u) => ({ id: u.id, brain: u.brain, title: u.title, when: timeAgo(u.at, now) }));
}
