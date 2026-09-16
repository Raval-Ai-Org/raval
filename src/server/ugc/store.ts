// Persistence seam for the UGC render engine. The Supabase implementation is
// store.supabase.server.ts; tests use store.memory.ts. The engine never talks
// to a database directly, so its state machine is tested without one.
import type { RenderStatus } from "@/lib/ugc/schemas";

export type RenderRow = {
  id: string;
  workspace_id: string;
  project_id: string;
  created_by: string | null;
  idempotency_key: string;
  status: RenderStatus;
  model_key: string;
  provider: string;
  provider_model: string;
  provider_variant: string | null;
  generation_type: string;
  duration_sec: number;
  aspect_ratio: string;
  resolution: string;
  audio: boolean;
  reference_asset_ids: string[];
  script: Record<string, unknown>;
  settings: Record<string, unknown>;
  prompt: string;
  provider_task_id: string | null;
  provider_state: string | null;
  provider_meta: Record<string, unknown>;
  error_code: string | null;
  error_message: string | null;
  reservation_id: string | null;
  est_cost_usd: number;
  actual_cost_usd: number | null;
  asset_id: string | null;
  attempts: number;
  max_attempts: number;
  submit_attempts: number;
  next_attempt_at: string;
  lease_until: string | null;
  locked_by: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type NewRenderRow = Pick<
  RenderRow,
  | "id"
  | "workspace_id"
  | "project_id"
  | "created_by"
  | "idempotency_key"
  | "model_key"
  | "provider"
  | "provider_model"
  | "provider_variant"
  | "generation_type"
  | "duration_sec"
  | "aspect_ratio"
  | "resolution"
  | "audio"
  | "reference_asset_ids"
  | "script"
  | "settings"
  | "prompt"
  | "reservation_id"
  | "est_cost_usd"
>;

export type RenderPatch = Partial<Omit<RenderRow, "id" | "workspace_id" | "created_at">>;

export type ReserveRequest = {
  scopeKey: string;
  workspaceId: string;
  userId: string | null;
  units: number;
  estCostUsd: number;
  provider: string;
  model: string;
  route: string;
  sourceId: string;
  ttlSeconds: number;
  limits: { dailyUsd: number; monthlyUsd: number; monthlyUnits: number };
  maxConcurrent: number;
};

export type ReserveResult = { ok: true; id: string } | { ok: false; code: string; reason: string };

export type PersistVideoResult =
  { ok: true; assetId: string } | { ok: false; status: number; message: string };

export interface UgcRenderStore {
  getRender(id: string): Promise<RenderRow | null>;
  findByIdempotencyKey(workspaceId: string, key: string): Promise<RenderRow | null>;
  findByProviderTask(provider: string, taskId: string): Promise<RenderRow | null>;
  /** Insert, or return the existing row for the same (workspace, idempotency key). */
  insertRender(row: NewRenderRow): Promise<{ row: RenderRow; created: boolean }>;
  /** Compare-and-set: apply `patch` only while status is one of `from`. */
  transition(
    id: string,
    from: readonly RenderStatus[],
    patch: RenderPatch,
  ): Promise<RenderRow | null>;
  claim(worker: string, max: number, leaseSeconds: number, id?: string): Promise<RenderRow[]>;
  reserve(request: ReserveRequest): Promise<ReserveResult>;
  capture(
    reservationId: string,
    actualCostUsd: number | null,
    latencyMs: number | null,
  ): Promise<boolean>;
  release(reservationId: string, reason: string): Promise<boolean>;
  sweepExpiredReservations(): Promise<number>;
  /** Signed, provider-fetchable URLs for the workspace's ready image assets, in order. */
  signImageAssets(workspaceId: string, assetIds: string[], ttlSeconds: number): Promise<string[]>;
  persistVideo(input: {
    row: RenderRow;
    sourceUrl: string;
    idempotencyKey: string;
    metadata: Record<string, unknown>;
  }): Promise<PersistVideoResult>;
}
