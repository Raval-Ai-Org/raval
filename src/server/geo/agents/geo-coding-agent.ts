// geo-coding-agent.ts — the Mellox GEO Engineer's stages.
//
//   investigate → plan     tool loop over the real repository (read-only);
//                          submit_plan is checked server-side (paths, files read,
//                          scope, strategy) and bounced back until it's valid
//   implement → patch      tool loop limited to the approved plan's files;
//                          submit_patch is applied to the real file contents
//                          (unique find/replace) and bounced back on failure
//   review                 a separate structured review of the diff
//   validate               deterministic checks (validate.ts) + grounding
//   correct                review blockers / failed checks go back to the
//                          implementation conversation, at most twice
//
// Stage functions are storage-agnostic: the runner persists results, events
// and checkpoints. Nothing here writes to a repository.
import "server-only";
import { createHash } from "node:crypto";
import { createPatch } from "diff";
import {
  claudeTextCompletion,
  claudeToolLoop,
  type ClaudeMessage,
  type ClaudeToolLoopResult,
  type ToolLoopUsage,
  type ToolOutcome,
} from "@/lib/anthropic-gateway.server";
import type {
  AgentFileInspected,
  AgentPlan,
  AgentReview,
  AgentUsage,
} from "@/lib/geo/agent-contracts";
import type { ProposalValidation, ValidationCheck } from "@/lib/geo/fix-contracts";
import type { FixRecipe } from "@/lib/geo/fix-recipes";
import type { SiteArtifacts } from "@/lib/geo/types";
import { checkRepoPath, MAX_FILES_PER_CHANGE } from "@/server/connectors/github/paths";
import { applyEdits, type GeneratedFile } from "../fixes/generate.server";
import { groundingCheck } from "../fixes/grounding";
import type { FixStrategy } from "../fixes/strategies";
import type { FixKind } from "../fixes/targets";
import { changedLines, validateProposal } from "../fixes/validate";
import type { Playbook } from "./framework-playbooks";
import {
  IMPLEMENT_SYSTEM,
  INVESTIGATE_SYSTEM,
  REVIEW_SCHEMA,
  REVIEW_SYSTEM,
  SUBMIT_PATCH_TOOL,
  SUBMIT_PLAN_TOOL,
} from "./prompts";
import {
  createRepoToolHandlers,
  REPO_TOOLS,
  type RepoSnapshot,
  type RepoToolDeps,
  type RepoToolState,
} from "./repo-tools.server";

export const GEO_AGENT_ROUTE = {
  investigate: "geo.agent.investigate",
  implement: "geo.agent.implement",
  review: "geo.agent.review",
} as const;

export function geoAgentModel(): string {
  return (process.env.GEO_AGENT_MODEL ?? "").trim() || "claude-sonnet-5";
}

export function geoAgentMaxCostUsd(): number {
  const n = Number(process.env.GEO_AGENT_MAX_COST_USD);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 20) : 1.5;
}

export const STAGE_LIMITS = {
  investigate: { maxTurns: 16, maxCostShare: 0.45, wallMs: 170_000, maxTokens: 12_000 },
  implement: { maxTurns: 10, maxCostShare: 0.35, wallMs: 150_000, maxTokens: 16_000 },
  maxCorrections: 2,
};

/* ───────────────────────── context ───────────────────────── */

export type AgentFinding = {
  ruleId: string;
  title: string;
  detail: string;
  evidence: Record<string, unknown>;
  pageUrl: string | null;
  severity: string | null;
  category: string | null;
  recommendation: string | null;
};

export type AgentContext = {
  runId: string;
  workspaceId: string;
  userId: string | null;
  finding: AgentFinding;
  siteOrigin: string;
  site: SiteArtifacts;
  snapshot: RepoSnapshot;
  playbook: Playbook;
  strategy: FixStrategy;
  fixKind: FixKind | null;
  recipe: FixRecipe | null;
  /** Deterministic planner's guess at target files (a hint, not a decision). */
  targetHints: string[];
  dependencies: string[];
  allowedImports: Set<string>;
  /** Scanned site text used to ground new copy. */
  siteText: string[];
  inputs: Record<string, string>;
  feedback: string | null;
  previousPlan: AgentPlan | null;
};

