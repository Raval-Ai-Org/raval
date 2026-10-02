import "server-only";
import { createServerFn } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rateLimitFor } from "@/server/rate-limit";
import { HttpError } from "@/server/http-error";
import { requireWorkspaceRole } from "@/server/workspace-access.server";
import { AiOutputError, runJsonPrompt, runStructuredPrompt } from "@/lib/ai";
import { contentBatchPrompt, nextPostPrompt, regeneratePrompt } from "@/lib/ai/prompts";
import { isNearDuplicateCopy } from "@/lib/studio/novelty";
import { validContentBatch } from "@/lib/content-batch-quality";
import { loadStudioContext, invalidateStudioContext } from "@/server/studio/context.server";
import { buildNextSteps } from "@/lib/ai/deterministic-suggestions";
import { humanizeText } from "@/lib/ai/humanize-text";
import { isHM, isYMD } from "@/lib/calendar/model";
import {
  buildPlanSlots,
  industryById,
  MAX_PLAN_POSTS,
  PLAN_GOALS,
  PLAN_TOPICS,
  topicLabel,
  type PlanSlot,
  type PlanTopicId,
} from "@/lib/calendar/planner";
import {
  assertContentTransition,
  CONTENT_STATUSES,
  hasMeaningfulContentChange,
  mergeMeta,
  type ContentStatus,
} from "@/lib/content-lifecycle";

const uuid = z.string().uuid();

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

const ChannelEnum = z.enum([
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
// brief / email / landing are legacy kinds: still readable, no longer created by Studio.
const KindEnum = z.enum([
  "post",
  "carousel",
  "image",
  "video",
  "ad",
  "script",
  "blog",
  "brief",
  "email",
  "landing",
]);
const AgentEnum = z.enum(["scout", "spark", "echo"]);
const StatusEnum = z.enum(CONTENT_STATUSES);

const CONTENT_COLS =
  "id, workspace_id, agent, kind, channel, title, body, hashtags, media_url, status, scheduled_at, metrics, meta, created_by, created_at, updated_at";

export type ContentItem = {
  id: string;
  workspace_id: string;
  agent: string;
  kind: string;
  channel: string | null;
  title: string | null;
  body: string | null;
  hashtags: string[] | null;
  media_url: string | null;
  status: string;
  scheduled_at: string | null;
  metrics: Json | null;
  meta: Json | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/* ------------------------------------------------------------ */
/* List content                                                  */
/* ------------------------------------------------------------ */
export const listContentItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid.optional(),
        status: StatusEnum.optional(),
        limit: z.number().int().min(1).max(500).optional(),
      })
      .parse(data ?? {}),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("content_items")
      .select(CONTENT_COLS)
      .order("scheduled_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 200);
    if (data.workspaceId) q = q.eq("workspace_id", data.workspaceId);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const items = (rows ?? []) as ContentItem[];
    const contentIds = items.map((item) => item.id);
    if (!contentIds.length) return items;

    type AssetRow = { content_item_id: string | null; storage_path: string | null };
    type SignedAsset = { path: string | null; signedUrl: string | null };
    const assetDb = context.supabase as any;
    const { data: assetRows } = await assetDb
      .from("assets")
      .select("content_item_id, storage_path")
      .in("content_item_id", contentIds)
      .is("deleted_at", null)
      .not("storage_path", "is", null)
      // Oldest first, so the newest picture is the one a post ends up with.
      .order("created_at", { ascending: true });
    const assets = (assetRows ?? []) as AssetRow[];
    const paths = assets
      .map((asset) => asset.storage_path)
      .filter((path): path is string => typeof path === "string");
    if (!paths.length) return items;

    const { data: signedRows } = await assetDb.storage
      .from("generated-assets")
      .createSignedUrls(paths, 3600);
    const signed = (signedRows ?? []) as SignedAsset[];
    const signedByPath = new Map(
      (signed ?? [])
        .filter((asset) => asset.path && asset.signedUrl)
        .map((asset) => [asset.path, asset.signedUrl] as const),
    );
    const pathByContentId = new Map(
      (assets ?? [])
        .filter((asset) => asset.content_item_id && asset.storage_path)
        .map((asset) => [asset.content_item_id, asset.storage_path] as const),
    );
    return items.map((item) => {
      const path = pathByContentId.get(item.id);
      const url = path ? signedByPath.get(path) : undefined;
      return url ? { ...item, media_url: url } : item;
    }) as ContentItem[];
  });

/* ------------------------------------------------------------ */
/* Create                                                        */
/* ------------------------------------------------------------ */
const CreateSchema = z.object({
  workspaceId: uuid,
  agent: AgentEnum.default("spark"),
  kind: KindEnum.default("post"),
  channel: ChannelEnum.optional().nullable(),
  title: z.string().max(280).optional().nullable(),
  body: z.string().max(40000).optional().nullable(),
  hashtags: z.array(z.string().max(60)).max(30).optional(),
  media_url: z.string().url().max(2048).optional().nullable(),
  // New work always enters the lifecycle at the start; approval, scheduling and
  // publishing are transitions, never an insert-time shortcut.
  status: z.enum(["draft", "pending"]).optional(),
  scheduled_at: z.string().datetime().optional().nullable(),
  meta: z.record(z.string(), z.any()).optional(),
});

