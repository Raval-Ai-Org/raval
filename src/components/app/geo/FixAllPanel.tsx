"use client";

// FixAllPanel — "Fix all automatically": every finding Mellox can fix for a
// website, generated in one run, reviewed once, approved once, delivered as
// ONE GitHub pull request. Mellox never merges it; each finding resolves only
// after the post-merge rescan confirms its own check passes.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  ExternalLink,
  GitCommit,
  RefreshCw,
  Spinner,
  Wand,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useVisibleInterval } from "@/hooks/use-visible-interval";
import type { GeoScanView } from "@/lib/geo/contracts";
import type { FixAllPreflight, FixBatchView } from "@/lib/geo/fix-contracts";
import {
  approveFixBatch,
  createFixBatch,
  discardFixBatch,
  getFixAllPreflight,
  getFixBatch,
  getVerification,
  listFixBranches,
} from "@/lib/geo-fixes.functions";
import { cn } from "@/lib/utils";
import { CheckRow, DiffView, SetupRequirement, VerificationCard } from "./FindingDetail";
import { Chip, pathOf, relativeTime } from "./geo-ui";

const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const ACTIVE = ["generating", "applying", "pr_open", "merged", "verifying"];

const ITEM_TONE = {
  generated: "success",
  pending: "muted",
  skipped: "warning",
  failed: "destructive",
} as const;

const PROPOSAL_LABEL: Record<string, string> = {
  draft: "In review",
  pr_open: "PR open",
  merged: "Merged",
  verifying: "Verifying",
  verified: "Verified fixed",
  not_verified: "Still failing",
  closed: "PR closed",
  failed: "Failed",
  discarded: "Discarded",
};

