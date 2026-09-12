// store.ts — durable state of the agent control plane: runs, per-step audit,
// action requests, findings and workspace settings (tables from migration
// 20260911120300_add_agent_control_plane.sql). One interface, two
// implementations: Supabase (service role, production) and in-memory (tests,
// evals, local dry runs).
import "server-only";
import type {
  ActionRequest,
  ActionRequestStatus,
  Finding,
  RunBudget,
  RunStatus,
  WorkspaceAgentSettings,
} from "./types";

export type RunRecord = {
  id: string;
  workspaceId: string;
  worker: string;
  trigger: string;
  status: RunStatus;
  objective: string;
  budget: RunBudget;
  startedAt?: string;
  finishedAt?: string;
  model?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  durationMs?: number;
  error?: string | null;
  summary?: string | null;
  createdBy?: string | null;
};

export type StepRecord = {
  runId: string;
  workspaceId: string;
  seq: number;
  kind: "tool" | "model" | "policy" | "note";
  tool?: string;
  toolCallId?: string;
  redactedArgs?: Record<string, unknown>;
  policyDecision?: "allow" | "require_approval" | "deny";
  status: "ok" | "error" | "denied" | "pending_approval";
  resultSummary?: Record<string, unknown>;
  latencyMs?: number;
  costUsd?: number;
};

export interface AgentStore {
  getSettings(workspaceId: string): Promise<WorkspaceAgentSettings>;
  createRun(run: Omit<RunRecord, "id">): Promise<RunRecord>;
  updateRun(id: string, patch: Partial<RunRecord>): Promise<void>;
  addStep(step: StepRecord): Promise<void>;
  createActionRequest(req: Omit<ActionRequest, "id">): Promise<ActionRequest>;
  getActionRequest(id: string): Promise<ActionRequest | null>;
  findActionRequestByKey(key: string): Promise<ActionRequest | null>;
  updateActionRequest(
    id: string,
    patch: Partial<ActionRequest> & { status?: ActionRequestStatus },
    expectStatus?: ActionRequestStatus,
  ): Promise<boolean>;
  /** Insert a finding, or bump the open one with the same fingerprint. */
  upsertFinding(
    workspaceId: string,
    runId: string | null,
    worker: string,
    f: Finding,
  ): Promise<"created" | "updated">;
}

const EMPTY_SETTINGS: WorkspaceAgentSettings = { agentsPaused: false, disabledWorkers: [] };