export const createContentItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => CreateSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("content_items")
      .insert({
        workspace_id: data.workspaceId,
        agent: data.agent,
        kind: data.kind,
        channel: data.channel ?? null,
        title: data.title ?? null,
        body: data.body ?? null,
        hashtags: data.hashtags ?? [],
        media_url: data.media_url ?? null,
        status: data.status ?? "draft",
        scheduled_at: data.scheduled_at ?? null,
        meta: (data.meta ?? {}) as Json,
        created_by: context.userId,
      })
      .select(CONTENT_COLS)
      .single();
    if (error || !row) throw new Error(error?.message ?? "Insert failed");
    return row as ContentItem;
  });

/* ------------------------------------------------------------ */
/* Update                                                        */
/* ------------------------------------------------------------ */
const UpdateSchema = z.object({
  id: uuid,
  patch: z
    .object({
      title: z.string().max(280).optional().nullable(),
      body: z.string().max(40000).optional().nullable(),
      hashtags: z.array(z.string().max(60)).max(30).optional(),
      channel: ChannelEnum.optional().nullable(),
      media_url: z.string().url().max(2048).optional().nullable(),
      status: StatusEnum.optional(),
      scheduled_at: z.string().datetime().nullable().optional(),
      meta: z.record(z.string(), z.any()).optional(),
    })
    .refine((v) => Object.keys(v).length > 0, "Empty patch"),
});

export const updateContentItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => UpdateSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: current, error: readError } = await context.supabase
      .from("content_items")
      .select("status, body, meta")
      .eq("id", data.id)
      .single();
    if (readError || !current) throw new Error(readError?.message ?? "Content item not found");

    const patch = { ...data.patch } as Record<string, unknown>;
    const currentStatus = current.status as ContentStatus;
    const requestedStatus = patch.status as string | undefined;

    // `meta` is shared bookkeeping (platform, asset link, SDR job ids). Merge
    // instead of replacing so one writer never erases another's keys; a `null`
    // value removes a key.
    if (data.patch.meta) patch.meta = mergeMeta(current.meta, data.patch.meta);

    if (hasMeaningfulContentChange(patch) && !requestedStatus) {
      const existingMeta = mergeMeta(current.meta, {});
      const editMeta: Record<string, unknown> = {
        edited_at: new Date().toISOString(),
        edited_by: context.userId,
      };
      if (!("original_content" in existingMeta) && typeof current.body === "string") {
        editMeta.original_content = current.body;
      }
      patch.meta = mergeMeta(patch.meta ?? current.meta, editMeta);
    }

    if (
      currentStatus === "approved" &&
      hasMeaningfulContentChange(patch) &&
      (!requestedStatus || requestedStatus === currentStatus)
    ) {
      // Editing approved work invalidates its approval and requires review again.
      patch.status = "draft";
    } else if (requestedStatus) {
      assertContentTransition(currentStatus, requestedStatus);
    }

    const { data: row, error } = await context.supabase
      .from("content_items")
      .update(patch as never)
      .eq("id", data.id)
      .select(CONTENT_COLS)
      .single();
    if (error || !row) throw new Error(error?.message ?? "Update failed");
    return row as ContentItem;
  });

/* ------------------------------------------------------------ */
/* Delete                                                        */
/* ------------------------------------------------------------ */
export const deleteContentItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("content_items").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ------------------------------------------------------------ */
/* Reschedule (drag-drop)                                        */
/* ------------------------------------------------------------ */
export const rescheduleContentItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        id: uuid,
        scheduled_at: z.string().datetime().nullable(),
        channel: ChannelEnum.optional().nullable(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = { scheduled_at: data.scheduled_at };
    if (data.channel !== undefined) patch.channel = data.channel;
    const { data: current, error: readError } = await context.supabase
      .from("content_items")
      .select("status")
      .eq("id", data.id)
      .single();
    if (readError || !current) throw new Error(readError?.message ?? "Content item not found");
    if (data.scheduled_at) {
      assertContentTransition(current.status, "scheduled");
      patch.status = "scheduled";
    } else if (current.status === "scheduled") {
      patch.status = "approved";
    }
    const { data: row, error } = await context.supabase
      .from("content_items")
      .update(patch as never)
      .eq("id", data.id)
      .select(CONTENT_COLS)
      .single();
    if (error || !row) throw new Error(error?.message ?? "Reschedule failed");
    return row as ContentItem;
  });

