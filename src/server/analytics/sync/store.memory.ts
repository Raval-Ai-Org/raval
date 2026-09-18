// In-memory AnalyticsSyncStore for runner tests. Mirrors the SQL semantics
// that matter: SKIP LOCKED-style claims honouring leases and next_attempt_at,
// lease-guarded updates, one queued/running run per source, PK upserts.
import type {
  AnalyticsSyncStore,
  Ga4DailyRow,
  Ga4DimensionRow,
  Ga4PeriodTotalRow,
  GscDailyRow,
  GscDimensionRow,
  SourceRow,
  SyncRunRow,
} from "./store";

export class MemoryAnalyticsStore implements AnalyticsSyncStore {
  runs = new Map<string, SyncRunRow>();
  sources = new Map<string, SourceRow>();
  connections = new Map<string, { id: string; workspace_id: string; status: string }>();
  ga4Daily = new Map<string, Ga4DailyRow>();
  gscDaily = new Map<string, GscDailyRow>();
  dims = new Map<string, Ga4DimensionRow | GscDimensionRow>();
  periodTotals = new Map<string, Ga4PeriodTotalRow>();
  private seq = 0;

  constructor(private clock: () => number = Date.now) {}

  private iso(ms = this.clock()) {
    return new Date(ms).toISOString();
  }

  async claimRuns(worker: string, max: number, leaseSeconds: number, runId?: string) {
    const now = this.clock();
    const due = [...this.runs.values()]
      .filter(
        (r) =>
          (r.status === "queued" || r.status === "running") &&
          (!runId || r.id === runId) &&
          Date.parse(r.next_attempt_at) <= now &&
          (!r.lease_until || Date.parse(r.lease_until) < now),
      )
      .sort((a, b) => a.next_attempt_at.localeCompare(b.next_attempt_at))
      .slice(0, max);
    return due.map((r) => {
      const claimed: SyncRunRow = {
        ...r,
        lease_until: this.iso(now + Math.max(leaseSeconds, 30) * 1000),
        locked_by: worker,
        attempts: r.attempts + 1,
        status: "running",
        started_at: r.started_at ?? this.iso(now),
      };
      this.runs.set(r.id, claimed);
      return structuredClone(claimed);
    });
  }

  async getRun(id: string) {
    const r = this.runs.get(id);
    return r ? structuredClone(r) : null;
  }

  async updateRun(id: string, worker: string, patch: Partial<SyncRunRow>) {
    const r = this.runs.get(id);
    if (!r || r.locked_by !== worker) return false;
    this.runs.set(id, { ...r, ...patch, updated_at: this.iso() } as SyncRunRow);
    return true;
  }

  async getSource(id: string) {
    const s = this.sources.get(id);
    return s ? structuredClone(s) : null;
  }

  async updateSource(id: string, patch: Partial<SourceRow>) {
    const s = this.sources.get(id);
    if (s) this.sources.set(id, { ...s, ...patch } as SourceRow);
  }

  async getConnection(id: string) {
    return this.connections.get(id) ?? null;
  }

  async upsertGa4Daily(rows: Ga4DailyRow[]) {
    for (const r of rows) this.ga4Daily.set(`${r.source_id}|${r.date}`, { ...r });
  }

  async upsertGscDaily(rows: GscDailyRow[]) {
    for (const r of rows) this.gscDaily.set(`${r.source_id}|${r.date}`, { ...r });
  }

  async replaceDimensionRows(
    table: string,
    sourceId: string,
    dimension: string,
    from: string,
    to: string,
    rows: Array<Ga4DimensionRow | GscDimensionRow>,
  ) {
    for (const [k, r] of this.dims) {
      if (
        k.startsWith(`${table}|`) &&
        r.source_id === sourceId &&
        r.dimension === dimension &&
        r.date >= from &&
        r.date <= to
      )
        this.dims.delete(k);
    }
    for (const r of rows)
      this.dims.set(`${table}|${r.source_id}|${r.date}|${r.dimension}|${r.value}`, { ...r });
  }

  async upsertGa4PeriodTotals(rows: Ga4PeriodTotalRow[]) {
    for (const r of rows)
      this.periodTotals.set(`${r.source_id}|${r.date_from}|${r.date_to}`, { ...r });
  }

  async enqueueRun(row: {
    workspace_id: string;
    source_id: string;
    trigger: SyncRunRow["trigger"];
    range_start: string;
    range_end: string;
    requested_by?: string | null;
  }) {
    const active = [...this.runs.values()].find(
      (r) => r.source_id === row.source_id && (r.status === "queued" || r.status === "running"),
    );
    if (active) return { run: structuredClone(active), created: false };
    const now = this.iso();
    const run: SyncRunRow = {
      id: `run-${++this.seq}`,
      workspace_id: row.workspace_id,
      source_id: row.source_id,
      trigger: row.trigger,
      status: "queued",
      range_start: row.range_start,
      range_end: row.range_end,
      cursor_date: row.range_start,
      cursor_step: 0,
      attempts: 0,
      max_attempts: 5,
      failures: 0,
      next_attempt_at: now,
      lease_until: null,
      locked_by: null,
      error_code: null,
      error_message: null,
      rows_written: 0,
      requested_by: row.requested_by ?? null,
      started_at: null,
      completed_at: null,
      created_at: now,
      updated_at: now,
    };
    this.runs.set(run.id, run);
    return { run: structuredClone(run), created: true };
  }

  async listActiveSources(limit: number) {
    return [...this.sources.values()].filter((s) => s.status === "active").slice(0, limit);
  }
}
