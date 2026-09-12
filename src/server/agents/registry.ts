// registry.ts — the typed capability layer (audit Stage 3): every operation an
// agent may perform, with schema, permissions, effect class, timeout and
// idempotency declared up front.
//
// Deliberately absent: publish, schedule-to-platform, OAuth connect/reconnect,
// credential access, raw SQL, cross-workspace reads. Those stay conventional,
// human-driven flows (audit §35). Every query below is scoped to
// ctx.workspaceId — a tool can only ever see its own tenant.
import "server-only";
import { z } from "zod";
import type { ToolDefinition } from "./types";

const uuid = z.string().uuid();
const IN_FLIGHT = ["publishing", "pending", "retrying"];

const PublicationRow = z.object({
  id: z.string(),
  content_item_id: z.string(),
  platform: z.string(),
  account_id: z.string(),
  status: z.string(),
  error_category: z.string().nullable().optional(),
  last_error: z.string().nullable().optional(),
  updated_at: z.string(),
  attempt: z.number().nullable().optional(),
});

function sinceIso(ctx: { now: () => Date }, hours: number): string {
  return new Date(ctx.now().getTime() - hours * 3600_000).toISOString();
}

// ── read tools ────────────────────────────────────────────────────────────
const publicationsSummary: ToolDefinition<{ days: number }, Record<string, number>> = {
  name: "publications.summary",
  description: "Count this workspace's deliveries by status over the last N days.",
  effect: "read",
  minRole: "viewer",
  input: z.object({ days: z.number().int().min(1).max(30).default(7) }),
  output: z.record(z.number()),
  timeoutMs: 10_000,
  idempotent: true,
  async handler({ days }, ctx) {
    const { data, error } = await ctx.db
      .from("content_publications")
      .select("status")
      .eq("workspace_id", ctx.workspaceId)
      .gte("updated_at", sinceIso(ctx, days * 24));
    if (error) throw new Error(error.message);
    const counts: Record<string, number> = {};
    for (const r of (data ?? []) as Array<{ status: string }>)
      counts[r.status] = (counts[r.status] ?? 0) + 1;
    return counts;
  },
};

const publicationsListStale: ToolDefinition<
  { olderThanMinutes: number; limit: number },
  Array<z.infer<typeof PublicationRow>>
> = {
  name: "publications.list_stale",
  description: "Deliveries still in flight (publishing/pending/retrying) past the SLA.",
  effect: "read",
  minRole: "viewer",
  input: z.object({
    olderThanMinutes: z
      .number()
      .int()
      .min(5)
      .max(24 * 60)
      .default(30),
    limit: z.number().int().min(1).max(100).default(50),
  }),
  output: z.array(PublicationRow),
  timeoutMs: 10_000,
  idempotent: true,
  async handler({ olderThanMinutes, limit }, ctx) {
    const { data, error } = await ctx.db
      .from("content_publications")
      .select(
        "id, content_item_id, platform, account_id, status, error_category, last_error, updated_at, attempt",
      )
      .eq("workspace_id", ctx.workspaceId)
      .in("status", IN_FLIGHT)
      .lt("updated_at", new Date(ctx.now().getTime() - olderThanMinutes * 60_000).toISOString())
      .order("updated_at", { ascending: true })
      .limit(limit);
    if (error) throw new Error(error.message);
    return data ?? [];
  },
};

const publicationsRecentFailures: ToolDefinition<
  { hours: number; limit: number },
  Array<z.infer<typeof PublicationRow>>
> = {
  name: "publications.recent_failures",
  description: "Failed deliveries in the last N hours with their error category.",
  effect: "read",
  minRole: "viewer",
  input: z.object({
    hours: z
      .number()
      .int()
      .min(1)
      .max(24 * 14)
      .default(72),
    limit: z.number().int().min(1).max(200).default(100),
  }),
  output: z.array(PublicationRow),
  timeoutMs: 10_000,
  idempotent: true,
  async handler({ hours, limit }, ctx) {
    const { data, error } = await ctx.db
      .from("content_publications")
      .select(
        "id, content_item_id, platform, account_id, status, error_category, last_error, updated_at, attempt",
      )
      .eq("workspace_id", ctx.workspaceId)
      .eq("status", "failed")
      .gte("updated_at", sinceIso(ctx, hours))
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return data ?? [];
  },
};

const contentStatusContradictions: ToolDefinition<
  { limit: number },
  Array<{ contentItemId: string; itemStatus: string; deliveryStatuses: string[] }>
