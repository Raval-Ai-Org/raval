"use client";

// PriorityLanes — open findings sorted into what to do next: critical, what
// Mellox can fix, quick wins, high impact, and manual work. Loads the scan's
// real findings; each row opens the finding's evidence and fix workflow.

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Wand } from "@/components/icons";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { getScanFindings } from "@/lib/geo.functions";
import type { GeoFindingView } from "@/lib/geo/contracts";
import { groupByLane, LANES, type LaneId } from "@/lib/geo/lanes";
import { cn } from "@/lib/utils";
import { Chip, pathOf, PriorityChip } from "../geo-ui";

const LANE_TONE: Record<LaneId, "destructive" | "primary" | "success" | "warning" | "muted"> = {
  critical: "destructive",
  auto_fixable: "primary",
  quick_wins: "success",
  high_impact: "warning",
  manual: "muted",
};

export function useScanFindings(workspaceId: string, scanId: string) {
  const [findings, setFindings] = useState<GeoFindingView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    getScanFindings({ data: { workspaceId, scanId } })
      .then((rows) => !cancelled && setFindings(rows))
      .catch(
        (e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load findings"),
      );
    return () => {
      cancelled = true;
    };
  }, [workspaceId, scanId, nonce]);
  return { findings, error, reload: () => setNonce((n) => n + 1) };
}

export function PriorityLanes({
  findings,
  error,
  onRetry,
  onOpenFinding,
}: {
  findings: GeoFindingView[] | null;
  error: string | null;
  onRetry: () => void;
  onOpenFinding: (f: GeoFindingView) => void;
}) {
  const lanes = useMemo(() => (findings ? groupByLane(findings) : null), [findings]);
  const [open, setOpen] = useState<LaneId | null>("critical");
  if (error && !findings) return <ErrorState size="sm" detail={error} onRetry={onRetry} />;
  if (!lanes) return <Skeleton className="h-40 w-full rounded-2xl" />;
  const total = Object.values(lanes).reduce((s, l) => s + l.length, 0);
  if (!total)
    return (
      <EmptyState
        size="sm"
        title="Nothing left to do"
        description="No open findings in this scan."
      />
    );
  return (
    <div className="space-y-2">
      {LANES.map((lane) => {
        const items = lanes[lane.id];
        const expanded = open === lane.id && items.length > 0;
        return (
          <div
            key={lane.id}
            className={cn(
              "overflow-hidden rounded-xl border bg-card/50",
              expanded ? "border-foreground/15" : "border-border/60",
            )}
          >
            <button
              type="button"
              aria-expanded={expanded}
              disabled={!items.length}
              onClick={() => setOpen(expanded ? null : lane.id)}
              className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-secondary/40 disabled:cursor-default disabled:opacity-60"
            >
              <Chip tone={LANE_TONE[lane.id]}>{items.length}</Chip>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">{lane.name}</div>
                <div className="truncate text-[11.5px] text-muted-foreground">{lane.hint}</div>
              </div>
              {items.length > 0 && (
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform",
                    expanded && "rotate-180",
                  )}
                />
              )}
            </button>
            {expanded && (
              <ul className="divide-y divide-border/40 border-t border-border/40">
                {items.slice(0, 8).map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => onOpenFinding(f)}
                      className="flex w-full items-start gap-2.5 px-3.5 py-2 text-left hover:bg-secondary/30"
                    >
                      <PriorityChip priority={f.priority} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] font-medium">{f.title}</div>
                        <div className="truncate text-[11.5px] text-muted-foreground">
                          {pathOf(f.pageUrl)} · {f.detail}
                        </div>
                      </div>
                      {f.fixMode !== "manual" && (
                        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-primary">
                          <Wand className="h-3 w-3" /> Fixable
                        </span>
                      )}
                      {f.pointImpact > 0 && (
                        <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
                          −{f.pointImpact}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
                {items.length > 8 && (
                  <li className="px-3.5 py-1.5 text-[11.5px] text-muted-foreground">
                    +{items.length - 8} more in Findings
                  </li>
                )}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
