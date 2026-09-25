// In-memory UgcRenderStore for engine tests. Mirrors the SQL semantics that
// matter: compare-and-set transitions, one lease at a time, reservation
// capture-once / release, idempotent inserts.
import type { RenderStatus } from "@/lib/ugc/schemas";
import type {
  NewRenderRow,
  PersistVideoResult,
  RenderPatch,
  RenderRow,
  ReserveRequest,
  ReserveResult,
  UgcRenderStore,
} from "./store";

type Hold = {
  id: string;
  state: "held" | "captured" | "released";
  reason?: string;
  cost: number | null;
};

export class MemoryUgcStore implements UgcRenderStore {
  renders = new Map<string, RenderRow>();
  holds = new Map<string, Hold>();
  usageEvents: Array<{ reservationId: string; cost: number | null }> = [];
  persisted: Array<{ idempotencyKey: string; sourceUrl: string; dataUrl?: string }> = [];
  persistFailures = 0;
  images = new Map<string, string>();
  reserveResult: ReserveResult | null = null;

  constructor(private clock: () => number = Date.now) {}

  private at() {
    return new Date(this.clock()).toISOString();
  }

  async getRender(id: string) {
    const r = this.renders.get(id);
    return r ? structuredClone(r) : null;
  }

  async findByIdempotencyKey(workspaceId: string, key: string) {
    for (const r of this.renders.values()) {
      if (r.workspace_id === workspaceId && r.idempotency_key === key) return structuredClone(r);
    }
    return null;
  }

  async findByProviderTask(provider: string, taskId: string) {
    for (const r of this.renders.values()) {
      if (r.provider === provider && r.provider_task_id === taskId) return structuredClone(r);
    }
    return null;
  }

  async insertRender(row: NewRenderRow) {
    const existing = await this.findByIdempotencyKey(row.workspace_id, row.idempotency_key);
    if (existing) return { row: existing, created: false };
    const full: RenderRow = {
      ...row,
      status: "queued",
      provider_task_id: null,
      provider_state: null,
      provider_meta: {},
      error_code: null,
      error_message: null,
      actual_cost_usd: null,
      asset_id: null,
      attempts: 0,
      max_attempts: 40,
      submit_attempts: 0,
      next_attempt_at: this.at(),
      lease_until: null,
      locked_by: null,
      submitted_at: null,
      completed_at: null,
      created_at: this.at(),
      updated_at: this.at(),
    };
    this.renders.set(full.id, full);
    return { row: structuredClone(full), created: true };
  }

  async transition(id: string, from: readonly RenderStatus[], patch: RenderPatch) {
    const r = this.renders.get(id);
    if (!r || !from.includes(r.status)) return null;
    Object.assign(r, structuredClone(patch), { updated_at: this.at() });
    return structuredClone(r);
  }

  async claim(worker: string, max: number, leaseSeconds: number, id?: string) {
    const t = this.clock();
    const due = [...this.renders.values()]
      .filter(
        (r) =>
          ["queued", "submitting", "processing", "persisting"].includes(r.status) &&
          (!id || r.id === id) &&
          Date.parse(r.next_attempt_at) <= t &&
          (!r.lease_until || Date.parse(r.lease_until) < t),
      )
      .sort((a, b) => Date.parse(a.next_attempt_at) - Date.parse(b.next_attempt_at))
      .slice(0, max);
    for (const r of due) {
      r.lease_until = new Date(t + leaseSeconds * 1000).toISOString();
      r.locked_by = worker;
      r.attempts++;
    }
    return due.map((r) => structuredClone(r));
  }

  async reserve(request: ReserveRequest): Promise<ReserveResult> {
    if (this.reserveResult) return this.reserveResult;
    const existing = this.holds.get(request.sourceId);
    if (existing) return { ok: true, id: existing.id };
    const id = `hold-${this.holds.size + 1}`;
    this.holds.set(request.sourceId, { id, state: "held", cost: null });
    return { ok: true, id };
  }

  private hold(id: string) {
    return [...this.holds.values()].find((h) => h.id === id);
  }

  async capture(reservationId: string, actualCostUsd: number | null) {
    const h = this.hold(reservationId);
    if (!h || !(h.state === "held" || (h.state === "released" && h.reason === "expired")))
      return false;
    h.state = "captured";
    h.cost = actualCostUsd;
    this.usageEvents.push({ reservationId, cost: actualCostUsd });
    return true;
  }

  async release(reservationId: string, reason: string) {
    const h = this.hold(reservationId);
    if (!h || h.state !== "held") return false;
    h.state = "released";
    h.reason = reason;
    return true;
  }

  async sweepExpiredReservations() {
    return 0;
  }

  async signImageAssets(_workspaceId: string, assetIds: string[]) {
    return assetIds.map((id) => this.images.get(id)).filter((u): u is string => Boolean(u));
  }

  async persistVideo(input: {
    sourceUrl: string;
    dataUrl?: string;
    idempotencyKey: string;
  }): Promise<PersistVideoResult> {
    if (this.persistFailures > 0) {
      this.persistFailures--;
      return { ok: false, status: 502, message: "download failed" };
    }
    const existing = this.persisted.findIndex((p) => p.idempotencyKey === input.idempotencyKey);
    if (existing === -1)
      this.persisted.push({
        idempotencyKey: input.idempotencyKey,
        sourceUrl: input.sourceUrl,
        ...(input.dataUrl ? { dataUrl: input.dataUrl } : {}),
      });
    return { ok: true, assetId: `asset-${input.idempotencyKey}` };
  }
}
