// Content: making it in Studio, the calendar, approvals, scheduling and posting.
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { transitionPath } from "@/lib/agency/command-center";
import {
  entriesBetween,
  entryFromContent,
  fmtYMD,
  isHM,
  isYMD,
  sortEntries,
  type CalendarSourceItem,
} from "@/lib/calendar/model";
import { PLAN_GOALS, PLAN_TOPICS } from "@/lib/calendar/planner";
import { CONTENT_STATUSES } from "@/lib/content-lifecycle";
import { isAutopilotEnabled } from "@/lib/feature-flags";
import { PlatformIdSchema, StudioTypeSchema } from "@/lib/studio/jobs";
import type { AutopilotView } from "@/lib/autopilot/contracts";
import type { McpCaller } from "../access.server";
import { callFn, callRoute } from "../bridge.server";
import { McpError } from "../errors.server";
import { record, soft, uuid, type McpTool } from "../tool";

const ymd = z.string().refine(isYMD, "Use a real date (YYYY-MM-DD).");
const hm = z.string().refine(isHM, "Use a real time (HH:mm).");
const Channel = z.enum([
  "instagram",
  "x",
  "linkedin",
  "facebook",
  "tiktok",
  "youtube",
  "threads",
  "blog",
  "email",
  "web",
]);
const PlanChannel = z.enum([
  "instagram",
  "facebook",
  "linkedin",
  "x",
  "threads",
  "tiktok",
  "youtube",
  "blog",
  "email",
]);
const ids = <T extends { id: string }>(list: readonly T[]) =>
  list.map((item) => item.id) as [string, ...string[]];

type ItemRow = { id: string; status: string; meta: unknown };

/**
 * Read the named posts with the caller's own client, inside the verified
 * workspace. Several older functions take a bare id; this is what stops an id
 * from another workspace being acted on through this one's switch.
 */
async function requireItems(
  caller: McpCaller,
  workspaceId: string,
  itemIds: string[],
): Promise<ItemRow[]> {
  const unique = [...new Set(itemIds)];
  const { data, error } = await caller.supabase
    .from("content_items")
    .select("id, status, meta")
    .eq("workspace_id", workspaceId)
    .in("id", unique);
  if (error) throw new McpError("internal_error", "Could not read those posts. Please try again.");
  const rows = (data ?? []) as ItemRow[];
  const missing = unique.filter((id) => !rows.some((row) => row.id === id));
  if (missing.length) {
    throw new McpError("not_found", "Some posts weren't found in this workspace.", { missing });
  }
  return rows;
}

