// Supabase implementation of UgcRenderStore. Worker/service path: the service
// role writes render rows and reservations (browsers can only read them), and
// every query is scoped by the ids the engine already owns.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import type { RenderStatus } from "@/lib/ugc/schemas";
import { ASSET_BUCKET, persistAsset } from "@/server/assets/persist.server";
import type {
  NewRenderRow,
  PersistVideoResult,
  RenderPatch,
  RenderRow,
  ReserveRequest,
  ReserveResult,
  UgcRenderStore,
} from "./store";

export const RENDER_COLS =
  "id, workspace_id, project_id, created_by, idempotency_key, status, model_key, provider, provider_model, provider_variant, generation_type, duration_sec, aspect_ratio, resolution, audio, reference_asset_ids, script, settings, prompt, provider_task_id, provider_state, provider_meta, error_code, error_message, reservation_id, est_cost_usd, actual_cost_usd, asset_id, attempts, max_attempts, submit_attempts, next_attempt_at, lease_until, locked_by, submitted_at, completed_at, created_at, updated_at";

function toRow(data: unknown): RenderRow {
  const r = data as RenderRow;
  return {
    ...r,
    est_cost_usd: Number(r.est_cost_usd ?? 0),
    actual_cost_usd: r.actual_cost_usd == null ? null : Number(r.actual_cost_usd),
    provider_meta: (r.provider_meta ?? {}) as Record<string, unknown>,
    script: (r.script ?? {}) as Record<string, unknown>,
    settings: (r.settings ?? {}) as Record<string, unknown>,
    reference_asset_ids: r.reference_asset_ids ?? [],
  };
}

function slug(text: string) {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "ad"
  );
}

