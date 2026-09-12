"use client";

// Operations inbox (audit §30.2): what the agents found, what they propose,
// and exactly what they did — beside the product workflow, never replacing it.
//   Findings   severity, evidence (record ids), hypotheses, recommended action
//   Approvals  the exact proposed change (before → after), affected records,
//              expiry, Approve / Reject with a reason
//   Runs       trigger, status, duration, cost; each run's audited steps and
//              policy decisions
// Labels follow the audit's UX rules: Suggested / Awaiting approval /
// Executed / Failed / Needs review — a recommendation is never shown as done.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { addAppEventListener, removeAppEventListener } from "@/lib/app-events";
import { authedFetch, getActiveWorkspaceId } from "@/lib/authed-fetch";

type Tab = "findings" | "approvals" | "runs";

type FindingRow = {
  id: string;
  worker: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  summary: string;
  evidence: string[];
  hypotheses: string[];
  recommended_action: string;
  confidence: number;
  status: string;
  occurrences: number;
  last_seen_at: string;
};

type ActionRow = {
  id: string;
  source: string;
  tool: string;
  title: string;
  preview: Record<string, any>;
  affected_records: Array<{ table: string; id: string }>;
  status: string;
  error: string | null;
  expires_at: string;
  created_at: string;
};

type RunRow = {
  id: string;
  worker: string;
  trigger: string;
  status: string;
  summary: string | null;
  error: string | null;
  cost_usd: number;
  duration_ms: number | null;
  created_at: string;
};

type StepRow = {
  seq: number;
  kind: string;
  tool: string | null;
  policy_decision: string | null;
  status: string;
  result_summary: Record<string, unknown>;
  latency_ms: number | null;
};

const SEVERITY_STYLE: Record<FindingRow["severity"], string> = {
  critical: "bg-destructive/15 text-destructive",
  high: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  low: "bg-muted text-muted-foreground",
};

const STATUS_LABEL: Record<string, string> = {
  suggested: "Awaiting approval",
  approved: "Executing",
  executed: "Executed",
  failed: "Failed",
  rejected: "Rejected",
  expired: "Expired",
  succeeded: "Completed",
  running: "Running",
  awaiting_approval: "Needs review",
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await authedFetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
  return json as T;
}

