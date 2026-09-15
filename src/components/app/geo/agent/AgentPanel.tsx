"use client";

// AgentPanel — the Mellox GEO Engineer working on one finding.
//
//   start          "Fix with AI Agent" (needs a verified repository + admin consent)
//   timeline       Detected → … → Verified fixed, from the run's real status
//   plan           files + reasons, risks, scope, validation criteria → approve / revise
//   inputs         facts the fix needs (never guessed)
//   patch          diff, self-review, validation checks → approve → pull request
//   activity       the tools the agent actually ran (no model reasoning)
//
// Every state and every log line comes from the server; polling stops once the
// run waits on a person or finishes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bot,
  CheckCircle,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Spinner,
  Wand,
  XCircle,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useVisibleInterval } from "@/hooks/use-visible-interval";
import {
  approveAgentPlan,
  cancelAgentRun,
  getAgentRun,
  getAgentRunForFinding,
  retryAgentRun,
  reviseAgentPlan,
  startAgentRun,
  submitAgentInputs,
} from "@/lib/geo-agent.functions";
import { approveFixProposal } from "@/lib/geo-fixes.functions";
import {
  AGENT_TERMINAL_STATUSES,
  AGENT_WAITING_STATUSES,
  type AgentEventView,
  type AgentRunView,
  type TimelineStep,
} from "@/lib/geo/agent-contracts";
import { cn } from "@/lib/utils";
import { Chip, relativeTime } from "../geo-ui";
import { CheckRow, DiffView, VerificationCard } from "../FindingDetail";

const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

type RunState = { run: AgentRunView | null; events: AgentEventView[] };

/* ───────────────────────── timeline ───────────────────────── */