/* ------------------------------------------------------------ */
/* AI generation helper                                          */
/* ------------------------------------------------------------ */
// Content generation routes through runStructuredPrompt (validated output, one
// repair attempt, then a real error) — never a silent template fallback.
const RegeneratedSchema = z.object({
  title: z.string().optional(),
  body: z.string().min(1),
  hashtags: z.array(z.string()).optional(),
});
const BatchSchema = z.object({
  items: z.array(
    z.object({
      channel: z.string().optional(),
      kind: z.string().optional(),
      title: z.string().optional(),
      body: z.string().optional(),
      hashtags: z.array(z.string()).optional(),
    }),
  ),
});

/* ------------------------------------------------------------ */
/* Regenerate copy on an existing item                           */
/* ------------------------------------------------------------ */
export const regenerateContentItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("generate")])
  .inputValidator((data) => z.object({ id: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: existing, error: readErr } = await context.supabase
      .from("content_items")
      .select(CONTENT_COLS)
      .eq("id", data.id)
      .single();
    if (readErr || !existing) throw new Error("Item not found");

    const role = await requireWorkspaceRole(context, existing.workspace_id, "editor");
    const { runMetered } = await import("@/server/billing/metered.server");
    const { result } = await runMetered(
      {
        workspaceId: existing.workspace_id,
        userId: context.userId,
        role,
        action: "post_regenerate",
        idempotencyKey: crypto.randomUUID(),
        route: "content.regenerate",
      },
      async () => {
        const studioContext = await loadStudioContext(
          context.supabase as never,
          existing.workspace_id,
          null,
        );
        const { styleTextFor } = await import("@/server/brand-kit/resolve.server");
        const styleText = await styleTextFor(
          existing.workspace_id,
          null,
          existing.kind === "blog"
            ? "article"
            : existing.kind === "script"
              ? "script"
              : existing.kind === "image"
                ? "image"
                : "social",
        );

        const { system, user } = regeneratePrompt({
          channel: existing.channel,
          kind: existing.kind,
          title: existing.title ?? "",
          body: existing.body ?? "",
        });

        // A failed regeneration throws (AiOutputError → 502). It used to return
        // the OLD text as if it had been regenerated, and the cache made pressing
        // "regenerate" return identical copy for 30 minutes.
        let parsed: z.infer<typeof RegeneratedSchema> | null = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          const candidate = await runStructuredPrompt({
            route: "content.regenerate",
            system: `${system}\nKeep the user's original facts and offer. Give a useful, fresh angle for their audience; never invent proof or market claims.`,
            user: `${user}\n\n## Brand and customer context\n${studioContext.brandText}\n\n## Brand Kit writing style\n${styleText || "Follow Brand DNA voice."}\n\n## Recent topics to avoid\n${studioContext.recent
              .slice(0, 10)
              .map((item) => `- ${item.title}: ${item.excerpt ?? ""}`)
              .join(
                "\n",
              )}\n${attempt ? "\nThe last rewrite was too similar. Change the hook, structure, and practical takeaway while preserving verified facts." : ""}`,
            schema: RegeneratedSchema,
            maxTokens: existing.kind === "blog" ? 3500 : 1200,
            temperature: 0.7,
            regenerate: true,
          });
          if (!isNearDuplicateCopy(candidate.body, existing.body ?? "")) {
            parsed = candidate;
            break;
          }
        }
        if (!parsed)
          throw new AiOutputError(
            "The rewrite repeated the existing draft. Try a more specific direction.",
          );

        const { data: row, error } = await context.supabase
          .from("content_items")
          .update({
            title: parsed.title ?? existing.title,
            body: parsed.body,
            hashtags: Array.isArray(parsed.hashtags)
              ? parsed.hashtags.slice(0, 30)
              : existing.hashtags,
          })
          .eq("id", data.id)
          .select(CONTENT_COLS)
          .single();
        if (error || !row) throw new Error(error?.message ?? "Update failed");
        invalidateStudioContext(existing.workspace_id);
        return row as ContentItem;
      },
    );
    return result;
  });

/* ------------------------------------------------------------ */
/* Generate fresh items from a prompt (Spark/Scout/Echo)         */
/* ------------------------------------------------------------ */
const GenerateSchema = z.object({
  workspaceId: uuid,
  agent: AgentEnum.default("spark"),
  prompt: z.string().min(2).max(2000),
  channels: z.array(ChannelEnum).min(1).max(6).optional(),
  count: z.number().int().min(1).max(8).optional(),
  /** Exact order for mixed-format batches such as the Command Center's weekly draft. */
  formatPlan: z
    .array(z.object({ channel: ChannelEnum, kind: KindEnum }))
    .min(1)
    .max(8)
    .optional(),
  context: z.string().max(6000).optional(),
  websiteUrl: z.string().max(2048).optional().nullable(),
  /** Brand Kit Style: an id, "none", or absent for the workspace default. */
  styleId: z.union([uuid, z.literal("none")]).nullish(),
});