export type StageEvent = {
  stage: "investigate" | "implement" | "review" | "validate" | "correct";
  kind:
    "tool_call" | "model_turn" | "plan_ready" | "review" | "validation" | "correction" | "error";
  summary: string;
  detail?: Record<string, unknown>;
};

export type AgentDeps = {
  toolDeps: RepoToolDeps;
  loop?: typeof claudeToolLoop;
  complete?: typeof claudeTextCompletion;
  onEvent: (e: StageEvent) => Promise<void>;
  isCancelled: () => Promise<boolean>;
  /** Persist the conversation after each turn (resume after a lost lease). */
  checkpoint?: (stage: "investigate" | "implement", messages: ClaudeMessage[]) => Promise<void>;
  now?: () => number;
};

export type StageFailure = {
  ok: false;
  code:
    | "cancelled"
    | "budget"
    | "deadline"
    | "max_turns"
    | "no_submission"
    | "invalid_plan"
    | "patch_failed"
    | "validation_failed";
  message: string;
  usage: AgentUsage;
};

export const emptyUsage = (): AgentUsage => ({
  turns: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
});

export function addUsage(a: AgentUsage, b: ToolLoopUsage | AgentUsage): AgentUsage {
  return {
    turns: a.turns + b.turns,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    costUsd: Math.round((a.costUsd + b.costUsd) * 1e6) / 1e6,
  };
}

function loopFailure(result: ClaudeToolLoopResult, usage: AgentUsage): StageFailure {
  const messages: Record<string, string> = {
    cancelled: "The run was cancelled.",
    budget: "The run reached its AI spend limit before finishing.",
    deadline: "The run took longer than its time limit.",
    max_turns: "The agent used all of its investigation steps without submitting.",
    no_submission: "The agent stopped without submitting a result.",
  };
  const code = result.status === "submitted" ? "no_submission" : result.status;
  return { ok: false, code, message: messages[code], usage };
}

/** Stable JSON (sorted keys) → sha256, binding what a person approved. */
export function hashPlan(plan: AgentPlan, inputs: Record<string, string>): string {
  const stable = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v as Record<string, unknown>)
              .sort()
              .map((k) => [k, stable((v as Record<string, unknown>)[k])]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(stable({ plan, inputs })))
    .digest("hex");
}

function briefing(ctx: AgentContext): string {
  const facts = {
    finding: {
      rule: ctx.finding.ruleId,
      title: ctx.finding.title,
      detail: ctx.finding.detail,
      severity: ctx.finding.severity,
      category: ctx.finding.category,
      recommendation: ctx.finding.recommendation,
      affectedPage: ctx.finding.pageUrl ?? `${ctx.siteOrigin}/`,
      evidence: ctx.finding.evidence,
    },
    site: ctx.siteOrigin,
    repository: `${ctx.snapshot.repo}@${ctx.snapshot.branch} (${ctx.snapshot.sha.slice(0, 7)})`,
    framework: ctx.snapshot.framework,
    frameworkEvidence: ctx.snapshot.frameworkEvidence,
    fileCount: ctx.snapshot.entries.length,
    listingPartial: ctx.snapshot.truncated,
    likelyFiles: ctx.targetHints,
    fixMode: ctx.strategy.mode,
    allowedChanges: ctx.strategy.editClasses,
    grounding: ctx.strategy.grounding,
    knownFactsNeeded: ctx.strategy.inputs,
    riskNote: ctx.strategy.risk,
    rescan: ctx.strategy.verifyScope,
  };
  const inputs = Object.keys(ctx.inputs).length
    ? `\n\nFacts the user supplied (use exactly as given):\n${JSON.stringify(ctx.inputs, null, 2)}`
    : "";
  const revise =
    ctx.previousPlan && ctx.feedback
      ? `\n\nThe user asked for changes to your previous plan.\nPrevious plan summary: ${ctx.previousPlan.summary}\nPrevious files: ${ctx.previousPlan.files.map((f) => f.path).join(", ")}\nUser feedback: ${ctx.feedback}`
      : "";
  return `Fix this finding.

<task_facts>
${JSON.stringify(facts, null, 2)}
</task_facts>

<framework_playbook name="${ctx.playbook.name}">
${ctx.playbook.conventions}
</framework_playbook>${inputs}${revise}`;
}

