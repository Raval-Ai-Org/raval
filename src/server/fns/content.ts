import "server-only";
import { createServerFn } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rateLimitFor } from "@/server/rate-limit";
import { AiOutputError, runJsonPrompt, runStructuredPrompt } from "@/lib/ai";
import { contentBatchPrompt, nextPostPrompt, regeneratePrompt } from "@/lib/ai/prompts";
import { buildNextSteps } from "@/lib/ai/deterministic-suggestions";
import {
  assertContentTransition,
  CONTENT_STATUSES,
  hasMeaningfulContentChange,
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
  "blog",
  "email",
  "web",
]);
const KindEnum = z.enum(["post", "brief", "email", "landing", "blog"]);
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
      .not("storage_path", "is", null);
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
  body: z.string().max(8000).optional().nullable(),
  hashtags: z.array(z.string().max(60)).max(30).optional(),
  media_url: z.string().url().max(2048).optional().nullable(),
  status: StatusEnum.optional(),
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
      body: z.string().max(8000).optional().nullable(),
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
      .select("status")
      .eq("id", data.id)
      .single();
    if (readError || !current) throw new Error(readError?.message ?? "Content item not found");

    const patch = { ...data.patch } as Record<string, unknown>;
    const currentStatus = current.status as ContentStatus;
    const requestedStatus = patch.status as string | undefined;

    if (currentStatus === "approved" && hasMeaningfulContentChange(patch)) {
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

    const { system, user } = regeneratePrompt({
      channel: existing.channel,
      kind: existing.kind,
      title: existing.title ?? "",
      body: existing.body ?? "",
    });

    // A failed regeneration throws (AiOutputError → 502). It used to return
    // the OLD text as if it had been regenerated, and the cache made pressing
    // "regenerate" return identical copy for 30 minutes.
    const parsed = await runStructuredPrompt({
      route: "content.regenerate",
      system,
      user,
      schema: RegeneratedSchema,
      maxTokens: 1200,
      temperature: 0.7,
      regenerate: true,
    });

    const { data: row, error } = await context.supabase
      .from("content_items")
      .update({
        title: parsed.title ?? existing.title,
        body: parsed.body,
        hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.slice(0, 30) : existing.hashtags,
      })
      .eq("id", data.id)
      .select(CONTENT_COLS)
      .single();
    if (error || !row) throw new Error(error?.message ?? "Update failed");
    return row as ContentItem;
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
  context: z.string().max(6000).optional(),
  websiteUrl: z.string().max(2048).optional().nullable(),
});

export const generateContentBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("generate")])
  .inputValidator((data) => GenerateSchema.parse(data))
  .handler(async ({ data, context }) => {
    const channels = data.channels ?? ["instagram", "x", "linkedin"];
    const count = data.count ?? channels.length;

    const { system, userTail } = contentBatchPrompt({
      agent: data.agent,
      count,
      channels,
      brandContext: data.context,
      websiteUrl: data.websiteUrl,
    });
    const user = `${userTail}\n\n## Brief\n${data.prompt}`;

    type Item = {
      channel?: string;
      kind?: string;
      title?: string;
      body?: string;
      hashtags?: string[];
    };
    // Budget scales with the number of pieces requested (one shared 1,200-token
    // budget used to leave ~150 tokens per post). An unusable answer is
    // repaired once and then surfaced as an error — the old code inserted
    // templated "fallback" posts as if the model had written them.
    const parsed = await runStructuredPrompt({
      route: "content.generateBatch",
      system,
      user,
      schema: BatchSchema,
      maxTokens: Math.min(6000, 300 + count * 500),
      temperature: 0.72,
    });

    const safeItems: Item[] = parsed.items
      .filter((it) => typeof it.body === "string" && it.body.trim())
      .slice(0, count);
    if (safeItems.length === 0) {
      throw new AiOutputError("The AI returned no usable drafts. Please try again.", "empty");
    }

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

    await context.supabase.from("agent_runs").insert({
      workspace_id: data.workspaceId,
      agent: data.agent,
      prompt: data.prompt,
      status: "completed",
      output: { count: inserted?.length ?? 0 },
      created_by: context.userId,
    });

    return (inserted ?? []) as ContentItem[];
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
  });