export const generateContentBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("generate")])
  .inputValidator((data) => GenerateSchema.parse(data))
  .handler(async ({ data, context }) => {
    const channels = data.formatPlan?.map((item) => item.channel) ??
      data.channels ?? ["instagram", "x", "linkedin"];
    const count = data.formatPlan?.length ?? data.count ?? channels.length;
    if (data.formatPlan && data.count && data.formatPlan.length !== data.count)
      throw new Error("The requested format plan and draft count do not match.");

    // Verified workspace; its stored Brand DNA is the brand context, so a
    // batch can never be written in another brand's voice.
    const role = await requireWorkspaceRole(context, data.workspaceId, "editor");
    const { runMetered } = await import("@/server/billing/metered.server");
    const { result } = await runMetered(
      {
        workspaceId: data.workspaceId,
        userId: context.userId,
        role,
        action: "post_set",
        // One post set covers up to three drafts.
        quantity: Math.max(1, Math.ceil(count / 3)),
        idempotencyKey: crypto.randomUUID(),
        route: "content.generateBatch",
      },
      async () => {
        const studioContext = await loadStudioContext(
          context.supabase as never,
          data.workspaceId,
          null,
        );
        const { system, userTail } = contentBatchPrompt({
          agent: data.agent,
          count,
          channels,
          kinds: data.formatPlan?.map((item) => item.kind),
          brandContext: studioContext.brandText || data.context,
          websiteUrl: studioContext.website || data.websiteUrl,
        });
        const { styleTextFor } = await import("@/server/brand-kit/resolve.server");
        const requestedKinds = new Set(data.formatPlan?.map((item) => item.kind) ?? ["post"]);
        const formats = [
          "social",
          ...(requestedKinds.has("blog") ? ["article"] : []),
          ...(requestedKinds.has("image") ? ["image"] : []),
        ];
        const styleBlocks = await Promise.all(
          formats.map(async (format) => {
            const block = await styleTextFor(data.workspaceId, data.styleId, format);
            return block ? `### ${format}\n${block.replace(/^## /gm, "#### ")}` : "";
          }),
        );
        const styleText = styleBlocks.filter(Boolean).join("\n\n");
        const plan = data.formatPlan
          ?.map((item, index) => `${index + 1}. ${item.kind} for ${item.channel}`)
          .join("\n");
        const user = `${userTail}${
          styleText
            ? `\n\n## Style (follow exactly; it overrides generic platform guidance)\n${styleText.replace(/^## /gm, "### ")}`
            : ""
        }\n\n## Exact output plan\n${plan || `Create ${count} items for: ${channels.join(", ")}.`}\n\n## Audience and market needs\n${
          [
            ...studioContext.opportunities.slice(0, 3),
            ...studioContext.risingQueries.slice(0, 4),
            ...studioContext.competitorMoves.slice(0, 2),
          ]
            .map((item) => `- ${item}`)
            .join("\n") || "Use the customer's needs in Brand DNA; do not invent a trend."
        }\n\n## Recent work to avoid\n${studioContext.recent
          .slice(0, 12)
          .map((item) => `- ${item.title}: ${item.excerpt ?? ""}`)
          .join("\n")}\n\n## Brief\n${data.prompt}`;

        type Item = {
          channel?: string;
          kind?: string;
          title?: string;
          body?: string;
          hashtags?: string[];
        };
        // Mixed batches reserve more output tokens for a substantive blog item.
        // A thin, incomplete or repeated set gets one fresh attempt before failing.
        let safeItems: Item[] = [];
        for (let attempt = 0; attempt < 2; attempt++) {
          const parsed = await runStructuredPrompt({
            route: "content.generateBatch",
            system: `${system}\nThe user's brief and requested format take priority. Use market and competitor signals only when relevant, and never as unsupported claims. Each piece must answer a distinct audience need with a useful takeaway. Make topics and entities clear in natural language for people and answer engines. Do not invent results, customers, quotes, or statistics. For kind blog, write a short, substantive article with a direct answer near the top, descriptive H2 sections and practical detail (at least 250 words). For kind image, write a visual brief and caption; do not imply media has been rendered. Follow the exact output plan in order when present.`,
            user: attempt
              ? `${user}\n\nThe previous set was incomplete or repeated recent work. Return ${count} distinct, fully written pieces with different hooks, examples and takeaways.`
              : user,
            schema: BatchSchema,
            maxTokens: Math.min(
              6000,
              300 + count * (data.formatPlan?.some((item) => item.kind === "blog") ? 700 : 500),
            ),
            temperature: 0.72,
            regenerate: true,
          });
          const candidates: Item[] = parsed.items
            .filter((item) => typeof item.body === "string" && item.body.trim())
            .slice(0, count);
          if (
            validContentBatch({
              drafts: candidates,
              count,
              channels,
              plan: data.formatPlan,
              recentBodies: studioContext.recent.map((item) => item.excerpt ?? "").filter(Boolean),
            })
          ) {
            safeItems = candidates;
            break;
          }
        }
        if (safeItems.length !== count)
          throw new AiOutputError(
            "The generated set was incomplete or too similar to existing posts. Try a more specific brief.",
          );

        const rows = safeItems.map((it) => ({
          workspace_id: data.workspaceId,
          agent: data.agent,
          kind: (KindEnum.safeParse(it.kind).success ? it.kind : "post") as string,
          channel: ChannelEnum.safeParse(it.channel).success ? it.channel! : channels[0],
          title: (it.title ?? "").slice(0, 280) || null,
          body: (it.body ?? "").slice(0, 8000) || null,
          hashtags: Array.isArray(it.hashtags) ? it.hashtags.slice(0, 30) : [],
          status: "pending",
          created_by: context.userId,
          meta: { prompt: data.prompt } as Json,
        }));

        if (rows.length === 0) throw new Error("No content items could be created");

        const { data: inserted, error } = await context.supabase
          .from("content_items")
          .insert(rows)
          .select(CONTENT_COLS);
        if (error) throw new Error(error.message);
        invalidateStudioContext(data.workspaceId);

        await context.supabase.from("agent_runs").insert({
          workspace_id: data.workspaceId,
          agent: data.agent,
          prompt: data.prompt,
          status: "completed",
          output: { count: inserted?.length ?? 0 },
          created_by: context.userId,
        });

        return (inserted ?? []) as ContentItem[];
      },
    );
    return result;
  });

