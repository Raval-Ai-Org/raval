"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  ExternalLink,
  MessageSquare,
  Search,
  ShieldCheck,
  Wand,
} from "@/components/icons";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { emitAppEvent } from "@/lib/app-events";
import { cn } from "@/lib/utils";
import { getScanFindings, setFindingState } from "@/lib/geo.functions";
import { listFixActivity, requestVerification } from "@/lib/geo-fixes.functions";
import type { FindingWorkflowState, GeoFindingView, GeoScanView } from "@/lib/geo/contracts";
import { GEO_CATEGORIES, type GeoCategoryId, type Priority } from "@/lib/geo/types";
import { FindingDetail } from "./FindingDetail";
import { FixAllPanel } from "./FixAllPanel";
import {
  Chip,
  displayUrl,
  ghostBtn,
  primaryBtn,
  pathOf,
  PriorityChip,
  SAFETY_META,
  StatusGlyph,
} from "./geo-ui";

export type FindingsFilter = { category?: GeoCategoryId; ruleId?: string; fixAll?: boolean };

/** States a person can set. "Resolved" comes only from a verification scan. */
type ManualState = Exclude<FindingWorkflowState, "resolved">;
const MANUAL_STATES: { value: ManualState; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "dismissed", label: "Dismissed" },
];
const FILTER_STATES: { value: FindingWorkflowState; label: string }[] = [
  ...MANUAL_STATES,
  { value: "resolved", label: "Resolved" },
];
const PRIORITY_RANK: Record<Priority, number> = { critical: 3, high: 2, medium: 1, low: 0 };
/** Checks that compare pages across the site can't be verified by rescanning one page. */
const SITE_COMPARISON_RULES = new Set([
  "tech.duplicate_title",
  "tech.duplicate_description",
  "tech.broken_links",
  "tech.crawl_depth",
  "tech.http_errors",
]);

type Activity = Awaited<ReturnType<typeof listFixActivity>>;

const PROPOSAL_LABEL: Record<
  string,
  { label: string; tone: "primary" | "success" | "warning" | "destructive" | "muted" }
> = {
  draft: { label: "Fix proposed", tone: "primary" },
  applying: { label: "Opening PR", tone: "primary" },
  pr_open: { label: "PR open", tone: "primary" },
  merged: { label: "PR merged", tone: "primary" },
  verifying: { label: "Verifying", tone: "primary" },
  verified: { label: "Verified", tone: "success" },
  not_verified: { label: "Not verified", tone: "destructive" },
  failed: { label: "Fix failed", tone: "destructive" },
  stale: { label: "Proposal outdated", tone: "warning" },
  access_lost: { label: "GitHub access lost", tone: "warning" },
};

type Group = {
  ruleId: string;
  title: string;
  category: GeoCategoryId;
  priority: Priority;
  priorityScore: number;
  pointsLost: number;
  fixId: string | null;
  safety: GeoFindingView["safety"];
  items: GeoFindingView[];
};

