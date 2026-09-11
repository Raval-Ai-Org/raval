// runtime.ts — executes tools and worker runs under policy, budgets and audit.
//
// invokeTool():  validate input (zod) → policy → approval gate → timeout →
//                validate output → audit step (redacted args). A write tool
//                without an approval becomes an agent_action_requests row in
//                `suggested` state and is NOT executed.
// executeRun():  durable agent_runs row (queued → running → succeeded/failed/
//                awaiting_approval), request scope carrying runId (so model
//                spend is metered against the run), step and deadline budgets,
//                loop detection, and a final summary.
import "server-only";
import { runWithScope } from "@/server/request-context";
import { decidePolicy } from "./policy";
import { getTool } from "./registry";
import type { AgentStore } from "./store";
import {
  ToolError,
  type ActionRequest,
  type AgentActor,
  type RunBudget,
  type ToolContext,
  type ToolDefinition,
} from "./types";

export const DEFAULT_RUN_BUDGET: RunBudget = { maxSteps: 25, deadlineMs: 90_000, maxCostUsd: 0.5 };
const APPROVAL_TTL_MS = 7 * 24 * 3600 * 1000;
const SENSITIVE_KEY = /token|secret|password|key|authorization|cookie/i;

/** Arguments as stored in the audit trail: secrets masked, long strings clipped. */
export function redactArgs(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth]";
  if (typeof value === "string") return value.length > 300 ? `${value.slice(0, 300)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redactArgs(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : redactArgs(v, depth + 1);
    }
    return out;
  }
  return value;
}

function summarize(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return { count: value.length };
  if (value && typeof value === "object") {
    const keys = Object.keys(value as object);
    return { keys: keys.slice(0, 12) };
  }
  return { value: typeof value === "string" ? value.slice(0, 120) : value };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, name: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ToolError("timeout", `${name} timed out after ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type InvokeOptions = {
  store: AgentStore;
  /** Set only by approvals.ts after a member approved THIS action request. */
  approvalGranted?: boolean;
  /** Idempotency key for writes (defaults to runId + tool + input hash). */
  idempotencyKey?: string;
  source?: ActionRequest["source"];
  /** Audit step counter for the current run. */
  nextSeq?: () => number;
};

export type InvokeResult<O> =
  | { status: "ok"; output: O }
  | { status: "pending_approval"; actionRequest: ActionRequest };