/* ------------------------------------------------------------ */
/* Content Calendar: plan a set of dated posts                   */
/* ------------------------------------------------------------ */
// Days, times, channels and topics are decided by `buildPlanSlots` (pure), so a
// plan always holds exactly what was asked for. The model works in two steps:
// one call picks a distinct idea for every slot, then the posts are written a
// few at a time with the whole list in view, so no two say the same thing.
const PlanChannelEnum = z.enum([
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
const ymd = z.string().refine(isYMD, "Use a real date (YYYY-MM-DD).");
const PlanSchema = z.object({
  workspaceId: uuid,
  startDate: ymd,
  weeks: z.number().int().min(1).max(6),
  postsPerWeek: z.number().int().min(1).max(14),
  channels: z.array(PlanChannelEnum).min(1).max(9),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  topics: z
    .array(z.enum(PLAN_TOPICS.map((t) => t.id) as [string, ...string[]]))
    .min(1)
    .max(PLAN_TOPICS.length),
  goal: z.enum(PLAN_GOALS.map((g) => g.id) as [string, ...string[]]),
  industry: z.string().max(40).default("auto"),
  keyDates: z.boolean().default(true),
  notes: z.string().max(1500).optional(),
  /** Brand Kit Style: an id, "none", or absent for the workspace default. */
  styleId: z.union([uuid, z.literal("none")]).nullish(),
});

const PlanIdeasSchema = z.object({
  ideas: z.array(z.object({ slot: z.number().int(), idea: z.string().min(3).max(300) })),
});
const PlanPostsSchema = z.object({
  posts: z.array(
    z.object({
      slot: z.number().int(),
      title: z.string().min(2).max(200),
      caption: z.string().min(20),
      hashtags: z.array(z.string()).optional(),
    }),
  ),
});

const PLAN_CHUNK = 6;

function slotLine(slot: PlanSlot): string {
  const topic = PLAN_TOPICS.find((t) => t.id === slot.topic);
  return `${slot.index}. ${slot.date} · ${slot.channel} · ${slot.format} · topic: ${topic?.label ?? slot.topic}${
    slot.moment ? ` · about ${slot.moment.name} (${slot.moment.date}): ${slot.moment.angle}` : ""
  }`;
}

export const planContentCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("generate")])
  .inputValidator((data) => PlanSchema.parse(data))
  .handler(async ({ data, context }) => {
    const role = await requireWorkspaceRole(context, data.workspaceId, "editor");
    const slots = buildPlanSlots({
      startDate: data.startDate,
      weeks: data.weeks,
      postsPerWeek: data.postsPerWeek,
      channels: data.channels,
      weekdays: data.weekdays,
      topics: data.topics as PlanTopicId[],
      industry: data.industry,
      keyDates: data.keyDates,
    });
    if (!slots.length) throw new HttpError(400, "Pick at least one day to post on.");
    if (slots.length > MAX_PLAN_POSTS)
      throw new HttpError(
        400,
        `A plan can hold up to ${MAX_PLAN_POSTS} posts. Choose fewer weeks or posts.`,
      );

    const { runMetered } = await import("@/server/billing/metered.server");
    const { result } = await runMetered(
      {
        workspaceId: data.workspaceId,
        userId: context.userId,
        role,
        action: "post_set",
        // One post set covers up to three drafts.
        quantity: Math.ceil(slots.length / 3),
        idempotencyKey: crypto.randomUUID(),
        route: "content.planCalendar",
      },
      async () => {
        const studioContext = await loadStudioContext(
          context.supabase as never,
          data.workspaceId,
          null,
        );
        const { styleTextFor } = await import("@/server/brand-kit/resolve.server");
        const styleText = await styleTextFor(data.workspaceId, data.styleId, "social");
        const goal = PLAN_GOALS.find((g) => g.id === data.goal) ?? PLAN_GOALS[0];
        const industry = industryById(data.industry);
        const usedTopics = PLAN_TOPICS.filter((t) => data.topics.includes(t.id));

        const shared = [
          `## Brand\n${studioContext.brandText || "No brand details saved. Keep claims general."}`,
          styleText
            ? `## Writing style (follow exactly)\n${styleText.replace(/^## /gm, "### ")}`
            : "",
          `## Goal\n${goal.brief}`,
          industry.id !== "auto"
            ? `## Kind of business\n${industry.label}.${industry.rule ? ` ${industry.rule}` : ""}`
            : "",
          `## Topics\n${usedTopics.map((t) => `- ${t.label}: ${t.brief}`).join("\n")}`,
          data.notes?.trim() ? `## What the owner wants covered\n${data.notes.trim()}` : "",
          studioContext.recent.length
            ? `## Already posted or drafted (do not repeat)\n${studioContext.recent
                .slice(0, 12)
                .map((item) => `- ${item.title}`)
                .join("\n")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n");

        const rules =
          "Write for this brand only, in its voice. Never invent customers, quotes, results, statistics, prices, offers or news: use what the brand context and the owner's notes give you, and keep everything else general. No placeholders such as [brand]. Return strict JSON only, no code fences.";

        // Step 1 — one distinct idea per slot, chosen with the whole plan in view.
        const ideas = await runStructuredPrompt({
          route: "content.planCalendar",
          system: `You plan a brand's content calendar. Give every numbered slot one specific post idea (one sentence: the point of the post and its angle). No two ideas may make the same point. Each idea must fit its slot's channel, type and topic; a slot marked "about" a date must be about that date. ${rules}\nSchema: {"ideas":[{"slot":number,"idea":string}]}`,
          user: `${shared}\n\n## Slots\n${slots.map(slotLine).join("\n")}`,
          schema: PlanIdeasSchema,
          maxTokens: 500 + slots.length * 90,
          temperature: 0.8,
          regenerate: true,
        });
        const ideaBySlot = new Map(ideas.ideas.map((i) => [i.slot, i.idea.trim()]));
        const planned = slots.filter((s) => ideaBySlot.has(s.index));
        if (planned.length < Math.ceil(slots.length / 2))
          throw new AiOutputError("The plan came back incomplete. Please try again.");
        const overview = planned.map((s) => `${s.index}. ${ideaBySlot.get(s.index)}`).join("\n");

        // Step 2 — write the posts a few at a time.
        const chunks: PlanSlot[][] = [];
        for (let i = 0; i < planned.length; i += PLAN_CHUNK)
          chunks.push(planned.slice(i, i + PLAN_CHUNK));
        const written = await Promise.allSettled(
          chunks.map((chunk) =>
            runStructuredPrompt({
              route: "content.planCalendar",
              system: `You write ready-to-post content. Write the post for each slot listed under "Write these", following its idea. The first line of every caption is the hook. Social posts: 50-150 words, written the way that channel reads, with one clear next step. Article: a 120-200 word outline with a direct answer first, then the section headings. Email: the title is the subject line, the caption is the email body. Up to 6 hashtags for social posts, none for articles and emails. ${rules}\nSchema: {"posts":[{"slot":number,"title":string,"caption":string,"hashtags":string[]}]}`,
              user: `${shared}\n\n## The whole plan (for context; do not repeat another slot's point)\n${overview}\n\n## Write these\n${chunk
                .map((s) => `${slotLine(s)}\n   idea: ${ideaBySlot.get(s.index)}`)
                .join("\n")}`,
              schema: PlanPostsSchema,
              maxTokens: 500 + chunk.length * 480,
              temperature: 0.75,
              regenerate: true,
            }),
          ),
        );
        const postBySlot = new Map<number, z.infer<typeof PlanPostsSchema>["posts"][number]>();
        for (const outcome of written) {
          if (outcome.status !== "fulfilled") continue;
          for (const post of outcome.value.posts) postBySlot.set(post.slot, post);
        }
        const ready = planned.filter((s) => postBySlot.has(s.index));
        if (!ready.length) {
          const failure = written.find((o) => o.status === "rejected");
          if (failure?.status === "rejected" && failure.reason instanceof Error)
            throw failure.reason;
          throw new AiOutputError("The posts could not be written. Please try again.");
        }

        const rows = ready.map((slot) => {
          const post = postBySlot.get(slot.index)!;
          const kind =
            slot.channel === "blog" ? "blog" : slot.channel === "email" ? "email" : "post";
          return {
            workspace_id: data.workspaceId,
            agent: "spark",
            kind,
            channel: slot.channel,
            title: humanizeText(post.title).slice(0, 280),
            body: humanizeText(post.caption).slice(0, 8000),
            hashtags:
              kind === "post" && Array.isArray(post.hashtags)
                ? post.hashtags
                    .map((tag) => tag.trim().slice(0, 60))
                    .filter(Boolean)
                    .slice(0, 6)
                : [],
            status: "draft",
            created_by: context.userId,
            meta: {
              source: "calendar-generator",
              calendar_date: slot.date,
              calendar_time: slot.time,
              format: slot.format,
              pillar: topicLabel(slot.topic),
              ...(slot.moment ? { moment: slot.moment.name } : {}),
            } as Json,
          };
        });

        const { data: inserted, error } = await context.supabase
          .from("content_items")
          .insert(rows)
          .select(CONTENT_COLS);
        if (error) throw new Error(error.message);
        invalidateStudioContext(data.workspaceId);

        return {
          items: (inserted ?? []) as ContentItem[],
          requested: slots.length,
        };
      },
    );
    return result;
  });

