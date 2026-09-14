"use client";

// FindingDetail — one AI Visibility finding end to end: what's wrong, the
// evidence, affected pages, the recommended fix, and the fix workflow.
//
//   GitHub pull request   connect → repository → branch → affected files →
//                         proposed change + diff + checks → approval →
//                         branch + PR → PR status → verification rescan
//   manual                recipe → "Verify fix" rescan
//
// Every state shown here comes from the server (src/server/geo/fixes). A
// finding is shown as resolved only after a verification scan confirms it.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  ExternalLink,
  GitCommit,
  Github,
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
import { emitAppEvent } from "@/lib/app-events";
import { startGithubInstall, subscribeConnectors, updateSource } from "@/lib/connectors.functions";
import type { SourceView } from "@/lib/connectors/types";
import type { GeoFindingView, GeoScanView } from "@/lib/geo/contracts";
import type {
  FixAvailability,
  FixProposalView,
  FixSetup,
  FixTargetPreview,
  RuleCheckState,
  VerificationView,
} from "@/lib/geo/fix-contracts";
import { fixRecipeFor } from "@/lib/geo/fix-recipes";
import { RULE_BY_ID } from "@/lib/geo/rules";
import { CATEGORY_BY_ID } from "@/lib/geo/types";
import {
  approveFixProposal,
  createFixProposal,
  discardFixProposal,
  getFixAvailability,
  getFixProposal,
  getVerification,
  listFixBranches,
  previewFix,
  requestVerification,
} from "@/lib/geo-fixes.functions";
import { cn } from "@/lib/utils";
import { RepositoryPicker } from "../connectors/GitHubConnector";
import { FixDrawer } from "./FixDrawer";
import { Chip, pathOf, PriorityChip, relativeTime, SAFETY_META, StatusGlyph } from "./geo-ui";

const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/* ───────────────────────── small pieces ───────────────────────── */