/* ───────────────────────── investigate → plan ───────────────────────── */

export function checkPlan(
  plan: AgentPlan,
  ctx: { exists: (path: string) => boolean; filesRead: Set<string>; strategy: FixStrategy },
): string[] {
  const problems: string[] = [];
  if (!plan.feasible) {
    if (!plan.notFixableReason?.trim())
      problems.push("Explain in notFixableReason why this can't be automated.");
    if (!plan.manualSteps.length) problems.push("Give manualSteps a person can follow.");
    if (plan.files.length) problems.push("A not-feasible plan must not list files.");
    return problems;
  }
  if (ctx.strategy.mode === "manual") {
    problems.push(
      "This finding must be fixed manually; set feasible to false and give manualSteps.",
    );
  }
  if (!plan.files.length) problems.push("List the files to change.");
  if (plan.files.length > MAX_FILES_PER_CHANGE)
    problems.push(`A fix may change at most ${MAX_FILES_PER_CHANGE} files.`);
  const seen = new Set<string>();
  for (const f of plan.files) {
    if (seen.has(f.path)) problems.push(`${f.path} is listed twice.`);
    seen.add(f.path);
    const check = checkRepoPath(f.path);
    if (!check.ok) {
      problems.push(`${f.path}: ${check.reason}.`);
      continue;
    }
    if (f.action === "update") {
      if (!ctx.exists(f.path))
        problems.push(`${f.path} doesn't exist; use action "create" or pick the right file.`);
      else if (!ctx.filesRead.has(f.path))
        problems.push(`Read ${f.path} with read_file before planning to change it.`);
    } else if (ctx.exists(f.path)) {
      problems.push(`${f.path} already exists; use action "update" after reading it.`);
    }
    if (!f.reason.trim()) problems.push(`Give a reason for ${f.path}.`);
  }
  if (!plan.validationCriteria.length)
    problems.push("Add validationCriteria that prove the fix on the live site.");
  const keys = plan.needsInput.map((n) => n.key);
  if (new Set(keys).size !== keys.length) problems.push("needsInput keys must be unique.");
  return problems;
}

export type PlanOutcome =
  | {
      ok: true;
      plan: AgentPlan;
      filesInspected: AgentFileInspected[];
      usage: AgentUsage;
      messages: ClaudeMessage[];
    }
  | StageFailure;

export async function investigateAndPlan(
  ctx: AgentContext,
  deps: AgentDeps,
  opts: { resume?: ClaudeMessage[]; state: RepoToolState; budgetUsd: number },
): Promise<PlanOutcome> {
  const now = deps.now ?? Date.now;
  const repo = createRepoToolHandlers({
    snapshot: ctx.snapshot,
    siteOrigin: ctx.siteOrigin,
    deps: deps.toolDeps,
    state: opts.state,
  });
  let accepted: AgentPlan | null = null;

  const handleTool = async (name: string, input: unknown): Promise<ToolOutcome> => {
    if (name === "submit_plan") {
      const plan = input as AgentPlan;
      const problems = checkPlan(plan, {
        exists: repo.exists,
        filesRead: opts.state.filesRead,
        strategy: ctx.strategy,
      });
      if (problems.length) {
        await deps.onEvent({
          stage: "investigate",
          kind: "tool_call",
          summary: `Plan needed changes: ${problems[0]}`.slice(0, 280),
          detail: { problems },
        });
        return {
          content: `The plan was not accepted:\n- ${problems.join("\n- ")}\nFix these and call submit_plan again.`,
          isError: true,
          summary: "Plan sent back for changes",
        };
      }
      accepted = plan;
      return {
        content: "Plan received.",
        summary: plan.feasible
          ? `Prepared a plan: ${plan.strategy}`
          : "Concluded this can't be automated safely",
      };
    }
    const out = await repo.handle(name, input);
    await deps.onEvent({
      stage: "investigate",
      kind: "tool_call",
      summary: out.summary.slice(0, 280),
      detail: out.detail,
    });
    return out;
  };

  const messages: ClaudeMessage[] = opts.resume?.length
    ? opts.resume
    : [{ role: "user", content: briefing(ctx) }];
  const result = await (deps.loop ?? claudeToolLoop)({
    route: GEO_AGENT_ROUTE.investigate,
    model: geoAgentModel(),
    system: INVESTIGATE_SYSTEM,
    tools: [...REPO_TOOLS, SUBMIT_PLAN_TOOL],
    messages,
    handleTool,
    terminalTools: ["submit_plan"],
    maxTurns: STAGE_LIMITS.investigate.maxTurns,
    maxTokensPerTurn: STAGE_LIMITS.investigate.maxTokens,
    maxCostUsd: opts.budgetUsd,
    deadlineAt: now() + STAGE_LIMITS.investigate.wallMs,
    effort: "high",
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    isCancelled: deps.isCancelled,
    onTurn: async (t) => {
      await deps.checkpoint?.("investigate", t.messages);
    },
  });
  const usage = addUsage(emptyUsage(), result.usage);
  if (result.status !== "submitted" || !accepted) return loopFailure(result, usage);
  const plan = normalizePlan(accepted, ctx);
  return { ok: true, plan, filesInspected: opts.state.inspected, usage, messages: result.messages };
}

