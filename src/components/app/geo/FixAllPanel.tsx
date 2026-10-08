"use client";

// FixAllPanel — "Fix all automatically": every finding Mellox can fix for a
// website, generated in one run, reviewed once, approved once, delivered as
// ONE GitHub pull request (WordPress / Webflow: CmsFixAllPanel). Mellox never merges it; each finding resolves only
// after the post-merge rescan confirms its own check passes.
//
// Setup moves on by itself: connecting happens in a sign-in window, the
// repository check runs as soon as a repository is chosen, and the repository
// and branch are picked for the person (they can change them). The two clicks
// that stay are the ones that matter: start the run, and open the pull request.

import { useCallback, useEffect, useState } from "react";
import { toast } from "@/lib/toast";
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
import type {
  FixAllPreflight,
  FixBatchView,
  SiteConnections,
  SiteProviderId,
} from "@/lib/geo/fix-contracts";
import {
  approveFixBatch,
  createFixBatch,
  discardFixBatch,
  getFixAllPreflight,
  getFixBatch,
  getSiteConnections,
  getVerification,
  listFixBranches,
  mergeFixBatch,
} from "@/lib/geo-fixes.functions";
import { cn } from "@/lib/utils";
import {
  CheckRow,
  DiffView,
  SetupRequirement,
  SetupSteps,
  setupStepOf,
  VerificationCard,
} from "./FindingDetail";
import { CmsFixAllPanel } from "./CmsFixAllPanel";
import { Chip, pathOf, relativeTime } from "./geo-ui";
import { SiteConnectPicker } from "./SiteConnectPicker";

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
  canMerge,
  onChange,
  onRestart,
}: {
  /** Admins can merge the pull request from here; everyone else merges on GitHub. */
  canMerge: boolean;
  workspaceId: string;
  batch: FixBatchView;
  onChange: (b: FixBatchView) => void;
  onRestart: () => void;
}) {
  const [busy, setBusy] = useState<"approve" | "discard" | "sync" | "close" | "merge" | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmMerge, setConfirmMerge] = useState(false);
  const b = batch;
  const included = b.items.filter((i) => i.status === "generated");
  const checksFailed = !!b.checks?.available && b.checks.state === "failure";
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

  const act = async (kind: "approve" | "discard" | "sync" | "close" | "merge") => {
    setBusy(kind);
    try {
      if (kind === "approve") {
        onChange(
          await approveFixBatch({
            data: { workspaceId, batchId: b.id, contentHash: b.contentHash! },
          }),
        );
        toast.success("Pull request opened");
      } else if (kind === "merge") {
        onChange(await mergeFixBatch({ data: { workspaceId, batchId: b.id } }));
        toast.success("Merged. Mellox checks your live site next.");
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
      setConfirmMerge(false);
    }
  };

  if (b.status === "generating") {
    const pct = b.progress.total ? Math.round((b.progress.done / b.progress.total) * 100) : 0;
    // The one being written now is the first that isn't finished.
    const currentAt = b.items.findIndex((i) => i.status === "pending");
    return (
      <div
        className="ds-enter space-y-4 rounded-2xl border border-primary/25 bg-card p-4"
        aria-busy="true"
      >
        <div className="flex items-center gap-3">
          <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
            <span
              aria-hidden
              className="absolute inset-0 animate-ping rounded-full bg-primary/20 [animation-duration:1.8s]"
            />
            <Wand className="relative h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold">Writing your fixes</p>
            <p className="truncate text-[12px] text-muted-foreground">
              {b.progress.done} of {b.progress.total} done · nothing is changed yet
            </p>
          </div>
          <span className="text-[18px] font-semibold tabular-nums">{pct}%</span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1.5 overflow-hidden rounded-full bg-border/50"
        >
          <div
            className="ds-sheen h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
            style={{ width: `${Math.max(pct, 4)}%` }}
          />
        </div>
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {b.items.map((i, k) => {
            const now = k === currentAt;
            const done = i.status !== "pending";
            return (
              <li
                key={i.findingId}
                className={cn(
                  "flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] transition-colors duration-300",
                  now && "bg-primary/10",
                  !done && !now && "opacity-50",
                )}
              >
                {i.status === "generated" ? (
                  <CheckCircle className="ds-pop h-3.5 w-3.5 shrink-0 text-success" />
                ) : done ? (
                  <AlertTriangle className="ds-pop h-3.5 w-3.5 shrink-0 text-warning" />
                ) : now ? (
                  <Spinner className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                ) : (
                  <span className="mx-[3px] h-2 w-2 shrink-0 rounded-full border border-muted-foreground/50" />
                )}
                <span className={cn("min-w-0 truncate", now && "font-medium")}>{i.title}</span>
                <span className="ml-auto shrink-0 truncate text-[11.5px] text-muted-foreground">
                  {pathOf(i.pageUrl)}
                </span>
              </li>
            );
          })}
        </ul>
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

      {b.status === "draft" && (
        <div className="ds-enter flex flex-wrap items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <span className="ds-pop grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <CheckCircle className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1 basis-[200px]">
            <p className="text-[14px] font-semibold">
              {included.length} fix{included.length === 1 ? "" : "es"} ready
            </p>
            <p className="text-[12px] text-muted-foreground">
              {b.validation.ok
                ? `One pull request on ${b.repoFullName}. Nothing is merged.`
                : "A check failed, so this can't be opened."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!b.validation.ok || busy !== null || !b.contentHash}
              loading={busy === "approve"}
              onClick={() => void act("approve")}
            >
              <GitCommit className="h-4 w-4" /> Open pull request
            </Button>
            <Button
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
        <div className="ds-enter flex items-center gap-3 rounded-2xl border border-primary/25 bg-card p-4">
          <Spinner className="h-4 w-4 shrink-0 animate-spin text-primary" />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-[13px] font-medium">Opening the pull request</p>
            <div role="progressbar" className="ds-sheen h-1 rounded-full bg-primary/25" />
          </div>
        </div>
      )}

      {b.status === "pr_open" && b.pr && (
        <div className="ds-enter flex flex-wrap items-center gap-3 rounded-2xl border border-success/30 bg-success/5 p-4">
          <span className="ds-pop grid h-10 w-10 shrink-0 place-items-center rounded-full bg-success/15 text-success">
            <CheckCircle className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1 basis-[200px]">
            <p className="text-[14px] font-semibold">
              {confirmMerge ? `Merge into ${b.baseBranch}?` : "Pull request opened"}
            </p>
            <p className="text-[12px] text-muted-foreground">
              {confirmMerge
                ? "This puts the fixes live on your website."
                : checksFailed
                  ? "A check failed on GitHub. Look at it there before merging."
                  : canMerge
                    ? "Merge it here or on GitHub. Mellox then checks your live site."
                    : "An admin can merge it. Mellox then checks your live site."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {confirmMerge ? (
              <>
                <Button loading={busy === "merge"} onClick={() => void act("merge")}>
                  Yes, merge
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => setConfirmMerge(false)}
                >
                  Not yet
                </Button>
              </>
            ) : (
              <>
                {canMerge && !checksFailed && (
                  <Button disabled={busy !== null} onClick={() => setConfirmMerge(true)}>
                    <GitCommit className="h-4 w-4" /> Merge now
                  </Button>
                )}
                <Button asChild variant={canMerge && !checksFailed ? "outline" : "default"}>
                  <a href={b.pr.url} target="_blank" rel="noopener noreferrer">
                    Review on GitHub <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {(b.status === "merged" || b.status === "verifying") && (
        <div className="ds-enter flex items-center gap-3 rounded-2xl border border-primary/25 bg-card p-4">
          <Spinner className="h-4 w-4 shrink-0 animate-spin text-primary" />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-[13px] font-medium">Merged. Checking your live site</p>
            <p className="text-[12px] text-muted-foreground">
              Each issue is marked fixed only when its page passes. This can take a few minutes
              after your site deploys.
            </p>
            <div role="progressbar" className="ds-sheen h-1 rounded-full bg-primary/25" />
          </div>
        </div>
      )}

      <section className="rounded-xl border border-border/60 bg-gradient-to-b from-card/90 to-card/40 shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.05),0_8px_24px_-16px_rgb(0_0_0/0.5)] transition-colors duration-200 hover:border-border p-3.5">
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {included.length} included
          {excluded.length ? ` · ${excluded.length} need you` : ""}
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
            {b.files.length} file{b.files.length === 1 ? "" : "s"} changed
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
            <p className="text-[12px] font-semibold">Checks</p>
            <ul className="mt-1">
              {b.validation.checks.map((c) => (
                <CheckRow key={c.id} status={c.status} label={c.label} detail={c.detail} />
              ))}
            </ul>
          </div>
        </section>
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

/** Everything is set up: one button starts the run. The repository and branch are already chosen. */
function ReadyToFix({
  preflight,
  host,
  sourceId,
  onSource,
  branches,
  branch,
  onBranch,
  choosing,
  onChoose,
  starting,
  onStart,
}: {
  preflight: FixAllPreflight;
  host: string;
  sourceId: string | null;
  onSource: (id: string) => void;
  branches: { name: string; protected: boolean }[] | null;
  branch: string;
  onBranch: (name: string) => void;
  choosing: boolean;
  onChoose: () => void;
  starting: boolean;
  onStart: () => void;
}) {
  const count = Math.min(preflight.fixable.length, preflight.maxFindings);
  const sources = preflight.setup.sources.filter(
    (s) => s.status === "active" && s.siteUrl?.includes(host),
  );
  const repo = sources.find((s) => s.id === sourceId)?.fullName ?? preflight.setup.source?.fullName;
  const also = [
    preflight.engineerCount ? `${preflight.engineerCount} more fixed one at a time` : "",
    preflight.manualCount ? `${preflight.manualCount} need you` : "",
    preflight.inProgressCount ? `${preflight.inProgressCount} already in progress` : "",
  ].filter(Boolean);
  const field = "h-9 w-full rounded-lg border border-border/70 bg-card px-2.5 text-[12.5px]";

  return (
    <section className="ds-enter space-y-3 rounded-2xl border border-primary/25 bg-primary/5 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 basis-[200px]">
          <p className="text-[14px] font-semibold">
            {count} issue{count === 1 ? "" : "s"} ready to fix
          </p>
          <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[12px] text-muted-foreground">
            <span className="truncate">
              {repo ?? "Repository"} · {branch || "…"}
            </span>
            <button
              type="button"
              onClick={onChoose}
              aria-expanded={choosing}
              className="font-medium text-foreground underline-offset-2 hover:underline"
            >
              {choosing ? "Done" : "Change"}
            </button>
          </p>
        </div>
        <Button
          disabled={!branch || starting || !preflight.setup.canPropose}
          loading={starting}
          onClick={onStart}
        >
          <Wand className="h-4 w-4" /> Fix {count} issue{count === 1 ? "" : "s"}
        </Button>
      </div>
      {choosing && (
        <div className="ds-enter grid gap-2 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">Repository</span>
            <select
              value={sourceId ?? ""}
              onChange={(e) => onSource(e.target.value)}
              className={field}
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">Branch</span>
            {branches ? (
              <select value={branch} onChange={(e) => onBranch(e.target.value)} className={field}>
                {branches.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>
            ) : (
              <Skeleton className="h-9 w-full rounded-lg" />
            )}
          </label>
        </div>
      )}
      <details className="group">
        <summary className="cursor-pointer text-[12px] font-medium text-muted-foreground hover:text-foreground">
          See what will be fixed
        </summary>
        <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
          {preflight.fixable.slice(0, preflight.maxFindings).map((f) => (
            <li key={f.findingId} className="flex min-w-0 items-center gap-2 text-[12px]">
              <span className="truncate font-medium">{f.title}</span>
              <span className="truncate text-muted-foreground">{pathOf(f.pageUrl)}</span>
            </li>
          ))}
        </ul>
      </details>
      {also.length > 0 && <p className="text-[11.5px] text-muted-foreground">{also.join(" · ")}</p>}
      {!preflight.setup.canPropose && (
        <p className="text-[11.5px] text-muted-foreground">An editor can run “Fix all”.</p>
      )}
    </section>
  );
}

export function FixAllPanel({
  workspaceId,
  scan,
  onBack,
  onChanged,
  onOpenFinding,
}: {
  workspaceId: string;
  scan: GeoScanView;
  onBack: () => void;
  onChanged: () => void;
  onOpenFinding?: (findingId: string) => void;
}) {
  const [preflight, setPreflight] = useState<FixAllPreflight | null>(null);
  const [connections, setConnections] = useState<SiteConnections | null>(null);
  const [provider, setProvider] = useState<SiteProviderId | null>(null);
  const [batch, setBatch] = useState<FixBatchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [branches, setBranches] = useState<{ name: string; protected: boolean }[] | null>(null);
  const [branch, setBranch] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([
      getFixAllPreflight({ data: { workspaceId, scanId: scan.id } }),
      getSiteConnections({ data: { workspaceId, scanId: scan.id } }),
    ])
      .then(([p, c]) => {
        if (cancelled) return;
        setPreflight(p);
        setConnections(c);
        // The platform that serves the site; else the one the live page says it's built with.
        setProvider(
          (cur) => cur ?? p.platform ?? c.active ?? c.detected ?? c.tiles[0]?.provider ?? "github",
        );
        setBatch(p.batch && p.batch.status !== "discarded" ? p.batch : null);
        setSourceId(p.setup.source?.id ?? null);
      })
      .catch((e) => !cancelled && setError(errMsg(e, "Couldn't load fixable findings")));
    return () => {
      cancelled = true;
    };
  }, [workspaceId, scan.id, nonce]);

  const github = provider === "github";
  const ready = github && preflight?.setup.requirement === "ready";
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

  const tile = connections?.tiles.find((t) => t.provider === provider) ?? null;
  const intro = !provider
    ? ""
    : github
      ? "One pull request with every fix. You merge it."
      : `You see each change first. Nothing goes live on ${
          provider === "wordpress" ? "WordPress" : "Webflow"
        } until you apply it.`;

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All findings
      </button>

      <header>
        <h3 className="flex items-center gap-2 text-[16px] font-semibold">
          <Wand className="h-4 w-4 text-primary" /> Fix all for {scan.host}
        </h3>
        {intro ? <p className="mt-1 text-[12.5px] text-muted-foreground">{intro}</p> : null}
      </header>

      {error ? (
        <ErrorState size="sm" detail={error} onRetry={reload} />
      ) : !preflight || !connections || !provider ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : batch ? (
        <BatchReview
          workspaceId={workspaceId}
          batch={batch}
          canMerge={preflight.setup.canManageConnections}
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
          <SiteConnectPicker
            workspaceId={workspaceId}
            connections={connections}
            selected={provider}
            onSelect={(p) => {
              setProvider(p);
              setStartError(null);
            }}
            onConnected={reload}
          />
          {github && tile?.state !== "unavailable" && (
            <SetupSteps
              at={tile?.state === "not_connected" ? 0 : setupStepOf(preflight.setup.requirement)}
            />
          )}

          {!github ? (
            tile?.state === "serves_site" ? (
              <CmsFixAllPanel
                workspaceId={workspaceId}
                scanId={scan.id}
                onChanged={onChanged}
                onOpenFinding={onOpenFinding}
              />
            ) : null
          ) : tile?.state === "not_connected" || tile?.state === "unavailable" ? null : !ready ? (
            <SetupRequirement
              workspaceId={workspaceId}
              scan={scan}
              setup={preflight.setup}
              onReload={reload}
            />
          ) : preflight.fixable.length === 0 ? (
            <p className="rounded-xl bg-muted/40 px-4 py-3 text-[12.5px] text-muted-foreground">
              Nothing in this scan can be fixed in code automatically. Open a finding for its steps.
            </p>
          ) : (
            <ReadyToFix
              preflight={preflight}
              host={scan.host}
              sourceId={sourceId}
              onSource={setSourceId}
              branches={branches}
              branch={branch}
              onBranch={setBranch}
              choosing={choosing}
              onChoose={() => setChoosing((v) => !v)}
              starting={starting}
              onStart={() => void start()}
            />
          )}
          {startError && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-[12px] text-destructive"
            >
              {startError}
            </p>
          )}
        </>
      )}
    </div>
  );
}
