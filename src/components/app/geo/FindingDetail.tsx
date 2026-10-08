"use client";

// FindingDetail — one AI Visibility finding end to end: what's wrong, the
// evidence, affected pages, the recommended fix, and the fix workflow.
//
//   GitHub pull request   connect → repository → check (each step moves on by
//                         itself) → proposed change + diff + checks → approval →
//                         branch + PR → PR status → verification rescan
//   manual                recipe → "Verify fix" rescan
//
// Every state shown here comes from the server (src/server/geo/fixes). A
// finding is shown as resolved only after a verification scan confirms it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import {
  ArrowLeft,
  CheckCircle,
  ExternalLink,
  Github,
  RefreshCw,
  ShieldCheck,
  Spinner,
  XCircle,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useVisibleInterval } from "@/hooks/use-visible-interval";
import { emitAppEvent } from "@/lib/app-events";
import { updateSource, verifySourceOwnership } from "@/lib/connectors.functions";
import { hostsMatch, ownershipIsCurrent } from "@/lib/connectors/ownership";
import { useGithubInstall } from "../connectors/useGithubInstall";
import type { SourceView } from "@/lib/connectors/types";
import {
  DISMISS_REASONS,
  type DismissReason,
  type GeoFindingView,
  type GeoScanView,
} from "@/lib/geo/contracts";
import { markFindingsReviewed, setFindingState } from "@/lib/geo.functions";
import { AgentPanel } from "./agent/AgentPanel";
import { SiteConnectionCard } from "./SiteConnectionCard";
import { SiteConnectSection } from "./SiteConnectPicker";
import type {
  FixAvailability,
  FixSetup,
  RuleCheckState,
  VerificationView,
} from "@/lib/geo/fix-contracts";
import { fixRecipeFor } from "@/lib/geo/fix-recipes";
import { RULE_BY_ID } from "@/lib/geo/rules";
import { CATEGORY_BY_ID } from "@/lib/geo/types";
import {
  getFixAvailability,
  getVerification,
  requestVerification,
} from "@/lib/geo-fixes.functions";
import { cn } from "@/lib/utils";
import { RepositoryPicker } from "../connectors/GitHubConnector";
import { RepoOwnershipCard } from "../connectors/RepoOwnershipCard";
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
    <section
      className={cn(
        "rounded-xl border border-border/60 bg-gradient-to-b from-card/90 to-card/40 shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.05),0_8px_24px_-16px_rgb(0_0_0/0.5)] transition-colors duration-200 hover:border-border p-3.5",
        className,
      )}
    >
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

/* ───────────────────────── GitHub setup (shared with "Fix all") ───────────────────────── */

// Getting a GitHub site ready is four short steps. Each one moves on by itself
// as soon as it can: the sign-in window closing re-reads the state, choosing a
// repository starts the check, and a passed check lands on "Fix".
const SETUP_STEPS = ["Connect", "Repository", "Check", "Fix"] as const;

export function setupStepOf(requirement: FixSetup["requirement"]): number {
  switch (requirement) {
    case "connect":
    case "reconnect":
    case "not_configured":
      return 0;
    case "select_repository":
    case "access_lost":
    case "unsupported":
      return 1;
    case "verify_ownership":
    case "ownership_mismatch":
      return 2;
    default:
      return 3;
  }
}