function normalizePlan(plan: AgentPlan, ctx: AgentContext): AgentPlan {
  const clip = (s: string, n = 600) => s.slice(0, n);
  return {
    feasible: plan.feasible,
    notFixableReason: plan.notFixableReason ? clip(plan.notFixableReason, 1200) : null,
    manualSteps: plan.manualSteps.slice(0, 12).map((s) => clip(s)),
    strategy: clip(plan.strategy, 160),
    scope: plan.scope,
    summary: clip(plan.summary, 1200),
    files: plan.files.slice(0, MAX_FILES_PER_CHANGE).map((f) => ({
      path: f.path,
      action: f.action,
      reason: clip(f.reason, 400),
      evidence: f.evidence
        .slice(0, 6)
        .map((e) => ({ path: e.path, line: e.line, note: clip(e.note, 300) })),
    })),
    risks: plan.risks.slice(0, 8).map((s) => clip(s, 400)),
    outOfScope: plan.outOfScope.slice(0, 8).map((s) => clip(s, 300)),
    validationCriteria: plan.validationCriteria.slice(0, 10).map((s) => clip(s, 400)),
    needsInput: [
      ...plan.needsInput.slice(0, 6),
      // Facts the strategy always requires and the agent didn't already ask for.
      ...ctx.strategy.inputs.filter(
        (i) => !plan.needsInput.some((n) => n.key === i.key) && !ctx.inputs[i.key] && plan.feasible,
      ),
    ].map((n) => ({
      key: n.key.slice(0, 60),
      label: clip(n.label, 120),
      why: clip(n.why, 300),
      example: clip(n.example, 200),
    })),
    verification: {
      scope: ctx.strategy.verifyScope === "full" ? "full" : plan.verification.scope,
      urls: plan.verification.urls.filter((u) => u.startsWith(ctx.siteOrigin)).slice(0, 20),
    },
    confidence: plan.confidence,
  };
}

/* ───────────────────────── implement → review → validate → correct ───────────────────────── */

export type PatchOutcome =
  | {
      ok: true;
      files: GeneratedFile[];
      explanation: string;
      review: AgentReview;
      validation: ProposalValidation;
      corrections: number;
      usage: AgentUsage;
    }
  | (StageFailure & {
      review?: AgentReview;
      validation?: ProposalValidation;
      files?: GeneratedFile[];
    });

function finalizeFiles(
  files: { path: string; action: "create" | "update"; before: string | null; after: string }[],
  why: Map<string, string>,
): GeneratedFile[] {
  return files.map((f) => {
    const stats = changedLines(f.before ?? "", f.after);
    return {
      ...f,
      explanation: why.get(f.path) ?? "",
      diff: createPatch(f.path, f.before ?? "", f.after, "current", "proposed", { context: 3 }),
      additions: stats.additions,
      deletions: stats.deletions,
    };
  });
}