export const supabaseUgcStore: UgcRenderStore = {
  async getRender(id) {
    const { data, error } = await supabaseAdmin
      .from("ugc_renders")
      .select(RENDER_COLS)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toRow(data) : null;
  },

  async findByIdempotencyKey(workspaceId, key) {
    const { data, error } = await supabaseAdmin
      .from("ugc_renders")
      .select(RENDER_COLS)
      .eq("workspace_id", workspaceId)
      .eq("idempotency_key", key)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toRow(data) : null;
  },

  async findByProviderTask(provider, taskId) {
    const { data, error } = await supabaseAdmin
      .from("ugc_renders")
      .select(RENDER_COLS)
      .eq("provider", provider)
      .eq("provider_task_id", taskId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toRow(data) : null;
  },

  async insertRender(row: NewRenderRow) {
    const { data, error } = await supabaseAdmin
      .from("ugc_renders")
      .insert({ ...row, script: row.script as Json, settings: row.settings as Json })
      .select(RENDER_COLS)
      .single();
    if (!error && data) return { row: toRow(data), created: true };
    if (error?.code === "23505") {
      const existing = await supabaseUgcStore.findByIdempotencyKey(
        row.workspace_id,
        row.idempotency_key,
      );
      if (existing) return { row: existing, created: false };
    }
    throw new Error(error?.message ?? "Could not create the render");
  },

  async transition(id, from: readonly RenderStatus[], patch: RenderPatch) {
    const { data, error } = await supabaseAdmin
      .from("ugc_renders")
      .update(patch as never)
      .eq("id", id)
      .in("status", [...from])
      .select(RENDER_COLS)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toRow(data) : null;
  },

  async claim(worker, max, leaseSeconds, id) {
    const { data, error } = await supabaseAdmin.rpc("claim_ugc_renders", {
      p_worker: worker,
      p_max: max,
      p_lease_seconds: leaseSeconds,
      ...(id ? { p_id: id } : {}),
    });
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown[]).map(toRow);
  },

  async reserve(req: ReserveRequest): Promise<ReserveResult> {
    const { data, error } = await supabaseAdmin.rpc("reserve_ai_usage", {
      p_request: {
        scope_key: req.scopeKey,
        workspace_id: req.workspaceId,
        user_id: req.userId,
        kind: "video",
        units: req.units,
        est_cost_usd: req.estCostUsd,
        provider: req.provider,
        model: req.model,
        route: req.route,
        source: "ugc_render",
        source_id: req.sourceId,
        ttl_seconds: req.ttlSeconds,
        limits: {
          daily_usd: req.limits.dailyUsd,
          monthly_usd: req.limits.monthlyUsd,
          monthly_units: req.limits.monthlyUnits,
        },
        max_concurrent: req.maxConcurrent,
      } as Json,
    });
    if (error) throw new Error(`Allowance check failed: ${error.message}`);
    const r = (data ?? {}) as { ok?: boolean; id?: string; code?: string; reason?: string };
    if (r.ok && r.id) return { ok: true, id: r.id };
    return {
      ok: false,
      code: r.code ?? "blocked",
      reason: r.reason ?? "AI allowance reached for this period.",
    };
  },

  async capture(reservationId, actualCostUsd, latencyMs) {
    const { data, error } = await supabaseAdmin.rpc("capture_ai_usage_reservation", {
      p_id: reservationId,
      ...(actualCostUsd != null ? { p_actual_cost_usd: actualCostUsd } : {}),
      ...(latencyMs != null ? { p_latency_ms: Math.round(latencyMs) } : {}),
    });
    if (error) throw new Error(error.message);
    return Boolean(data);
  },

  async release(reservationId, reason) {
    const { data, error } = await supabaseAdmin.rpc("release_ai_usage_reservation", {
      p_id: reservationId,
      p_reason: reason,
    });
    if (error) throw new Error(error.message);
    return Boolean(data);
  },

  async sweepExpiredReservations() {
    const { data, error } = await supabaseAdmin.rpc("release_expired_ai_usage_reservations");
    if (error) throw new Error(error.message);
    return Number(data ?? 0);
  },

  async signImageAssets(workspaceId, assetIds, ttlSeconds) {
    if (!assetIds.length) return [];
    const db = supabaseAdmin as unknown as SupabaseClient;
    const { data, error } = await db
      .from("assets")
      .select("id, storage_path")
      .eq("workspace_id", workspaceId)
      .eq("asset_type", "image")
      .eq("status", "ready")
      .is("deleted_at", null)
      .in("id", assetIds);
    if (error) throw new Error(error.message);
    const byId = new Map(
      ((data ?? []) as Array<{ id: string; storage_path: string | null }>)
        .filter((a) => a.storage_path)
        .map((a) => [a.id, a.storage_path as string]),
    );
    const paths = assetIds.map((id) => byId.get(id)).filter((p): p is string => Boolean(p));
    if (!paths.length) return [];
    const { data: signed, error: signError } = await db.storage
      .from(ASSET_BUCKET)
      .createSignedUrls(paths, ttlSeconds);
    if (signError) throw new Error(signError.message);
    return (signed ?? []).map((s) => s.signedUrl).filter((u): u is string => Boolean(u));
  },

  async persistVideo({
    row,
    sourceUrl,
    dataUrl,
    idempotencyKey,
    metadata,
  }): Promise<PersistVideoResult> {
    const hook = typeof metadata.hook === "string" ? metadata.hook : "ugc-ad";
    const result = await persistAsset({
      workspaceId: row.workspace_id,
      idempotencyKey,
      ...(dataUrl ? { dataUrl } : { sourceUrl }),
      assetType: "video",
      mimeType: "video/mp4",
      filename: `mellox-ugc-${slug(hook)}.mp4`,
      platform: typeof row.settings.platform === "string" ? row.settings.platform : null,
      provider: row.provider,
      model: [row.provider_model, row.provider_variant].filter(Boolean).join(":"),
      modelRoute: row.generation_type,
      promptVersion: "ugc-v1",
      attempt: row.submit_attempts,
      metadata,
    });
    return result.ok ? { ok: true, assetId: result.asset.id } : result;
  },
};