async function stableKey(parts: unknown[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(parts));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export async function invokeTool<O = unknown>(
  ctx: ToolContext,
  name: string,
  rawInput: unknown,
  opts: InvokeOptions,
): Promise<InvokeResult<O>> {
  const tool = getTool(name) as ToolDefinition<unknown, O> | undefined;
  const seq = opts.nextSeq?.() ?? 0;
  const audit = async (step: Parameters<AgentStore["addStep"]>[0]) => {
    if (!ctx.runId) return;
    try {
      await opts.store.addStep(step);
    } catch (e) {
      console.error("[agents] audit step not recorded", e instanceof Error ? e.message : e);
    }
  };
  const base = { runId: ctx.runId ?? "", workspaceId: ctx.workspaceId, seq, kind: "tool" as const, tool: name };

  if (!tool) {
    await audit({ ...base, status: "denied", policyDecision: "deny", resultSummary: { error: "unknown tool" } });
    throw new ToolError("unknown_tool", `No tool named ${name}`);
  }

  const parsed = tool.input.safeParse(rawInput);
  if (!parsed.success) {
    await audit({ ...base, status: "error", resultSummary: { error: "invalid input" } });
    throw new ToolError("invalid_input", `${name}: ${parsed.error.issues[0]?.message ?? "invalid input"}`);
  }
  const input = parsed.data;
  const redacted = redactArgs(input) as Record<string, unknown>;

  const settings = await opts.store.getSettings(ctx.workspaceId);
  const policy = decidePolicy(tool, ctx.actor, settings, { approvalGranted: opts.approvalGranted });

  if (policy.decision === "deny") {
    await audit({ ...base, redactedArgs: redacted, policyDecision: "deny", status: "denied", resultSummary: { reason: policy.reason } });
    throw new ToolError("denied", policy.reason);
  }

  if (policy.decision === "require_approval") {
    const idempotencyKey =
      opts.idempotencyKey ?? `${ctx.workspaceId}:${name}:${await stableKey([ctx.runId ?? null, input])}`;
    // The same proposal twice is one request, not two.
    const existing = await opts.store.findActionRequestByKey(idempotencyKey);
    const actionRequest =
      existing ??
      (await opts.store.createActionRequest({
        workspaceId: ctx.workspaceId,
        runId: ctx.runId ?? null,
        source: opts.source ?? (ctx.actor.kind === "worker" ? "worker" : "user"),
        tool: name,
        args: input as Record<string, unknown>,
        title: tool.description,
        preview: tool.preview ? await tool.preview(input, ctx) : {},
        affectedRecords: tool.affects?.(input) ?? [],
        status: "suggested",
        idempotencyKey,
        expiresAt: new Date(ctx.now().getTime() + APPROVAL_TTL_MS).toISOString(),
      }));
    await audit({
      ...base,
      redactedArgs: redacted,
      policyDecision: "require_approval",
      status: "pending_approval",
      resultSummary: { actionRequestId: actionRequest.id },
    });
    return { status: "pending_approval", actionRequest };
  }

  const started = Date.now();
  try {
    const output = await withTimeout(tool.handler(input, ctx), tool.timeoutMs, name);
    const checked = tool.output.safeParse(output);
    if (!checked.success) throw new ToolError("invalid_output", `${name} returned an invalid result`);
    await audit({
      ...base,
      redactedArgs: redacted,
      policyDecision: "allow",
      status: "ok",
      resultSummary: summarize(checked.data),
      latencyMs: Date.now() - started,
    });
    return { status: "ok", output: checked.data };
  } catch (error) {
    await audit({
      ...base,
      redactedArgs: redacted,
      policyDecision: "allow",
      status: "error",
      resultSummary: { error: error instanceof Error ? error.message.slice(0, 200) : "failed" },
      latencyMs: Date.now() - started,
    });
    if (error instanceof ToolError) throw error;
    throw new ToolError("failed", error instanceof Error ? error.message : `${name} failed`);
  }
}

// ── Worker runs ───────────────────────────────────────────────────────────
export type WorkerContext = {
  workspaceId: string;
  runId: string;
  /** Call a tool as this worker; counts against the run's step budget. */
  tool: <O = unknown>(name: string, input: unknown) => Promise<InvokeResult<O>>;
  note: (message: string, detail?: Record<string, unknown>) => Promise<void>;
  store: AgentStore;
  now: () => Date;
  input: Record<string, unknown>;
};

export type WorkerDefinition = {
  name: string;
  objective: string;
  budget?: Partial<RunBudget>;
  run: (ctx: WorkerContext) => Promise<{ summary: string; awaitingApproval?: boolean }>;
};

export type RunOutcome = {
  runId: string;
  status: "succeeded" | "failed" | "awaiting_approval";
  summary: string;
  error?: string;
};

export async function executeRun(
  worker: WorkerDefinition,
  opts: {
    workspaceId: string;
    trigger: "manual" | "cron" | "event";
    store: AgentStore;
    db: any;
    createdBy?: string | null;
    input?: Record<string, unknown>;
    now?: () => Date;
  },
): Promise<RunOutcome> {
  const now = opts.now ?? (() => new Date());
  const budget: RunBudget = { ...DEFAULT_RUN_BUDGET, ...worker.budget };
  const settings = await opts.store.getSettings(opts.workspaceId);
  const actor: AgentActor = { kind: "worker", worker: worker.name };
  if (settings.agentsPaused || settings.disabledWorkers.includes(worker.name)) {
    return { runId: "", status: "failed", summary: "", error: "Agents are paused for this workspace." };
  }

  const run = await opts.store.createRun({
    workspaceId: opts.workspaceId,
    worker: worker.name,
    trigger: opts.trigger,
    status: "running",
    objective: worker.objective,
    budget,
    startedAt: now().toISOString(),
    createdBy: opts.createdBy ?? null,
  });

  const started = Date.now();
  let steps = 0;
  const seen = new Map<string, number>();
  const toolCtx: ToolContext = { workspaceId: opts.workspaceId, actor, runId: run.id, db: opts.db, now };

  const ctx: WorkerContext = {
    workspaceId: opts.workspaceId,
    runId: run.id,
    store: opts.store,
    now,
    input: opts.input ?? {},
    tool: async (name, input) => {
      steps += 1;
      if (steps > budget.maxSteps) throw new ToolError("budget", `Step budget (${budget.maxSteps}) exhausted`);
      if (Date.now() - started > budget.deadlineMs) throw new ToolError("budget", "Run deadline exceeded");
      // Loop detection: the same call more than 3 times is a stuck agent.
      const signature = `${name}:${JSON.stringify(input)}`;
      const count = (seen.get(signature) ?? 0) + 1;
      seen.set(signature, count);
      if (count > 3) throw new ToolError("budget", `Loop detected on ${name}`);
      return invokeTool(toolCtx, name, input, { store: opts.store, nextSeq: () => steps });
    },
    note: async (message, detail) => {
      steps += 1;
      await opts.store.addStep({
        runId: run.id,
        workspaceId: opts.workspaceId,
        seq: steps,
        kind: "note",
        status: "ok",
        resultSummary: { message: message.slice(0, 500), ...(detail ?? {}) },
      });
    },
  };

  try {
    const result = await runWithScope(
      { workspaceId: opts.workspaceId, runId: run.id, route: `agent.${worker.name}` },
      () => worker.run(ctx),
    );
    const status = result.awaitingApproval ? "awaiting_approval" : "succeeded";
    await opts.store.updateRun(run.id, {
      status,
      finishedAt: now().toISOString(),
      durationMs: Date.now() - started,
      summary: result.summary.slice(0, 2000),
    });
    return { runId: run.id, status, summary: result.summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await opts.store.updateRun(run.id, {
      status: "failed",
      finishedAt: now().toISOString(),
      durationMs: Date.now() - started,
      error: message.slice(0, 1000),
    });
    return { runId: run.id, status: "failed", summary: "", error: message };
  }
}
