// store.server.ts — Autopilot rows in Postgres. Service role: browsers have no
// write policy on these tables, so every caller has checked the workspace and
// the role before it gets here.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ActionRow, EventRow, OpportunityRow, ProgramRow } from "@/lib/autopilot/contracts";
import { WORKER_STATUSES } from "@/lib/autopilot/state";
import type { AutopilotStore } from "./engine";

const db = supabaseAdmin as unknown as SupabaseClient;

function must<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

/** Statuses in which a video has been (or is being) made, for the weekly video limit. */
const VIDEO_COUNTED = [
  "generating",
  "needs_approval",
  "approved",
  "scheduled",
  "published",
  "measured",
  "done",
  "rejected",
  "missed",
];

export const supabaseAutopilotStore: AutopilotStore = {
  async claim(worker, max, leaseSeconds, id) {
    const data = must(
      await db.rpc("claim_autopilot_actions", {
        p_worker: worker,
        p_max: max,
        p_lease_seconds: leaseSeconds,
        p_id: id ?? null,
      }),
    );
    return (data ?? []) as ActionRow[];
  },

  async transition(action, to, patch = {}, opts = {}) {
    let query = db
      .from("autopilot_actions")
      .update({
        ...patch,
        status: to,
        ...(opts.keepLease ? {} : { lease_until: null, locked_by: null }),
      })
      .eq("id", action.id)
      .eq("status", action.status);
    if (opts.worker) query = query.eq("locked_by", opts.worker);
    const rows = must(await query.select("id"));
    return (rows ?? []).length > 0;
  },

  async release(action, worker, patch = {}) {
    must(
      await db
        .from("autopilot_actions")
        .update({ ...patch, lease_until: null, locked_by: null })
        .eq("id", action.id)
        .eq("locked_by", worker),
    );
  },

  async insertActions(rows) {
    if (!rows.length) return [];
    const data = must(
      await db
        .from("autopilot_actions")
        // Rows in one batch don't all carry the same columns (only a Story has
        // `result`). A column a row leaves out must take its default, not NULL.
        .upsert(rows, {
          onConflict: "workspace_id,dedupe_key",
          ignoreDuplicates: true,
          defaultToNull: false,
        })
        .select("*"),
    );
    return (data ?? []) as ActionRow[];
  },

  async getAction(workspaceId, id) {
    const data = must(
      await db
        .from("autopilot_actions")
        .select("*")
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
    );
    return (data as ActionRow | null) ?? null;
  },

  async listActions(workspaceId, opts = {}) {
    let query = db.from("autopilot_actions").select("*").eq("workspace_id", workspaceId);
    if (opts.statuses?.length) query = query.in("status", opts.statuses);
    if (opts.kind) query = query.eq("kind", opts.kind);
    if (opts.since) query = query.gte("updated_at", opts.since);
    const data = must(
      await query
        .order("planned_for", { ascending: true, nullsFirst: false })
        .limit(opts.limit ?? 100),
    );
    return (data ?? []) as ActionRow[];
  },

  async usage(programId, cycle) {
    const data = must(
      await db
        .from("autopilot_actions")
        .select("credits_charged, content_type, status")
        .eq("program_id", programId)
        .eq("cycle", cycle)
        .eq("kind", "content"),
    ) as { credits_charged: number; content_type: string | null; status: string }[] | null;
    let credits = 0;
    let videos = 0;
    for (const row of data ?? []) {
      credits += row.credits_charged ?? 0;
      if (row.content_type === "video" && VIDEO_COUNTED.includes(row.status)) videos++;
    }
    return { credits, videos };
  },

  async autoApprovedSince(workspaceId, since, opts) {
    let query = db
      .from("autopilot_actions")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("approved_via", "auto")
      .gte("updated_at", since);
    if (opts?.contentType) query = query.eq("content_type", opts.contentType);
    if (opts?.excludeContentType)
      query = query.or(`content_type.is.null,content_type.neq.${opts.excludeContentType}`);
    const { count, error } = await query;
    if (error) throw new Error(error.message);
    return count ?? 0;
  },

  async autoActedInCycle(programId, cycle) {
    const { count, error } = await db
      .from("autopilot_actions")
      .select("id", { count: "exact", head: true })
      .eq("program_id", programId)
      .eq("cycle", cycle)
      .not("opportunity_id", "is", null)
      .is("requested_by", null)
      .like("dedupe_key", "opp:%");
    if (error) throw new Error(error.message);
    return count ?? 0;
  },

  async openActionCount(programId) {
    const { count, error } = await db
      .from("autopilot_actions")
      .select("id", { count: "exact", head: true })
      .eq("program_id", programId)
      .in("status", ["proposed", ...WORKER_STATUSES]);
    if (error) throw new Error(error.message);
    return count ?? 0;
  },

  async getProgram(id) {
    const data = must(await db.from("autopilot_programs").select("*").eq("id", id).maybeSingle());
    return (data as ProgramRow | null) ?? null;
  },

  async liveProgram(workspaceId) {
    const data = must(
      await db
        .from("autopilot_programs")
        .select("*")
        .eq("workspace_id", workspaceId)
        .in("status", ["running", "paused"])
        .maybeSingle(),
    );
    return (data as ProgramRow | null) ?? null;
  },

  async insertProgram(row) {
    const data = must(await db.from("autopilot_programs").insert(row).select("*").single());
    return data as ProgramRow;
  },

  async updateProgram(id, patch, expectStatus) {
    let query = db.from("autopilot_programs").update(patch).eq("id", id);
    if (expectStatus) query = query.eq("status", expectStatus);
    const rows = must(await query.select("id"));
    return (rows ?? []).length > 0;
  },

  async knownFingerprints(workspaceId, since) {
    const data = must(
      await db
        .from("marketing_opportunities")
        .select("fingerprint, title")
        .eq("workspace_id", workspaceId)
        .gte("created_at", since)
        .limit(400),
    );
    return (data ?? []) as { fingerprint: string; title: string }[];
  },

  async insertOpportunities(rows) {
    if (!rows.length) return [];
    const data = must(
      await db
        .from("marketing_opportunities")
        .upsert(rows, { onConflict: "workspace_id,fingerprint", ignoreDuplicates: true })
        .select("*"),
    );
    return (data ?? []) as OpportunityRow[];
  },

  async getOpportunity(workspaceId, id) {
    const data = must(
      await db
        .from("marketing_opportunities")
        .select("*")
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
    );
    return (data as OpportunityRow | null) ?? null;
  },

  async listOpportunities(workspaceId, opts = {}) {
    let query = db.from("marketing_opportunities").select("*").eq("workspace_id", workspaceId);
    if (opts.statuses?.length) query = query.in("status", opts.statuses);
    const data = must(
      await query
        .gt("expires_at", new Date().toISOString())
        .order("score", { ascending: false })
        .limit(opts.limit ?? 30),
    );
    return (data ?? []) as OpportunityRow[];
  },

  async updateOpportunity(id, patch, expectStatus) {
    let query = db.from("marketing_opportunities").update(patch).eq("id", id);
    if (expectStatus) query = query.eq("status", expectStatus);
    const rows = must(await query.select("id"));
    return (rows ?? []).length > 0;
  },

  async expireOpportunities(workspaceId, now) {
    must(
      await db
        .from("marketing_opportunities")
        .update({ status: "expired" })
        .eq("workspace_id", workspaceId)
        .eq("status", "new")
        .lte("expires_at", now),
    );
  },

  async addEvent(event) {
    // History must never stop the work it describes.
    const { error } = await db.from("autopilot_events").insert(event);
    if (error) console.error("[autopilot] event not recorded:", error.message);
  },

  async listEvents(workspaceId, limit) {
    const data = must(
      await db
        .from("autopilot_events")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(limit),
    );
    return (data ?? []) as EventRow[];
  },
};