function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2" aria-label="Fix progress">
      {steps.map((s, i) => (
        <li key={s.id} className="flex items-center gap-1">
          <span
            title={s.detail ?? (s.at ? new Date(s.at).toLocaleString() : undefined)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
              s.state === "done" && "bg-success/10 text-success ring-success/25",
              s.state === "current" && "bg-primary/15 text-foreground ring-primary/40",
              s.state === "waiting" && "bg-warning/10 text-warning ring-warning/30",
              s.state === "failed" && "bg-destructive/10 text-destructive ring-destructive/30",
              (s.state === "todo" || s.state === "skipped") &&
                "bg-muted/60 text-muted-foreground ring-border/60",
              s.state === "skipped" && "line-through",
            )}
          >
            {s.state === "done" ? (
              <CheckCircle className="h-3 w-3" />
            ) : s.state === "current" ? (
              <Spinner className="h-3 w-3 animate-spin" />
            ) : s.state === "failed" ? (
              <XCircle className="h-3 w-3" />
            ) : s.state === "waiting" ? (
              <AlertTriangle className="h-3 w-3" />
            ) : null}
            {s.label}
          </span>
          {i < steps.length - 1 && (
            <span className="text-muted-foreground/50" aria-hidden>
              →
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

/* ───────────────────────── activity log ───────────────────────── */

function ActivityLog({ events }: { events: AgentEventView[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? events : events.slice(-12);
  if (!events.length) return <p className="text-[12px] text-muted-foreground">No activity yet.</p>;
  return (
    <div>
      <ol className="space-y-1">
        {shown.map((e) => (
          <li key={e.id} className="flex items-start gap-2 text-[12px]">
            <span className="w-14 shrink-0 tabular-nums text-muted-foreground">
              {new Date(e.at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
            <span
              className={cn(
                "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                e.kind === "error"
                  ? "bg-destructive"
                  : e.actor === "user"
                    ? "bg-primary"
                    : e.actor === "system"
                      ? "bg-muted-foreground/60"
                      : "bg-success",
              )}
              aria-hidden
            />
            <span
              className={cn(
                "min-w-0 break-words",
                e.kind === "error" ? "text-destructive" : "text-foreground/85",
              )}
            >
              {e.actor === "user" ? "You: " : ""}
              {e.summary}
            </span>
          </li>
        ))}
      </ol>
      {events.length > 12 && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="mt-1 text-[11.5px] font-medium text-primary underline-offset-2 hover:underline"
        >
          {all ? "Show recent only" : `Show all ${events.length} steps`}
        </button>
      )}
    </div>
  );
}

/* ───────────────────────── plan ───────────────────────── */

function PlanReview({
  workspaceId,
  run,
  onRun,
}: {
  workspaceId: string;
  run: AgentRunView;
  onRun: (next: RunState) => void;
}) {
  const plan = run.plan!;
  const [feedback, setFeedback] = useState("");
  const [revising, setRevising] = useState(false);
  const [busy, setBusy] = useState<"approve" | "revise" | null>(null);

  const approve = async () => {
    if (!run.planHash) return;
    setBusy("approve");
    try {
      onRun(
        await approveAgentPlan({ data: { workspaceId, runId: run.id, planHash: run.planHash } }),
      );
      toast.success("Plan approved — the GEO Engineer is implementing it");
    } catch (e) {
      toast.error(errMsg(e, "Couldn't approve the plan"));
    } finally {
      setBusy(null);
    }
  };
  const revise = async () => {
    setBusy("revise");
    try {
      onRun(await reviseAgentPlan({ data: { workspaceId, runId: run.id, feedback } }));
      setRevising(false);
      setFeedback("");
      toast.success("Sent your feedback — the plan is being revised");
    } catch (e) {
      toast.error(errMsg(e, "Couldn't send feedback"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip
          tone={
            plan.confidence === "high"
              ? "success"
              : plan.confidence === "medium"
                ? "warning"
                : "muted"
          }
        >
          {plan.confidence} confidence
        </Chip>
        <Chip tone="muted">{plan.scope} scope</Chip>
        <span className="text-[12px] text-muted-foreground">{plan.strategy}</span>
      </div>
      <p className="text-[13px] leading-relaxed text-foreground/90">{plan.summary}</p>

      {plan.files.length > 0 && (
        <div>
          <h5 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Files to change
          </h5>
          <ul className="space-y-1.5">
            {plan.files.map((f) => (
              <li
                key={f.path}
                className="rounded-lg border border-border/60 bg-background/60 px-2.5 py-2 text-[12px]"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <Chip tone={f.action === "create" ? "primary" : "muted"}>{f.action}</Chip>
                  <span className="break-all font-mono text-foreground/90">{f.path}</span>
                </div>
                <p className="mt-1 text-muted-foreground">{f.reason}</p>
                {f.evidence.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-[11.5px] text-muted-foreground">
                    {f.evidence.map((e, i) => (
                      <li key={i}>
                        <span className="font-mono">
                          {e.path}
                          {e.line ? `:${e.line}` : ""}
                        </span>{" "}
                        — {e.note}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {plan.risks.length > 0 && (
          <div>
            <h5 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              Risks
            </h5>
            <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-foreground/85">
              {plan.risks.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}
        {plan.validationCriteria.length > 0 && (
          <div>
            <h5 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              How the fix will be validated
            </h5>
            <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-foreground/85">
              {plan.validationCriteria.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}
        {plan.outOfScope.length > 0 && (
          <div>
            <h5 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              Not changed
            </h5>
            <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-muted-foreground">
              {plan.outOfScope.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {run.actions.approvePlan && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
          <Button
            size="sm"
            loading={busy === "approve"}
            disabled={busy !== null}
            onClick={() => void approve()}
          >
            <CheckCircle className="h-3.5 w-3.5" /> Approve plan
          </Button>
          {run.actions.revisePlan && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => setRevising((v) => !v)}
            >
              Request changes
            </Button>
          )}
          <span className="text-[11.5px] text-muted-foreground">
            Nothing is changed in your repository until you approve the final patch.
          </span>
        </div>
      )}
      {revising && (
        <div className="space-y-2">
          <label className="sr-only" htmlFor={`revise-${run.id}`}>
            What should change in the plan?
          </label>
          <textarea
            id={`revise-${run.id}`}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value.slice(0, 1000))}
            rows={3}
            placeholder="e.g. Put the canonical in the shared SEO component instead of each page"
            className="w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          />
          <Button
            size="sm"
            loading={busy === "revise"}
            disabled={feedback.trim().length < 3}
            onClick={() => void revise()}
          >
            Send feedback
          </Button>
        </div>
      )}
    </div>
  );
}

function InputsForm({
  workspaceId,
  run,
  onRun,
}: {
  workspaceId: string;
  run: AgentRunView;
  onRun: (n: RunState) => void;
}) {
  const requests = run.plan?.needsInput ?? [];
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(requests.map((r) => [r.key, run.inputs[r.key]?.value ?? ""])),
  );
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      onRun(await submitAgentInputs({ data: { workspaceId, runId: run.id, inputs: values } }));
      toast.success("Thanks — the plan is ready for review");
    } catch (e) {
      toast.error(errMsg(e, "Couldn't save your answers"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="space-y-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="text-[12.5px]">
        The fix needs facts Mellox won't guess. They're used exactly as you write them.
      </p>
      {requests.map((r) => (
        <div key={r.key}>
          <label htmlFor={`in-${run.id}-${r.key}`} className="text-[12px] font-medium">
            {r.label}
          </label>
          <p className="text-[11.5px] text-muted-foreground">{r.why}</p>
          <input
            id={`in-${run.id}-${r.key}`}
            value={values[r.key] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [r.key]: e.target.value }))}
            placeholder={r.example}
            className="mt-1 h-9 w-full rounded-lg border border-border/70 bg-background px-3 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          />
        </div>
      ))}
      <Button
        size="sm"
        type="submit"
        loading={busy}
        disabled={requests.some((r) => !values[r.key]?.trim())}
      >
        Continue
      </Button>
    </form>
  );
}

/* ───────────────────────── patch ───────────────────────── */

function PatchReview({
  workspaceId,
  run,
  onChanged,
}: {
  workspaceId: string;
  run: AgentRunView;
  onChanged: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const proposal = run.proposal;
  const approve = async () => {
    if (!proposal?.contentHash) return;
    setBusy(true);
    try {
      const p = await approveFixProposal({
        data: { workspaceId, proposalId: proposal.id, contentHash: proposal.contentHash },
      });
      toast.success(p.pr ? `Pull request #${p.pr.number} opened` : "Change applied");
      onChanged();
    } catch (e) {
      toast.error(errMsg(e, "Couldn't open the pull request"));
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  const files = run.patch?.files ?? [];
  return (
    <div className="space-y-3">
      {run.patch?.explanation && (
        <p className="text-[12.5px] text-foreground/90">{run.patch.explanation}</p>
      )}
      {files.map((f) => (
        <div key={f.path}>
          <div className="mb-1 flex flex-wrap items-center gap-2 text-[12px]">
            <span className="break-all font-mono">{f.path}</span>
            <span className="text-success">+{f.additions}</span>
            <span className="text-destructive">−{f.deletions}</span>
          </div>
          {f.diff ? (
            <DiffView diff={f.diff} />
          ) : (
            <p className="text-[12px] text-muted-foreground">Diff no longer stored.</p>
          )}
        </div>
      ))}
      {run.review && (
        <div className="rounded-lg border border-border/60 bg-background/60 p-2.5">
          <div className="flex items-center gap-2 text-[12px] font-medium">
            <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" /> Self-review:{" "}
            <Chip tone={run.review.verdict === "approve" ? "success" : "warning"}>
              {run.review.verdict === "approve" ? "passed" : "changes needed"}
            </Chip>
            {run.correctionRounds > 0 && (
              <span className="text-muted-foreground">
                after {run.correctionRounds} correction(s)
              </span>
            )}
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">{run.review.summary}</p>
          {run.review.issues.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-[11.5px] text-muted-foreground">
              {run.review.issues.map((i, k) => (
                <li key={k}>
                  <span className="font-medium">{i.severity}</span> · {i.category}: {i.detail}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {run.validation && (
        <ul>
          {run.validation.checks.map((c) => (
            <CheckRow key={c.id} status={c.status} label={c.label} detail={c.detail} />
          ))}
        </ul>
      )}
      {run.actions.approvePatch && proposal?.contentHash && (
        <div className="space-y-2 border-t border-border/50 pt-3">
          <label className="flex items-start gap-2 text-[12px]">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              I reviewed this exact change. Open it as a pull request from a new{" "}
              <span className="font-mono">mellox/</span> branch on{" "}
              <span className="font-medium">{run.repository}</span> (Mellox never merges or pushes
              to {run.baseBranch}).
            </span>
          </label>
          <Button size="sm" loading={busy} disabled={!agreed} onClick={() => void approve()}>
            <Wand className="h-3.5 w-3.5" /> Approve & create pull request
          </Button>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── panel ───────────────────────── */

export function AgentPanel({
  workspaceId,
  findingId,
  fixMode,
  canPropose,
  ready,
  notReadyReason,
  manualSteps,
  onChanged,
}: {
  workspaceId: string;
  findingId: string;
  fixMode: "deterministic" | "agent" | "manual";
  canPropose: boolean;
  /** GitHub connected + repository verified for this site (from fix availability). */
  ready: boolean;
  notReadyReason: string | null;
  manualSteps: string[];
  onChanged: () => void;
}) {
  const [state, setState] = useState<RunState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"start" | "cancel" | "retry" | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [refusal, setRefusal] = useState<{
    reason: string;
    manualSteps?: string[];
    validationSteps?: string[];
  } | null>(null);
  const lastEvent = useRef(0);

  const load = useCallback(async () => {
    try {
      const next = await getAgentRunForFinding({ data: { workspaceId, findingId } });
      lastEvent.current = next.events.at(-1)?.id ?? 0;
      setState(next);
      setError(null);
    } catch (e) {
      setError(errMsg(e, "Couldn't load the agent"));
    }
  }, [workspaceId, findingId]);

  useEffect(() => {
    setState(null);
    void load();
  }, [load]);

  const run = state?.run ?? null;
  const active =
    !!run &&
    !AGENT_TERMINAL_STATUSES.includes(run.status) &&
    !AGENT_WAITING_STATUSES.includes(run.status);
  const watching = !!run && ["pr_open", "merged", "rescan_pending"].includes(run.status);

  const poll = useCallback(async () => {
    if (!run) return;
    try {
      const next = await getAgentRun({
        data: { workspaceId, runId: run.id, afterEventId: lastEvent.current },
      });
      const events = [...(state?.events ?? []), ...next.events];
      lastEvent.current = events.at(-1)?.id ?? lastEvent.current;
      setState({ run: next.run, events });
      if (next.run.status !== run.status) onChanged();
    } catch {
      /* keep showing the last state; the next tick retries */
    }
  }, [run, state?.events, workspaceId, onChanged]);
  // Fast while the agent works, slow while GitHub/verification progress, idle otherwise.
  useVisibleInterval(
    () => {
      if (active || watching) void poll();
    },
    active ? 2500 : 20000,
    [run?.id, run?.status, active, watching],
  );

  const replace = (next: RunState) => {
    lastEvent.current = next.events.at(-1)?.id ?? 0;
    setState(next);
  };

  const start = async () => {
    setBusy("start");
    setRefusal(null);
    try {
      const r = await startAgentRun({ data: { workspaceId, findingId } });
      if (!r.ok) setRefusal(r);
      else {
        replace(await getAgentRun({ data: { workspaceId, runId: r.runId } }));
        if (r.joined) toast.message("The GEO Engineer is already working on this finding");
      }
    } catch (e) {
      toast.error(errMsg(e, "Couldn't start the agent"));
    } finally {
      setBusy(null);
    }
  };
  const cancel = async (closePullRequest: boolean) => {
    if (!run) return;
    setBusy("cancel");
    try {
      replace(await cancelAgentRun({ data: { workspaceId, runId: run.id, closePullRequest } }));
      setConfirmClose(false);
      onChanged();
    } catch (e) {
      toast.error(errMsg(e, "Couldn't cancel"));
    } finally {
      setBusy(null);
    }
  };
  const retry = async () => {
    if (!run) return;
    setBusy("retry");
    try {
      const fromStage = run.planApprovedAt && run.status === "failed" ? "implement" : "investigate";
      replace(await retryAgentRun({ data: { workspaceId, runId: run.id, fromStage } }));
    } catch (e) {
      toast.error(errMsg(e, "Couldn't retry"));
    } finally {
      setBusy(null);
    }
  };

  const header = useMemo(
    () => (
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
          <Bot className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">Mellox GEO Engineer</div>
          <div className="text-[11.5px] text-muted-foreground">
            {run?.model
              ? `Anthropic ${run.model === "claude-sonnet-5" ? "Claude Sonnet 5" : run.model}`
              : "Anthropic Claude Sonnet 5"}
            {run?.repository
              ? ` · ${run.repository}@${run.baseBranch}${run.baseSha ? ` (${run.baseSha.slice(0, 7)})` : ""}`
              : ""}
          </div>
        </div>
        {run && (
          <span className="ml-auto text-[11.5px] text-muted-foreground">
            {run.usage
              ? `${run.usage.turns} model turns · $${run.usage.costUsd.toFixed(2)} · `
              : ""}
            started {relativeTime(run.createdAt)}
          </span>
        )}
      </div>
    ),
    [run],
  );

  if (error && !state) return <ErrorState size="sm" detail={error} onRetry={() => void load()} />;
  if (!state) return <Skeleton className="h-24 w-full rounded-xl" />;

  if (fixMode === "manual") {
    return (
      <div className="space-y-2">
        {header}
        <p className="text-[12.5px] text-muted-foreground">
          This finding can't be fixed safely from source code (it needs your content, business
          facts, legal text or hosting changes). Follow the steps below; Mellox verifies the result
          with a re-scan.
        </p>
        {manualSteps.length > 0 && (
          <ol className="list-decimal space-y-1 pl-5 text-[12.5px]">
            {manualSteps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        )}
      </div>
    );
  }

  if (!run) {
    return (
      <div className="space-y-3">
        {header}
        <p className="text-[12.5px] text-muted-foreground">
          The GEO Engineer reads your repository, finds where this is produced, proposes a plan for
          you to approve, writes and self-reviews the patch, validates it, and opens a pull request
          only after you approve the exact change. A re-scan of the live site decides whether it's
          fixed.
        </p>
        {refusal && (
          <div className="rounded-lg border border-warning/30 bg-warning/5 p-2.5 text-[12.5px]">
            <p>{refusal.reason}</p>
            {refusal.manualSteps?.length ? (
              <ol className="mt-1 list-decimal space-y-0.5 pl-5">
                {refusal.manualSteps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            ) : null}
          </div>
        )}
        {!ready ? (
          <p className="text-[12px] text-muted-foreground">
            {notReadyReason ??
              "Connect and verify the repository behind this website first (see Fix method above)."}
          </p>
        ) : !canPropose ? (
          <p className="text-[12px] text-muted-foreground">An editor can start the GEO Engineer.</p>
        ) : (
          <Button size="sm" loading={busy === "start"} onClick={() => void start()}>
            <Wand className="h-3.5 w-3.5" /> Fix with AI Agent
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {header}
      <Timeline steps={run.timeline} />
      {run.statusDetail && (
        <p
          className={cn(
            "text-[12.5px]",
            run.status === "failed" ? "text-destructive" : "text-foreground/85",
          )}
        >
          {active && <Spinner className="mr-1 inline h-3.5 w-3.5 animate-spin" />}
          {run.statusDetail}
        </p>
      )}
      {run.error && run.status === "failed" && run.error.message !== run.statusDetail && (
        <p className="rounded-lg border border-destructive/25 bg-destructive/5 px-2.5 py-2 text-[12px] text-destructive">
          {run.error.message}
        </p>
      )}

      {run.filesInspected.length > 0 && (
        <details className="rounded-lg border border-border/60 bg-background/50 px-2.5 py-2">
          <summary className="cursor-pointer text-[12px] font-medium">
            Files inspected ({run.filesInspected.length})
          </summary>
          <ul className="mt-1.5 space-y-0.5 text-[11.5px]">
            {run.filesInspected.map((f) => (
              <li key={f.path}>
                <span className="font-mono text-foreground/85">{f.path}</span>
                {f.lines ? <span className="text-muted-foreground"> · lines {f.lines}</span> : null}
                <span className="text-muted-foreground"> — {f.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {run.status === "not_fixable" && run.plan && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-2.5 text-[12.5px]">
          <p className="font-medium">Can't be automated safely</p>
          <p className="mt-0.5 text-foreground/85">{run.plan.notFixableReason}</p>
          {run.plan.manualSteps.length > 0 && (
            <ol className="mt-1.5 list-decimal space-y-0.5 pl-5">
              {run.plan.manualSteps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          )}
          {run.plan.validationCriteria.length > 0 && (
            <p className="mt-1.5 text-[12px] text-muted-foreground">
              Afterwards: {run.plan.validationCriteria.join(" · ")}
            </p>
          )}
        </div>
      )}

      {run.status === "needs_input" && run.actions.submitInputs && (
        <InputsForm workspaceId={workspaceId} run={run} onRun={replace} />
      )}
      {run.plan &&
        run.plan.feasible &&
        ["awaiting_plan_approval", "needs_input"].includes(run.status) && (
          <PlanReview workspaceId={workspaceId} run={run} onRun={replace} />
        )}
      {run.plan &&
        run.plan.feasible &&
        run.planApprovedAt &&
        !["awaiting_plan_approval"].includes(run.status) && (
          <details className="rounded-lg border border-border/60 bg-background/50 px-2.5 py-2">
            <summary className="cursor-pointer text-[12px] font-medium">
              Approved plan · {run.plan.strategy}
            </summary>
            <p className="mt-1 text-[12px] text-muted-foreground">{run.plan.summary}</p>
          </details>
        )}
      {(run.patch || run.validation) && (
        <PatchReview
          workspaceId={workspaceId}
          run={run}
          onChanged={() => {
            void load();
            onChanged();
          }}
        />
      )}

      {run.proposal?.pr && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-2.5 py-2 text-[12.5px]">
          <a
            href={run.proposal.pr.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
          >
            Pull request #{run.proposal.pr.number} <ExternalLink className="h-3 w-3" />
          </a>
          <Chip
            tone={
              run.proposal.pr.state === "merged"
                ? "success"
                : run.proposal.pr.state === "closed"
                  ? "muted"
                  : "primary"
            }
          >
            {run.proposal.pr.state}
          </Chip>
          {run.proposal.headBranch && (
            <span className="font-mono text-[11.5px] text-muted-foreground">
              {run.proposal.headBranch}
            </span>
          )}
          {run.proposal.checks?.available ? (
            <span className="text-[11.5px] text-muted-foreground">
              CI: {run.proposal.checks.state} ({run.proposal.checks.passed}/
              {run.proposal.checks.total})
            </span>
          ) : run.proposal.checks ? (
            <span className="text-[11.5px] text-muted-foreground">
              CI status unavailable ({run.proposal.checks.reason})
            </span>
          ) : null}
          {run.status === "pr_open" && (
            <span className="text-[11.5px] text-muted-foreground">
              Merge it on GitHub when you're ready — Mellox re-scans the live site after the deploy.
            </span>
          )}
        </div>
      )}
      {run.verification && <VerificationCard v={run.verification} />}

      <details
        open={active}
        className="rounded-lg border border-border/60 bg-background/50 px-2.5 py-2"
      >
        <summary className="cursor-pointer text-[12px] font-medium">
          Activity ({state.events.length})
        </summary>
        <div className="mt-1.5">
          <ActivityLog events={state.events} />
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-2">
        {run.actions.retry && (
          <Button
            size="sm"
            variant="outline"
            loading={busy === "retry"}
            onClick={() => void retry()}
          >
            <RefreshCw className="h-3.5 w-3.5" />{" "}
            {run.planApprovedAt && run.status === "failed" ? "Retry from approved plan" : "Retry"}
          </Button>
        )}
        {run.actions.cancel &&
          (run.status === "pr_open" ? (
            confirmClose ? (
              <>
                <Button
                  size="sm"
                  variant="destructive"
                  loading={busy === "cancel"}
                  onClick={() => void cancel(true)}
                >
                  Close PR & delete its branch
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmClose(false)}>
                  Keep it
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirmClose(true)}>
                Cancel & close pull request
              </Button>
            )
          ) : (
            <Button
              size="sm"
              variant="ghost"
              loading={busy === "cancel"}
              onClick={() => void cancel(false)}
            >
              Cancel run
            </Button>
          ))}
        <Button size="sm" variant="ghost" onClick={() => void load()}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>
    </div>
  );
}