/** Deterministic checks + grounding; nothing is executed. */
export function validatePatch(
  ctx: AgentContext,
  plan: AgentPlan,
  files: GeneratedFile[],
): ProposalValidation {
  const base = validateProposal({
    kind: ctx.fixKind,
    ruleId: ctx.finding.ruleId,
    pageUrl: ctx.finding.pageUrl,
    site: ctx.site,
    files,
    crawlerReadsFile: files.every((f) => /\.(html?|txt|xml)$/i.test(f.path)),
    allowedImports: ctx.allowedImports,
    resolveImport: (spec, from) => resolveImport(ctx.snapshot, spec, from),
  });
  const checks: ValidationCheck[] = [...base.checks];
  const planned = new Set(plan.files.map((f) => f.path));
  const outside = files.filter((f) => !planned.has(f.path)).map((f) => f.path);
  checks.push({
    id: "scope",
    label: "Only the approved plan's files change",
    status: outside.length ? "fail" : "pass",
    detail: outside.length
      ? `Not in the plan: ${outside.join(", ")}`
      : files.map((f) => f.path).join(", "),
  });
  if (ctx.strategy.grounding !== "none") {
    const g = groundingCheck({
      files,
      siteText: ctx.siteText,
      inputs: ctx.strategy.grounding === "page_text_inputs" ? Object.values(ctx.inputs) : [],
    });
    checks.push({
      id: "grounding",
      label: "No facts that aren't on the site",
      status: g.ok ? "pass" : "fail",
      detail: g.ok
        ? `${g.checked} added text fragment(s) match existing site text${Object.keys(ctx.inputs).length ? " or your inputs" : ""}`
        : g.ungrounded.map((u) => `${u.path}: “${u.text.slice(0, 80)}” — ${u.reason}`).join("; "),
    });
  }
  const deleted = files.reduce((s, f) => s + f.deletions, 0);
  const total = files.reduce((s, f) => s + (f.before ?? "").split("\n").length, 0);
  const ratio = total ? deleted / total : 0;
  checks.push({
    id: "deletions",
    label: "The change doesn't rewrite whole files",
    status: total > 20 && ratio > 0.5 ? "fail" : "pass",
    detail: `${deleted} of ${total} existing line(s) removed`,
  });
  return { ok: checks.every((c) => c.status !== "fail"), checks };
}

/** Relative / alias import → an existing repository file. */
export function resolveImport(snapshot: RepoSnapshot, spec: string, fromPath: string): boolean {
  const paths = new Set(snapshot.entries.map((e) => e.path));
  let base: string;
  if (spec.startsWith(".")) {
    const parts = fromPath.split("/").slice(0, -1);
    for (const seg of spec.split("/")) {
      if (seg === "..") parts.pop();
      else if (seg !== ".") parts.push(seg);
    }
    base = parts.join("/");
  } else if (spec.startsWith("@/") || spec.startsWith("~/")) {
    const rest = spec.slice(2);
    base =
      paths.has(`src/${rest}`) ||
      [...paths].some((p) => p.startsWith(`src/${rest}.`) || p.startsWith(`src/${rest}/`))
        ? `src/${rest}`
        : rest;
  } else return false;
  const exts = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".vue", ".svelte", ".astro", ".json"];
  return (
    exts.some((e) => paths.has(`${base}${e}`)) ||
    exts.slice(1).some((e) => paths.has(`${base}/index${e}`))
  );
}