export function EvidenceList({ evidence }: { evidence: Record<string, unknown> }) {
  const entries = Object.entries(evidence).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );
  if (!entries.length) {
    return (
      <p className="text-[12px] text-muted-foreground">
        No additional evidence was recorded for this check.
      </p>
    );
  }
  return (
    <dl className="grid gap-1 rounded-lg bg-background/70 p-2.5 text-[11.5px]">
      {entries.slice(0, 12).map(([k, v]) => (
        <div key={k} className="grid grid-cols-[minmax(80px,140px)_1fr] gap-2">
          <dt className="truncate text-muted-foreground">
            {k.replace(/([A-Z])/g, " $1").replace(/_/g, " ")}
          </dt>
          <dd className="min-w-0 break-words font-mono text-foreground/85">
            {typeof v === "string" || typeof v === "number" || typeof v === "boolean"
              ? String(v)
              : JSON.stringify(v, null, 0).slice(0, 600)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-border/60 bg-card/50 p-3.5", className)}>
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {title}
      </h4>
      {children}
    </section>
  );
}

export function DiffView({ diff }: { diff: string }) {
  const lines = diff.split("\n").filter((l) => !/^(Index:|={5,}|--- |\+\+\+ )/.test(l));
  return (
    <div className="max-h-80 overflow-auto rounded-lg border border-border/60 bg-background">
      <pre className="min-w-max p-2 text-[11.5px] leading-[1.55]">
        {lines.map((l, i) => (
          <div
            key={i}
            className={cn(
              "px-2",
              l.startsWith("+") && "bg-success/10 text-success",
              l.startsWith("-") && "bg-destructive/10 text-destructive",
              l.startsWith("@@") && "text-muted-foreground",
            )}
          >
            {l || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}

export function CheckRow({
  status,
  label,
  detail,
}: {
  status: "pass" | "fail" | "skipped";
  label: string;
  detail: string;
}) {
  return (
    <li className="flex items-start gap-2 py-1">
      {status === "pass" ? (
        <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
      ) : status === "fail" ? (
        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
      ) : (
        <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full border border-muted-foreground/50" />
      )}
      <div className="min-w-0 text-[12px]">
        <span className="font-medium text-foreground/90">{label}</span>
        <span className="text-muted-foreground"> — {detail}</span>
      </div>
    </li>
  );
}

const STATE_TONE: Record<
  RuleCheckState["status"],
  "success" | "warning" | "destructive" | "muted"
> = {
  pass: "success",
  warn: "warning",
  fail: "destructive",
  na: "muted",
  missing: "muted",
};

export function VerificationCard({ v }: { v: VerificationView }) {
  const pending = v.status === "scheduled" || v.status === "running";
  return (
    <div className="rounded-lg border border-border/60 bg-background/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {v.status === "verified" ? (
          <Chip tone="success">
            <CheckCircle className="h-3 w-3" /> Verified fixed
          </Chip>
        ) : pending ? (
          <Chip tone="primary">
            <Spinner className="h-3 w-3 animate-spin" />{" "}
            {v.status === "running" ? "Re-scanning" : "Scheduled"}
          </Chip>
        ) : v.status === "not_verified" ? (
          <Chip tone="destructive">Not fixed on the live site</Chip>
        ) : (
          <Chip tone="warning">Couldn't confirm</Chip>
        )}
        <span className="text-[11.5px] text-muted-foreground">
          Attempt {Math.max(v.attempts, pending ? v.attempts : 1)} of {v.maxAttempts} · started{" "}
          {relativeTime(v.createdAt)}
          {pending && v.nextAttemptAt && Date.parse(v.nextAttemptAt) > Date.now()
            ? ` · next check ${new Date(v.nextAttemptAt).toLocaleTimeString()}`
            : ""}
        </span>
      </div>
      {v.outcomeDetail && (
        <p className="mt-1.5 text-[12px] text-foreground/85">{v.outcomeDetail}</p>
      )}
      {Object.keys(v.after).length > 0 && (
        <ul className="mt-2 space-y-1 text-[12px]">
          {Object.entries(v.after).map(([fp, after]) => {
            const before = v.before[fp];
            return (
              <li key={fp} className="flex flex-wrap items-center gap-1.5">
                <span className="text-muted-foreground">{pathOf(after.pageUrl)}:</span>
                {before && <Chip tone={STATE_TONE[before.status]}>before · {before.status}</Chip>}
                <span className="text-muted-foreground">→</span>
                <Chip tone={STATE_TONE[after.status]}>after · {after.status}</Chip>
                <span className="min-w-0 break-words text-muted-foreground">{after.detail}</span>
              </li>
            );
          })}
        </ul>
      )}
      {v.regressions.length > 0 && (
        <div className="mt-2 rounded-md border border-warning/30 bg-warning/5 px-2.5 py-1.5 text-[11.5px]">
          <span className="font-medium">New issues on these pages:</span>{" "}
          {v.regressions
            .slice(0, 5)
            .map((r) => r.title)
            .join(", ")}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── GitHub connect (contextual) ───────────────────────── */

function useGithubInstall(workspaceId: string, onConnected: () => void) {
  const [installing, setInstalling] = useState(false);
  useEffect(
    () =>
      subscribeConnectors((message) => {
        if (message.provider !== "github") return;
        setInstalling(false);
        if (message.type === "connected") {
          toast.success("GitHub connected");
          onConnected();
        } else toast.error(message.message);
      }),
    [onConnected],
  );
  const install = async () => {
    setInstalling(true);
    const popup = window.open(
      "about:blank",
      "mellox-github-install",
      "popup,width=1020,height=760",
    );
    try {
      const { url } = await startGithubInstall({ data: { workspaceId } });
      if (popup && !popup.closed) popup.location.href = url;
      else window.location.href = url;
    } catch (e) {
      popup?.close();
      setInstalling(false);
      toast.error(errMsg(e, "Couldn't start the GitHub connection"));
    }
  };
  return { installing, install };
}

/* ───────────────────────── GitHub setup step (shared with "Fix all") ───────────────────────── */

export function SetupRequirement({
  workspaceId,
  scan,
  setup,
  onReload,
}: {
  workspaceId: string;
  scan: Pick<GeoScanView, "host" | "origin">;
  setup: FixSetup;
  onReload: () => void;
}) {
  const { installing, install } = useGithubInstall(workspaceId, onReload);
  const [linking, setLinking] = useState(false);
  const a = setup;

  const linkSource = async (source: SourceView) => {
    setLinking(true);
    try {
      await updateSource({ data: { workspaceId, sourceId: source.id, siteUrl: scan.origin } });
      toast.success(`${source.fullName} linked to ${scan.host}`);
      onReload();
    } catch (e) {
      toast.error(errMsg(e, "Couldn't link the repository"));
    } finally {
      setLinking(false);
    }
  };

  switch (a.requirement) {
    case "not_configured":
      return (
        <p className="text-[12.5px] text-muted-foreground">{a.reason} Follow the manual steps.</p>
      );
    case "connect":
    case "reconnect":
      return (
        <div className="space-y-2">
          <p className="text-[12.5px]">{a.reason}</p>
          {a.canManageConnections ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" loading={installing} onClick={() => void install()}>
                <Github className="h-3.5 w-3.5" />{" "}
                {a.requirement === "connect" ? "Connect GitHub" : "Reconnect GitHub"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => emitAppEvent("open:settings", { section: "connections" })}
              >
                Manage in Settings
              </Button>
              {installing && (
                <span className="text-[12px] text-muted-foreground">
                  Finish on GitHub, then return here…
                </span>
              )}
            </div>
          ) : (
            <p className="text-[12px] text-muted-foreground">
              Ask a workspace admin to connect GitHub in Settings → Connections.
            </p>
          )}
        </div>
      );
    case "select_repository": {
      const unlinked = a.sources.filter((s) => s.status === "active");
      return (
        <div className="space-y-3">
          <p className="text-[12.5px]">{a.reason}</p>
          {!a.canManageConnections ? (
            <p className="text-[12px] text-muted-foreground">
              Ask a workspace admin to link the repository in Settings → Connections.
            </p>
          ) : (
            <>
              {unlinked.length > 0 && (
                <ul className="space-y-1.5">
                  {unlinked.map((s) => (
                    <li
                      key={s.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-[12px]"
                    >
                      <span className="font-medium">{s.fullName}</span>
                      <span className="text-muted-foreground">
                        {s.siteUrl
                          ? `linked to ${s.siteUrl.replace(/^https?:\/\//, "")}`
                          : "not linked to a website"}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="ml-auto"
                        loading={linking}
                        onClick={() => void linkSource(s)}
                      >
                        Use for {scan.host}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {a.connection && a.connection.status === "active" && (
                <RepositoryPicker
                  workspaceId={workspaceId}
                  connection={a.connection}
                  selectedIds={new Set(a.sources.map((s) => s.externalId))}
                  canManage={a.canManageConnections}
                  siteUrl={scan.origin}
                  onSelected={() => onReload()}
                />
              )}
            </>
          )}
        </div>
      );
    }
    case "access_lost":
    case "unsupported":
      return (
        <div className="space-y-2">
          <p className="text-[12.5px]">{a.reason}</p>
          {a.requirement === "access_lost" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => emitAppEvent("open:settings", { section: "connections" })}
            >
              Open Settings → Connections
            </Button>
          )}
        </div>
      );
    case "manual_only":
      return <p className="text-[12.5px] text-muted-foreground">{a.reason}</p>;
    default:
      return null;
  }
}

/* ───────────────────────── Fix flow ───────────────────────── */

function ProposalReview({
  workspaceId,
  proposal,
  onChange,
  onRegenerate,
  regenerating,
}: {
  workspaceId: string;
  proposal: FixProposalView;
  onChange: (p: FixProposalView) => void;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState<"approve" | "discard" | "sync" | "close" | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const act = async (kind: "approve" | "discard" | "sync" | "close") => {
    setBusy(kind);
    try {
      if (kind === "approve") {
        onChange(
          await approveFixProposal({
            data: { workspaceId, proposalId: proposal.id, contentHash: proposal.contentHash! },
          }),
        );
        toast.success("Pull request opened");
      } else if (kind === "sync") {
        onChange(
          await getFixProposal({ data: { workspaceId, proposalId: proposal.id, sync: true } }),
        );
      } else {
        onChange(
          await discardFixProposal({
            data: { workspaceId, proposalId: proposal.id, closePullRequest: kind === "close" },
          }),
        );
        toast.success(kind === "close" ? "Pull request closed" : "Proposal discarded");
      }
    } catch (e) {
      toast.error(errMsg(e, "That didn't work"));
      if (kind === "approve") {
        onChange(
          await getFixProposal({ data: { workspaceId, proposalId: proposal.id } }).catch(
            () => proposal,
          ),
        );
      }
    } finally {
      setBusy(null);
      setConfirmClose(false);
    }
  };

  const p = proposal;
  const target = p.baseBranch ?? "the base branch";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
        <Github className="h-3.5 w-3.5" />
        <span className="font-medium text-foreground/90">{p.repoFullName}</span>
        <span>· base {target}</span>
        {p.baseSha && <span className="font-mono">@{p.baseSha.slice(0, 7)}</span>}
        {p.framework && <span>· {p.framework}</span>}
        {p.model && <span>· drafted with {p.model}</span>}
      </div>

      {p.explanation && (
        <p className="text-[12.5px] leading-relaxed text-foreground/90">{p.explanation}</p>
      )}

      {p.filesPurged ? (
        <p className="text-[12px] text-muted-foreground">
          The proposed file contents were removed after 30 days.
        </p>
      ) : (
        p.files.map((f) => (
          <div key={f.path} className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="font-mono font-medium">{f.path}</span>
              <Chip tone="muted">{f.action === "create" ? "new file" : "edit"}</Chip>
              <span className="text-success">+{f.additions}</span>
              <span className="text-destructive">−{f.deletions}</span>
            </div>
            {f.explanation && <p className="text-[12px] text-muted-foreground">{f.explanation}</p>}
            {f.diff && <DiffView diff={f.diff} />}
          </div>
        ))
      )}

      <div>
        <p className="text-[12px] font-semibold">Checks before approval</p>
        <ul className="mt-1">
          {p.validation.checks.map((c) => (
            <CheckRow key={c.id} status={c.status} label={c.label} detail={c.detail} />
          ))}
        </ul>
      </div>

      {p.error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-[12px] text-destructive"
        >
          {p.error}
        </p>
      )}

      {p.status === "draft" && p.batchId && (
        <p className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-[12px]">
          This fix is part of a “Fix all” run. Review and approve it together with the other fixes
          from Findings → Fix all.
        </p>
      )}

      {p.status === "draft" && !p.batchId && (
        <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
          {!p.validation.ok ? (
            <p className="text-[12px] text-destructive">
              This proposal failed a check and can't be applied. Regenerate it or follow the manual
              steps.
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
                I reviewed this change. Mellox will create a new{" "}
                <span className="font-mono">mellox/</span> branch in {p.repoFullName}, commit
                exactly these files, and open a pull request against{" "}
                <span className="font-mono">{target}</span>. Nothing is merged or pushed to {target}
                .
              </span>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!agreed || !p.validation.ok || busy !== null || !p.contentHash}
              loading={busy === "approve"}
              onClick={() => void act("approve")}
            >
              <GitCommit className="h-3.5 w-3.5" /> Approve & open pull request
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              loading={regenerating}
              onClick={onRegenerate}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Regenerate
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

      {p.status === "applying" && (
        <p className="flex items-center gap-2 text-[12.5px]">
          <Spinner className="h-3.5 w-3.5 animate-spin" /> Creating the branch, commit and pull
          request…
        </p>
      )}

      {p.pr && (
        <div className="space-y-2 rounded-lg border border-border/60 bg-background/60 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={p.pr.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[13px] font-semibold underline-offset-2 hover:underline"
            >
              Pull request #{p.pr.number} <ExternalLink className="h-3 w-3" />
            </a>
            <Chip
              tone={
                p.pr.state === "merged" ? "success" : p.pr.state === "open" ? "primary" : "muted"
              }
            >
              {p.pr.state}
            </Chip>
            {p.headBranch && (
              <span className="font-mono text-[11.5px] text-muted-foreground">{p.headBranch}</span>
            )}
            <span className="text-[11.5px] text-muted-foreground">
              · synced {relativeTime(p.lastSyncedAt)}
            </span>
          </div>
          {p.checks ? (
            p.checks.available ? (
              <p className="text-[12px]">
                CI:{" "}
                <span
                  className={cn(
                    "font-medium",
                    p.checks.state === "success" && "text-success",
                    p.checks.state === "failure" && "text-destructive",
                  )}
                >
                  {p.checks.state === "none"
                    ? "no checks reported"
                    : `${p.checks.passed} passed · ${p.checks.failed} failed · ${p.checks.pending} pending`}
                </span>
              </p>
            ) : (
              <p className="text-[12px] text-muted-foreground">
                CI status unavailable
                {p.checks.reason === "permission"
                  ? " — grant the GitHub App Checks and Commit statuses (read) to see it here."
                  : "."}
              </p>
            )
          ) : null}
          {p.status === "pr_open" && (
            <>
              <p className="text-[12px] text-muted-foreground">
                Review and merge it on GitHub. After it's merged and deployed, Mellox re-scans the
                page and marks the finding resolved only if the check passes.
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

      {p.verification && <VerificationCard v={p.verification} />}
    </div>
  );
}

function FixFlow({
  workspaceId,
  scan,
  finding,
  availability,
  onReload,
}: {
  workspaceId: string;
  scan: GeoScanView;
  finding: GeoFindingView;
  availability: FixAvailability;
  onReload: () => void;
}) {
  const a = availability;
  const [sourceId, setSourceId] = useState<string | null>(a.source?.id ?? null);
  const [branches, setBranches] = useState<{ name: string; protected: boolean }[] | null>(null);
  const [branch, setBranch] = useState<string>("");
  const [preview, setPreview] = useState<{
    framework: string | null;
    target: FixTargetPreview | null;
    unsupportedReason: string | null;
    branch: { name: string; sha: string; protected: boolean };
  } | null>(null);
  const [busy, setBusy] = useState<"branches" | "preview" | "generate" | "link" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<FixProposalView | null>(a.proposal);

  useEffect(() => setProposal(a.proposal), [a.proposal]);
  useEffect(() => setSourceId(a.source?.id ?? null), [a.source?.id]);

  const live =
    proposal && ["draft", "applying", "pr_open", "merged", "verifying"].includes(proposal.status);

  // Load branches for the chosen repository.
  useEffect(() => {
    if (a.requirement !== "ready" || !sourceId || live) return;
    let cancelled = false;
    setBusy("branches");
    setError(null);
    setPreview(null);
    listFixBranches({ data: { workspaceId, sourceId } })
      .then((r) => {
        if (cancelled) return;
        setBranches(r.branches);
        setBranch(r.selectedBranch ?? r.defaultBranch ?? r.branches[0]?.name ?? "");
      })
      .catch((e) => !cancelled && setError(errMsg(e, "Couldn't load branches")))
      .finally(() => !cancelled && setBusy(null));
    return () => {
      cancelled = true;
    };
  }, [workspaceId, sourceId, a.requirement, live]);

  // Poll while GitHub or verification work is in flight.
  const polling =
    !!proposal && ["applying", "pr_open", "merged", "verifying"].includes(proposal.status);
  useVisibleInterval(
    () => {
      if (!proposal || !polling) return;
      getFixProposal({ data: { workspaceId, proposalId: proposal.id } })
        .then(async (p) => {
          setProposal(p);
          if (p.verification && ["scheduled", "running"].includes(p.verification.status)) {
            await getVerification({
              data: { workspaceId, verificationId: p.verification.id },
            }).catch(() => undefined);
          }
          if (p.status === "verified" || p.status === "not_verified") onReload();
        })
        .catch(() => undefined);
    },
    15_000,
    [proposal?.id, polling],
  );

  const runPreview = async () => {
    if (!sourceId || !branch) return;
    setBusy("preview");
    setError(null);
    try {
      setPreview(
        await previewFix({
          data: { workspaceId, findingId: finding.id, sourceId, baseBranch: branch },
        }),
      );
    } catch (e) {
      setError(errMsg(e, "Couldn't read the repository"));
    } finally {
      setBusy(null);
    }
  };

  const generate = async (replaceDraft = false) => {
    if (!sourceId || !branch) return;
    setBusy("generate");
    setError(null);
    try {
      const result = await createFixProposal({
        data: { workspaceId, findingId: finding.id, sourceId, baseBranch: branch, replaceDraft },
      });
      if (result.ok) setProposal(result.proposal);
      else setError(result.reason);
    } catch (e) {
      setError(errMsg(e, "Couldn't generate the change"));
    } finally {
      setBusy(null);
    }
  };

  /* ── requirements before a proposal ── */
  if (proposal && proposal.status !== "discarded") {
    return (
      <div className="space-y-3">
        <ProposalReview
          workspaceId={workspaceId}
          proposal={proposal}
          onChange={(p) => {
            setProposal(p);
            if (p.status === "discarded") onReload();
          }}
          regenerating={busy === "generate"}
          onRegenerate={() => void generate(true)}
        />
        {["failed", "stale", "closed", "not_verified", "access_lost"].includes(proposal.status) && (
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
            <span>
              {proposal.status === "stale"
                ? "The base branch changed since this was generated."
                : proposal.status === "closed"
                  ? "The pull request was closed without merging."
                  : proposal.status === "not_verified"
                    ? "The live site still fails this check."
                    : "This attempt didn't complete."}
            </span>
            <Button size="sm" variant="outline" onClick={() => setProposal(null)}>
              Start a new proposal
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-[12px] text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (a.requirement !== "ready") {
    return <SetupRequirement workspaceId={workspaceId} scan={scan} setup={a} onReload={onReload} />;
  }

  const siteSources = a.sources.filter(
    (s) => s.status === "active" && s.siteUrl && s.siteUrl.includes(scan.host),
  );
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">Repository</span>
          <select
            value={sourceId ?? ""}
            onChange={(e) => setSourceId(e.target.value)}
            className="h-9 w-full rounded-lg border border-border/70 bg-card px-2.5 text-[12.5px]"
          >
            {(siteSources.length ? siteSources : a.source ? [a.source] : []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullName}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">Base branch</span>
          {branches ? (
            <select
              value={branch}
              onChange={(e) => {
                setBranch(e.target.value);
                setPreview(null);
              }}
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
        Mellox never writes to this branch. It opens a pull request from a new{" "}
        <span className="font-mono">mellox/</span> branch into it.
      </p>

      {!preview ? (
        <Button
          size="sm"
          variant="outline"
          disabled={!branch || busy !== null}
          loading={busy === "preview"}
          onClick={() => void runPreview()}
        >
          Check affected files
        </Button>
      ) : preview.target ? (
        <div className="space-y-2 rounded-lg border border-border/60 bg-background/60 p-3">
          <p className="text-[12px]">
            <span className="font-medium">{preview.framework ?? "Unknown framework"}</span> ·{" "}
            {preview.target.strategy === "static_file" ? "discovery file" : "source edit"} ·{" "}
            {preview.target.scope === "site" ? "applies site-wide" : "this page"}
          </p>
          <ul className="space-y-0.5">
            {preview.target.files.map((f) => (
              <li key={f.path} className="flex items-center gap-2 text-[12px]">
                <span className="font-mono">{f.path}</span>
                <Chip tone="muted">{f.action === "create" ? "new file" : "edit"}</Chip>
              </li>
            ))}
          </ul>
          <p className="text-[11.5px] text-muted-foreground">{preview.target.reason}</p>
          <Button
            size="sm"
            disabled={busy !== null || !a.canPropose}
            loading={busy === "generate"}
            onClick={() => void generate()}
          >
            <Wand className="h-3.5 w-3.5" /> Generate proposed change
          </Button>
          {!a.canPropose && (
            <p className="text-[11.5px] text-muted-foreground">Editors can generate fixes.</p>
          )}
          {busy === "generate" && (
            <p className="text-[11.5px] text-muted-foreground">
              Reading the files and drafting a minimal change…
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-[12px]">
          <p className="font-medium">No automated change for this repository</p>
          <p className="mt-0.5 text-muted-foreground">
            {preview.unsupportedReason} Follow the manual steps below.
          </p>
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-[12px] text-destructive"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/* ───────────────────────── Finding detail ───────────────────────── */

export function FindingDetail({
  workspaceId,
  scan,
  finding,
  related,
  brandName,
  onBack,
  onChanged,
}: {
  workspaceId: string;
  scan: GeoScanView;
  finding: GeoFindingView;
  /** Findings of the same check on other pages. */
  related: GeoFindingView[];
  brandName: string | null;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [availability, setAvailability] = useState<FixAvailability | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [verifying, setVerifying] = useState<VerificationView | null>(null);
  const [startingVerify, setStartingVerify] = useState(false);
  const rule = RULE_BY_ID.get(finding.ruleId);
  const recipe = finding.fixId
    ? fixRecipeFor(finding.fixId, {
        url: scan.origin,
        pageUrl: finding.pageUrl ?? undefined,
        brandName,
        description: scan.report?.snapshot.description,
      })
    : null;

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    getFixAvailability({ data: { workspaceId, findingId: finding.id } })
      .then((a) => !cancelled && setAvailability(a))
      .catch((e) => !cancelled && setError(errMsg(e, "Couldn't load fix options")));
    return () => {
      cancelled = true;
    };
  }, [workspaceId, finding.id, nonce]);

  useVisibleInterval(
    () => {
      if (!verifying || !["scheduled", "running"].includes(verifying.status)) return;
      getVerification({ data: { workspaceId, verificationId: verifying.id } })
        .then((v) => {
          setVerifying(v);
          if (!["scheduled", "running"].includes(v.status)) {
            toast[v.status === "verified" ? "success" : "error"](
              v.status === "verified"
                ? "Verified fixed on the live site"
                : (v.outcomeDetail ?? "Not verified"),
            );
            reload();
            onChanged();
          }
        })
        .catch(() => undefined);
    },
    5000,
    [verifying?.id, verifying?.status],
  );

  const verify = async () => {
    setStartingVerify(true);
    try {
      const { verificationId } = await requestVerification({
        data: { workspaceId, findingIds: [finding.id] },
      });
      setVerifying(await getVerification({ data: { workspaceId, verificationId } }));
      toast.success("Re-scanning the affected page");
    } catch (e) {
      toast.error(errMsg(e, "Couldn't start the verification"));
    } finally {
      setStartingVerify(false);
    }
  };

  const pages = useMemo(
    () => [finding, ...related.filter((r) => r.id !== finding.id)],
    [finding, related],
  );
  const history = availability?.verifications ?? [];
  const pendingVerification =
    verifying && ["scheduled", "running"].includes(verifying.status) ? verifying : null;

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All findings
      </button>

      <header className="rounded-xl border border-border/70 bg-card/70 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <PriorityChip priority={finding.priority} />
          <StatusGlyph status={finding.status} />
          <span className="text-[11.5px] text-muted-foreground">
            {CATEGORY_BY_ID[finding.category].name}
          </span>
          {finding.state === "resolved" && finding.resolution === "verified" && (
            <Chip tone="success">
              <ShieldCheck className="h-3 w-3" /> Verified{" "}
              {finding.verifiedAt ? relativeTime(finding.verifiedAt) : ""}
            </Chip>
          )}
          {finding.state === "resolved" && finding.resolution === "manual_legacy" && (
            <Chip tone="muted">Marked resolved (unverified)</Chip>
          )}
          {finding.reopenedAt && <Chip tone="warning">Reopened</Chip>}
        </div>
        <h3 className="mt-2 text-[16px] font-semibold text-foreground">{finding.title}</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-foreground/85">{finding.detail}</p>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
          {finding.pointImpact > 0 && (
            <span>−{finding.pointImpact} points on the overall score</span>
          )}
          <span>Effort: {finding.effort}</span>
          <span title={SAFETY_META[finding.safety].hint}>{SAFETY_META[finding.safety].label}</span>
          <span className="font-mono">{finding.ruleId}</span>
        </div>
      </header>

      <div className="grid gap-3 lg:grid-cols-2">
        <Section title="Why it matters">
          <p className="text-[12.5px] leading-relaxed text-foreground/85">
            {rule?.recommendation ?? finding.title}. {CATEGORY_BY_ID[finding.category].blurb}
          </p>
        </Section>
        <Section title="Evidence">
          <EvidenceList evidence={finding.evidence} />
        </Section>
      </div>

      <Section title={`Affected pages (${pages.filter((p) => p.pageUrl).length || "site-wide"})`}>
        <ul className="max-h-48 space-y-1 overflow-y-auto">
          {pages.slice(0, 50).map((p) => (
            <li key={p.id} className="flex min-w-0 flex-wrap items-center gap-2 text-[12px]">
              <StatusGlyph status={p.status} className="h-3.5 w-3.5" />
              {p.pageUrl ? (
                <a
                  href={p.pageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate font-medium underline-offset-2 hover:underline"
                >
                  {pathOf(p.pageUrl)}
                </a>
              ) : (
                <span className="font-medium">Site-wide</span>
              )}
              <span className="min-w-0 truncate text-muted-foreground">{p.detail}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Fix">
        {error ? (
          <ErrorState size="sm" detail={error} onRetry={reload} />
        ) : !availability ? (
          <Skeleton className="h-24 w-full rounded-lg" />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={availability.method === "github_pr" ? "primary" : "muted"}>
                {availability.method === "github_pr" ? (
                  <>
                    <Github className="h-3 w-3" /> Pull request via GitHub
                  </>
                ) : (
                  "Manual fix"
                )}
              </Chip>
              {availability.method === "github_pr" &&
                availability.requirement !== "ready" &&
                !availability.proposal && (
                  <Chip tone="warning">
                    <AlertTriangle className="h-3 w-3" /> Setup needed
                  </Chip>
                )}
            </div>
            {availability.method === "github_pr" && (
              <FixFlow
                workspaceId={workspaceId}
                scan={scan}
                finding={finding}
                availability={availability}
                onReload={reload}
              />
            )}
            {recipe && (
              <div>
                <p className="mb-1 text-[12px] font-semibold">
                  {availability.method === "github_pr" ? "Or fix it manually" : "How to fix it"}
                </p>
                <FixDrawer recipe={recipe} safety={finding.safety} />
              </div>
            )}
          </div>
        )}
      </Section>

      <Section title="Verification">
        <p className="text-[12px] text-muted-foreground">
          Fixed it yourself, or deployed a change? Mellox re-scans the affected page and marks this
          finding resolved only if the check passes on the live site.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            loading={startingVerify}
            disabled={!!pendingVerification || finding.state === "dismissed"}
            onClick={() => void verify()}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Verify fix
          </Button>
        </div>
        <div className="mt-2 space-y-2">
          {verifying && !history.some((h) => h.id === verifying.id) && (
            <VerificationCard v={verifying} />
          )}
          {history.map((v) => (
            <VerificationCard key={v.id} v={v.id === verifying?.id ? verifying : v} />
          ))}
        </div>
      </Section>
    </div>
  );
}
