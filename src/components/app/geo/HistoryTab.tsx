"use client";

import { Spinner } from "@/components/icons";
import { useState } from "react";
import { ArrowDown, ArrowUp, History, LineChart } from "@/components/icons";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { compareScans } from "@/lib/geo.functions";
import type { GeoScanSummary } from "@/lib/geo/contracts";
import type { ScanComparison } from "@/lib/geo/compare";
import {
  Chip,
  displayUrl,
  ghostBtn,
  pathOf,
  PanelHeading,
  primaryBtn,
  relativeTime,
  scoreTone,
  TONE,
} from "./geo-ui";

const STATUS_TONE = {
  succeeded: "success",
  failed: "destructive",
  cancelled: "muted",
  queued: "primary",
  running: "primary",
} as const;

function ComparisonView({
  comparison,
  onClose,
}: {
  comparison: ScanComparison;
  onClose: () => void;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-border/60 bg-gradient-to-b from-card/90 to-card/40 shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.05),0_8px_24px_-16px_rgb(0_0_0/0.5)] transition-colors duration-200 hover:border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[14px] font-semibold text-foreground">{comparison.summary}</div>
          <div className="text-[12px] text-muted-foreground">
            {new Date(comparison.base.createdAt).toLocaleString()} →{" "}
            {new Date(comparison.target.createdAt).toLocaleString()}
          </div>
        </div>
        <button type="button" onClick={onClose} className={cn(ghostBtn, "px-3 py-1.5 text-[12px]")}>
          Close
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {comparison.categories.map((c) => (
          <div
            key={c.id}
            className="rounded-lg border border-border/60 bg-background/50 px-2.5 py-2"
          >
            <div className="truncate text-[11px] text-muted-foreground">{c.name}</div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[15px] font-semibold tabular-nums text-foreground">
                {c.after ?? "—"}
              </span>
              {c.delta !== null && c.delta !== 0 && (
                <span
                  className={cn(
                    "text-[11.5px] font-semibold tabular-nums",
                    c.delta > 0 ? "text-success" : "text-destructive",
                  )}
                >
                  {c.delta > 0 ? "+" : ""}
                  {c.delta}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {[
          {
            title: `Resolved (${comparison.resolvedFindings.length})`,
            items: comparison.resolvedFindings,
            tone: "success" as const,
          },
          {
            title: `New (${comparison.newFindings.length})`,
            items: comparison.newFindings,
            tone: "destructive" as const,
          },
        ].map((col) => (
          <div
            key={col.title}
            className="min-w-0 rounded-xl border border-border/60 bg-gradient-to-b from-background/80 to-muted/20 shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.05),0_8px_24px_-16px_rgb(0_0_0/0.5)] transition-colors duration-200 hover:border-border p-3"
          >
            <div className={cn("mb-1.5 text-[12.5px] font-semibold", TONE[col.tone].text)}>
              {col.title}
            </div>
            {col.items.length ? (
              <ul className="max-h-64 space-y-1.5 overflow-auto">
                {col.items.map((f) => (
                  <li key={f.fingerprint} className="text-[12.5px]">
                    <div className="font-medium text-foreground/90">{f.title}</div>
                    <div className="truncate text-muted-foreground">{pathOf(f.pageUrl)}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-[12.5px] text-muted-foreground">None</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function HistoryTab({
  workspaceId,
  history,
  currentId,
  onView,
}: {
  workspaceId: string;
  history: GeoScanSummary[] | null;
  currentId: string | null;
  onView: (id: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [comparison, setComparison] = useState<ScanComparison | null>(null);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const completed = (history ?? []).filter((s) => s.status === "succeeded");

  const runCompare = async (ids: string[]) => {
    const [a, b] = ids
      .map((id) => completed.find((s) => s.id === id)!)
      .sort((x, y) => x.createdAt.localeCompare(y.createdAt));
    setComparing(true);
    setError(null);
    try {
      setComparison(
        await compareScans({ data: { workspaceId, baseScanId: a.id, targetScanId: b.id } }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't compare scans");
    } finally {
      setComparing(false);
    }
  };

  const compareWithPrevious = (scan: GeoScanSummary) => {
    const previous = completed.find((s) => s.host === scan.host && s.createdAt < scan.createdAt);
    if (previous) void runCompare([previous.id, scan.id]);
  };

  if (!history) return null;
  if (!history.length) {
    return (
      <EmptyState
        size="sm"
        icon={History}
        title="No scans yet"
        description="Your scan history and comparisons appear here."
      />
    );
  }

  return (
    <div className="space-y-4">
      {comparison && <ComparisonView comparison={comparison} onClose={() => setComparison(null)} />}
      {error && <ErrorState size="sm" detail={error} />}
      <PanelHeading
        icon={LineChart}
        title="Scan history"
        hint="Select two completed scans to compare"
        action={
          <button
            type="button"
            disabled={selected.length !== 2 || comparing}
            onClick={() => void runCompare(selected)}
            className={cn(primaryBtn, "px-3 py-1.5 text-[12px]")}
          >
            {comparing ? (
              <>
                <Spinner className="h-3.5 w-3.5 animate-spin" aria-hidden /> Comparing…
              </>
            ) : (
              "Compare selected"
            )}
          </button>
        }
      />
      <div className="overflow-x-auto rounded-xl border border-border/60">
        <table className="w-full min-w-[620px] text-left text-[12.5px]">
          <thead className="bg-card/70 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="w-8 px-3 py-2" />
              <th className="px-3 py-2 font-medium">When</th>
              <th className="px-3 py-2 font-medium">Site</th>
              <th className="px-3 py-2 font-medium">Scan</th>
              <th className="px-3 py-2 font-medium">Score</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {history.map((s, i) => {
              const prev = history
                .slice(i + 1)
                .find((p) => p.host === s.host && p.status === "succeeded");
              const delta =
                s.overallScore !== null && prev?.overallScore != null
                  ? s.overallScore - prev.overallScore
                  : null;
              const checked = selected.includes(s.id);
              return (
                <tr key={s.id} className={cn(s.id === currentId && "bg-primary/5")}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Select for comparison"
                      disabled={s.status !== "succeeded" || (!checked && selected.length >= 2)}
                      checked={checked}
                      onChange={() =>
                        setSelected((v) => (checked ? v.filter((x) => x !== s.id) : [...v, s.id]))
                      }
                      className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
                    />
                  </td>
                  <td
                    className="px-3 py-2 text-foreground/85"
                    title={new Date(s.createdAt).toLocaleString()}
                  >
                    {relativeTime(s.createdAt)}
                  </td>
                  <td className="max-w-[200px] truncate px-3 py-2 text-foreground/85">
                    {displayUrl(s.host)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Chip tone={STATUS_TONE[s.status]}>{s.status}</Chip>
                      <span className="text-muted-foreground">
                        {s.mode === "quick" ? "Homepage" : `${s.pagesCrawled} pages`}
                        {s.trigger === "scheduled" ? " · scheduled" : ""}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {s.overallScore === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className={cn(
                            "font-semibold tabular-nums",
                            TONE[scoreTone(s.overallScore)].text,
                          )}
                        >
                          {s.overallScore}
                        </span>
                        {delta !== null && delta !== 0 && (
                          <span
                            className={cn(
                              "inline-flex items-center text-[11.5px] font-semibold",
                              delta > 0 ? "text-success" : "text-destructive",
                            )}
                          >
                            {delta > 0 ? (
                              <ArrowUp className="h-3 w-3" />
                            ) : (
                              <ArrowDown className="h-3 w-3" />
                            )}
                            {Math.abs(delta)}
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {s.status === "succeeded" && (
                      <div className="flex justify-end gap-1.5">
                        {s.id !== currentId && (
                          <button
                            type="button"
                            onClick={() => onView(s.id)}
                            className={cn(ghostBtn, "px-2.5 py-1 text-[11.5px]")}
                          >
                            View
                          </button>
                        )}
                        {prev && (
                          <button
                            type="button"
                            onClick={() => compareWithPrevious(s)}
                            className={cn(ghostBtn, "px-2.5 py-1 text-[11.5px]")}
                          >
                            vs previous
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
