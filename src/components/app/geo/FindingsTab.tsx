"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { ChevronDown, ExternalLink, MessageSquare, Search, Wand } from "@/components/icons";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { emitAppEvent } from "@/lib/app-events";
import { cn } from "@/lib/utils";
import { getScanFindings, setFindingState } from "@/lib/geo.functions";
import type { FindingWorkflowState, GeoFindingView, GeoScanView } from "@/lib/geo/contracts";
import { fixRecipeFor } from "@/lib/geo/fix-recipes";
import { GEO_CATEGORIES, type GeoCategoryId, type Priority } from "@/lib/geo/types";
import { FixDrawer } from "./FixDrawer";
import {
  Chip,
  displayUrl,
  ghostBtn,
  pathOf,
  PriorityChip,
  SAFETY_META,
  StatusGlyph,
} from "./geo-ui";

export type FindingsFilter = { category?: GeoCategoryId; ruleId?: string };

const STATE_OPTIONS: { value: FindingWorkflowState; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" },
];
const PRIORITY_RANK: Record<Priority, number> = { critical: 3, high: 2, medium: 1, low: 0 };

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

function EvidenceList({ evidence }: { evidence: Record<string, unknown> }) {
  const entries = Object.entries(evidence).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );
  if (!entries.length) return null;
  return (
    <dl className="mt-1.5 grid gap-1 rounded-lg bg-background/70 p-2 text-[11.5px]">
      {entries.slice(0, 8).map(([k, v]) => (
        <div key={k} className="grid grid-cols-[minmax(80px,140px)_1fr] gap-2">
          <dt className="truncate text-muted-foreground">
            {k.replace(/([A-Z])/g, " $1").replace(/_/g, " ")}
          </dt>
          <dd className="min-w-0 break-words font-mono text-foreground/85">
            {typeof v === "string" || typeof v === "number" || typeof v === "boolean"
              ? String(v)
              : JSON.stringify(v, null, 0).slice(0, 400)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function FindingItem({
  finding,
  onState,
  onAsk,
}: {
  finding: GeoFindingView;
  onState: (f: GeoFindingView, s: FindingWorkflowState) => void;
  onAsk: (f: GeoFindingView) => void;
}) {
  const [showEvidence, setShowEvidence] = useState(false);
  return (
    <li
      className={cn(
        "px-3.5 py-2.5",
        (finding.state === "resolved" || finding.state === "dismissed") && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
        <StatusGlyph status={finding.status} className="mt-0.5" />
        <div className="min-w-0 flex-1 basis-[220px]">
          <div className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium text-foreground/90">
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
          </div>
          <div className="mt-0.5 break-words text-[12.5px] leading-relaxed text-muted-foreground">
            {finding.detail}
          </div>
          {Object.keys(finding.evidence).length > 0 && (
            <button
              type="button"
              onClick={() => setShowEvidence((v) => !v)}
              className="mt-1 text-[11.5px] font-medium text-primary underline-offset-2 hover:underline"
            >
              {showEvidence ? "Hide evidence" : "Show evidence"}
            </button>
          )}
          {showEvidence && <EvidenceList evidence={finding.evidence} />}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <label className="sr-only" htmlFor={`state-${finding.id}`}>
            Status
          </label>
          <select
            id={`state-${finding.id}`}
            value={finding.state}
            onChange={(e) => onState(finding, e.target.value as FindingWorkflowState)}
            className="h-8 rounded-full border border-border/70 bg-card px-2.5 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            {STATE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
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
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [stateFilter, setStateFilter] = useState<"active" | FindingWorkflowState | "all">("active");
  const [query, setQuery] = useState("");
  const [openGroup, setOpenGroup] = useState<string | null>(filter.ruleId ?? null);
  const [fixOpen, setFixOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(40);

  useEffect(() => {
    let cancelled = false;
    setFindings(null);
    setError(null);
    getScanFindings({ data: { workspaceId, scanId: scan.id } })
      .then((rows) => !cancelled && setFindings(rows))
      .catch(
        (e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load findings"),
      );
    return () => {
      cancelled = true;
    };
  }, [workspaceId, scan.id, nonce]);

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

  const updateState = async (targets: GeoFindingView[], state: FindingWorkflowState) => {
    const fingerprints = new Set(targets.map((t) => t.fingerprint));
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

  const ask = (f: GeoFindingView) =>
    emitAppEvent("chat:prefill", {
      text: `Help me fix this AI visibility finding on ${f.pageUrl ?? displayUrl(scan.origin)}: "${f.title}" — ${f.detail} Give me exact changes.`,
      focus: true,
    });

  if (error && !findings)
    return <ErrorState size="sm" detail={error} onRetry={() => setNonce((n) => n + 1)} />;

  return (
    <div className="space-y-3">
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
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="relative flex items-center">
            <span className="sr-only">Search findings</span>
            <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search findings or pages"
              className="h-8 w-48 rounded-full border border-border/70 bg-background/60 pl-8 pr-3 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
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
            {STATE_OPTIONS.map((o) => (
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
            const recipe = g.fixId
              ? fixRecipeFor(g.fixId, {
                  url: scan.origin,
                  pageUrl: g.items.find((i) => i.pageUrl)?.pageUrl,
                  brandName,
                  description: scan.report?.snapshot.description,
                })
              : null;
            const sitewide = g.items.every((i) => !i.pageUrl);
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
                      {recipe && (
                        <button
                          type="button"
                          onClick={() => setFixOpen(fixOpen === g.ruleId ? null : g.ruleId)}
                          className={cn(ghostBtn, "px-3 py-1.5 text-[12px]")}
                        >
                          <Wand className="h-3.5 w-3.5" />{" "}
                          {fixOpen === g.ruleId ? "Hide fix" : "Show fix"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void updateState(g.items, "resolved")}
                        className={cn(ghostBtn, "px-3 py-1.5 text-[12px]")}
                      >
                        Mark all resolved
                      </button>
                      <button
                        type="button"
                        onClick={() => void updateState(g.items, "dismissed")}
                        className={cn(ghostBtn, "px-3 py-1.5 text-[12px]")}
                      >
                        Dismiss
                      </button>
                      {g.items.some((i) => i.state !== "open") && (
                        <Chip tone="muted">
                          {g.items.filter((i) => i.state === "resolved").length} resolved
                        </Chip>
                      )}
                    </div>
                    <AnimatePresence initial={false}>
                      {fixOpen === g.ruleId && recipe && (
                        <div className="pt-2.5">
                          <FixDrawer recipe={recipe} safety={g.safety} />
                        </div>
                      )}
                    </AnimatePresence>
                    <ul className="divide-y divide-border/40">
                      {g.items.slice(0, 100).map((f) => (
                        <FindingItem
                          key={f.id}
                          finding={f}
                          onAsk={ask}
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