function BatchReview({
  workspaceId,
  batch,
  onChange,
  onRestart,
}: {
  workspaceId: string;
  batch: FixBatchView;
  onChange: (b: FixBatchView) => void;
  onRestart: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState<"approve" | "discard" | "sync" | "close" | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const b = batch;
  const included = b.items.filter((i) => i.status === "generated");
  const excluded = b.items.filter((i) => i.status !== "generated");

  useVisibleInterval(
    () => {
      if (!ACTIVE.includes(b.status)) return;
      getFixBatch({ data: { workspaceId, batchId: b.id } })
        .then(async (next) => {
          onChange(next);
          const v = next.verification;
          if (v && (v.status === "scheduled" || v.status === "running")) {
            await getVerification({ data: { workspaceId, verificationId: v.id } }).catch(
              () => undefined,
            );
          }
        })
        .catch(() => undefined);
    },
    b.status === "generating" ? 3000 : 15_000,
    [b.id, b.status],
  );

  const act = async (kind: "approve" | "discard" | "sync" | "close") => {
    setBusy(kind);
    try {
      if (kind === "approve") {
        onChange(
          await approveFixBatch({
            data: { workspaceId, batchId: b.id, contentHash: b.contentHash! },
          }),
        );
        toast.success("Pull request opened with all fixes");
      } else if (kind === "sync") {
        onChange(await getFixBatch({ data: { workspaceId, batchId: b.id, sync: true } }));
      } else {
        onChange(
          await discardFixBatch({
            data: { workspaceId, batchId: b.id, closePullRequest: kind === "close" },
          }),
        );
        toast.success(kind === "close" ? "Pull request closed" : "Run discarded");
      }
    } catch (e) {
      toast.error(errMsg(e, "That didn't work"));
      onChange(await getFixBatch({ data: { workspaceId, batchId: b.id } }).catch(() => b));
    } finally {
      setBusy(null);
      setConfirmClose(false);
    }
  };

  if (b.status === "generating") {
    const pct = b.progress.total ? Math.round((b.progress.done / b.progress.total) * 100) : 0;
    return (
      <div className="space-y-3 rounded-xl border border-border/60 bg-gradient-to-b from-card/90 to-card/40 shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.05),0_8px_24px_-16px_rgb(0_0_0/0.5)] transition-colors duration-200 hover:border-border p-4">
        <p className="flex items-center gap-2 text-[13px] font-medium">
          <Spinner className="h-4 w-4 animate-spin" /> Preparing fixes for {b.host}…
        </p>
        <div className="h-1.5 overflow-hidden rounded-full bg-border/50">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-[12px] text-muted-foreground">
          {b.progress.done} of {b.progress.total} findings processed
          {b.progress.current ? ` · now: ${b.progress.current}` : ""}. Mellox reads the repository
          and drafts each change; nothing is written to GitHub yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
        <span className="font-medium text-foreground/90">{b.repoFullName}</span>
        <span>· base {b.baseBranch}</span>
        {b.baseSha && <span className="font-mono">@{b.baseSha.slice(0, 7)}</span>}
        {b.framework && <span>· {b.framework}</span>}
        <span>· started {relativeTime(b.createdAt)}</span>
      </div>
      {b.explanation && <p className="text-[13px] font-medium">{b.explanation}</p>}
      {b.error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-[12px] text-destructive"
        >
          {b.error}
        </p>
      )}

      <section className="rounded-xl border border-border/60 bg-gradient-to-b from-card/90 to-card/40 shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.05),0_8px_24px_-16px_rgb(0_0_0/0.5)] transition-colors duration-200 hover:border-border p-3.5">
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Findings ({included.length} included
          {excluded.length ? `, ${excluded.length} need manual work` : ""})
        </h4>
        <ul className="max-h-72 space-y-1.5 overflow-y-auto">
          {b.items.map((i) => (
            <li key={i.findingId} className="flex flex-wrap items-start gap-2 text-[12px]">
              <Chip tone={ITEM_TONE[i.status]}>
                {i.status === "generated"
                  ? "Included"
                  : i.status === "failed"
                    ? "Failed"
                    : i.status === "pending"
                      ? "Pending"
                      : "Skipped"}
              </Chip>
              {i.proposalStatus && PROPOSAL_LABEL[i.proposalStatus] && i.status === "generated" && (
                <Chip
                  tone={
                    i.proposalStatus === "verified"
                      ? "success"
                      : i.proposalStatus === "not_verified"
                        ? "destructive"
                        : "primary"
                  }
                >
                  {PROPOSAL_LABEL[i.proposalStatus]}
                </Chip>
              )}
              <div className="min-w-0 flex-1 basis-[200px]">
                <span className="font-medium">{i.title}</span>
                <span className="text-muted-foreground"> · {pathOf(i.pageUrl)}</span>
                {i.reason && <p className="text-muted-foreground">{i.reason}</p>}
                {i.files.length > 0 && (
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {i.files.join(", ")}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {b.files.length > 0 && (
        <section className="space-y-3 rounded-xl border border-border/60 bg-gradient-to-b from-card/90 to-card/40 shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.05),0_8px_24px_-16px_rgb(0_0_0/0.5)] transition-colors duration-200 hover:border-border p-3.5">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Combined change ({b.files.length} file{b.files.length === 1 ? "" : "s"})
          </h4>
          {b.filesPurged ? (
            <p className="text-[12px] text-muted-foreground">
              File contents were removed after 30 days.
            </p>
          ) : (
            b.files.map((f) => (
              <div key={f.path} className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2 text-[12px]">
                  <span className="font-mono font-medium">{f.path}</span>
                  <Chip tone="muted">{f.action === "create" ? "new file" : "edit"}</Chip>
                  <span className="text-success">+{f.additions}</span>
                  <span className="text-destructive">−{f.deletions}</span>
                </div>
                {f.explanation && (
                  <p className="text-[12px] text-muted-foreground">{f.explanation}</p>
                )}
                {f.diff && <DiffView diff={f.diff} />}
              </div>
            ))
          )}
          <div>
            <p className="text-[12px] font-semibold">Checks before approval</p>
            <ul className="mt-1">
              {b.validation.checks.map((c) => (
                <CheckRow key={c.id} status={c.status} label={c.label} detail={c.detail} />
              ))}
            </ul>
          </div>
        </section>
      )}

      {b.status === "draft" && (
        <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3.5">
          {!b.validation.ok ? (
            <p className="text-[12px] text-destructive">
              The combined change failed a check and can't be applied.
            </p>
          ) : (
            <label className="flex items-start gap-2 text-[12px]">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              <span>
                I reviewed all {included.length} fixes. Mellox will create one new{" "}
                <span className="font-mono">mellox/</span> branch in {b.repoFullName}, commit
                exactly these {b.files.length} file(s), and open one pull request against{" "}
                <span className="font-mono">{b.baseBranch}</span>. Nothing is merged or pushed to{" "}
                {b.baseBranch}.
              </span>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!agreed || !b.validation.ok || busy !== null || !b.contentHash}
              loading={busy === "approve"}
              onClick={() => void act("approve")}
            >
              <GitCommit className="h-3.5 w-3.5" /> Approve & open one pull request
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              loading={busy === "discard"}
              onClick={() => void act("discard")}
            >
              Discard
            </Button>
          </div>
        </div>
      )}

      {b.status === "applying" && (
        <p className="flex items-center gap-2 text-[12.5px]">
          <Spinner className="h-3.5 w-3.5 animate-spin" /> Creating the branch, commit and pull
          request…
        </p>
      )}

      {b.pr && (
        <div className="space-y-2 rounded-xl border border-border/60 bg-gradient-to-b from-background/80 to-muted/20 shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.05),0_8px_24px_-16px_rgb(0_0_0/0.5)] transition-colors duration-200 hover:border-border p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={b.pr.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[13px] font-semibold underline-offset-2 hover:underline"
            >
              Pull request #{b.pr.number} <ExternalLink className="h-3 w-3" />
            </a>
            <Chip
              tone={
                b.pr.state === "merged" ? "success" : b.pr.state === "open" ? "primary" : "muted"
              }
            >
              {b.pr.state}
            </Chip>
            {b.headBranch && (
              <span className="font-mono text-[11.5px] text-muted-foreground">{b.headBranch}</span>
            )}
            <span className="text-[11.5px] text-muted-foreground">
              · synced {relativeTime(b.lastSyncedAt)}
            </span>
          </div>
          {b.checks &&
            (b.checks.available ? (
              <p className="text-[12px]">
                CI:{" "}
                <span
                  className={cn(
                    "font-medium",
                    b.checks.state === "success" && "text-success",
                    b.checks.state === "failure" && "text-destructive",
                  )}
                >
                  {b.checks.state === "none"
                    ? "no checks reported"
                    : `${b.checks.passed} passed · ${b.checks.failed} failed · ${b.checks.pending} pending`}
                </span>
              </p>
            ) : (
              <p className="text-[12px] text-muted-foreground">
                CI status unavailable
                {b.checks.reason === "permission"
                  ? " — grant the GitHub App Checks and Commit statuses (read)."
                  : "."}
              </p>
            ))}
          {b.status === "pr_open" && (
            <>
              <p className="text-[12px] text-muted-foreground">
                Review and merge it on GitHub. After deploy, Mellox re-scans every affected page and
                resolves each finding only when its own check passes.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  loading={busy === "sync"}
                  disabled={busy !== null}
                  onClick={() => void act("sync")}
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Refresh status
                </Button>
                {!confirmClose ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => setConfirmClose(true)}
                  >
                    Close pull request
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="destructive"
                    loading={busy === "close"}
                    onClick={() => void act("close")}
                  >
                    Close PR & delete its branch
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {b.verification && <VerificationCard v={b.verification} />}

      {["completed", "closed", "failed", "discarded", "stale", "access_lost"].includes(
        b.status,
      ) && (
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
          {b.status === "completed" ? (
            <span className="inline-flex items-center gap-1 text-foreground">
              <CheckCircle className="h-3.5 w-3.5 text-success" /> This run is finished.
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5 text-warning" />
              {b.status === "stale"
                ? "The base branch changed since this was generated."
                : "This run didn't complete."}
            </span>
          )}
          <Button size="sm" variant="outline" onClick={onRestart}>
            Run “Fix all” again
          </Button>
        </div>
      )}
    </div>
  );
}

export function FixAllPanel({
  workspaceId,
  scan,
  onBack,
  onChanged,
}: {
  workspaceId: string;
  scan: GeoScanView;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [preflight, setPreflight] = useState<FixAllPreflight | null>(null);
  const [batch, setBatch] = useState<FixBatchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [branches, setBranches] = useState<{ name: string; protected: boolean }[] | null>(null);
  const [branch, setBranch] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    getFixAllPreflight({ data: { workspaceId, scanId: scan.id } })
      .then((p) => {
        if (cancelled) return;
        setPreflight(p);
        setBatch(p.batch && p.batch.status !== "discarded" ? p.batch : null);
        setSourceId(p.setup.source?.id ?? null);
      })
      .catch((e) => !cancelled && setError(errMsg(e, "Couldn't load fixable findings")));
    return () => {
      cancelled = true;
    };
  }, [workspaceId, scan.id, nonce]);

  const ready = preflight?.setup.requirement === "ready";
  useEffect(() => {
    if (!ready || !sourceId || batch) return;
    let cancelled = false;
    setBranches(null);
    listFixBranches({ data: { workspaceId, sourceId } })
      .then((r) => {
        if (cancelled) return;
        setBranches(r.branches);
        setBranch(r.selectedBranch ?? r.defaultBranch ?? r.branches[0]?.name ?? "");
      })
      .catch((e) => !cancelled && setStartError(errMsg(e, "Couldn't load branches")));
    return () => {
      cancelled = true;
    };
  }, [workspaceId, sourceId, ready, batch]);

  const start = async () => {
    if (!sourceId || !branch) return;
    setStarting(true);
    setStartError(null);
    try {
      setBatch(
        await createFixBatch({
          data: { workspaceId, scanId: scan.id, sourceId, baseBranch: branch },
        }),
      );
    } catch (e) {
      setStartError(errMsg(e, "Couldn't start “Fix all”"));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All findings
      </button>

      <header className="rounded-xl border border-primary/30 bg-primary/5 p-4">
        <h3 className="flex items-center gap-2 text-[16px] font-semibold">
          <Wand className="h-4 w-4 text-primary" /> Fix all automatically
        </h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-foreground/85">
          Mellox prepares every fix it can for {scan.host} and puts them in{" "}
          <strong>one GitHub pull request</strong>. You review once and approve once. Mellox never
          merges it for you, and each finding is marked resolved only after a rescan of the live
          site confirms it.
        </p>
      </header>

      {error ? (
        <ErrorState size="sm" detail={error} onRetry={reload} />
      ) : !preflight ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : batch ? (
        <BatchReview
          workspaceId={workspaceId}
          batch={batch}
          onChange={(b) => {
            setBatch(b);
            if (["completed", "discarded"].includes(b.status)) onChanged();
          }}
          onRestart={() => {
            setBatch(null);
            reload();
            onChanged();
          }}
        />
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              [preflight.fixable.length, "can be fixed automatically"],
              [preflight.manualCount, "need manual work"],
              [preflight.inProgressCount, "already have a fix in progress"],
            ].map(([n, label]) => (
              <div
                key={String(label)}
                className="rounded-xl border border-border/60 bg-gradient-to-b from-card/90 to-card/40 shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.05),0_8px_24px_-16px_rgb(0_0_0/0.5)] transition-colors duration-200 hover:border-border px-3 py-2.5"
              >
                <div className="text-[19px] font-semibold tabular-nums">{n}</div>
                <div className="text-[11.5px] text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>

          {preflight.fixable.length === 0 ? (
            <p className="rounded-xl border border-border/60 bg-gradient-to-b from-card/90 to-card/40 shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.05),0_8px_24px_-16px_rgb(0_0_0/0.5)] transition-colors duration-200 hover:border-border px-4 py-3 text-[12.5px] text-muted-foreground">
              No open findings in this scan can be fixed automatically. Open a finding for its
              manual steps.
            </p>
          ) : (
            <section className="rounded-xl border border-border/60 bg-gradient-to-b from-card/90 to-card/40 shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.05),0_8px_24px_-16px_rgb(0_0_0/0.5)] transition-colors duration-200 hover:border-border p-3.5">
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Will be attempted
                {preflight.fixable.length > preflight.maxFindings
                  ? ` (first ${preflight.maxFindings} of ${preflight.fixable.length}, highest priority)`
                  : ""}
              </h4>
              <ul className="max-h-56 space-y-1 overflow-y-auto">
                {preflight.fixable.slice(0, preflight.maxFindings).map((f) => (
                  <li key={f.findingId} className="flex min-w-0 items-center gap-2 text-[12px]">
                    <Chip tone="muted" className="uppercase">
                      {f.priority}
                    </Chip>
                    <span className="truncate font-medium">{f.title}</span>
                    <span className="truncate text-muted-foreground">{pathOf(f.pageUrl)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-xl border border-border/60 bg-gradient-to-b from-card/90 to-card/40 shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.05),0_8px_24px_-16px_rgb(0_0_0/0.5)] transition-colors duration-200 hover:border-border p-3.5">
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              GitHub repository
            </h4>
            {!ready ? (
              <SetupRequirement
                workspaceId={workspaceId}
                scan={scan}
                setup={preflight.setup}
                onReload={reload}
              />
            ) : (
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-[11px] font-medium text-muted-foreground">
                      Repository
                    </span>
                    <select
                      value={sourceId ?? ""}
                      onChange={(e) => setSourceId(e.target.value)}
                      className="h-9 w-full rounded-lg border border-border/70 bg-card px-2.5 text-[12.5px]"
                    >
                      {preflight.setup.sources
                        .filter((s) => s.status === "active" && s.siteUrl?.includes(scan.host))
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.fullName}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] font-medium text-muted-foreground">
                      Base branch
                    </span>
                    {branches ? (
                      <select
                        value={branch}
                        onChange={(e) => setBranch(e.target.value)}
                        className="h-9 w-full rounded-lg border border-border/70 bg-card px-2.5 text-[12.5px]"
                      >
                        {branches.map((b) => (
                          <option key={b.name} value={b.name}>
                            {b.name}
                            {b.protected ? " (protected)" : ""}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Skeleton className="h-9 w-full rounded-lg" />
                    )}
                  </label>
                </div>
                <p className="text-[11.5px] text-muted-foreground">
                  Mellox never writes to this branch. It opens one pull request from a new{" "}
                  <span className="font-mono">mellox/</span> branch into it. Each code fix uses AI
                  credits.
                </p>
                <Button
                  disabled={
                    !branch || starting || !preflight.fixable.length || !preflight.setup.canPropose
                  }
                  loading={starting}
                  onClick={() => void start()}
                >
                  <Wand className="h-4 w-4" /> Generate all fixes
                </Button>
                {!preflight.setup.canPropose && (
                  <p className="text-[11.5px] text-muted-foreground">Editors can run “Fix all”.</p>
                )}
              </div>
            )}
            {startError && (
              <p
                role="alert"
                className="mt-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-[12px] text-destructive"
              >
                {startError}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