function FindingItem({
  finding,
  activity,
  onState,
  onAsk,
  onOpen,
}: {
  finding: GeoFindingView;
  activity: Activity | null;
  onState: (f: GeoFindingView, s: ManualState) => void;
  onAsk: (f: GeoFindingView) => void;
  onOpen: (f: GeoFindingView) => void;
}) {
  const proposal = activity?.proposals[finding.fingerprint];
  const badge = proposal ? PROPOSAL_LABEL[proposal.status] : null;
  const resolved = finding.state === "resolved";
  return (
    <li
      className={cn("px-3.5 py-2.5", (resolved || finding.state === "dismissed") && "opacity-70")}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
        <StatusGlyph status={finding.status} className="mt-0.5" />
        <div className="min-w-0 flex-1 basis-[220px]">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12.5px] font-medium text-foreground/90">
            {finding.pageUrl ? (
              <a
                href={finding.pageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-w-0 items-center gap-1 truncate underline-offset-2 hover:underline"
              >
                <span className="truncate">{pathOf(finding.pageUrl)}</span>
                <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
              </a>
            ) : (
              <span>Site-wide</span>
            )}
            {finding.pointImpact > 0 && (
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                −{finding.pointImpact}
              </span>
            )}
            {resolved && finding.resolution === "verified" && (
              <Chip tone="success">
                <ShieldCheck className="h-3 w-3" /> Verified
              </Chip>
            )}
            {resolved && finding.resolution === "manual_legacy" && (
              <Chip tone="muted">Resolved (unverified)</Chip>
            )}
            {finding.reopenedAt && !resolved && <Chip tone="warning">Reopened</Chip>}
            {badge && !resolved && <Chip tone={badge.tone}>{badge.label}</Chip>}
          </div>
          <div className="mt-0.5 break-words text-[12.5px] leading-relaxed text-muted-foreground">
            {finding.detail}
          </div>
          <button
            type="button"
            onClick={() => onOpen(finding)}
            className="mt-1 text-[11.5px] font-medium text-primary underline-offset-2 hover:underline"
          >
            Details & fix
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {resolved ? (
            <span className="text-[12px] text-muted-foreground">Resolved</span>
          ) : (
            <>
              <label className="sr-only" htmlFor={`state-${finding.id}`}>
                Status
              </label>
              <select
                id={`state-${finding.id}`}
                value={finding.state}
                onChange={(e) => onState(finding, e.target.value as ManualState)}
                className="h-8 rounded-full border border-border/70 bg-card px-2.5 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                {MANUAL_STATES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </>
          )}
          <button
            type="button"
            onClick={() => onAsk(finding)}
            className={cn(ghostBtn, "h-8 px-2.5 text-[12px]")}
            title="Ask Ravi about this finding"
          >
            <MessageSquare className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </li>
  );
}

