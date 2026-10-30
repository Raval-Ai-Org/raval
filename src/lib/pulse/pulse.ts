// The workspace pulse: what is happening right now across Autopilot,
// Campaigns, products and the goal, in one small read for the chat screen.
//
// Pure and browser-safe. The server (src/server/pulse/) reads rows that
// already exist with the caller's own client and hands them here; nothing is
// estimated, searched or paid for. The message box shows what waits for a
// person from it, and the ideas under the box are written from it.
import { FOCUS_LABELS, GOAL_FOCUSES, type GoalFocus } from "@/lib/goals/contracts";

export type PulseCampaign = {
  id: string;
  name: string;
  /** The phase it is in today, by its own plan. */
  phase: string | null;
  keyDate: string | null;
  /** Its posts that are made and wait for a person's OK. */
  waiting: number;
};

export type WorkspacePulse = {
  /** Every post that waits for a person, Autopilot's and campaigns' alike. */
  waiting: number;
  autopilot: { status: "running" | "paused" | null; waiting: number };
  campaigns: PulseCampaign[];
  /** Names of products the brand sells, in the team's own order. */
  products: string[];
  goal: { focus: GoalFocus; label: string } | null;
};

export const EMPTY_PULSE: WorkspacePulse = {
  waiting: 0,
  autopilot: { status: null, waiting: 0 },
  campaigns: [],
  products: [],
  goal: null,
};

export type PulseRows = {
  program: { status: string } | null;
  /** Content steps waiting for a person, with the campaign each belongs to. */
  waiting: { campaign_id: string | null }[];
  campaigns: { id: string; name: string; key_date: string | null; phase: string | null }[];
  products: { name: string }[];
  goal: { focus?: unknown } | null;
};

const MAX_PRODUCTS = 3;

export function buildPulse(rows: PulseRows): WorkspacePulse {
  const byCampaign = new Map<string, number>();
  let own = 0;
  for (const row of rows.waiting) {
    if (row.campaign_id)
      byCampaign.set(row.campaign_id, (byCampaign.get(row.campaign_id) ?? 0) + 1);
    else own++;
  }
  const campaigns = rows.campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    phase: c.phase,
    keyDate: c.key_date,
    waiting: byCampaign.get(c.id) ?? 0,
  }));
  const status =
    rows.program?.status === "running" || rows.program?.status === "paused"
      ? rows.program.status
      : null;
  // Steps left by a program that has ended wait for nobody.
  if (!status) own = 0;
  const focus = GOAL_FOCUSES.find((f) => f === rows.goal?.focus);
  const names = rows.products
    .map((p) => p.name.replace(/\s+/g, " ").trim())
    .filter((n) => n.length >= 2 && n.length <= 40);
  // A paused or finished campaign's pieces don't wait for anyone, so only the
  // campaigns listed here (running ones) count.
  const campaignWaiting = campaigns.reduce((n, c) => n + c.waiting, 0);
  return {
    waiting: own + campaignWaiting,
    autopilot: { status, waiting: own },
    campaigns,
    products: [...new Set(names)].slice(0, MAX_PRODUCTS),
    goal: focus ? { focus, label: FOCUS_LABELS[focus].label } : null,
  };
}

/** Where a click on "N to approve" should go: the one place that holds them all. */
export function waitingPlace(
  pulse: WorkspacePulse,
): { to: "autopilot" } | { to: "campaign"; id: string } | { to: "campaigns" } | null {
  if (!pulse.waiting) return null;
  const withWork = pulse.campaigns.filter((c) => c.waiting > 0);
  if (!pulse.autopilot.waiting && withWork.length === 1)
    return { to: "campaign", id: withWork[0].id };
  if (!pulse.autopilot.waiting) return { to: "campaigns" };
  // Autopilot's approvals list holds every waiting step, campaigns' included.
  return { to: "autopilot" };
}
