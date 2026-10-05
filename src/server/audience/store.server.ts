// store.server.ts — audience rows in Postgres. Service role: browsers have no
// write policy on these tables, so every caller has checked the workspace and
// the role before it gets here.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type {
  CalibrationRow,
  OutcomeRow,
  PredictionRow,
  RunEventRow,
  RunRow,
  TwinRow,
} from "@/lib/audience/contracts";
import { SCORE_VERSION } from "@/lib/audience/score";
import type { AudienceStore } from "./engine";

const db = supabaseAdmin as unknown as SupabaseClient;

function must<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

const ACTIVE = ["queued", "running"];
const CACHE_KEY = "workspace_id,subject_hash,twins_fingerprint,depth,score_version";

const calibrationRow = (row: Record<string, unknown>): CalibrationRow => ({
  ...(row as unknown as CalibrationRow),
  bias: Number(row.bias),
  mae: Number(row.mae),
  learned: Array.isArray(row.learned) ? (row.learned as string[]) : [],
});

const outcomeRow = (row: Record<string, unknown>): OutcomeRow => ({
  ...(row as unknown as OutcomeRow),
  engagement: Number(row.engagement),
});

export const supabaseAudienceStore: AudienceStore = {
  async claim(worker, max, leaseSeconds, id) {
    const data = must(
      await db.rpc("claim_audience_runs", {
        p_worker: worker,
        p_max: max,
        p_lease_seconds: leaseSeconds,
        p_id: id ?? null,
      }),
    );
    return (data ?? []) as RunRow[];
  },

  async updateRun(run, worker, patch, opts = {}) {
    const rows = must(
      await db
        .from("audience_runs")
        .update({ ...patch, ...(opts.keepLease ? {} : { lease_until: null, locked_by: null }) })
        .eq("id", run.id)
        .eq("locked_by", worker)
        .select("id"),
    );
    return (rows ?? []).length > 0;
  },

  async insertRun(row) {
    const inserted = must(
      await db
        .from("audience_runs")
        .upsert(
          {
            workspace_id: row.workspace_id,
            kind: row.kind,
            idempotency_key: row.idempotency_key,
            input: row.input ?? {},
            content_item_id: row.content_item_id ?? null,
            created_by: row.created_by ?? null,
          },
          { onConflict: "workspace_id,idempotency_key", ignoreDuplicates: true },
        )
        .select("*"),
    ) as RunRow[] | null;
    if (inserted?.length) return { run: inserted[0], created: true };
    const held = must(
      await db
        .from("audience_runs")
        .select("*")
        .eq("workspace_id", row.workspace_id)
        .eq("idempotency_key", row.idempotency_key)
        .single(),
    );
    return { run: held as RunRow, created: false };
  },

  async getRun(workspaceId, id) {
    const data = must(
      await db
        .from("audience_runs")
        .select("*")
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
    );
    return (data as RunRow | null) ?? null;
  },

  async listRuns(workspaceId, opts = {}) {
    let query = db.from("audience_runs").select("*").eq("workspace_id", workspaceId);
    if (opts.kind) query = query.eq("kind", opts.kind);
    if (opts.active) query = query.in("status", ACTIVE);
    if (opts.contentItemId) query = query.eq("content_item_id", opts.contentItemId);
    const data = must(
      await query.order("created_at", { ascending: false }).limit(opts.limit ?? 20),
    );
    return (data ?? []) as RunRow[];
  },

  async requestCancel(workspaceId, id) {
    const now = new Date().toISOString();
    // Nobody is working on it: end it here. Otherwise the worker sees the flag.
    must(
      await db
        .from("audience_runs")
        .update({
          cancel_requested: true,
          status: "cancelled",
          stage: "cancelled",
          finished_at: now,
        })
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .in("status", ACTIVE)
        .or(`lease_until.is.null,lease_until.lt.${now}`),
    );
    must(
      await db
        .from("audience_runs")
        .update({ cancel_requested: true })
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .in("status", ACTIVE),
    );
    return this.getRun(workspaceId, id);
  },

  async addEvent(event) {
    must(
      await db.from("audience_run_events").insert({
        workspace_id: event.workspace_id,
        run_id: event.run_id,
        kind: event.kind,
        summary: event.summary.slice(0, 300),
        data: event.data ?? {},
      }),
    );
  },

  async listEvents(workspaceId, runId, limit = 30) {
    const data = must(
      await db
        .from("audience_run_events")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("run_id", runId)
        .order("created_at", { ascending: true })
        .limit(limit),
    );
    return (data ?? []) as RunEventRow[];
  },

  async listTwins(workspaceId, opts = {}) {
    let query = db.from("audience_twins").select("*").eq("workspace_id", workspaceId);
    if (!opts.includeArchived) query = query.eq("status", "active");
    const data = must(
      await query
        .order("weight", { ascending: false })
        .order("slug", { ascending: true })
        .limit(40),
    );
    return (data ?? []) as TwinRow[];
  },

  async getTwin(workspaceId, id) {
    const data = must(
      await db
        .from("audience_twins")
        .select("*")
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
    );
    return (data as TwinRow | null) ?? null;
  },

  async upsertTwin(workspaceId, draft, userId) {
    const fields = {
      name: draft.name,
      segment: draft.segment,
      summary: draft.summary,
      weight: draft.weight,
      profile: draft.profile,
      origin: draft.origin,
      origin_ref: draft.origin_ref,
      status: "active",
      updated_by: userId,
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      const held = must(
        await db
          .from("audience_twins")
          .select("id, version")
          .eq("workspace_id", workspaceId)
          .eq("slug", draft.slug)
          .maybeSingle(),
      ) as { id: string; version: number } | null;
      if (held) {
        // Compare-and-set on the version, so two writers never lose a bump.
        const rows = must(
          await db
            .from("audience_twins")
            .update({ ...fields, version: held.version + 1 })
            .eq("id", held.id)
            .eq("version", held.version)
            .select("*"),
        ) as TwinRow[] | null;
        if (rows?.length) return rows[0];
        continue;
      }
      const inserted = must(
        await db
          .from("audience_twins")
          .upsert(
            {
              ...fields,
              workspace_id: workspaceId,
              slug: draft.slug,
              kind: draft.kind ?? "group",
              created_by: userId,
            },
            { onConflict: "workspace_id,slug", ignoreDuplicates: true },
          )
          .select("*"),
      ) as TwinRow[] | null;
      if (inserted?.length) return inserted[0];
    }
    throw new Error("Could not save the audience group. Try again.");
  },

  async archiveTwin(workspaceId, id, userId) {
    const held = await this.getTwin(workspaceId, id);
    if (!held || held.kind !== "group" || held.status !== "active") return false;
    const rows = must(
      await db
        .from("audience_twins")
        .update({ status: "archived", version: held.version + 1, updated_by: userId })
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .select("id"),
    );
    return (rows ?? []).length > 0;
  },

  async findPrediction(workspaceId, key) {
    const data = must(
      await db
        .from("audience_predictions")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("subject_hash", key.subjectHash)
        .eq("twins_fingerprint", key.fingerprint)
        .eq("depth", key.depth)
        .eq("score_version", SCORE_VERSION)
        .maybeSingle(),
    );
    return (data as PredictionRow | null) ?? null;
  },

  async savePrediction(row) {
    const data = must(
      await db
        .from("audience_predictions")
        .upsert(row, { onConflict: CACHE_KEY })
        .select("*")
        .single(),
    );
    return data as PredictionRow;
  },

  async getPrediction(workspaceId, id) {
    const data = must(
      await db
        .from("audience_predictions")
        .select("*")
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
    );
    return (data as PredictionRow | null) ?? null;
  },

  async listPredictions(workspaceId, opts = {}) {
    if (opts.contentItemIds && !opts.contentItemIds.length) return [];
    let query = db.from("audience_predictions").select("*").eq("workspace_id", workspaceId);
    if (opts.runId) query = query.eq("run_id", opts.runId);
    if (opts.contentItemIds) query = query.in("content_item_id", opts.contentItemIds);
    const data = must(
      await query.order("created_at", { ascending: false }).limit(opts.limit ?? 50),
    );
    return (data ?? []) as PredictionRow[];
  },

  async getCalibration(workspaceId, platform, contentType) {
    const data = must(
      await db
        .from("audience_calibration")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("platform", platform)
        .eq("content_type", contentType)
        .maybeSingle(),
    ) as Record<string, unknown> | null;
    return data ? calibrationRow(data) : null;
  },

  async listCalibration(workspaceId) {
    const data = must(
      await db.from("audience_calibration").select("*").eq("workspace_id", workspaceId).limit(200),
    ) as Record<string, unknown>[] | null;
    return (data ?? []).map(calibrationRow);
  },

  async saveCalibration(row) {
    must(
      await db
        .from("audience_calibration")
        .upsert(
          { ...row, updated_at: new Date().toISOString() },
          { onConflict: "workspace_id,platform,content_type" },
        ),
    );
  },

  async insertOutcome(row) {
    const { data, error } = await db.from("audience_outcomes").insert(row).select("id");
    // 23505: this prediction (or this post) already has its frozen result.
    if (error) {
      if ((error as { code?: string }).code === "23505") return false;
      throw new Error(error.message);
    }
    return (data ?? []).length > 0;
  },

  async listOutcomes(workspaceId, limit = 200) {
    const data = must(
      await db
        .from("audience_outcomes")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("measured_at", { ascending: false })
        .limit(limit),
    ) as Record<string, unknown>[] | null;
    return (data ?? []).map(outcomeRow);
  },

  async setOutcomeActual(workspaceId, id, actual) {
    must(
      await db
        .from("audience_outcomes")
        .update({ actual })
        .eq("id", id)
        .eq("workspace_id", workspaceId),
    );
  },
};
