// Campaigns worth running, found from what Mellox already knows: a season
// coming up, a product that hasn't had its moment, the brand's goal, an
// opportunity Autopilot found, the strategy's roadmap. No model call and no
// charge — a suggestion only prefills the brief; planning is a person's click.
// Pure: no I/O.
import { addDaysYmd } from "@/lib/autopilot/time";
import type { MarketingMoment } from "@/lib/studio/moments";
import type { CampaignSuggestion } from "./contracts";
import { playbookById } from "./playbooks";

export type SuggestInput = {
  today: string;
  moments: readonly MarketingMoment[];
  products: readonly { id: string; name: string; featured: boolean }[];
  /** workspace_goals.focus */
  goalFocus: string | null;
  opportunities: readonly { id: string; title: string; why: string }[];
  /** The confirmed strategy's roadmap phases. */
  roadmap: readonly { phase: string; focus: string }[];
  /** Campaigns the workspace already has (any status but ended). */
  existing: readonly { type: string; keyDate: string | null }[];
  channels: readonly string[];
};

const MOMENT_TYPE: [RegExp, string][] = [
  [/black friday|cyber monday|small business saturday/i, "sale"],
  [/earth day|women's day|giving tuesday/i, "awareness-day"],
  [/year in review|mid-year|q4 planning/i, "showcase"],
  [/.*/, "seasonal"],
];

const GOAL_TYPE: Record<string, string> = {
  leads: "lead-magnet",
  sales: "social-proof",
  launch: "product-launch",
  followers: "teach",
  reach: "memes",
  engagement: "memes",
};

function typeForMoment(name: string): string {
  return MOMENT_TYPE.find(([re]) => re.test(name))?.[1] ?? "seasonal";
}

export function suggestCampaigns(input: SuggestInput, limit = 6): CampaignSuggestion[] {
  const out: CampaignSuggestion[] = [];
  const tomorrow = addDaysYmd(input.today, 1);
  const channels = input.channels.length ? [...input.channels] : ["instagram"];
  const has = (type: string, keyDate: string | null) =>
    input.existing.some((c) => c.type === type && (keyDate === null || c.keyDate === keyDate));

  for (const moment of input.moments) {
    const type = typeForMoment(moment.name);
    if (has(type, moment.date)) continue;
    const startsOn = addDaysYmd(moment.date, -Math.max(7, Math.min(21, moment.leadDays)));
    out.push({
      id: `moment:${moment.id}`,
      type,
      title: `${moment.name} campaign`,
      why: moment.angle,
      source: "moment",
      brief: {
        type,
        name: moment.name,
        keyDate: moment.date,
        startsOn: startsOn < tomorrow ? tomorrow : startsOn,
        about: moment.angle,
        channels: channels as never,
      },
    });
  }

  const product = input.products.find((p) => !p.featured);
  if (product && !has("product-launch", null)) {
    out.push({
      id: `product:${product.id}`,
      type: "product-launch",
      title: `Launch ${product.name}`,
      why: "It hasn't had its own moment on your channels yet.",
      source: "product",
      brief: {
        type: "product-launch",
        name: `${product.name} launch`,
        productIds: [product.id],
        startsOn: tomorrow,
        keyDate: addDaysYmd(input.today, 14),
        channels: channels as never,
      },
    });
  }

  const goalType = input.goalFocus ? GOAL_TYPE[input.goalFocus] : undefined;
  if (goalType && !has(goalType, null) && playbookById(goalType)) {
    const playbook = playbookById(goalType)!;
    out.push({
      id: `goal:${input.goalFocus}`,
      type: goalType,
      title: playbook.label,
      why: "It works straight towards your goal.",
      source: "goal",
      brief: {
        type: goalType,
        name: playbook.label,
        startsOn: tomorrow,
        channels: channels as never,
      },
    });
  }

  for (const opportunity of input.opportunities.slice(0, 2)) {
    out.push({
      id: `opportunity:${opportunity.id}`,
      type: "showcase",
      title: opportunity.title.slice(0, 80),
      why: opportunity.why.slice(0, 160) || "Autopilot found this for you.",
      source: "opportunity",
      brief: {
        type: "showcase",
        name: opportunity.title.slice(0, 80),
        about: opportunity.why.slice(0, 600),
        startsOn: tomorrow,
        channels: channels as never,
      },
    });
  }

  const step = input.roadmap[0];
  if (step) {
    out.push({
      id: `strategy:${step.phase.slice(0, 40)}`,
      type: "teach",
      title: step.phase.slice(0, 80),
      why: step.focus.slice(0, 160),
      source: "strategy",
      brief: {
        type: "teach",
        name: step.phase.slice(0, 80),
        about: step.focus.slice(0, 600),
        startsOn: tomorrow,
        channels: channels as never,
      },
    });
  }

  for (const type of ["behind-scenes", "teach", "memes"]) {
    if (out.length >= limit) break;
    if (has(type, null) || out.some((s) => s.type === type)) continue;
    const playbook = playbookById(type)!;
    out.push({
      id: `evergreen:${type}`,
      type,
      title: playbook.label,
      why: playbook.line,
      source: "evergreen",
      brief: { type, name: playbook.label, startsOn: tomorrow, channels: channels as never },
    });
  }

  const seen = new Set<string>();
  return out.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true))).slice(0, limit);
}