export async function reviewPatch(
  ctx: AgentContext,
  plan: AgentPlan,
  files: GeneratedFile[],
  explanation: string,
  deps: AgentDeps,
): Promise<AgentReview> {
  const user = `<finding>${JSON.stringify({ rule: ctx.finding.ruleId, title: ctx.finding.title, detail: ctx.finding.detail, page: ctx.finding.pageUrl })}</finding>
<framework>${ctx.snapshot.framework ?? "unknown"} — ${ctx.playbook.name}</framework>
<approved_plan>${JSON.stringify({ summary: plan.summary, strategy: plan.strategy, files: plan.files.map((f) => ({ path: f.path, action: f.action, reason: f.reason })), risks: plan.risks })}</approved_plan>
<explanation>${explanation}</explanation>
<diff>
${files.map((f) => f.diff).join("\n")}
</diff>
<site_text_sample>${ctx.siteText.join("\n").slice(0, 6000)}</site_text_sample>
<user_inputs>${JSON.stringify(ctx.inputs)}</user_inputs>`;
  const res = await (deps.complete ?? claudeTextCompletion)({
    route: GEO_AGENT_ROUTE.review,
    model: geoAgentModel(),
    system: REVIEW_SYSTEM,
    user,
    maxTokens: 6000,
    effort: "high",
    outputSchema: REVIEW_SCHEMA,
    timeoutMs: 90_000,
    retries: 1,
  });
  const parsed = JSON.parse(res.text) as AgentReview;
  const issues = (parsed.issues ?? []).slice(0, 12);
  const blocking = issues.some((i) => i.severity !== "minor");
  return {
    verdict: blocking ? "revise" : "approve",
    summary: String(parsed.summary ?? "").slice(0, 1200),
    issues,
  };
}

async function currentContents(
  ctx: AgentContext,
  plan: AgentPlan,
  readBlob: (sha: string) => Promise<string | null>,
): Promise<{ path: string; action: "create" | "update"; content: string | null }[]> {
  const byPath = new Map(ctx.snapshot.entries.map((e) => [e.path, e]));
  const out = [];
  for (const f of plan.files) {
    const entry = byPath.get(f.path);
    if (f.action === "update" && entry) {
      const content = await readBlob(entry.sha);
      if (content === null) throw new Error(`${f.path} couldn't be read as text.`);
      out.push({ path: f.path, action: "update" as const, content });
    } else out.push({ path: f.path, action: "create" as const, content: null });
  }
  return out;
}

