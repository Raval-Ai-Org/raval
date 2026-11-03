// Campaigns (ADR-0039): planned runs of posts around a launch, an event, a
// season or a sale. Read only: planning, starting and ending a campaign stay
// a person's click in the app.
import "server-only";
import { z } from "zod";
import type { CampaignView, CampaignsHome } from "@/lib/campaigns/contracts";
import { playbookById } from "@/lib/campaigns/playbooks";
import { currentPhase } from "@/lib/campaigns/progress";
import { callFn } from "../bridge.server";
import { uuid, type McpTool } from "../tool";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function summary(c: CampaignView) {
  const phase = currentPhase(c.plan.phases, today());
  return {
    campaignId: c.id,
    name: c.name,
    kind: playbookById(c.type)?.label ?? c.type,
    status: c.status,
    startsOn: c.startsOn,
    endsOn: c.endsOn,
    keyDate: c.keyDate,
    currentPhase: c.status === "running" || c.status === "paused" ? (phase?.label ?? null) : null,
    goal: {
      kind: c.goal.kind,
      target: c.goal.target,
      // The person's own number; Mellox never estimates it.
      yourCount: c.goal.count,
      link: c.goal.link,
    },
    progress: c.progress,
  };
}

export const campaignTools: McpTool[] = [
  {
    name: "list_campaigns",
    title: "Campaigns",
    description:
      "The brand's campaigns (launches, events, seasons, sales and more): status, dates, the step each running one is on, its goal with the team's own count, and how many posts went out or wait for approval. Also ideas for campaigns worth running.",
    input: { status: z.enum(["all", "running", "draft", "done"]).optional() },
    scope: "workspace",
    minRole: "viewer",
    write: false,
    run: async ({ workspaceId, status }, { caller }) => {
      const home = await callFn<CampaignsHome>(caller, "campaigns", "getCampaignsHome", {
        workspaceId,
      });
      const want = (s: string) =>
        !status || status === "all"
          ? true
          : status === "running"
            ? s === "running" || s === "paused"
            : status === "draft"
              ? s === "draft" || s === "ready"
              : s === "done" || s === "ended";
      return {
        campaigns: home.campaigns.filter((c) => want(c.status)).map(summary),
        ideas: home.suggestions.map((s) => ({
          kind: playbookById(s.type)?.label ?? s.type,
          title: s.title,
          why: s.why,
        })),
      };
    },
  },
  {
    name: "get_campaign",
    title: "One campaign",
    description:
      "One campaign in full: its idea, its steps with dates and purpose, and every planned post and Story with its day, channel, format, what it says and where it is now. Use the campaignId from list_campaigns.",
    input: { campaignId: uuid },
    scope: "workspace",
    minRole: "viewer",
    write: false,
    run: async ({ workspaceId, campaignId }, { caller }) => {
      const c = await callFn<CampaignView>(caller, "campaigns", "getCampaign", {
        workspaceId,
        campaignId,
      });
      return {
        ...summary(c),
        idea: c.plan.bigIdea,
        steps: c.plan.phases.map((p) => ({
          label: p.label,
          from: p.startsOn,
          to: p.endsOn,
          purpose: p.purpose,
        })),
        pieces: c.pieces.slice(0, 60).map((p) => ({
          step: p.phase,
          date: p.date,
          time: p.time,
          platform: p.platform,
          format: p.format,
          title: p.title,
          idea: p.idea,
          state: p.state,
          contentItemIds: p.contentIds,
        })),
      };
    },
  },
];