// ── Supabase implementation ───────────────────────────────────────────────
export function supabaseAgentStore(db: any): AgentStore {
  const actionFromRow = (r: any): ActionRequest => ({
    id: r.id,
    workspaceId: r.workspace_id,
    runId: r.run_id,
    source: r.source,
    tool: r.tool,
    args: r.args ?? {},
    title: r.title,
    preview: r.preview ?? {},
    affectedRecords: r.affected_records ?? [],
    status: r.status,
    idempotencyKey: r.idempotency_key,
    expiresAt: r.expires_at,
    decidedBy: r.decided_by,
    decisionReason: r.decision_reason,
    result: r.result,
    error: r.error,
  });

  return {
    async getSettings(workspaceId) {
      const { data } = await db
        .from("workspace_agent_settings")
        .select("agents_paused, disabled_workers")
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      return data
        ? {
            agentsPaused: Boolean(data.agents_paused),
            disabledWorkers: data.disabled_workers ?? [],
          }
        : EMPTY_SETTINGS;
    },
    async createRun(run) {
      const { data, error } = await db
        .from("agent_runs")
        .insert({
          workspace_id: run.workspaceId,
          agent: run.worker,
          worker: run.worker,
          trigger: run.trigger,
          status: run.status,
          prompt: run.objective,
          budget: run.budget,
          started_at: run.startedAt ?? null,
          created_by: run.createdBy ?? null,
          output: {},
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(error?.message ?? "could not create agent run");
      return { ...run, id: data.id };
    },
    async updateRun(id, patch) {
      const row: Record<string, unknown> = {};
      if (patch.status) row.status = patch.status;
      if (patch.startedAt) row.started_at = patch.startedAt;
      if (patch.finishedAt) row.finished_at = patch.finishedAt;
      if (patch.model !== undefined) row.model = patch.model;
      if (patch.inputTokens !== undefined) row.input_tokens = patch.inputTokens;
      if (patch.outputTokens !== undefined) row.output_tokens = patch.outputTokens;
      if (patch.costUsd !== undefined) row.cost_usd = patch.costUsd;
      if (patch.durationMs !== undefined) row.duration_ms = patch.durationMs;
      if (patch.error !== undefined) row.error = patch.error;
      if (patch.summary !== undefined) {
        row.summary = patch.summary;
        row.output = { summary: patch.summary };
      }
      const { error } = await db.from("agent_runs").update(row).eq("id", id);
      if (error) throw new Error(error.message);
    },
    async addStep(step) {
      const { error } = await db.from("agent_run_steps").insert({
        run_id: step.runId,
        workspace_id: step.workspaceId,
        seq: step.seq,
        kind: step.kind,
        tool: step.tool ?? null,
        tool_call_id: step.toolCallId ?? null,
        redacted_args: step.redactedArgs ?? {},
        policy_decision: step.policyDecision ?? null,
        status: step.status,
        result_summary: step.resultSummary ?? {},
        latency_ms: step.latencyMs ?? null,
        cost_usd: step.costUsd ?? 0,
      });
      if (error) throw new Error(error.message);
    },
    async createActionRequest(req) {
      const { data, error } = await db
        .from("agent_action_requests")
        .insert({
          workspace_id: req.workspaceId,
          run_id: req.runId,
          source: req.source,
          tool: req.tool,
          args: req.args,
          title: req.title,
          preview: req.preview,
          affected_records: req.affectedRecords,
          status: req.status,
          idempotency_key: req.idempotencyKey,
          expires_at: req.expiresAt,
        })
        .select("*")
        .single();
      if (error || !data) throw new Error(error?.message ?? "could not create action request");
      return actionFromRow(data);
    },
    async getActionRequest(id) {
      const { data } = await db
        .from("agent_action_requests")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      return data ? actionFromRow(data) : null;
    },
    async findActionRequestByKey(key) {
      const { data } = await db
        .from("agent_action_requests")
        .select("*")
        .eq("idempotency_key", key)
        .maybeSingle();
      return data ? actionFromRow(data) : null;
    },
    async updateActionRequest(id, patch, expectStatus) {
      const row: Record<string, unknown> = {};
      if (patch.status) row.status = patch.status;
      if (patch.decidedBy !== undefined) {
        row.decided_by = patch.decidedBy;
        row.decided_at = new Date().toISOString();
      }
      if (patch.decisionReason !== undefined) row.decision_reason = patch.decisionReason;
      if (patch.result !== undefined) row.result = patch.result;
      if (patch.error !== undefined) row.error = patch.error;
      if (patch.status === "executed" || patch.status === "failed") {
        row.executed_at = new Date().toISOString();
      }
      let q = db.from("agent_action_requests").update(row).eq("id", id);
      // Compare-and-set: two approvers clicking at once cannot both execute.
      if (expectStatus) q = q.eq("status", expectStatus);
      const { data, error } = await q.select("id");
      if (error) throw new Error(error.message);
      return Array.isArray(data) ? data.length > 0 : Boolean(data);
    },
    async upsertFinding(workspaceId, runId, worker, f) {
      const { data: open } = await db
        .from("agent_findings")
        .select("id, occurrences")
        .eq("workspace_id", workspaceId)
        .eq("fingerprint", f.fingerprint)
        .neq("status", "resolved")
        .maybeSingle();
      const body = {
        run_id: runId,
        worker,
        severity: f.severity,
        title: f.title,
        summary: f.summary,
        evidence: f.evidence,
        hypotheses: f.hypotheses,
        affected: f.affected,
        recommended_action: f.recommendedAction,
        requires_human_approval: f.requiresHumanApproval,
        confidence: f.confidence,
        last_seen_at: new Date().toISOString(),
      };
      if (open) {
        const { error } = await db
          .from("agent_findings")
          .update({ ...body, occurrences: (open.occurrences ?? 1) + 1 })
          .eq("id", open.id);
        if (error) throw new Error(error.message);
        return "updated";
      }
      const { error } = await db
        .from("agent_findings")
        .insert({ ...body, workspace_id: workspaceId, fingerprint: f.fingerprint });
      if (error) throw new Error(error.message);
      return "created";
    },
  };
}

// ── In-memory implementation (tests, evals) ───────────────────────────────
export function memoryAgentStore(seed: { settings?: Record<string, WorkspaceAgentSettings> } = {}) {
  const runs = new Map<string, RunRecord>();
  const steps: StepRecord[] = [];
  const actions = new Map<string, ActionRequest>();
  const findings = new Map<
    string,
    Finding & { workspaceId: string; occurrences: number; status: string }
  >();
  const settings = new Map(Object.entries(seed.settings ?? {}));
  let n = 0;
  const id = (p: string) => `${p}-${++n}`;

  const store: AgentStore & {
    runs: typeof runs;
    steps: typeof steps;
    actions: typeof actions;
    findings: typeof findings;
    settings: typeof settings;
  } = {
    runs,
    steps,
    actions,
    findings,
    settings,
    async getSettings(ws) {
      return settings.get(ws) ?? EMPTY_SETTINGS;
    },
    async createRun(run) {
      const rec = { ...run, id: id("run") };
      runs.set(rec.id, rec);
      return rec;
    },
    async updateRun(runId, patch) {
      const cur = runs.get(runId);
      if (cur) runs.set(runId, { ...cur, ...patch });
    },
    async addStep(step) {
      steps.push(step);
    },
    async createActionRequest(req) {
      const rec = { ...req, id: id("act") };
      actions.set(rec.id, rec);
      return rec;
    },
    async getActionRequest(actionId) {
      return actions.get(actionId) ?? null;
    },
    async findActionRequestByKey(key) {
      return [...actions.values()].find((a) => a.idempotencyKey === key) ?? null;
    },
    async updateActionRequest(actionId, patch, expectStatus) {
      const cur = actions.get(actionId);
      if (!cur || (expectStatus && cur.status !== expectStatus)) return false;
      actions.set(actionId, { ...cur, ...patch });
      return true;
    },
    async upsertFinding(ws, _runId, _worker, f) {
      const key = `${ws}:${f.fingerprint}`;
      const cur = findings.get(key);
      if (cur && cur.status !== "resolved") {
        findings.set(key, { ...cur, ...f, occurrences: cur.occurrences + 1 });
        return "updated";
      }
      findings.set(key, { ...f, workspaceId: ws, occurrences: 1, status: "open" });
      return "created";
    },
  };
  return store;
}

export type MemoryAgentStore = ReturnType<typeof memoryAgentStore>;