> = {
  name: "content.status_contradictions",
  description: "Content items whose editorial status disagrees with their delivery rows.",
  effect: "read",
  minRole: "viewer",
  input: z.object({ limit: z.number().int().min(1).max(200).default(100) }),
  output: z.array(
    z.object({
      contentItemId: z.string(),
      itemStatus: z.string(),
      deliveryStatuses: z.array(z.string()),
    }),
  ),
  timeoutMs: 15_000,
  idempotent: true,
  async handler({ limit }, ctx) {
    const { data: items, error } = await ctx.db
      .from("content_items")
      .select("id, status")
      .eq("workspace_id", ctx.workspaceId)
      .in("status", ["published", "publishing", "partial_failed", "failed"])
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    const ids = (items ?? []).map((i: { id: string }) => i.id);
    if (!ids.length) return [];
    const { data: pubs } = await ctx.db
      .from("content_publications")
      .select("content_item_id, status")
      .eq("workspace_id", ctx.workspaceId)
      .in("content_item_id", ids);
    const byItem = new Map<string, string[]>();
    for (const p of (pubs ?? []) as Array<{ content_item_id: string; status: string }>) {
      byItem.set(p.content_item_id, [...(byItem.get(p.content_item_id) ?? []), p.status]);
    }
    const out: Array<{ contentItemId: string; itemStatus: string; deliveryStatuses: string[] }> =
      [];
    for (const item of (items ?? []) as Array<{ id: string; status: string }>) {
      const statuses = byItem.get(item.id) ?? [];
      if (!statuses.length) continue;
      const inFlight = statuses.some((s) => IN_FLIGHT.includes(s));
      const allTerminal = statuses.every((s) => ["published", "failed", "cancelled"].includes(s));
      const contradiction =
        ((item.status === "published" ||
          item.status === "failed" ||
          item.status === "partial_failed") &&
          inFlight) ||
        (item.status === "publishing" && allTerminal);
      if (contradiction)
        out.push({ contentItemId: item.id, itemStatus: item.status, deliveryStatuses: statuses });
    }
    return out;
  },
};

const webhooksRecentRejections: ToolDefinition<
  { hours: number },
  { rejected: number; stale: number; verified: number; lastRejectedAt: string | null }