/* ------------------------------------------------------------ */
/* Content Calendar: move a post to another day                  */
/* ------------------------------------------------------------ */
// Changes only where a post sits on the calendar. It never schedules, never
// approves and never un-approves: a post that is on its way out (or already
// out) is refused, because its time belongs to the publishing provider.
export const setContentPlanDate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        id: uuid,
        date: ymd,
        time: z.string().refine(isHM, "Use a real time (HH:mm).").optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: current, error: readError } = await context.supabase
      .from("content_items")
      .select("workspace_id, status, meta")
      .eq("id", data.id)
      .single();
    if (readError || !current) throw new HttpError(404, "Post not found");
    await requireWorkspaceRole(context, current.workspace_id, "editor");
    if (["scheduled", "publishing", "published"].includes(current.status))
      throw new HttpError(
        409,
        "This post is already scheduled or posted. Cancel the schedule to move it.",
      );
    const meta = mergeMeta(current.meta, {
      calendar_date: data.date,
      ...(data.time ? { calendar_time: data.time } : {}),
    });
    const { data: row, error } = await context.supabase
      .from("content_items")
      .update({ meta: meta as Json })
      .eq("id", data.id)
      .select(CONTENT_COLS)
      .single();
    if (error || !row) throw new Error(error?.message ?? "Update failed");
    return row as ContentItem;
  });