export function FindingsTab({
  workspaceId,
  scan,
  brandName,
  filter,
  onFilterChange,
}: {
  workspaceId: string;
  scan: GeoScanView;
  brandName: string | null;
  filter: FindingsFilter;
  onFilterChange: (f: FindingsFilter) => void;
}) {
  const [findings, setFindings] = useState<GeoFindingView[] | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [stateFilter, setStateFilter] = useState<"active" | FindingWorkflowState | "all">("active");
  const [query, setQuery] = useState("");
  const [openGroup, setOpenGroup] = useState<string | null>(filter.ruleId ?? null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [verifyingGroup, setVerifyingGroup] = useState<string | null>(null);
  const [limit, setLimit] = useState(40);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([
      getScanFindings({ data: { workspaceId, scanId: scan.id } }),
      listFixActivity({ data: { workspaceId, scanId: scan.id } }).catch(() => null),
    ])
      .then(([rows, act]) => {
        if (cancelled) return;
        setFindings(rows);
        setActivity(act);
      })
      .catch(
        (e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load findings"),
      );
    return () => {
      cancelled = true;
    };
  }, [workspaceId, scan.id, nonce]);

  useEffect(() => {
    setFindings(null);
    setDetailId(null);
  }, [scan.id]);

  useEffect(() => {
    if (filter.ruleId) setOpenGroup(filter.ruleId);
  }, [filter.ruleId]);

  const groups = useMemo(() => {
    if (!findings) return [];
    const q = query.trim().toLowerCase();
    const map = new Map<string, Group>();
    for (const f of findings) {
      if (filter.category && f.category !== filter.category) continue;
      if (filter.ruleId && f.ruleId !== filter.ruleId) continue;
      if (stateFilter === "active" && (f.state === "resolved" || f.state === "dismissed")) continue;
      if (stateFilter !== "active" && stateFilter !== "all" && f.state !== stateFilter) continue;
      if (q && !`${f.title} ${f.detail} ${f.pageUrl ?? ""}`.toLowerCase().includes(q)) continue;
      const g = map.get(f.ruleId) ?? {
        ruleId: f.ruleId,
        title: f.title,
        category: f.category,
        priority: f.priority,
        priorityScore: f.priorityScore,
        pointsLost: 0,
        fixId: f.fixId,
        safety: f.safety,
        items: [],
      };
      g.items.push(f);
      g.pointsLost = Math.round((g.pointsLost + f.pointImpact) * 10) / 10;
      if (PRIORITY_RANK[f.priority] > PRIORITY_RANK[g.priority]) g.priority = f.priority;
      g.priorityScore = Math.max(g.priorityScore, f.priorityScore);
      map.set(f.ruleId, g);
    }
    return [...map.values()].sort(
      (a, b) => b.priorityScore - a.priorityScore || b.pointsLost - a.pointsLost,
    );
  }, [findings, filter, stateFilter, query]);

  const updateState = async (targets: GeoFindingView[], state: ManualState) => {
    const fingerprints = new Set(
      targets.filter((t) => t.state !== "resolved").map((t) => t.fingerprint),
    );
    const previous = findings;
    setFindings(
      (rows) => rows?.map((r) => (fingerprints.has(r.fingerprint) ? { ...r, state } : r)) ?? rows,
    );
    try {
      for (const fp of [...fingerprints].slice(0, 100)) {
        await setFindingState({ data: { workspaceId, fingerprint: fp, state } });
      }
    } catch (e) {
      setFindings(previous);
      setError(e instanceof Error ? e.message : "Couldn't update the finding");
    }
  };

  const verifyGroup = async (g: Group) => {
    const targets = g.items
      .filter((i) => i.state !== "resolved" && i.state !== "dismissed")
      .slice(0, 20);
    if (!targets.length) return;
    setVerifyingGroup(g.ruleId);
    try {
      const { urls } = await requestVerification({
        data: { workspaceId, findingIds: targets.map((t) => t.id) },
      });
      toast.success(`Re-scanning ${urls.length} page${urls.length === 1 ? "" : "s"} to verify`, {
        description: "Open a finding to follow the result.",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start the verification");
    } finally {
      setVerifyingGroup(null);
    }
  };

  const ask = (f: GeoFindingView) =>
    emitAppEvent("chat:prefill", {
      text: `Help me fix this AI visibility finding on ${f.pageUrl ?? displayUrl(scan.origin)}: "${f.title}" — ${f.detail} Give me exact changes.`,
      focus: true,
    });

  if (error && !findings) return <ErrorState size="sm" detail={error} onRetry={reload} />;

  if (filter.fixAll) {
    return (
      <FixAllPanel
        workspaceId={workspaceId}
        scan={scan}
        onBack={() => onFilterChange({})}
        onChanged={reload}
      />
    );
  }

  const detail = detailId ? findings?.find((f) => f.id === detailId) : null;
  if (detail) {
    return (
      <FindingDetail
        workspaceId={workspaceId}
        scan={scan}
        finding={detail}
        related={findings!.filter((f) => f.ruleId === detail.ruleId)}
        brandName={brandName}
        onBack={() => setDetailId(null)}
        onChanged={reload}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3.5 py-2.5">
        <p className="min-w-0 flex-1 basis-[220px] text-[12.5px]">
          <span className="font-medium">Fix all automatically</span>
          <span className="text-muted-foreground">
            {" "}
            — every fix Mellox can make, in one GitHub pull request you approve once.
          </span>
        </p>
        <button
          type="button"
          onClick={() => onFilterChange({ fixAll: true })}
          className={cn(primaryBtn, "px-3.5 py-1.5 text-[12.5px]")}
        >
          <Wand className="h-3.5 w-3.5" /> Fix all
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onFilterChange({})}
            className={cn(
              "rounded-full px-3 py-1 text-[12px] font-medium ring-1 transition-colors",
              !filter.category && !filter.ruleId
                ? "bg-primary text-primary-foreground ring-primary"
                : "bg-card text-muted-foreground ring-border/70 hover:text-foreground",
            )}
          >
            All
          </button>
          {GEO_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onFilterChange({ category: c.id })}
              className={cn(
                "rounded-full px-3 py-1 text-[12px] font-medium ring-1 transition-colors",
                filter.category === c.id
                  ? "bg-primary text-primary-foreground ring-primary"
                  : "bg-card text-muted-foreground ring-border/70 hover:text-foreground",
              )}
            >
              {c.short}
            </button>
          ))}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          <label className="relative flex min-w-0 flex-1 items-center sm:flex-none">
            <span className="sr-only">Search findings</span>
            <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search findings or pages"
              className="h-8 w-full rounded-full border border-border/70 bg-background/60 pl-8 pr-3 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-primary/25 sm:w-48"
            />
          </label>
          <label className="sr-only" htmlFor="geo-state-filter">
            Workflow state
          </label>
          <select
            id="geo-state-filter"
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value as typeof stateFilter)}
            className="h-8 rounded-full border border-border/70 bg-card px-2.5 text-[12px] outline-none"
          >
            <option value="active">Open & in progress</option>
            {FILTER_STATES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            <option value="all">All states</option>
          </select>
        </div>
      </div>

      {filter.ruleId && (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          Showing one check.
          <button
            type="button"
            onClick={() => onFilterChange({})}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Show all findings
          </button>
        </div>
      )}
      {error && findings && (
        <div role="alert" className="text-[12.5px] text-destructive">
          {error}
        </div>
      )}

      {!findings ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          size="sm"
          title={findings.length ? "Nothing matches these filters" : "No findings in this scan"}
          description={
            findings.length ? "Try another category or state." : "Every applicable check passed."
          }
        />
      ) : (
        <ul className="space-y-2">
          {groups.slice(0, limit).map((g) => {
            const open = openGroup === g.ruleId;
            const sitewide = g.items.every((i) => !i.pageUrl);
            const resolvedCount = g.items.filter((i) => i.state === "resolved").length;
            const canVerify = !SITE_COMPARISON_RULES.has(g.ruleId);
            return (
              <li
                key={g.ruleId}
                className={cn(
                  "overflow-hidden rounded-xl border bg-card/50",
                  open ? "border-foreground/15" : "border-border/60",
                )}
              >
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenGroup(open ? null : g.ruleId)}
                  className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-secondary/40"
                >
                  <PriorityChip priority={g.priority} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium text-foreground">
                      {g.title}
                    </div>
                    <div className="truncate text-[12px] text-muted-foreground">
                      {GEO_CATEGORIES.find((c) => c.id === g.category)?.name} ·{" "}
                      {sitewide
                        ? "site-wide"
                        : `${g.items.length} page${g.items.length === 1 ? "" : "s"}`}
                      {g.pointsLost > 0 && ` · −${g.pointsLost} pts`}
                    </div>
                  </div>
                  <span
                    className="hidden text-[11.5px] text-muted-foreground sm:inline"
                    title={SAFETY_META[g.safety].hint}
                  >
                    {SAFETY_META[g.safety].label}
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                      open && "rotate-180",
                    )}
                  />
                </button>
                {open && (
                  <div className="border-t border-border/40">
                    <div className="flex flex-wrap items-center gap-1.5 px-3.5 pt-2.5">
                      <button
                        type="button"
                        onClick={() => setDetailId(g.items[0].id)}
                        className={cn(ghostBtn, "border-primary/40 px-3 py-1.5 text-[12px]")}
                      >
                        <Wand className="h-3.5 w-3.5" /> Fix this
                      </button>
                      {canVerify ? (
                        <button
                          type="button"
                          disabled={verifyingGroup !== null}
                          onClick={() => void verifyGroup(g)}
                          className={cn(ghostBtn, "px-3 py-1.5 text-[12px]")}
                          title="Re-scan the affected pages; findings resolve only if the check passes"
                        >
                          {verifyingGroup === g.ruleId ? "Starting…" : "Verify fixes"}
                        </button>
                      ) : (
                        <span className="text-[11.5px] text-muted-foreground">
                          Run a full re-scan to verify this check.
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => void updateState(g.items, "dismissed")}
                        className={cn(ghostBtn, "px-3 py-1.5 text-[12px]")}
                      >
                        Dismiss
                      </button>
                      {resolvedCount > 0 && (
                        <Chip tone="success">{resolvedCount} verified resolved</Chip>
                      )}
                    </div>
                    <ul className="divide-y divide-border/40">
                      {g.items.slice(0, 100).map((f) => (
                        <FindingItem
                          key={f.id}
                          finding={f}
                          activity={activity}
                          onAsk={ask}
                          onOpen={(x) => setDetailId(x.id)}
                          onState={(finding, s) => void updateState([finding], s)}
                        />
                      ))}
                    </ul>
                    {g.items.length > 100 && (
                      <div className="px-3.5 py-2 text-[12px] text-muted-foreground">
                        +{g.items.length - 100} more pages with this finding
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {groups.length > limit && (
        <button
          type="button"
          onClick={() => setLimit((n) => n + 40)}
          className={cn(ghostBtn, "w-full px-3 py-2 text-[12.5px]")}
        >
          Show more ({groups.length - limit} remaining)
        </button>
      )}
    </div>
  );
}