> = {
  name: "webhooks.recent_rejections",
  description: "Delivery-webhook receipts for this workspace: verified vs rejected vs stale.",
  effect: "read",
  minRole: "viewer",
  input: z.object({
    hours: z
      .number()
      .int()
      .min(1)
      .max(24 * 7)
      .default(24),
  }),
  output: z.object({
    rejected: z.number(),
    stale: z.number(),
    verified: z.number(),
    lastRejectedAt: z.string().nullable(),
  }),
  timeoutMs: 10_000,
  idempotent: true,
  async handler({ hours }, ctx) {
    const { data, error } = await ctx.db
      .from("sdr_webhook_events")
      .select("outcome, received_at")
      .eq("workspace_id", ctx.workspaceId)
      .gte("received_at", sinceIso(ctx, hours))
      .order("received_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ outcome: string; received_at: string }>;
    return {
      rejected: rows.filter((r) => r.outcome === "rejected").length,
      stale: rows.filter((r) => r.outcome === "stale").length,
      verified: rows.filter((r) => r.outcome === "verified").length,
      lastRejectedAt:
        rows.find((r) => r.outcome === "rejected" || r.outcome === "stale")?.received_at ?? null,
    };
  },
};

const schedulerHeartbeats: ToolDefinition<
  Record<string, never>,
  Array<{
    job: string;
    lastSucceededAt: string | null;
    expectedIntervalSeconds: number;
    overdue: boolean;
  }>
> = {
  name: "scheduler.heartbeats",
  description: "Platform scheduler health: when each cron job last succeeded (no tenant data).",
  effect: "read",
  minRole: "viewer",
  input: z.object({}).strict(),
  output: z.array(
    z.object({
      job: z.string(),
      lastSucceededAt: z.string().nullable(),
      expectedIntervalSeconds: z.number(),
      overdue: z.boolean(),
    }),
  ),
  timeoutMs: 10_000,
  idempotent: true,
  async handler(_input, ctx) {
    const { data, error } = await ctx.db
      .from("cron_heartbeats")
      .select("job, last_succeeded_at, expected_interval_seconds");
    if (error) throw new Error(error.message);
    return (
      (data ?? []) as Array<{
        job: string;
        last_succeeded_at: string | null;
        expected_interval_seconds: number;
      }>
    ).map((r) => ({
      job: r.job,
      lastSucceededAt: r.last_succeeded_at,
      expectedIntervalSeconds: r.expected_interval_seconds,
      overdue:
        !r.last_succeeded_at ||
        ctx.now().getTime() - new Date(r.last_succeeded_at).getTime() >
          r.expected_interval_seconds * 3000,
    }));
  },
};

const ContentItem = z.object({
  id: z.string(),
  channel: z.string().nullable(),
  kind: z.string(),
  status: z.string(),
  title: z.string().nullable(),
  body: z.string().nullable(),
  hashtags: z.array(z.string()).nullable(),
  media_url: z.string().nullable(),
});

const contentGet: ToolDefinition<{ id: string }, z.infer<typeof ContentItem>> = {
  name: "content.get",
  description: "Read one content item of this workspace.",
  effect: "read",
  minRole: "viewer",
  input: z.object({ id: uuid }),
  output: ContentItem,
  timeoutMs: 10_000,
  idempotent: true,
  async handler({ id }, ctx) {
    const { data, error } = await ctx.db
      .from("content_items")
      .select("id, channel, kind, status, title, body, hashtags, media_url")
      .eq("id", id)
      .eq("workspace_id", ctx.workspaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    // Another workspace's id is indistinguishable from a missing one.
    if (!data) throw new Error("Content item not found");
    return data;
  },
};

// ── write tools (always approval-gated by policy) ─────────────────────────
const RevisionInput = z.object({
  contentItemId: uuid,
  title: z.string().max(280).optional(),
  body: z.string().min(1).max(8000),
  hashtags: z.array(z.string().max(60)).max(30).optional(),
  reasons: z.array(z.string().max(300)).max(10).default([]),
});

const contentApplyRevision: ToolDefinition<
  z.infer<typeof RevisionInput>,
  { id: string; status: string }
> = {
  name: "content.apply_revision",
  description: "Apply a proposed revision to a content item's copy",
  effect: "write",
  minRole: "editor",
  input: RevisionInput,
  output: z.object({ id: z.string(), status: z.string() }),
  timeoutMs: 15_000,
  idempotent: true,
  affects: (input) => [{ table: "content_items", id: input.contentItemId }],
  async preview(input, ctx) {
    const { data } = await ctx.db
      .from("content_items")
      .select("title, body, hashtags")
      .eq("id", input.contentItemId)
      .eq("workspace_id", ctx.workspaceId)
      .maybeSingle();
    return {
      before: {
        title: data?.title ?? null,
        body: data?.body ?? null,
        hashtags: data?.hashtags ?? [],
      },
      after: {
        title: input.title ?? data?.title ?? null,
        body: input.body,
        hashtags: input.hashtags ?? data?.hashtags ?? [],
      },
      reasons: input.reasons,
    };
  },
  async handler(input, ctx) {
    const patch: Record<string, unknown> = { body: input.body };
    if (input.title !== undefined) patch.title = input.title;
    if (input.hashtags !== undefined) patch.hashtags = input.hashtags;
    const { data, error } = await ctx.db
      .from("content_items")
      .update(patch)
      .eq("id", input.contentItemId)
      .eq("workspace_id", ctx.workspaceId)
      .select("id, status")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Content item not found");
    return data;
  },
};

const DraftInput = z.object({
  title: z.string().min(1).max(280),
  body: z.string().max(8000).default(""),
  channel: z.string().max(40).optional(),
  kind: z.enum(["post", "brief", "email", "landing", "blog"]).default("post"),
  proposedAt: z.string().datetime().optional(),
});

const contentCreateDraft: ToolDefinition<z.infer<typeof DraftInput>, { id: string }> = {
  name: "content.create_draft",
  description: "Create a draft content item in the approval queue",
  effect: "write",
  minRole: "editor",
  input: DraftInput,
  output: z.object({ id: z.string() }),
  timeoutMs: 15_000,
  idempotent: false,
  preview: (input) => ({
    title: input.title,
    channel: input.channel ?? null,
    proposedAt: input.proposedAt ?? null,
  }),
  async handler(input, ctx) {
    const { data, error } = await ctx.db
      .from("content_items")
      .insert({
        workspace_id: ctx.workspaceId,
        agent: "spark",
        kind: input.kind,
        channel: input.channel ?? null,
        title: input.title,
        body: input.body,
        status: "pending",
        created_by: ctx.actor.kind === "user" ? ctx.actor.userId : null,
        meta: { source: "agent", proposed_at: input.proposedAt ?? null, run_id: ctx.runId ?? null },
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Draft could not be created");
    return data;
  },
};

const memorySaveNote: ToolDefinition<{ body: string }, { id: string }> = {
  name: "memory.save_note",
  description: "Save a note to the workspace memory (it informs future answers)",
  effect: "write",
  minRole: "editor",
  input: z.object({ body: z.string().min(3).max(1200) }),
  output: z.object({ id: z.string() }),
  timeoutMs: 10_000,
  idempotent: false,
  preview: (input) => ({ note: input.body.slice(0, 300) }),
  async handler({ body }, ctx) {
    const { data, error } = await ctx.db
      .from("memory_insights")
      .insert({ workspace_id: ctx.workspaceId, body })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Note could not be saved");
    return data;
  },
};

const TOOLS: ToolDefinition[] = [
  publicationsSummary,
  publicationsListStale,
  publicationsRecentFailures,
  contentStatusContradictions,
  webhooksRecentRejections,
  schedulerHeartbeats,
  contentGet,
  contentApplyRevision,
  contentCreateDraft,
  memorySaveNote,
] as ToolDefinition[];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): ToolDefinition | undefined {
  return BY_NAME.get(name);
}

/** Capability discovery: name, description, effect, role, approval need. */
export function listTools() {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    effect: t.effect,
    minRole: t.minRole,
    requiresApproval: t.effect === "write" || t.effect === "external",
    idempotent: t.idempotent,
    timeoutMs: t.timeoutMs,
  }));
}