export function SetupSteps({ at }: { at: number }) {
  return (
    <ol className="flex gap-1.5" aria-label="Setup progress">
      {SETUP_STEPS.map((label, i) => (
        <li
          key={label}
          aria-current={i === at ? "step" : undefined}
          className="flex min-w-0 flex-1 flex-col gap-1.5"
        >
          <span
            className={cn(
              "h-1 rounded-full transition-colors duration-500",
              i < at ? "bg-primary" : i === at ? "ds-sheen bg-primary/70" : "bg-border/70",
            )}
          />
          <span
            className={cn(
              "flex items-center gap-1 truncate text-[11px]",
              i <= at ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {i < at && <CheckCircle className="ds-pop h-3 w-3 shrink-0 text-primary" />}
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function SetupRow({
  icon,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="ds-enter flex flex-wrap items-center gap-3 rounded-2xl border border-border/60 bg-card/60 p-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-secondary">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">{title}</p>
        {hint && <p className="text-[12px] text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

/** Checks by itself that the repository builds this website; shows the evidence only if it can't prove it. */
function OwnershipStep({
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
  const source = setup.source;
  const [checking, setChecking] = useState(false);
  const tried = useRef<string | null>(null);
  const o = source?.ownership;
  // Never checked for this website, or a passed check that has gone stale.
  const due =
    !!o &&
    (!o.checkedAt ||
      !hostsMatch(o.siteHost, scan.host) ||
      (o.status === "verified" &&
        !ownershipIsCurrent({
          status: o.status,
          checkedHost: o.siteHost,
          checkedAt: o.checkedAt,
          siteHost: scan.host,
        })));
  const sourceId = source?.id;
  const sourceName = source?.fullName;

  useEffect(() => {
    if (!sourceId || !due || !setup.canPropose || setup.requirement !== "verify_ownership") return;
    const key = `${sourceId}:${scan.host}`;
    if (tried.current === key) return;
    tried.current = key;
    setChecking(true);
    verifySourceOwnership({ data: { workspaceId, sourceId, siteHost: scan.host } })
      .then((updated) => {
        if (updated.ownership.status === "verified")
          toast.success(`${sourceName} builds ${scan.host}`);
        onReload();
      })
      .catch(() => undefined)
      .finally(() => setChecking(false));
  }, [
    workspaceId,
    sourceId,
    sourceName,
    due,
    scan.host,
    setup.canPropose,
    setup.requirement,
    onReload,
  ]);

  if (!source) return <p className="text-[12.5px]">{setup.reason}</p>;
  if (checking)
    return (
      <SetupRow
        icon={<Spinner className="h-4 w-4 animate-spin" />}
        title={`Checking that ${source.fullName} builds ${scan.host}`}
        hint="A few seconds."
      />
    );
  return (
    <div className="ds-enter space-y-2">
      <RepoOwnershipCard
        workspaceId={workspaceId}
        source={source}
        siteHost={scan.host}
        canVerify={setup.canPropose}
        canAttest={setup.canManageConnections}
        onChange={() => onReload()}
      />
      {setup.requirement === "ownership_mismatch" && setup.canManageConnections && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => emitAppEvent("open:settings", { section: "website" })}
        >
          Use a different repository
        </Button>
      )}
    </div>
  );
}

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
  // Only used if the browser blocks the sign-in window and GitHub opens in this tab.
  const returnRule = "ruleId" in setup && typeof setup.ruleId === "string" ? setup.ruleId : null;
  const { installing, install } = useGithubInstall(
    workspaceId,
    `/app?geo=findings${returnRule ? `&rule=${encodeURIComponent(returnRule)}` : ""}`,
    onReload,
  );
  const [linking, setLinking] = useState<string | null>(null);
  const a = setup;

  const linkSource = async (source: SourceView) => {
    setLinking(source.id);
    try {
      await updateSource({ data: { workspaceId, sourceId: source.id, siteUrl: scan.origin } });
      onReload();
    } catch (e) {
      toast.error(errMsg(e, "Couldn't use that repository"));
    } finally {
      setLinking(null);
    }
  };

  switch (a.requirement) {
    case "not_configured":
      return <p className="text-[12.5px] text-muted-foreground">{a.reason}</p>;
    case "connect":
    case "reconnect":
      return (
        <SetupRow
          icon={<Github className="h-4 w-4" />}
          title={a.requirement === "connect" ? "Connect GitHub" : "Reconnect GitHub"}
          hint={
            installing
              ? "Finish in the GitHub window. This page updates by itself."
              : "Mellox only opens pull requests. You merge them."
          }
        >
          {a.canManageConnections ? (
            <Button size="sm" loading={installing} onClick={() => void install()}>
              {a.requirement === "connect" ? "Connect" : "Reconnect"}
            </Button>
          ) : (
            <span className="text-[12px] text-muted-foreground">Ask an admin</span>
          )}
        </SetupRow>
      );
    case "select_repository": {
      const linked = a.sources.filter((s) => s.status === "active");
      return (
        <div className="ds-enter space-y-2.5">
          <p className="text-[13px] font-medium">Which repository builds {scan.host}?</p>
          {!a.canManageConnections ? (
            <p className="text-[12px] text-muted-foreground">Ask an admin to choose it.</p>
          ) : (
            <>
              {linked.length > 0 && (
                <ul className="space-y-1.5">
                  {linked.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center gap-2 rounded-xl border border-border/60 px-3 py-2 text-[12.5px]"
                    >
                      <Github className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate font-medium">{s.fullName}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        loading={linking === s.id}
                        disabled={linking !== null}
                        onClick={() => void linkSource(s)}
                      >
                        Use this
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
    case "verify_ownership":
    case "ownership_mismatch":
      return <OwnershipStep workspaceId={workspaceId} scan={scan} setup={a} onReload={onReload} />;
    case "access_lost":
    case "unsupported":
      return (
        <div className="space-y-2">
          <p className="text-[12.5px]">{a.reason}</p>
          {a.requirement === "access_lost" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => emitAppEvent("open:settings", { section: "website" })}
            >
              Open Connections
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

/** Nothing connected for this site yet: offer GitHub, WordPress and Webflow side by side. */
function needsSite(a: FixAvailability): boolean {
  return (
    !a.site && !a.proposal && ["connect", "reconnect", "not_configured"].includes(a.requirement)
  );
}

/* ───────────────────────── Finding state (review / ignore / reopen) ───────────────────────── */

function FindingStateActions({
  workspaceId,
  finding,
  onChanged,
}: {
  workspaceId: string;
  finding: GeoFindingView;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<"review" | "ignore" | "reopen" | null>(null);
  const [ignoring, setIgnoring] = useState(false);
  const [reason, setReason] = useState<DismissReason | "">("");
  const [note, setNote] = useState("");
  const [reviewedAt, setReviewedAt] = useState(finding.reviewedAt);
  useEffect(() => setReviewedAt(finding.reviewedAt), [finding.reviewedAt]);
  const resolved = finding.state === "resolved";

  const review = async () => {
    setBusy("review");
    try {
      const next = !reviewedAt;
      await markFindingsReviewed({
        data: { workspaceId, fingerprints: [finding.fingerprint], reviewed: next },
      });
      setReviewedAt(next ? new Date().toISOString() : null);
      onChanged();
    } catch (e) {
      toast.error(errMsg(e, "Couldn't update the review"));
    } finally {
      setBusy(null);
    }
  };
  const setState = async (state: "open" | "dismissed") => {
    setBusy(state === "open" ? "reopen" : "ignore");
    try {
      await setFindingState({
        data: {
          workspaceId,
          fingerprint: finding.fingerprint,
          state,
          note: state === "dismissed" ? note.trim() || null : null,
          dismissReason: state === "dismissed" ? (reason as DismissReason) : null,
        },
      });
      toast.success(state === "open" ? "Finding reopened" : "Finding ignored");
      setIgnoring(false);
      onChanged();
    } catch (e) {
      toast.error(errMsg(e, "Couldn't update the finding"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-3 space-y-2 border-t border-border/50 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        {finding.pageUrl && (
          <a
            href={finding.pageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1 rounded-full border border-border/70 bg-card px-3 text-[12px] font-medium hover:bg-secondary"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Open affected page
          </a>
        )}
        <Button
          size="sm"
          variant="outline"
          loading={busy === "review"}
          onClick={() => void review()}
        >
          <CheckCircle className="h-3.5 w-3.5" /> {reviewedAt ? "Reviewed" : "Mark as reviewed"}
        </Button>
        {!resolved &&
          (finding.state === "dismissed" ? (
            <Button
              size="sm"
              variant="outline"
              loading={busy === "reopen"}
              onClick={() => void setState("open")}
            >
              Reopen
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setIgnoring((v) => !v)}>
              Ignore with reason
            </Button>
          ))}
        {reviewedAt && (
          <span className="text-[11.5px] text-muted-foreground">
            Reviewed {relativeTime(reviewedAt)}
          </span>
        )}
        {finding.state === "dismissed" && finding.dismissReason && (
          <Chip tone="muted">
            Ignored: {DISMISS_REASONS.find((r) => r.value === finding.dismissReason)?.label}
          </Chip>
        )}
      </div>
      {ignoring && (
        <form
          className="space-y-2 rounded-lg border border-border/60 bg-background/60 p-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason) void setState("dismissed");
          }}
        >
          <fieldset className="space-y-1">
            <legend className="text-[12px] font-medium">Why ignore this finding?</legend>
            {DISMISS_REASONS.map((r) => (
              <label key={r.value} className="flex items-center gap-2 text-[12px]">
                <input
                  type="radio"
                  name={`dismiss-${finding.id}`}
                  value={r.value}
                  checked={reason === r.value}
                  onChange={() => setReason(r.value)}
                />
                {r.label}
              </label>
            ))}
          </fieldset>
          <label className="block text-[12px]">
            <span className="sr-only">Note</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 1000))}
              placeholder="Optional note for your team"
              className="h-8 w-full rounded-lg border border-border/70 bg-background px-2.5 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            />
          </label>
          <div className="flex gap-2">
            <Button size="sm" type="submit" disabled={!reason} loading={busy === "ignore"}>
              Ignore finding
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setIgnoring(false)}>
              Cancel
            </Button>
          </div>
        </form>
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

      <header className="rounded-xl border border-border/70 bg-gradient-to-b from-card/90 to-card/40 shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.05),0_8px_24px_-16px_rgb(0_0_0/0.5)] transition-colors duration-200 hover:border-border p-4">
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
          <span>
            {finding.fixMode === "manual"
              ? "Manual fix"
              : finding.fixMode === "agent"
                ? "GEO Engineer can fix"
                : "Mellox can fix"}
          </span>
          <span className="font-mono">{finding.ruleId}</span>
        </div>
        <FindingStateActions workspaceId={workspaceId} finding={finding} onChanged={onChanged} />
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

      <Section title="Fix with AI Agent">
        {!availability && !error ? (
          <Skeleton className="h-24 w-full rounded-lg" />
        ) : (
          <AgentPanel
            workspaceId={workspaceId}
            findingId={finding.id}
            fixMode={finding.fixMode}
            canPropose={availability?.canPropose ?? false}
            provider={availability?.provider ?? "github"}
            ready={availability?.requirement === "ready"}
            notReadyReason={
              availability && availability.requirement !== "ready" ? availability.reason : null
            }
            // What is still missing is set up right here, next to the button it unlocks.
            setup={
              error ? (
                <ErrorState size="sm" detail={error} onRetry={reload} />
              ) : !availability ? null : needsSite(availability) ? (
                <SiteConnectSection
                  workspaceId={workspaceId}
                  scanId={scan.id}
                  returnPath={`/app?geo=findings&rule=${encodeURIComponent(finding.ruleId)}`}
                  onConnected={reload}
                />
              ) : availability.method === "github_pr" ? (
                <div className="space-y-3">
                  <SetupSteps at={setupStepOf(availability.requirement)} />
                  <SetupRequirement
                    workspaceId={workspaceId}
                    scan={scan}
                    setup={availability}
                    onReload={reload}
                  />
                </div>
              ) : availability.method === "cms_apply" ? (
                <p className="text-[12.5px]">{availability.reason}</p>
              ) : null
            }
            manualSteps={recipe?.steps ?? (rule ? [rule.recommendation] : [])}
            onChanged={() => {
              reload();
              onChanged();
            }}
          />
        )}
      </Section>

      {(recipe || (availability?.site && availability.site.provider !== "github")) && (
        <Section title="Fix it yourself">
          <div className="space-y-3">
            {availability?.site && availability.site.provider !== "github" && (
              <SiteConnectionCard
                site={availability.site}
                canManage={availability.canManageConnections}
              />
            )}
            {recipe && <FixDrawer recipe={recipe} safety={finding.safety} />}
          </div>
        </Section>
      )}

      <Section title="Verification">
        <p className="text-[12px] text-muted-foreground">
          Fixed it yourself, or deployed a change? Mellox re-scans the affected page and marks this
          finding resolved only if the check passes on the live site.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {finding.verifyScope === "full" ? (
            <p className="text-[12px] text-muted-foreground">
              This check compares pages across the whole site. Run a full re-scan from the scan bar
              to verify it.
            </p>
          ) : (
            <Button
              size="sm"
              variant="outline"
              loading={startingVerify}
              disabled={!!pendingVerification || finding.state === "dismissed"}
              onClick={() => void verify()}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Re-scan to verify
            </Button>
          )}
          {finding.state === "dismissed" && (
            <span className="text-[12px] text-muted-foreground">
              Reopen the finding to verify it.
            </span>
          )}
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