/* ------------------------------------------------------------ */
/* Approve / Reject shortcuts                                    */
/* ------------------------------------------------------------ */
export const setContentItemStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: uuid, status: StatusEnum }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: current, error: readError } = await context.supabase
      .from("content_items")
      .select("status")
      .eq("id", data.id)
      .single();
    if (readError || !current) throw new Error(readError?.message ?? "Content item not found");
    assertContentTransition(current.status, data.status);
    const { data: row, error } = await context.supabase
      .from("content_items")
      .update({ status: data.status })
      .eq("id", data.id)
      .select(CONTENT_COLS)
      .single();
    if (error || !row) throw new Error(error?.message ?? "Update failed");
    return row as ContentItem;
  });

/* ------------------------------------------------------------ */
/* Agency HQ aggregate                                           */
/* ------------------------------------------------------------ */
export const listAgencyFeed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ limit: z.number().int().min(1).max(500).optional() }).parse(data ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("content_items")
      .select(CONTENT_COLS)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 200);
    if (error) throw new Error(error.message);

    const { data: runs } = await context.supabase
      .from("agent_runs")
      .select("id, workspace_id, agent, prompt, status, created_at, output")
      .order("created_at", { ascending: false })
      .limit(50);

    return {
      items: (rows ?? []) as ContentItem[],
      runs: runs ?? [],
    };
  });

/* ------------------------------------------------------------ */
/* Suggest next steps (real, brand-grounded)                     */
/* ------------------------------------------------------------ */
const SuggestSchema = z.object({
  workspaceId: uuid.optional(),
  context: z.string().max(6000).optional(),
  lastUserMessage: z.string().max(2000).optional(),
});

export type NextStepSuggestion = {
  label: string;
  prompt: string;
  agent?: "scout" | "spark" | "echo";
};