function presentItem(raw: unknown) {
  const item = record(raw);
  const meta = record(item.meta);
  return {
    id: item.id,
    kind: item.kind,
    channel: item.channel,
    title: item.title,
    body: typeof item.body === "string" ? item.body.slice(0, 2_000) : null,
    hashtags: item.hashtags,
    status: item.status,
    scheduledAt: item.scheduled_at,
    plannedDate: typeof meta.calendar_date === "string" ? meta.calendar_date : null,
    mediaUrl: item.media_url,
    madeByAutopilot: typeof meta.autopilot_action_id === "string",
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

function presentJob(raw: unknown) {
  const job = record(raw);
  return {
    jobId: job.id,
    type: job.type,
    status: job.status,
    stage: job.stage,
    title: job.title,
    contentItemIds: job.content_item_ids ?? [],
    output: job.output,
    error: job.error,
  };
}

/** Destinations: every connected account that matches each post's own platform. */
const ALL_ACCOUNTS = { type: "all" } as const;

function presentResults(body: unknown) {
  const results = record(body).results;
  return {
    results: (Array.isArray(results) ? results : []).map((r) => {
      const row = record(r);
      return {
        contentItemId: row.contentItemId,
        status: row.status,
        reason: row.reason ?? null,
        scheduledAt: row.scheduledAt ?? null,
      };
    }),
  };
}

function assertApproved(rows: ItemRow[], allowed: string[], verb: string) {
  const blocked = rows.filter((row) => !allowed.includes(row.status));
  if (blocked.length) {
    throw new McpError(
      "not_approved",
      `Only approved posts can be ${verb}. Approve them first with review_content (a person should agree to that).`,
      { posts: blocked.map((row) => ({ id: row.id, status: row.status })) },
    );
  }
}

export const contentTools: McpTool[] = [
  {
    name: "list_content",
    title: "List content",
    description:
      "Posts, articles and other content in a workspace, optionally by status (draft, pending, approved, rejected, scheduled, publishing, published, failed, partial_failed).",
    input: {
      status: z.enum(CONTENT_STATUSES).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
    scope: "workspace",
    minRole: "viewer",
    write: false,
    run: async ({ workspaceId, status, limit }, { caller }) => {
      const items = await callFn<unknown[]>(caller, "content", "listContentItems", {
        workspaceId,
        status,
        limit: limit ?? 50,
      });
      return { items: items.map(presentItem) };
    },
  },
  {
    name: "get_content_calendar",
    title: "Content calendar",
    description:
      "What is planned, scheduled and posted between two dates (YYYY-MM-DD, at most 92 days apart). Defaults to the next 14 days. Dates are in UTC.",
    input: { from: ymd.optional(), to: ymd.optional() },
    scope: "workspace",
    minRole: "viewer",
    write: false,
    run: async ({ workspaceId, from, to }, { caller }) => {
      const start = from ?? fmtYMD(new Date());
      const end = to ?? fmtYMD(new Date(new Date(start).getTime() + 14 * 86_400_000));
      if (end < start) throw new McpError("invalid_input", '"to" must be on or after "from".');
      if (new Date(end).getTime() - new Date(start).getTime() > 92 * 86_400_000) {
        throw new McpError("invalid_input", "Ask for at most 92 days at a time.");
      }
      const items = await callFn<CalendarSourceItem[]>(caller, "content", "listContentItems", {
        workspaceId,
        limit: 500,
      });
      const scheduledAt = new Map(items.map((item) => [item.id, item.scheduled_at]));
      const entries = sortEntries(entriesBetween(items.map(entryFromContent), start, end));
      return {
        from: start,
        to: end,
        entries: entries.map((e) => ({
          id: e.id,
          date: e.date,
          time: e.time,
          channel: e.channel,
          format: e.format,
          topic: e.topic ?? null,
          title: e.title,
          caption: e.caption?.slice(0, 600) ?? null,
          status: e.status,
          scheduledAt: scheduledAt.get(e.id) ?? null,
        })),
      };
    },
  },
  {
    name: "get_pending_approvals",
    title: "Waiting for approval",
    description:
      "Everything waiting for a person to approve: posts in review (pending or draft) and, when Autopilot is on, a weekly plan waiting for a yes.",
    input: {},
    scope: "workspace",
    minRole: "viewer",
    write: false,
    run: async ({ workspaceId }, { caller }) => {
      const [pending, drafts, autopilot] = await Promise.all([
        callFn<unknown[]>(caller, "content", "listContentItems", {
          workspaceId,
          status: "pending",
          limit: 100,
        }),
        callFn<unknown[]>(caller, "content", "listContentItems", {
          workspaceId,
          status: "draft",
          limit: 100,
        }),
        isAutopilotEnabled(workspaceId)
          ? soft(() => callFn<AutopilotView>(caller, "autopilot", "getAutopilot", { workspaceId }))
          : Promise.resolve(null),
      ]);
      return {
        posts: [...pending, ...drafts].map(presentItem),
        weeklyPlanWaiting: (autopilot?.proposed ?? []).map((a) => ({
          actionId: a.id,
          plannedFor: a.plannedFor,
          platform: a.platform,
          type: a.contentType,
          title: a.title,
          reason: a.reason,
        })),
      };
    },
  },
  {
    name: "create_content",
    title: "Create content in Studio",
    description:
      "Make new content with Mellox Studio, in the brand's own voice: social posts, an image post, a carousel, an Instagram or Facebook Story (1 to 7 vertical frames), a video, an article, a script or ads. Uses the workspace's credits. Text is ready in the reply; images and videos keep rendering, so check get_content_job. The result lands as drafts waiting for approval; nothing is posted.",
    input: {
      type: StudioTypeSchema.describe("What to make."),
      brief: z
        .string()
        .trim()
        .min(3)
        .max(4000)
        .describe("What it should be about, in plain words."),
      platforms: z.array(PlatformIdSchema).max(7).optional(),
      goal: z.enum(["awareness", "engagement", "leads", "launch", "education", "offer"]).optional(),
      tone: z.string().max(80).optional(),
      frames: z
        .number()
        .int()
        .min(1)
        .max(7)
        .optional()
        .describe("Stories only: how many frames (default 3)."),
      requestId: z
        .string()
        .min(4)
        .max(100)
        .optional()
        .describe("Any unique text for this request, so a retry can't be charged twice."),
    },
    scope: "workspace",
    minRole: "editor",
    write: true,
    run: async (args, { caller }) => {
      const key = args.requestId
        ? createHash("sha256")
            .update(`${caller.userId}:${args.workspaceId}:${args.requestId}`)
            .digest("hex")
            .slice(0, 40)
        : randomUUID();
      const { POST } = await import("@/app/api/studio/jobs/route");
      const out = await callRoute<{ job: unknown }>(caller, POST, "/api/studio/jobs", {
        body: {
          workspaceId: args.workspaceId,
          type: args.type,
          idempotencyKey: `mcp-${key}`,
          intent: { brief: args.brief, goal: args.goal, ideaSource: "mcp" },
          controls: {
            platforms: args.platforms ?? [],
            tone: args.tone,
            ...(args.type === "story" && args.frames ? { frameCount: args.frames } : {}),
          },
        },
      });
      return presentJob(out.job);
    },
  },
  {
    name: "get_content_job",
    title: "Check a Studio job",
    description:
      "The state and result of a create_content job. Call again while it is queued or running.",
    input: { jobId: uuid },
    scope: "workspace",
    minRole: "viewer",
    write: false,
    run: async ({ workspaceId, jobId }, { caller }) => {
      const { GET } = await import("@/app/api/studio/jobs/[id]/route");
      const out = await callRoute<{ job: unknown }>(caller, GET, `/api/studio/jobs/${jobId}`, {
        method: "GET",
        query: { workspaceId },
      });
      return presentJob(out.job);
    },
  },
  {
    name: "generate_campaign_brief",
    title: "Write a campaign brief",
    description:
      "A campaign brief for a goal across channels (angle, messages, pieces to make). Uses credits. It saves nothing; follow it with create_content or plan_content_calendar.",
    input: {
      goal: z.string().min(3).max(500),
      channels: z.array(z.string().min(1).max(40)).min(1).max(6),
    },
    scope: "workspace",
    minRole: "editor",
    write: true,
    run: ({ workspaceId, goal, channels }, { caller }) =>
      callFn(caller, "campaign-generation", "generateCampaignBrief", {
        workspaceId,
        goal,
        channels,
        idempotencyKey: randomUUID(),
      }),
  },
  {
    name: "plan_content_calendar",
    title: "Plan the calendar",
    description:
      "Write a dated set of draft posts onto the content calendar (up to 6 weeks). Uses credits. The posts are drafts: nothing is approved, scheduled or posted.",
    input: {
      startDate: ymd,
      weeks: z.number().int().min(1).max(6),
      postsPerWeek: z.number().int().min(1).max(14),
      channels: z.array(PlanChannel).min(1).max(9),
      weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional().describe("0 = Sunday."),
      topics: z.array(z.enum(ids(PLAN_TOPICS))).min(1),
      goal: z.enum(ids(PLAN_GOALS)),
      notes: z.string().max(1500).optional().describe("What the person wants covered."),
    },
    scope: "workspace",
    minRole: "editor",
    write: true,
    run: async (args, { caller }) => {
      const out = await callFn<{ items: unknown[]; requested: number }>(
        caller,
        "content",
        "planContentCalendar",
        { ...args, weekdays: args.weekdays ?? [] },
      );
      return { requested: out.requested, created: out.items.map(presentItem) };
    },
  },
  {
    name: "write_content_draft",
    title: "Save a draft",
    description:
      "Save text you (the assistant) wrote with the person as a new draft in Mellox. Free. It enters as a draft or in review, never approved.",
    input: {
      kind: z.enum(["post", "carousel", "image", "video", "ad", "script", "blog"]).default("post"),
      channel: Channel.optional(),
      title: z.string().max(280).optional(),
      body: z.string().min(1).max(40_000),
      hashtags: z.array(z.string().max(60)).max(30).optional(),
      plannedDate: ymd.optional().describe("Where it sits on the calendar."),
      sendToReview: z.boolean().optional().describe("True puts it in review instead of drafts."),
    },
    scope: "workspace",
    minRole: "editor",
    write: true,
    run: async (args, { caller }) =>
      presentItem(
        await callFn(caller, "content", "createContentItem", {
          workspaceId: args.workspaceId,
          kind: args.kind,
          channel: args.channel ?? null,
          title: args.title ?? null,
          body: args.body,
          hashtags: args.hashtags,
          status: args.sendToReview ? "pending" : "draft",
          meta: { source: "mcp", ...(args.plannedDate ? { calendar_date: args.plannedDate } : {}) },
        }),
      ),
  },
  {
    name: "update_content",
    title: "Edit a post",
    description:
      "Change a post's title, text, hashtags or channel. Editing an approved post sends it back to draft, so it needs approval again.",
    input: {
      contentItemId: uuid,
      title: z.string().max(280).optional(),
      body: z.string().max(40_000).optional(),
      hashtags: z.array(z.string().max(60)).max(30).optional(),
      channel: Channel.optional(),
    },
    scope: "workspace",
    minRole: "editor",
    write: true,
    run: async ({ workspaceId, contentItemId, ...patch }, { caller }) => {
      const [row] = await requireItems(caller, workspaceId, [contentItemId]);
      if (["scheduled", "publishing", "published"].includes(row.status)) {
        throw new McpError(
          "conflict",
          "This post is scheduled or already posted. Cancel the schedule before editing it.",
        );
      }
      const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      if (!Object.keys(clean).length) throw new McpError("invalid_input", "Nothing to change.");
      return presentItem(
        await callFn(caller, "content", "updateContentItem", { id: contentItemId, patch: clean }),
      );
    },
  },
  {
    name: "regenerate_content",
    title: "Rewrite a post",
    description:
      "Have Mellox write a fresh take on an existing post, keeping its facts. Uses credits.",
    input: { contentItemId: uuid },
    scope: "workspace",
    minRole: "editor",
    write: true,
    run: async ({ workspaceId, contentItemId }, { caller }) => {
      await requireItems(caller, workspaceId, [contentItemId]);
      return presentItem(
        await callFn(caller, "content", "regenerateContentItem", { id: contentItemId }),
      );
    },
  },
  {
    name: "move_content_date",
    title: "Move a post on the calendar",
    description:
      "Move a post that isn't scheduled yet to another day on the calendar. It doesn't schedule or approve anything.",
    input: { contentItemId: uuid, date: ymd, time: hm.optional() },
    scope: "workspace",
    minRole: "editor",
    write: true,
    run: async ({ workspaceId, contentItemId, date, time }, { caller }) => {
      await requireItems(caller, workspaceId, [contentItemId]);
      return presentItem(
        await callFn(caller, "content", "setContentPlanDate", { id: contentItemId, date, time }),
      );
    },
  },
  {
    name: "delete_content",
    title: "Delete a post",
    description:
      "Permanently delete a post that hasn't been scheduled or posted. This can't be undone; confirm with the person first.",
    input: { contentItemId: uuid },
    scope: "workspace",
    minRole: "editor",
    write: true,
    destructive: true,
    run: async ({ workspaceId, contentItemId }, { caller }) => {
      const [row] = await requireItems(caller, workspaceId, [contentItemId]);
      if (["scheduled", "publishing", "published"].includes(row.status)) {
        throw new McpError("conflict", "A scheduled or posted item can't be deleted from here.");
      }
      await callFn(caller, "content", "deleteContentItem", { id: contentItemId });
      return { deleted: contentItemId };
    },
  },
  {
    name: "review_content",
    title: "Approve or reject a post",
    description:
      "Approve or reject a post that is waiting for review. Approval is the person's decision: only call this when they said yes to this exact post. Approving doesn't post anything.",
    input: { contentItemId: uuid, decision: z.enum(["approve", "reject"]) },
    scope: "workspace",
    minRole: "editor",
    write: true,
    run: async ({ workspaceId, contentItemId, decision }, { caller }) => {
      const [row] = await requireItems(caller, workspaceId, [contentItemId]);
      const actionId = record(row.meta).autopilot_action_id;
      // A piece Autopilot made is decided through Autopilot, so its plan and
      // the post stay in step. If that step isn't waiting any more, fall through.
      if (typeof actionId === "string" && isAutopilotEnabled(workspaceId)) {
        try {
          await callFn(caller, "autopilot", "decideAutopilotAction", {
            workspaceId,
            actionId,
            decision: decision === "approve" ? "approve" : "skip",
          });
          const [after] = await requireItems(caller, workspaceId, [contentItemId]);
          return { id: contentItemId, status: after.status, via: "autopilot" };
        } catch (error) {
          const status = (error as { status?: number }).status;
          if (status !== 409 && status !== 404) throw error;
        }
      }
      const target = decision === "approve" ? "approved" : "rejected";
      if (row.status === target) return { id: contentItemId, status: target };
      let status = row.status;
      for (const step of transitionPath(row.status, target)) {
        const updated = record(
          await callFn(caller, "content", "updateContentItem", {
            id: contentItemId,
            patch: { status: step },
          }),
        );
        status = String(updated.status);
      }
      return { id: contentItemId, status };
    },
  },
  {
    name: "schedule_content",
    title: "Schedule approved posts",
    description:
      "Schedule approved posts to go out at a time (ISO 8601 with a time zone, at least a minute ahead). Each post goes to the connected account for its own platform. Only approved posts are accepted. Scheduling a post that is already scheduled moves it.",
    input: {
      items: z
        .array(
          z.object({ contentItemId: uuid, scheduledAt: z.string().datetime({ offset: true }) }),
        )
        .min(1)
        .max(25),
    },
    scope: "workspace",
    minRole: "editor",
    write: true,
    run: async ({ workspaceId, items }, { caller }) => {
      const rows = await requireItems(
        caller,
        workspaceId,
        items.map((i: { contentItemId: string }) => i.contentItemId),
      );
      assertApproved(rows, ["approved", "scheduled"], "scheduled");
      const { POST } = await import("@/app/api/sdr/schedule/route");
      return presentResults(
        await callRoute(caller, POST, "/api/sdr/schedule", {
          body: { workspaceId, items, selection: ALL_ACCOUNTS },
        }),
      );
    },
  },
  {
    name: "publish_content_now",
    title: "Post now",
    description:
      "Post approved content to the workspace's connected social accounts right now. This is public and can't be taken back: only call it when the person asked to post these exact posts now. Only approved posts are accepted.",
    input: { contentItemIds: z.array(uuid).min(1).max(10) },
    scope: "workspace",
    minRole: "editor",
    write: true,
    destructive: true,
    run: async ({ workspaceId, contentItemIds }, { caller }) => {
      const rows = await requireItems(caller, workspaceId, contentItemIds);
      assertApproved(rows, ["approved"], "posted");
      const { POST } = await import("@/app/api/sdr/publish/route");
      return presentResults(
        await callRoute(caller, POST, "/api/sdr/publish", {
          body: { workspaceId, contentItemIds, selection: ALL_ACCOUNTS },
        }),
      );
    },
  },
  {
    name: "cancel_scheduled_content",
    title: "Cancel a scheduled post",
    description: "Cancel a scheduled post before it goes out. It returns to approved.",
    input: { contentItemId: uuid },
    scope: "workspace",
    minRole: "editor",
    write: true,
    run: async ({ workspaceId, contentItemId }, { caller }) => {
      await requireItems(caller, workspaceId, [contentItemId]);
      const { POST } = await import("@/app/api/sdr/cancel/route");
      await callRoute(caller, POST, "/api/sdr/cancel", { body: { workspaceId, contentItemId } });
      const [after] = await requireItems(caller, workspaceId, [contentItemId]);
      return { id: contentItemId, status: after.status };
    },
  },
];
