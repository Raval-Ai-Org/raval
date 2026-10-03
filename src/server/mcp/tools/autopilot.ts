// Autopilot: the marketing plan, its weekly pieces and the opportunities it finds.
import "server-only";
import { z } from "zod";
import {
  OPPORTUNITY_FORMATS,
  ProgramSettingsSchema,
  type ActionView,
  type AutopilotView,
} from "@/lib/autopilot/contracts";
import { PlatformIdSchema } from "@/lib/studio/jobs";
import type { McpCaller } from "../access.server";
import { callFn } from "../bridge.server";
import { uuid, type McpTool } from "../tool";

const view = (caller: McpCaller, workspaceId: string) =>
  callFn<AutopilotView>(caller, "autopilot", "getAutopilot", { workspaceId });

function presentAction(a: ActionView) {
  return {
    actionId: a.id,
    kind: a.kind,
    status: a.status,
    plannedFor: a.plannedFor,
    platform: a.platform,
    type: a.contentType,
    title: a.title,
    reason: a.reason,
    error: a.error,
    contentItemIds: a.contentItemIds,
    draft: a.preview
      ? {
          contentItemId: a.preview.contentItemId,
          status: a.preview.status,
          title: a.preview.title,
          body: a.preview.body.slice(0, 1_500),
        }
      : null,
  };
}

export const autopilotTools: McpTool[] = [
  {
    name: "get_autopilot_status",
    title: "Autopilot status",
    description:
      "Autopilot for a workspace: whether it is running, its plan and settings, this week's budget, what is waiting for approval, what is coming up, what failed, and what is missing before it can work.",
    input: {},
    scope: "workspace",
    minRole: "viewer",
    write: false,
    run: async ({ workspaceId }, { caller }) => {
      const v = await view(caller, workspaceId);
      return {
        program: v.program,
        budget: v.budget,
        fullyAutomaticAvailable: v.fullAvailable,
        weeklyPlanWaiting: v.proposed.map(presentAction),
        waitingForApproval: v.approvals.map(presentAction),
        upcoming: v.upcoming.slice(0, 20).map(presentAction),
        failed: v.failed.map(presentAction),
        recentlyDone: v.finished.slice(0, 10).map(presentAction),
        connectedPlatforms: v.connectedPlatforms,
        notReady: v.readiness.filter((r) => !r.ok),
        learnings: v.learnings,
        recentActivity: v.events.slice(0, 15).map((e) => ({ at: e.createdAt, what: e.summary })),
      };
    },
  },
  {
    name: "get_opportunities",
    title: "Marketing opportunities",
    description:
      "What Mellox found worth acting on for this brand: trends, competitor moves, news and performance signals, each with its sources, a score and a suggested piece. Use act_on_opportunity to turn one into content.",
    input: {},
    scope: "workspace",
    minRole: "viewer",
    write: false,
    run: async ({ workspaceId }, { caller }) => ({
      opportunities: (await view(caller, workspaceId)).opportunities,
    }),
  },
  {
    name: "act_on_opportunity",
    title: "Act on an opportunity",
    description:
      'Turn an opportunity into content, or dismiss it. "create" queues the piece for Autopilot to make (format "campaign" makes three linked posts); it uses credits when made and still waits for approval before anything is posted.',
    input: {
      opportunityId: uuid,
      decision: z.enum(["create", "dismiss"]),
      format: z.enum(OPPORTUNITY_FORMATS).optional(),
      platform: PlatformIdSchema.optional(),
    },
    scope: "workspace",
    minRole: "editor",
    write: true,
    run: (args, { caller }) => callFn(caller, "autopilot", "decideOpportunity", args),
  },
  {
    name: "suggest_marketing_plan",
    title: "Suggest a marketing plan",
    description:
      "Mellox's proposed strategy and Autopilot settings for this brand, written from its Brand DNA. Saves nothing. Show it to the person, adjust it with them, then call save_marketing_plan.",
    input: { timezone: z.string().min(1).max(64).describe("IANA time zone, e.g. Europe/London.") },
    scope: "workspace",
    minRole: "editor",
    write: false,
    run: ({ workspaceId, timezone }, { caller }) =>
      callFn(caller, "autopilot", "suggestAutopilotStrategy", { workspaceId, timezone }),
  },
  {
    name: "save_marketing_plan",
    title: "Start or change the marketing plan",
    description:
      'Start Autopilot with these settings, or change the running plan (changes apply from the next weekly plan). Admins and owners only. The person who saves it becomes the member Autopilot acts as. Mode "assist" asks before each week, "autopilot" asks before each post, "full" posts simple pieces by itself.',
    input: { settings: ProgramSettingsSchema },
    scope: "workspace",
    minRole: "admin",
    write: true,
    run: async ({ workspaceId, settings }, { caller }) => {
      const current = (await view(caller, workspaceId)).program;
      const live = current?.status === "running" || current?.status === "paused";
      await callFn(caller, "autopilot", live ? "updateAutopilot" : "startAutopilot", {
        workspaceId,
        settings,
      });
      return { saved: live ? "updated" : "started" };
    },
  },
  {
    name: "approve_weekly_plan",
    title: "Approve this week's plan",
    description:
      "Say yes to the weekly plan Autopilot proposed (assist mode), so it starts making the pieces. Only when the person agreed to the plan.",
    input: {},
    scope: "workspace",
    minRole: "editor",
    write: true,
    run: ({ workspaceId }, { caller }) =>
      callFn(caller, "autopilot", "approveAutopilotPlan", { workspaceId }),
  },
  {
    name: "review_autopilot_piece",
    title: "Approve or skip an Autopilot piece",
    description:
      "Approve a piece Autopilot made and is holding for approval, or skip a planned piece. Use the actionId from get_autopilot_status.",
    input: { actionId: uuid, decision: z.enum(["approve", "skip"]) },
    scope: "workspace",
    minRole: "editor",
    write: true,
    run: (args, { caller }) => callFn(caller, "autopilot", "decideAutopilotAction", args),
  },
  {
    name: "retry_autopilot_step",
    title: "Retry a failed Autopilot step",
    description: "Try a failed Autopilot step again.",
    input: { actionId: uuid },
    scope: "workspace",
    minRole: "editor",
    write: true,
    run: (args, { caller }) => callFn(caller, "autopilot", "retryAutopilotAction", args),
  },
  {
    name: "set_autopilot_paused",
    title: "Pause or resume Autopilot",
    description:
      "Pause Autopilot for a workspace, or resume it. Nothing is made or posted while paused.",
    input: { paused: z.boolean() },
    scope: "workspace",
    minRole: "editor",
    write: true,
    run: (args, { caller }) => callFn(caller, "autopilot", "setAutopilotPaused", args),
  },
  {
    name: "stop_autopilot",
    title: "Stop Autopilot",
    description:
      "End the Autopilot plan for a workspace. Admins and owners only. A new plan has to be started afterwards; use set_autopilot_paused for a break.",
    input: {},
    scope: "workspace",
    minRole: "admin",
    write: true,
    run: ({ workspaceId }, { caller }) =>
      callFn(caller, "autopilot", "stopAutopilot", { workspaceId }),
  },
];
