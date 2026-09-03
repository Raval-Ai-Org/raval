import { createServerFn } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { runJsonPrompt } from "@/lib/ai";
import { contentBatchPrompt, nextPostPrompt, regeneratePrompt } from "@/lib/ai/prompts";
import { buildNextSteps } from "@/lib/ai/deterministic-suggestions";

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
const StatusEnum = z.enum([
  "draft",
  "pending",
  "approved",
  "rejected",
  "scheduled",
  "publishing",
  "published",
]);

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
    return (rows ?? []) as ContentItem[];
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
    const { data: row, error } = await context.supabase
      .from("content_items")
      .update(data.patch as never)
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
    if (data.scheduled_at) patch.status = "scheduled";
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
// Legacy `callLovableAi` + `safeParse` helpers removed; all calls now
// route through `runJsonPrompt` (shared cache + safe parsing).

function extractBrandFact(context?: string | null, label = "Brand") {
  if (!context) return "";
  const line = context
    .split("\n")
    .find((l) => l.toLowerCase().startsWith(label.toLowerCase() + ":"));
  return line?.split(":").slice(1).join(":").trim() ?? "";
}

function fallbackGeneratedItems(args: {
  count: number;
  channels: string[];
  context?: string | null;
  prompt: string;
}): Array<{ channel: string; kind: string; title: string; body: string; hashtags: string[] }> {
  const brand = extractBrandFact(args.context, "Brand") || "the brand";
  const offer =
    extractBrandFact(args.context, "Products") ||
    extractBrandFact(args.context, "One-liner") ||
    "the core offer";
  const audience = extractBrandFact(args.context, "Audience") || "the target audience";
  return Array.from({ length: args.count }, (_, i) => {
    const channel = args.channels[i % args.channels.length] ?? "linkedin";
    const kind = channel === "web" ? "brief" : channel === "email" ? "email" : "post";
    const title =
      kind === "brief"
        ? `${brand}: SEO brief for ${offer}`
        : kind === "email"
          ? `${brand}: customer update`
          : `${brand}: ${channel} post for ${audience}`;
    const body =
      kind === "brief"
        ? `Target query: ${offer}\nIntent: Help ${audience} understand why ${brand} is relevant now.\nAnswer snippet: ${brand} helps ${audience} with ${offer}. Build the page around the problem, proof, offer, FAQ, and one clear next step.\nRecommended H2s: Problem, Solution, Proof, FAQs, CTA.`
        : kind === "email"
          ? `Subject: A practical next step from ${brand}\nPreview: Built for ${audience}.\n\nHi — if ${audience} are looking for a clearer way to move forward, ${brand} can help with ${offer}. The next best step is simple: review the offer, match it to the customer's current need, and make the CTA easy to act on.`
          : `${brand} is built for ${audience}.\n\nThe message to lead with: ${offer}.\n\nWhen the value is specific, useful, and easy to act on, the right people know why they should pay attention.\n\nWhat would you want your audience to do next?`;
    return {
      channel,
      kind,
      title,
      body,
      hashtags: [brand, "marketing", "growth"]
        .map(
          (h) =>
            `#${h
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "")
              .slice(0, 24)}`,
        )
        .filter((h) => h.length > 1),
    };
  });
}

/* ------------------------------------------------------------ */
/* Regenerate copy on an existing item                           */
/* ------------------------------------------------------------ */
export const regenerateContentItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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

    const parsed = await runJsonPrompt<{ title?: string; body?: string; hashtags?: string[] }>({
      route: "content.regenerate",
      system,
      user,
      fallback: {},
      maxTokens: 900,
      temperature: 0.7,
    });

    const { data: row, error } = await context.supabase
      .from("content_items")
      .update({
        title: parsed.title ?? existing.title,
        body: parsed.body ?? existing.body,
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
  .middleware([requireSupabaseAuth])
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
    const parsed = await runJsonPrompt<{ items?: Item[] }>({
      route: "content.generateBatch",
      system,
      user,
      fallback: { items: [] },
      maxTokens: 1600,
      temperature: 0.72,
    });

    const items = (parsed.items ?? []).filter(
      (it) => typeof it.body === "string" && it.body.trim(),
    );
    const safeItems =
      items.length > 0
        ? items.slice(0, count)
        : fallbackGeneratedItems({ count, channels, context: data.context, prompt: data.prompt });

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
  .middleware([requireSupabaseAuth])
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
