// store.memory.ts — the audience store in memory, with the same lease,
// compare-and-set and uniqueness rules as Postgres. The engine's tests run
// against this.
import type {
  CalibrationRow,
  OutcomeRow,
  PredictionRow,
  RunEventRow,
  RunRow,
  TwinRow,
} from "@/lib/audience/contracts";
import { isActiveRun } from "@/lib/audience/contracts";
import { SCORE_VERSION } from "@/lib/audience/score";
import type { AudienceStore } from "./engine";

export type MemoryAudienceStore = AudienceStore & {
  runs: RunRow[];
  events: RunEventRow[];
  twins: TwinRow[];
  predictions: PredictionRow[];
  outcomes: OutcomeRow[];
  calibration: CalibrationRow[];
  now: () => Date;
};

let seq = 0;
const id = (prefix: string) => `${prefix}0000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const copy = <T>(value: T): T => structuredClone(value);

export function createMemoryAudienceStore(now: () => Date = () => new Date()): MemoryAudienceStore {
  const runs: RunRow[] = [];
  const events: RunEventRow[] = [];
  const twins: TwinRow[] = [];
  const predictions: PredictionRow[] = [];
  const outcomes: OutcomeRow[] = [];
  const calibration: CalibrationRow[] = [];
  const iso = () => now().toISOString();

  const store: MemoryAudienceStore = {
    runs,
    events,
    twins,
    predictions,
    outcomes,
    calibration,
    now,

    async claim(worker, max, leaseSeconds, onlyId) {
      const at = now().getTime();
      const due = runs
        .filter((r) => {
          if (!isActiveRun(r.status)) return false;
          if (onlyId && r.id !== onlyId) return false;
          if (Date.parse(r.next_attempt_at) > at) return false;
          return !(r.lease_until && Date.parse(r.lease_until) >= at);
        })
        .sort((a, b) => a.next_attempt_at.localeCompare(b.next_attempt_at))
        .slice(0, max);
      for (const r of due) {
        r.lease_until = new Date(at + leaseSeconds * 1000).toISOString();
        r.locked_by = worker;
      }
      return due.map(copy);
    },

    async updateRun(run, worker, patch, opts = {}) {
      const row = runs.find((r) => r.id === run.id);
      if (!row || row.locked_by !== worker) return false;
      Object.assign(row, copy(patch), { updated_at: iso() });
      if (!opts.keepLease) {
        row.lease_until = null;
        row.locked_by = null;
      }
      return true;
    },

    async insertRun(input) {
      const held = runs.find(
        (r) => r.workspace_id === input.workspace_id && r.idempotency_key === input.idempotency_key,
      );
      if (held) return { run: copy(held), created: false };
      const row: RunRow = {
        id: id("r"),
        workspace_id: input.workspace_id,
        kind: input.kind,
        status: "queued",
        stage: "queued",
        progress: { done: 0, total: 0 },
        input: copy(input.input ?? {}),
        state: {},
        output: {},
        content_item_id: input.content_item_id ?? null,
        idempotency_key: input.idempotency_key,
        created_by: input.created_by ?? null,
        cancel_requested: false,
        attempts: 0,
        next_attempt_at: iso(),
        lease_until: null,
        locked_by: null,
        last_error: null,
        created_at: iso(),
        updated_at: iso(),
        finished_at: null,
      };
      runs.push(row);
      return { run: copy(row), created: true };
    },

    async getRun(workspaceId, runId) {
      const row = runs.find((r) => r.id === runId && r.workspace_id === workspaceId);
      return row ? copy(row) : null;
    },

    async listRuns(workspaceId, opts = {}) {
      return runs
        .filter(
          (r) =>
            r.workspace_id === workspaceId &&
            (!opts.kind || r.kind === opts.kind) &&
            (!opts.active || isActiveRun(r.status)) &&
            (!opts.contentItemId || r.content_item_id === opts.contentItemId),
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, opts.limit ?? 20)
        .map(copy);
    },

    async requestCancel(workspaceId, runId) {
      const row = runs.find((r) => r.id === runId && r.workspace_id === workspaceId);
      if (!row || !isActiveRun(row.status)) return row ? copy(row) : null;
      row.cancel_requested = true;
      const leased = row.lease_until && Date.parse(row.lease_until) >= now().getTime();
      if (!leased) {
        row.status = "cancelled";
        row.stage = "cancelled";
        row.finished_at = iso();
      }
      row.updated_at = iso();
      return copy(row);
    },

    async addEvent(event) {
      events.push({
        id: id("e"),
        workspace_id: event.workspace_id,
        run_id: event.run_id,
        kind: event.kind,
        summary: event.summary,
        data: copy(event.data ?? {}),
        created_at: iso(),
      });
    },

    async listEvents(workspaceId, runId, limit = 30) {
      return events
        .filter((e) => e.workspace_id === workspaceId && e.run_id === runId)
        .slice(-limit)
        .map(copy);
    },

    async listTwins(workspaceId, opts = {}) {
      return twins
        .filter(
          (t) => t.workspace_id === workspaceId && (opts.includeArchived || t.status === "active"),
        )
        .sort((a, b) => b.weight - a.weight || a.slug.localeCompare(b.slug))
        .map(copy);
    },

    async getTwin(workspaceId, twinId) {
      const row = twins.find((t) => t.id === twinId && t.workspace_id === workspaceId);
      return row ? copy(row) : null;
    },

    async upsertTwin(workspaceId, draft, userId) {
      const held = twins.find((t) => t.workspace_id === workspaceId && t.slug === draft.slug);
      if (held) {
        Object.assign(held, {
          name: draft.name,
          segment: draft.segment,
          summary: draft.summary,
          weight: draft.weight,
          profile: copy(draft.profile),
          origin: draft.origin,
          origin_ref: draft.origin_ref,
          status: "active",
          version: held.version + 1,
          updated_by: userId,
          updated_at: iso(),
        });
        return copy(held);
      }
      const row: TwinRow = {
        id: id("t"),
        workspace_id: workspaceId,
        slug: draft.slug,
        kind: draft.kind ?? "group",
        name: draft.name,
        segment: draft.segment,
        summary: draft.summary,
        weight: draft.weight,
        profile: copy(draft.profile),
        origin: draft.origin,
        origin_ref: draft.origin_ref,
        status: "active",
        version: 1,
        created_by: userId,
        updated_by: userId,
        created_at: iso(),
        updated_at: iso(),
      };
      twins.push(row);
      return copy(row);
    },

    async archiveTwin(workspaceId, twinId, userId) {
      const row = twins.find((t) => t.id === twinId && t.workspace_id === workspaceId);
      if (!row || row.kind !== "group" || row.status !== "active") return false;
      Object.assign(row, {
        status: "archived",
        version: row.version + 1,
        updated_by: userId,
        updated_at: iso(),
      });
      return true;
    },

    async findPrediction(workspaceId, key) {
      const row = predictions.find(
        (p) =>
          p.workspace_id === workspaceId &&
          p.subject_hash === key.subjectHash &&
          p.twins_fingerprint === key.fingerprint &&
          p.depth === key.depth &&
          p.score_version === SCORE_VERSION,
      );
      return row ? copy(row) : null;
    },

    async savePrediction(input) {
      const held = predictions.find(
        (p) =>
          p.workspace_id === input.workspace_id &&
          p.subject_hash === input.subject_hash &&
          p.twins_fingerprint === input.twins_fingerprint &&
          p.depth === input.depth &&
          p.score_version === input.score_version,
      );
      if (held) {
        Object.assign(held, copy(input));
        return copy(held);
      }
      const row: PredictionRow = { ...copy(input), id: id("p"), created_at: iso() };
      predictions.push(row);
      return copy(row);
    },

    async getPrediction(workspaceId, predictionId) {
      const row = predictions.find((p) => p.id === predictionId && p.workspace_id === workspaceId);
      return row ? copy(row) : null;
    },

    async listPredictions(workspaceId, opts = {}) {
      return predictions
        .filter(
          (p) =>
            p.workspace_id === workspaceId &&
            (!opts.runId || p.run_id === opts.runId) &&
            (!opts.contentItemIds ||
              (p.content_item_id !== null && opts.contentItemIds.includes(p.content_item_id))),
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, opts.limit ?? 50)
        .map(copy);
    },

    async getCalibration(workspaceId, platform, contentType) {
      const row = calibration.find(
        (c) =>
          c.workspace_id === workspaceId &&
          c.platform === platform &&
          c.content_type === contentType,
      );
      return row ? copy(row) : null;
    },

    async listCalibration(workspaceId) {
      return calibration.filter((c) => c.workspace_id === workspaceId).map(copy);
    },

    async saveCalibration(input) {
      const at = calibration.findIndex(
        (c) =>
          c.workspace_id === input.workspace_id &&
          c.platform === input.platform &&
          c.content_type === input.content_type,
      );
      const row: CalibrationRow = { ...copy(input), updated_at: iso() };
      if (at >= 0) calibration[at] = row;
      else calibration.push(row);
    },

    async insertOutcome(input) {
      if (
        outcomes.some(
          (o) =>
            (o.prediction_id === input.prediction_id && o.horizon === input.horizon) ||
            (input.content_item_id !== null &&
              o.content_item_id === input.content_item_id &&
              o.horizon === input.horizon),
        )
      ) {
        return false;
      }
      outcomes.push({ ...copy(input), id: id("o"), measured_at: iso() });
      return true;
    },

    async listOutcomes(workspaceId, limit = 200) {
      return outcomes
        .filter((o) => o.workspace_id === workspaceId)
        .sort((a, b) => b.measured_at.localeCompare(a.measured_at))
        .slice(0, limit)
        .map(copy);
    },

    async setOutcomeActual(workspaceId, outcomeId, actual) {
      const row = outcomes.find((o) => o.id === outcomeId && o.workspace_id === workspaceId);
      if (row) row.actual = actual;
    },
  };
  return store;
}