export function OperationsInbox() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("findings");
  const [loading, setLoading] = useState(false);
  const [findings, setFindings] = useState<FindingRow[]>([]);
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [runDetail, setRunDetail] = useState<{ id: string; steps: StepRow[] } | null>(null);
  const [settings, setSettings] = useState<{
    agentsPaused: boolean;
    canManage: boolean;
    globallyDisabled: boolean;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const closeRef = useRef<HTMLButtonElement>(null);
  const workspaceId = open ? getActiveWorkspaceId() : null;

  useEffect(() => {
    const h = (e: CustomEvent<{ tab?: Tab } | undefined>) => {
      if (e.detail?.tab) setTab(e.detail.tab);
      setOpen(true);
    };
    addAppEventListener("open:operations", h as never);
    return () => removeAppEventListener("open:operations", h as never);
  }, []);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const q = `workspaceId=${encodeURIComponent(workspaceId)}`;
      const [f, a, r, s] = await Promise.all([
        api<{ findings: FindingRow[] }>(`/api/agents/findings?${q}&status=open`),
        api<{ actions: ActionRow[] }>(`/api/agents/actions?${q}&status=all`),
        api<{ runs: RunRow[] }>(`/api/agents/runs?${q}`),
        api<{ agentsPaused: boolean; canManage: boolean; globallyDisabled: boolean }>(
          `/api/agents/settings?${q}`,
        ),
      ]);
      setFindings(f.findings);
      setActions(a.actions);
      setRuns(r.runs);
      setSettings(s);
    } catch (e) {
      toast.error("Couldn't load operations", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (open) {
      void load();
      closeRef.current?.focus();
    }
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const runCheck = async () => {
    if (!workspaceId) return;
    setBusy("run");
    try {
      const out = await api<{ status: string; summary: string; error?: string }>(
        "/api/agents/run",
        {
          method: "POST",
          body: JSON.stringify({ workspaceId, worker: "distribution-reliability" }),
        },
      );
      if (out.status === "failed") toast.error("Check failed", { description: out.error });
      else toast.success("Delivery check complete", { description: out.summary.slice(0, 160) });
      await load();
    } catch (e) {
      toast.error("Couldn't run the check", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const updateFinding = async (id: string, action: "acknowledge" | "resolve") => {
    if (!workspaceId) return;
    setBusy(id);
    try {
      await api("/api/agents/findings", {
        method: "POST",
        body: JSON.stringify({ workspaceId, id, action }),
      });
      setFindings((rows) => rows.filter((r) => r.id !== id || action === "acknowledge"));
      if (action === "acknowledge")
        setFindings((rows) =>
          rows.map((r) => (r.id === id ? { ...r, status: "acknowledged" } : r)),
        );
    } catch (e) {
      toast.error("Couldn't update finding", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const decide = async (id: string, decision: "approve" | "reject") => {
    if (!workspaceId) return;
    setBusy(id);
    try {
      await api("/api/agents/actions", {
        method: "POST",
        body: JSON.stringify({ workspaceId, id, decision, reason: reasons[id] || undefined }),
      });
      toast.success(decision === "approve" ? "Approved and applied" : "Rejected — nothing changed");
      await load();
    } catch (e) {
      toast.error(decision === "approve" ? "Approval failed" : "Couldn't reject", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const togglePause = async () => {
    if (!workspaceId || !settings) return;
    setBusy("pause");
    try {
      const out = await api<{ agentsPaused: boolean }>("/api/agents/settings", {
        method: "POST",
        body: JSON.stringify({ workspaceId, agentsPaused: !settings.agentsPaused }),
      });
      setSettings({ ...settings, agentsPaused: out.agentsPaused });
      toast.success(out.agentsPaused ? "Agents paused for this workspace" : "Agents resumed");
    } catch (e) {
      toast.error("Couldn't change agent settings", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const openRun = async (id: string) => {
    if (!workspaceId) return;
    try {
      const out = await api<{ steps: StepRow[] }>(
        `/api/agents/runs?workspaceId=${encodeURIComponent(workspaceId)}&id=${id}`,
      );
      setRunDetail({ id, steps: out.steps });
    } catch (e) {
      toast.error("Couldn't load run", { description: e instanceof Error ? e.message : undefined });
    }
  };

  if (!open) return null;
  const pending = actions.filter((a) => a.status === "suggested");

  return (
    <div
      className="fixed inset-0 z-[70] flex justify-end bg-black/30"
      onClick={() => setOpen(false)}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="ops-inbox-title"
        className="flex h-full w-full max-w-[560px] flex-col border-l border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <h2 id="ops-inbox-title" className="text-[15px] font-semibold">
              Operations inbox
            </h2>
            <p className="text-[12px] text-muted-foreground">
              Agents observe and propose. Nothing changes without your approval.
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
              aria-label="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              ref={closeRef}
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
              aria-label="Close operations inbox"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <button
            type="button"
            onClick={() => void runCheck()}
            disabled={
              busy === "run" || !workspaceId || settings?.agentsPaused || settings?.globallyDisabled
            }
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy === "run" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PlayCircle className="h-3.5 w-3.5" />
            )}
            Run delivery check
          </button>
          {settings?.canManage ? (
            <button
              type="button"
              onClick={() => void togglePause()}
              disabled={busy === "pause"}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[12px]"
            >
              <PauseCircle className="h-3.5 w-3.5" />
              {settings.agentsPaused ? "Resume agents" : "Pause agents"}
            </button>
          ) : null}
          {settings?.agentsPaused ? (
            <span className="text-[12px] text-amber-700 dark:text-amber-300">
              Agents are paused in this workspace.
            </span>
          ) : null}
          {settings?.globallyDisabled ? (
            <span className="text-[12px] text-amber-700 dark:text-amber-300">
              Agents are disabled platform-wide.
            </span>
          ) : null}
        </div>

        <nav
          className="flex gap-1 border-b border-border px-3"
          role="tablist"
          aria-label="Operations sections"
        >
          {(
            [
              ["findings", `Findings (${findings.length})`],
              ["approvals", `Approvals (${pending.length})`],
              ["runs", "Runs"],
            ] as Array<[Tab, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`border-b-2 px-2.5 py-2 text-[13px] ${
                tab === id
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto px-4 py-3" role="tabpanel">
          {!workspaceId ? (
            <p className="text-[13px] text-muted-foreground">
              Select a workspace to see its operations.
            </p>
          ) : loading && !findings.length && !actions.length && !runs.length ? (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : tab === "findings" ? (
            findings.length ? (
              <ul className="flex flex-col gap-3">
                {findings.map((f) => (
                  <li key={f.id} className="rounded-xl border border-border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span
                          className={`mr-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${SEVERITY_STYLE[f.severity]}`}
                        >
                          {f.severity}
                        </span>
                        <span className="text-[13.5px] font-medium">{f.title}</span>
                        <p className="mt-1 text-[12.5px] text-muted-foreground">{f.summary}</p>
                      </div>
                      {f.status === "acknowledged" ? (
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          Acknowledged
                        </span>
                      ) : null}
                    </div>
                    {f.hypotheses?.length ? (
                      <div className="mt-2 text-[12.5px]">
                        <span className="font-medium">Likely cause (suggested): </span>
                        {f.hypotheses[0]}
                      </div>
                    ) : null}
                    <div className="mt-1 text-[12.5px]">
                      <span className="font-medium">Recommended: </span>
                      {f.recommended_action}
                    </div>
                    {f.evidence?.length ? (
                      <details className="mt-2 text-[12px] text-muted-foreground">
                        <summary className="cursor-pointer">Evidence ({f.evidence.length})</summary>
                        <ul className="mt-1 list-disc pl-5">
                          {f.evidence.slice(0, 10).map((e, i) => (
                            <li key={i} className="break-all">
                              {e}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                    <div className="mt-2 flex items-center justify-between text-[11.5px] text-muted-foreground">
                      <span>
                        {f.worker} · seen {f.occurrences}× · confidence{" "}
                        {Math.round(f.confidence * 100)}%
                      </span>
                      <span className="flex gap-1.5">
                        {f.status !== "acknowledged" ? (
                          <button
                            type="button"
                            disabled={busy === f.id}
                            onClick={() => void updateFinding(f.id, "acknowledge")}
                            className="rounded-md border border-border px-2 py-0.5 text-foreground"
                          >
                            Acknowledge
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={busy === f.id}
                          onClick={() => void updateFinding(f.id, "resolve")}
                          className="rounded-md border border-border px-2 py-0.5 text-foreground"
                        >
                          Mark resolved
                        </button>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" /> No open findings. Run a
                delivery check anytime.
              </p>
            )
          ) : tab === "approvals" ? (
            actions.length ? (
              <ul className="flex flex-col gap-3">
                {actions.map((a) => (
                  <li key={a.id} className="rounded-xl border border-border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-[13.5px] font-medium">{a.title}</div>
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px]">
                        {STATUS_LABEL[a.status] ?? a.status}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                      Proposed by {a.source} · {a.tool} · expires{" "}
                      {new Date(a.expires_at).toLocaleDateString()}
                    </div>
                    {a.preview?.before || a.preview?.after ? (
                      <div className="mt-2 grid gap-2 text-[12.5px] sm:grid-cols-2">
                        <div className="rounded-lg bg-muted/60 p-2">
                          <div className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">
                            Before
                          </div>
                          <p className="whitespace-pre-wrap break-words">
                            {a.preview.before?.body ?? "—"}
                          </p>
                        </div>
                        <div className="rounded-lg bg-emerald-500/10 p-2">
                          <div className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">
                            After
                          </div>
                          <p className="whitespace-pre-wrap break-words">
                            {a.preview.after?.body ?? "—"}
                          </p>
                        </div>
                      </div>
                    ) : Object.keys(a.preview ?? {}).length ? (
                      <pre className="mt-2 overflow-x-auto rounded-lg bg-muted/60 p-2 text-[11.5px]">
                        {JSON.stringify(a.preview, null, 2)}
                      </pre>
                    ) : null}
                    {Array.isArray(a.preview?.reasons) && a.preview.reasons.length ? (
                      <ul className="mt-2 list-disc pl-5 text-[12px] text-muted-foreground">
                        {a.preview.reasons.map((r: string, i: number) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    ) : null}
                    {a.error ? (
                      <p className="mt-2 flex items-center gap-1.5 text-[12px] text-destructive">
                        <AlertTriangle className="h-3.5 w-3.5" /> {a.error}
                      </p>
                    ) : null}
                    {a.status === "suggested" ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <input
                          value={reasons[a.id] ?? ""}
                          onChange={(e) => setReasons((r) => ({ ...r, [a.id]: e.target.value }))}
                          placeholder="Reason (optional)"
                          aria-label="Decision reason"
                          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-[12px]"
                        />
                        <button
                          type="button"
                          disabled={busy === a.id}
                          onClick={() => void decide(a.id, "approve")}
                          className="rounded-md bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground disabled:opacity-50"
                        >
                          Approve & apply
                        </button>
                        <button
                          type="button"
                          disabled={busy === a.id}
                          onClick={() => void decide(a.id, "reject")}
                          className="rounded-md border border-border px-2.5 py-1 text-[12px]"
                        >
                          Reject
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted-foreground">No proposed actions.</p>
            )
          ) : runDetail ? (
            <div>
              <button
                type="button"
                onClick={() => setRunDetail(null)}
                className="mb-2 text-[12px] text-primary"
              >
                ← All runs
              </button>
              <ol className="flex flex-col gap-1.5">
                {runDetail.steps.map((s) => (
                  <li
                    key={s.seq}
                    className="rounded-lg border border-border px-2.5 py-1.5 text-[12px]"
                  >
                    <span className="font-medium">
                      #{s.seq} {s.kind}
                      {s.tool ? ` · ${s.tool}` : ""}
                    </span>
                    <span className="ml-2 text-muted-foreground">
                      {s.policy_decision ? `policy: ${s.policy_decision} · ` : ""}
                      {s.status}
                      {s.latency_ms != null ? ` · ${s.latency_ms} ms` : ""}
                    </span>
                    {Object.keys(s.result_summary ?? {}).length ? (
                      <div className="mt-0.5 break-all text-muted-foreground">
                        {JSON.stringify(s.result_summary)}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          ) : runs.length ? (
            <ul className="flex flex-col gap-2">
              {runs.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => void openRun(r.id)}
                    className="w-full rounded-xl border border-border p-2.5 text-left hover:bg-muted/40"
                  >
                    <div className="flex items-center justify-between gap-2 text-[13px]">
                      <span className="font-medium">{r.worker}</span>
                      <span className="text-[11.5px] text-muted-foreground">
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[12px] text-muted-foreground">
                      {r.trigger} · {new Date(r.created_at).toLocaleString()}
                      {r.duration_ms != null ? ` · ${(r.duration_ms / 1000).toFixed(1)} s` : ""}
                      {Number(r.cost_usd) > 0 ? ` · $${Number(r.cost_usd).toFixed(4)}` : ""}
                    </div>
                    <p className="mt-1 line-clamp-2 text-[12.5px]">{r.error ?? r.summary ?? ""}</p>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">No agent runs yet.</p>
          )}
        </div>
      </aside>
    </div>
  );
}