export async function implementPlan(
  ctx: AgentContext,
  plan: AgentPlan,
  deps: AgentDeps,
  opts: { state: RepoToolState; budgetUsd: number; resume?: ClaudeMessage[] },
): Promise<PatchOutcome> {
  const now = deps.now ?? Date.now;
  let usage = emptyUsage();
  const planned = new Set(plan.files.map((f) => f.path));
  const repo = createRepoToolHandlers({
    snapshot: ctx.snapshot,
    siteOrigin: ctx.siteOrigin,
    deps: deps.toolDeps,
    state: opts.state,
    allowPaths: (p) => planned.has(p) || opts.state.filesRead.has(p),
  });
  const current = await currentContents(ctx, plan, deps.toolDeps.readBlob);
  let submitted: { files: GeneratedFile[]; explanation: string } | null = null;

  const handleTool = async (name: string, input: unknown): Promise<ToolOutcome> => {
    if (name === "submit_patch") {
      const { explanation, edits } = input as {
        explanation: string;
        edits: { path: string; find: string; replace: string; why: string }[];
      };
      const outside = edits.filter((e) => !planned.has(e.path)).map((e) => e.path);
      if (outside.length) {
        return {
          content: `Only the approved plan's files may change. Remove edits to: ${outside.join(", ")}.`,
          isError: true,
          summary: "Patch touched files outside the plan",
        };
      }
      const applied = applyEdits(current, edits);
      if (!applied.ok) {
        await deps.onEvent({
          stage: "implement",
          kind: "tool_call",
          summary: `Patch didn't apply: ${applied.reason}`.slice(0, 280),
        });
        return {
          content: `${applied.reason} Re-read the file and submit exact, unique find strings.`,
          isError: true,
          summary: "Patch didn't apply cleanly",
        };
      }
      submitted = {
        files: finalizeFiles(applied.files, applied.why),
        explanation: String(explanation ?? "").slice(0, 2000),
      };
      return {
        content: "Patch received.",
        summary: `Prepared a patch for ${applied.files.map((f) => f.path).join(", ")}`,
      };
    }
    const out = await repo.handle(name, input);
    await deps.onEvent({
      stage: "implement",
      kind: "tool_call",
      summary: out.summary.slice(0, 280),
      detail: out.detail,
    });
    return out;
  };

  const planText = JSON.stringify(
    {
      summary: plan.summary,
      strategy: plan.strategy,
      scope: plan.scope,
      files: plan.files,
      risks: plan.risks,
      validationCriteria: plan.validationCriteria,
    },
    null,
    2,
  );
  let messages: ClaudeMessage[] = opts.resume?.length
    ? opts.resume
    : [
        {
          role: "user",
          content: `${briefing(ctx)}\n\n<approved_plan>\n${planText}\n</approved_plan>\n\nImplement the approved plan now.`,
        },
      ];

  let corrections = 0;
  for (;;) {
    submitted = null;
    const remaining = opts.budgetUsd - usage.costUsd;
    const result = await (deps.loop ?? claudeToolLoop)({
      route: GEO_AGENT_ROUTE.implement,
      model: geoAgentModel(),
      system: IMPLEMENT_SYSTEM,
      tools: [...REPO_TOOLS.filter((t) => t.name !== "inspect_live_page"), SUBMIT_PATCH_TOOL],
      messages,
      handleTool,
      terminalTools: ["submit_patch"],
      maxTurns: STAGE_LIMITS.implement.maxTurns,
      maxTokensPerTurn: STAGE_LIMITS.implement.maxTokens,
      maxCostUsd: Math.max(0.01, remaining),
      deadlineAt: now() + STAGE_LIMITS.implement.wallMs,
      effort: "medium",
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      isCancelled: deps.isCancelled,
      onTurn: async (t) => {
        await deps.checkpoint?.("implement", t.messages);
      },
    });
    usage = addUsage(usage, result.usage);
    messages = result.messages;
    const patch = submitted as { files: GeneratedFile[]; explanation: string } | null;
    if (result.status !== "submitted" || !patch) return loopFailure(result, usage);

    const review = await reviewPatch(ctx, plan, patch.files, patch.explanation, deps);
    await deps.onEvent({
      stage: "review",
      kind: "review",
      summary:
        review.verdict === "approve"
          ? `Self-review passed${review.issues.length ? ` (${review.issues.length} minor note(s))` : ""}`
          : `Self-review found ${review.issues.filter((i) => i.severity !== "minor").length} issue(s) to fix`,
      detail: {
        verdict: review.verdict,
        issues: review.issues.map((i) => `${i.severity}: ${i.detail}`).slice(0, 6),
      },
    });
    const validation = validatePatch(ctx, plan, patch.files);
    const failed = validation.checks.filter((c) => c.status === "fail");
    await deps.onEvent({
      stage: "validate",
      kind: "validation",
      summary: failed.length
        ? `Validation failed: ${failed.map((c) => c.label).join(", ")}`.slice(0, 280)
        : "Validation checks passed",
      detail: { checks: validation.checks.map((c) => ({ id: c.id, status: c.status })) },
    });

    if (review.verdict === "approve" && validation.ok) {
      return {
        ok: true,
        files: patch.files,
        explanation: patch.explanation,
        review,
        validation,
        corrections,
        usage,
      };
    }
    if (corrections >= STAGE_LIMITS.maxCorrections) {
      return {
        ok: false,
        code: "validation_failed",
        message: failed.length
          ? `The patch still fails: ${failed.map((c) => `${c.label} — ${c.detail}`).join("; ")}`.slice(
              0,
              1800,
            )
          : `The review still found problems: ${review.issues.map((i) => i.detail).join("; ")}`.slice(
              0,
              1800,
            ),
        usage,
        review,
        validation,
        files: patch.files,
      };
    }
    corrections++;
    await deps.onEvent({
      stage: "correct",
      kind: "correction",
      summary: `Correcting the patch (round ${corrections} of ${STAGE_LIMITS.maxCorrections})`,
    });
    const problems = [
      ...review.issues
        .filter((i) => i.severity !== "minor")
        .map(
          (i) =>
            `[review ${i.severity}/${i.category}] ${i.path ?? ""} ${i.detail} → ${i.suggestion}`,
        ),
      ...failed.map((c) => `[check: ${c.label}] ${c.detail}`),
    ];
    // Base the next attempt on the original files; the model resubmits the full edit set.
    messages = [
      ...messages,
      {
        role: "user",
        content: `Your patch was not accepted. Fix these problems and call submit_patch again with the complete set of edits (edits apply to the original files):\n- ${problems.join("\n- ")}`,
      },
    ];
  }
}