export const suggestNextSteps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => SuggestSchema.parse(data ?? {}))
  .handler(async ({ data, context }) => {
    // Live stats for the workspace ground the suggestions in real activity.
    let stats = { pending: 0, scheduled: 0, published: 0, recentTitles: [] as string[] };
    if (data.workspaceId) {
      const [p, s, pub, recent] = await Promise.all([
        context.supabase
          .from("content_items")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", data.workspaceId)
          .eq("status", "pending"),
        context.supabase
          .from("content_items")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", data.workspaceId)
          .eq("status", "scheduled"),
        context.supabase
          .from("content_items")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", data.workspaceId)
          .eq("status", "published"),
        context.supabase
          .from("content_items")
          .select("title")
          .eq("workspace_id", data.workspaceId)
          .order("created_at", { ascending: false })
          .limit(5),
      ]);
      stats = {
        pending: p.count ?? 0,
        scheduled: s.count ?? 0,
        published: pub.count ?? 0,
        recentTitles: ((recent.data ?? []) as { title: string | null }[])
          .map((r) => r.title)
          .filter((t): t is string => !!t),
      };
    }

    // Deterministic — buildNextSteps ranks prebuilt templates using
    // real workspace stats + brand facts. Zero tokens, sub-ms.
    const steps = buildNextSteps(stats, data.context, data.lastUserMessage);
    return { steps, stats };
  });

/* ------------------------------------------------------------ */
/* Generate next recommended post                                */
/* ------------------------------------------------------------ */
const NextPostSchema = z.object({
  workspaceId: uuid,
  context: z.string().max(6000).optional(),
  websiteUrl: z.string().max(2048).optional().nullable(),
  channel: ChannelEnum.optional(),
});

const CHANNEL_ROTATION: Array<z.infer<typeof ChannelEnum>> = [
  "instagram",
  "linkedin",
  "x",
  "tiktok",
  "blog",
];

export const generateNextPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("generate")])
  .inputValidator((data) => NextPostSchema.parse(data))
  .handler(async ({ data, context }) => {
    // Writing a new draft spends credits and changes content: editors only.
    const role = await requireWorkspaceRole(context, data.workspaceId, "editor");
    const { runMetered } = await import("@/server/billing/metered.server");
    const { result } = await runMetered(
      {
        workspaceId: data.workspaceId,
        userId: context.userId,
        role,
        action: "post_regenerate",
        idempotencyKey: crypto.randomUUID(),
        route: "content.generateNextPost",
      },
      async () => {
        // Recent items ground the suggestion in real history
        const { data: recent } = await context.supabase
          .from("content_items")
          .select("title, body, channel, kind, status, created_at")
          .eq("workspace_id", data.workspaceId)
          .order("created_at", { ascending: false })
          .limit(15);
        const recentRows = (recent ?? []) as Array<{
          title: string | null;
          body: string | null;
          channel: string | null;
          kind: string | null;
          status: string | null;
        }>;

        // Pick the channel that's used least recently (unless caller overrides)
        let targetChannel: z.infer<typeof ChannelEnum> = data.channel ?? "instagram";
        if (!data.channel) {
          const usage = new Map<string, number>();
          for (const r of recentRows) {
            if (r.channel) usage.set(r.channel, (usage.get(r.channel) ?? 0) + 1);
          }
          let best = CHANNEL_ROTATION[0];
          let bestScore = Infinity;
          for (const c of CHANNEL_ROTATION) {
            const score = usage.get(c) ?? 0;
            if (score < bestScore) {
              bestScore = score;
              best = c;
            }
          }
          targetChannel = best;
        }

        const recentSummary =
          recentRows
            .slice(0, 8)
            .map(
              (r, i) =>
                `${i + 1}. [${r.channel ?? "?"}] ${r.title ?? "(untitled)"}${r.body ? ` — ${r.body.slice(0, 90)}` : ""}`,
            )
            .join("\n") || "(no recent posts)";

        const { system, user } = nextPostPrompt({
          brandContext: data.context,
          websiteUrl: data.websiteUrl,
          targetChannel,
          recentSummary,
        });

        const parsed = await runJsonPrompt<{
          title?: string;
          body?: string;
          hashtags?: string[];
          rationale?: string;
        }>({
          route: "content.generateNextPost",
          system,
          user,
          fallback: {},
          maxTokens: 900,
          temperature: 0.72,
        });

        if (!parsed.body && !parsed.title) throw new Error("AI returned no content");

        const { data: row, error } = await context.supabase
          .from("content_items")
          .insert({
            workspace_id: data.workspaceId,
            agent: "spark",
            kind: "post",
            channel: targetChannel,
            title: (parsed.title ?? "").slice(0, 280) || null,
            body: (parsed.body ?? "").slice(0, 8000) || null,
            hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.slice(0, 30) : [],
            status: "pending",
            created_by: context.userId,
            meta: {
              source: "next-post",
              rationale: parsed.rationale ?? null,
            } as Json,
          })
          .select(CONTENT_COLS)
          .single();
        if (error || !row) throw new Error(error?.message ?? "Insert failed");

        await context.supabase.from("agent_runs").insert({
          workspace_id: data.workspaceId,
          agent: "spark",
          prompt: `Next post for ${targetChannel}`,
          status: "completed",
          output: { id: row.id, channel: targetChannel } as Json,
          created_by: context.userId,
        });

        return {
          item: row as ContentItem,
          channel: targetChannel,
          rationale: parsed.rationale ?? null,
        };
      },
    );
    return result;
  });
