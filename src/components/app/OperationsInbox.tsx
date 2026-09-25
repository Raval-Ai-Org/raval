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
import { Spinner } from "@/components/icons";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
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
import { authedFetch } from "@/lib/authed-fetch";

type Tab = "findings" | "approvals" | "runs" | "settings";
type FindingFilter = "active" | "resolved" | "all";
type ActionFilter = "pending" | "all";
type WorkerName = "distribution-reliability" | "content-fit";
type AgentSettings = {
  agentsPaused: boolean;
  disabledWorkers: WorkerName[];
  canManage: boolean;
  canAct: boolean;
  globallyDisabled: boolean;
  workers: Array<{ name: WorkerName; objective: string }>;
};
type ContentItem = { id: string; title: string | null; channel: string | null; status: string };

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
  preview: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    reasons?: string[];
    [key: string]: unknown;
  };
  affected_records: Array<{ table: string; id: string }>;
  status: string;
  error: string | null;
  expires_at: string;
  created_at: string;
  decided_at: string | null;
  decision_reason: string | null;
  executed_at: string | null;
  run_id: string | null;
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
  model?: string | null;
  input_tokens?: number;
  output_tokens?: number;
};

type StepRow = {
  seq: number;
  kind: string;
  tool: string | null;
  policy_decision: string | null;
  status: string;
  result_summary: Record<string, unknown>;
  redacted_args: Record<string, unknown>;
  latency_ms: number | null;
  cost_usd: number;
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
  const [runDetail, setRunDetail] = useState<{ run: RunRow; steps: StepRow[] } | null>(null);
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [contentItems, setContentItems] = useState<ContentItem[]>([]);
  const [contentItemId, setContentItemId] = useState("");
  const [findingFilter, setFindingFilter] = useState<FindingFilter>("active");
  const [actionFilter, setActionFilter] = useState<ActionFilter>("pending");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const closeRef = useRef<HTMLButtonElement>(null);
  const loadSequence = useRef(0);
  const routeWorkspaceId = useOptionalWorkspaceId();
  const workspaceId = open ? routeWorkspaceId : null;

  useEffect(() => {
    loadSequence.current += 1;
    setFindings([]);
    setActions([]);
    setRuns([]);
    setRunDetail(null);
    setSettings(null);
    setContentItems([]);
    setContentItemId("");
    setLoadError(null);
  }, [routeWorkspaceId]);

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
    const sequence = ++loadSequence.current;
    setLoading(true);
    try {
      const q = `workspaceId=${encodeURIComponent(workspaceId)}`;
      const [f, a, r, s, c] = await Promise.all([
        api<{ findings: FindingRow[] }>(`/api/agents/findings?${q}&status=all`),
        api<{ actions: ActionRow[] }>(`/api/agents/actions?${q}&status=all`),
        api<{ runs: RunRow[] }>(`/api/agents/runs?${q}`),
        api<AgentSettings>(`/api/agents/settings?${q}`),
        api<{ items: ContentItem[] }>(`/api/agents/run?${q}`).catch(() => ({ items: [] })),
      ]);
      if (sequence !== loadSequence.current) return;
      setFindings(f.findings);
      setActions(a.actions);
      setRuns(r.runs);
      setSettings(s);
      setContentItems(c.items);
      setContentItemId((id) => (c.items.some((item) => item.id === id) ? id : ""));
      setLoadError(null);
    } catch (e) {
      if (sequence !== loadSequence.current) return;
      setLoadError(e instanceof Error ? e.message : "Could not load operations");
      toast.error("Couldn't load operations", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
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

  const runCheck = async (worker: WorkerName) => {
    if (!workspaceId) return;
    setBusy("run");
    try {
      const out = await api<{ status: string; summary: string; error?: string }>(
        "/api/agents/run",
        {
          method: "POST",
          body: JSON.stringify({
            workspaceId,
            worker,
            ...(worker === "content-fit" ? { contentItemId } : {}),
          }),
        },
      );
      if (out.status === "failed") toast.error("Check failed", { description: out.error });
      else toast.success("Check complete", { description: out.summary.slice(0, 160) });
      await load();
    } catch (e) {
      toast.error("Couldn't run the check", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const updateFinding = async (id: string, action: "acknowledge" | "resolve" | "reopen") => {
    if (!workspaceId) return;
    setBusy(id);
    try {
      await api("/api/agents/findings", {
        method: "POST",
        body: JSON.stringify({ workspaceId, id, action }),
      });
      setFindings((rows) =>
        rows.map((r) =>
          r.id === id
            ? {
                ...r,
                status:
                  action === "resolve" ? "resolved" : action === "reopen" ? "open" : "acknowledged",
              }
            : r,
        ),
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
      const out = await api<{ status: string }>("/api/agents/actions", {
        method: "POST",
        body: JSON.stringify({ workspaceId, id, decision, reason: reasons[id] || undefined }),
      });
      toast.success(
        decision === "approve" && out.status === "executed"
          ? "Approved and applied"
          : "Action rejected",
      );
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

  const toggleWorker = async (worker: WorkerName) => {
    if (!workspaceId || !settings) return;
    setBusy(worker);
    try {
      const disabledWorkers = settings.disabledWorkers.includes(worker)
        ? settings.disabledWorkers.filter((name) => name !== worker)
        : [...settings.disabledWorkers, worker];
      const out = await api<{ disabledWorkers: WorkerName[] }>("/api/agents/settings", {
        method: "POST",
        body: JSON.stringify({ workspaceId, disabledWorkers }),
      });
      setSettings({ ...settings, disabledWorkers: out.disabledWorkers });
      toast.success(
        out.disabledWorkers.includes(worker) ? `${worker} disabled` : `${worker} enabled`,
      );
    } catch (e) {
      toast.error("Couldn't change worker setting", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const openRun = async (id: string) => {
    if (!workspaceId) return;
    try {
      const out = await api<{ run: RunRow; steps: StepRow[] }>(
        `/api/agents/runs?workspaceId=${encodeURIComponent(workspaceId)}&id=${id}`,
      );
      setRunDetail(out);
    } catch (e) {
      toast.error("Couldn't load run", { description: e instanceof Error ? e.message : undefined });
    }
  };

  if (!open) return null;
  const pending = actions.filter(
    (a) => a.status === "suggested" && new Date(a.expires_at).getTime() > Date.now(),
  );
  const visibleFindings = findings.filter(
    (f) =>
      findingFilter === "all" ||
      (findingFilter === "resolved" ? f.status === "resolved" : f.status !== "resolved"),
  );
  const visibleActions = actionFilter === "pending" ? pending : actions;

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
              Review findings, decide proposed changes, and manage worker runs.
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
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
            onClick={() => void runCheck("distribution-reliability")}
            disabled={
              busy !== null ||
              !workspaceId ||
              !settings?.canAct ||
              settings.agentsPaused ||
              settings.globallyDisabled ||
              settings.disabledWorkers.includes("distribution-reliability")
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
          <select
            value={contentItemId}
            onChange={(e) => setContentItemId(e.target.value)}
            aria-label="Content item to check"
            className="min-w-0 max-w-[220px] rounded-md border border-border bg-background px-2 py-1 text-[12px]"
          >
            <option value="">Choose content to check</option>
            {contentItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title || item.id.slice(0, 8)} · {item.channel || "no channel"} · {item.status}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void runCheck("content-fit")}
            disabled={
              busy !== null ||
              !contentItemId ||
              !settings?.canAct ||
              settings.agentsPaused ||
              settings.globallyDisabled ||
              settings.disabledWorkers.includes("content-fit")
            }
            className="rounded-md border border-border px-2.5 py-1 text-[12px] disabled:opacity-50"
          >
            Check content fit
          </button>
          {settings?.canManage ? (
            <button
              type="button"
              onClick={() => void togglePause()}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[12px]"
            >
              {busy === "pause" ? (
                <Spinner className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <PauseCircle className="h-3.5 w-3.5" />
              )}
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
              ["settings", "Settings"],
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
          {loadError ? (
            <div
              role="alert"
              className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-[12px] text-destructive"
            >
              Couldn’t load current operations: {loadError}
            </div>
          ) : null}
          {!workspaceId ? (
            <p className="text-[13px] text-muted-foreground">
              Select a workspace to see its operations.
            </p>
          ) : loading && !findings.length && !actions.length && !runs.length ? (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : tab === "settings" ? (
            settings ? (
              <div className="space-y-4 text-[13px]">
                <div className="rounded-xl border border-border p-3">
                  <div className="font-medium">Workspace agents</div>
                  <p className="mt-1 text-muted-foreground">
                    Pause all worker runs for this workspace, or enable workers individually.
                  </p>
                  <p className="mt-2">
                    Status:{" "}
                    {settings.globallyDisabled
                      ? "Disabled platform-wide"
                      : settings.agentsPaused
                        ? "Paused"
                        : "Active"}
                  </p>
                  {settings.canManage ? (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void togglePause()}
                      className="mt-2 rounded-md border border-border px-2.5 py-1 disabled:opacity-50"
                    >
                      {settings.agentsPaused ? "Resume all" : "Pause all"}
                    </button>
                  ) : (
                    <p className="mt-2 text-muted-foreground">
                      Only workspace admins can change settings.
                    </p>
                  )}
                </div>
                {settings.workers.map((worker) => (
                  <div key={worker.name} className="rounded-xl border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium">{worker.name}</div>
                      <span className="text-muted-foreground">
                        {settings.disabledWorkers.includes(worker.name) ? "Disabled" : "Enabled"}
                      </span>
                    </div>
                    <p className="mt-1 text-muted-foreground">{worker.objective}</p>
                    {settings.canManage ? (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void toggleWorker(worker.name)}
                        className="mt-2 rounded-md border border-border px-2.5 py-1 disabled:opacity-50"
                      >
                        {settings.disabledWorkers.includes(worker.name)
                          ? "Enable worker"
                          : "Disable worker"}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null
          ) : tab === "findings" ? (
            <div>
              <div className="mb-3 flex gap-1" aria-label="Filter findings">
                {(
                  [
                    ["active", "Active"],
                    ["resolved", "Resolved"],
                    ["all", "All"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={findingFilter === value}
                    onClick={() => setFindingFilter(value)}
                    className={`rounded-md px-2 py-1 text-[12px] ${findingFilter === value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {visibleFindings.length ? (
                <ul className="flex flex-col gap-3">
                  {visibleFindings.map((f) => (
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
                        {f.status !== "open" ? (
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {f.status === "resolved" ? "Resolved" : "Acknowledged"}
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
                          <summary className="cursor-pointer">
                            Evidence ({f.evidence.length})
                          </summary>
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
                        {settings?.canAct ? (
                          <span className="flex gap-1.5">
                            {f.status === "open" ? (
                              <button
                                type="button"
                                disabled={busy === f.id}
                                onClick={() => void updateFinding(f.id, "acknowledge")}
                                className="rounded-md border border-border px-2 py-0.5 text-foreground"
                              >
                                {busy === f.id ? (
                                  <Spinner
                                    className="mr-1 inline h-3 w-3 animate-spin"
                                    aria-hidden
                                  />
                                ) : null}
                                Acknowledge
                              </button>
                            ) : null}
                            {f.status !== "resolved" ? (
                              <button
                                type="button"
                                disabled={busy === f.id}
                                onClick={() => void updateFinding(f.id, "resolve")}
                                className="rounded-md border border-border px-2 py-0.5 text-foreground"
                              >
                                {busy === f.id ? (
                                  <Spinner
                                    className="mr-1 inline h-3 w-3 animate-spin"
                                    aria-hidden
                                  />
                                ) : null}
                                Mark resolved
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={busy === f.id}
                                onClick={() => void updateFinding(f.id, "reopen")}
                                className="rounded-md border border-border px-2 py-0.5 text-foreground"
                              >
                                Reopen
                              </button>
                            )}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" /> No{" "}
                  {findingFilter === "all" ? "" : findingFilter} findings.
                </p>
              )}
            </div>
          ) : tab === "approvals" ? (
            <div>
              <div className="mb-3 flex gap-1" aria-label="Filter approvals">
                {(
                  [
                    ["pending", "Pending"],
                    ["all", "History"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={actionFilter === value}
                    onClick={() => setActionFilter(value)}
                    className={`rounded-md px-2 py-1 text-[12px] ${actionFilter === value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {visibleActions.length ? (
                <ul className="flex flex-col gap-3">
                  {visibleActions.map((a) => (
                    <li key={a.id} className="rounded-xl border border-border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-[13.5px] font-medium">{a.title}</div>
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px]">
                          {a.status === "suggested" &&
                          new Date(a.expires_at).getTime() <= Date.now()
                            ? "Expired"
                            : (STATUS_LABEL[a.status] ?? a.status)}
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
                            <pre className="whitespace-pre-wrap break-words font-sans">
                              {JSON.stringify(a.preview.before ?? {}, null, 2)}
                            </pre>
                          </div>
                          <div className="rounded-lg bg-emerald-500/10 p-2">
                            <div className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">
                              After
                            </div>
                            <pre className="whitespace-pre-wrap break-words font-sans">
                              {JSON.stringify(a.preview.after ?? {}, null, 2)}
                            </pre>
                          </div>
                        </div>
                      ) : Object.keys(a.preview ?? {}).length ? (
                        <pre className="mt-2 overflow-x-auto rounded-lg bg-muted/60 p-2 text-[11.5px]">
                          {JSON.stringify(a.preview, null, 2)}
                        </pre>
                      ) : null}
                      {Array.isArray(a.preview?.reasons) && a.preview.reasons.length ? (
                        <ul className="mt-2 list-disc pl-5 text-[12px] text-muted-foreground">
                          {a.preview.reasons.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      ) : null}
                      {a.error ? (
                        <p className="mt-2 flex items-center gap-1.5 text-[12px] text-destructive">
                          <AlertTriangle className="h-3.5 w-3.5" /> {a.error}
                        </p>
                      ) : null}
                      {a.affected_records?.length ? (
                        <details className="mt-2 text-[12px] text-muted-foreground">
                          <summary className="cursor-pointer">
                            Affected records ({a.affected_records.length})
                          </summary>
                          <ul className="mt-1 list-disc pl-5">
                            {a.affected_records.map((record, index) => (
                              <li key={index} className="break-all">
                                {record.table}: {record.id}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                      {a.decision_reason ? (
                        <p className="mt-2 text-[12px] text-muted-foreground">
                          Decision reason: {a.decision_reason}
                        </p>
                      ) : null}
                      {a.decided_at ? (
                        <p className="text-[12px] text-muted-foreground">
                          Decided {new Date(a.decided_at).toLocaleString()}
                        </p>
                      ) : null}
                      {a.run_id ? (
                        <button
                          type="button"
                          className="mt-2 text-[12px] text-primary"
                          onClick={() => {
                            setTab("runs");
                            void openRun(a.run_id!);
                          }}
                        >
                          View originating run
                        </button>
                      ) : null}
                      {a.status === "suggested" &&
                      new Date(a.expires_at).getTime() > Date.now() &&
                      settings?.canAct ? (
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
                            disabled={busy !== null}
                            onClick={() => void decide(a.id, "approve")}
                            className="rounded-md bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground disabled:opacity-50"
                          >
                            {busy === a.id ? (
                              <Spinner className="mr-1 inline h-3 w-3 animate-spin" aria-hidden />
                            ) : null}
                            Approve & apply
                          </button>
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => void decide(a.id, "reject")}
                            className="rounded-md border border-border px-2.5 py-1 text-[12px]"
                          >
                            {busy === a.id ? (
                              <Spinner className="mr-1 inline h-3 w-3 animate-spin" aria-hidden />
                            ) : null}
                            Reject
                          </button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-muted-foreground">
                  {actionFilter === "pending" ? "No pending approvals." : "No proposed actions."}
                </p>
              )}
            </div>
          ) : runDetail ? (
            <div>
              <button
                type="button"
                onClick={() => setRunDetail(null)}
                className="mb-2 text-[12px] text-primary"
              >
                ← All runs
              </button>
              <div className="mb-3 rounded-xl border border-border p-3 text-[12px]">
                <div className="font-medium">
                  {runDetail.run.worker} ·{" "}
                  {STATUS_LABEL[runDetail.run.status] ?? runDetail.run.status}
                </div>
                <div className="mt-1 text-muted-foreground">
                  {runDetail.run.trigger} · {new Date(runDetail.run.created_at).toLocaleString()}
                  {runDetail.run.duration_ms != null
                    ? ` · ${(runDetail.run.duration_ms / 1000).toFixed(1)} s`
                    : ""}
                  {Number(runDetail.run.cost_usd) > 0
                    ? ` · $${Number(runDetail.run.cost_usd).toFixed(4)}`
                    : ""}
                </div>
                {runDetail.run.model ? (
                  <div className="mt-1 text-muted-foreground">
                    Model: {runDetail.run.model} · {runDetail.run.input_tokens ?? 0} input /{" "}
                    {runDetail.run.output_tokens ?? 0} output tokens
                  </div>
                ) : null}
                {runDetail.run.summary ? <p className="mt-2">{runDetail.run.summary}</p> : null}
                {runDetail.run.error ? (
                  <p className="mt-2 text-destructive">{runDetail.run.error}</p>
                ) : null}
              </div>
              {!runDetail.steps.length ? (
                <p className="text-[12px] text-muted-foreground">No recorded steps for this run.</p>
              ) : null}
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
                      {Number(s.cost_usd) > 0 ? ` · $${Number(s.cost_usd).toFixed(4)}` : ""}
                    </span>
                    {Object.keys(s.redacted_args ?? {}).length ? (
                      <details className="mt-1 text-muted-foreground">
                        <summary className="cursor-pointer">Inputs (redacted)</summary>
                        <pre className="mt-1 whitespace-pre-wrap break-all">
                          {JSON.stringify(s.redacted_args, null, 2)}
                        </pre>
                      </details>
                    ) : null}
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
