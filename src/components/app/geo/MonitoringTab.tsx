"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Plus, Trash } from "@/components/icons";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { deleteMonitor, listMonitors, saveMonitor } from "@/lib/geo.functions";
import type { GeoMonitor } from "@/lib/geo/contracts";
import {
  Chip,
  displayUrl,
  ghostBtn,
  PanelHeading,
  primaryBtn,
  relativeTime,
  Segmented,
} from "./geo-ui";

/** A drop of this many points between monitored scans is flagged. */
const REGRESSION_POINTS = 5;

export function MonitoringTab({
  workspaceId,
  defaultUrl,
  probesAvailable,
}: {
  workspaceId: string;
  defaultUrl: string;
  probesAvailable: boolean;
}) {
  const [monitors, setMonitors] = useState<GeoMonitor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState(defaultUrl);
  const [cadence, setCadence] = useState<"weekly" | "daily">("weekly");
  const [probes, setProbes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listMonitors({ data: { workspaceId } })
      .then((rows) => !cancelled && setMonitors(rows))
      .catch(
        (e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load monitors"),
      );
    return () => {
      cancelled = true;
    };
  }, [workspaceId, nonce]);

  useEffect(() => setUrl((u) => u || defaultUrl), [defaultUrl]);

  const add = async () => {
    setSaving(true);
    setError(null);
    try {
      const monitor = await saveMonitor({
        data: { workspaceId, url, cadence, active: true, probes: probes && probesAvailable },
      });
      setMonitors((rows) => [...(rows ?? []), monitor]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the monitor");
    } finally {
      setSaving(false);
    }
  };

  const update = async (
    m: GeoMonitor,
    patch: Partial<Pick<GeoMonitor, "active" | "cadence" | "probes">>,
  ) => {
    setError(null);
    try {
      const saved = await saveMonitor({
        data: {
          workspaceId,
          id: m.id,
          url: m.url,
          cadence: patch.cadence ?? m.cadence,
          active: patch.active ?? m.active,
          probes: patch.probes ?? m.probes,
        },
      });
      setMonitors((rows) => rows?.map((r) => (r.id === m.id ? saved : r)) ?? rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update the monitor");
    }
  };

  const remove = async (m: GeoMonitor) => {
    setError(null);
    try {
      await deleteMonitor({ data: { workspaceId, id: m.id } });
      setMonitors((rows) => rows?.filter((r) => r.id !== m.id) ?? rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete the monitor");
    }
  };

  return (
    <div className="space-y-4">
      <PanelHeading
        icon={CalendarClock}
        title="Scheduled rescans"
        hint="Track your score and catch regressions automatically"
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
        className="flex flex-col gap-2 rounded-xl border border-border/60 bg-gradient-to-b from-card/90 to-card/40 shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.05),0_8px_24px_-16px_rgb(0_0_0/0.5)] transition-colors duration-200 hover:border-border p-3 sm:flex-row sm:flex-wrap sm:items-center"
      >
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="yourwebsite.com"
          aria-label="Website to monitor"
          className="h-9 min-w-0 flex-1 rounded-full border border-border/70 bg-background/60 px-3.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
        />
        <Segmented
          label="Cadence"
          value={cadence}
          onChange={setCadence}
          options={[
            { value: "weekly", label: "Weekly" },
            { value: "daily", label: "Daily" },
          ]}
        />
        {probesAvailable && (
          <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <input type="checkbox" checked={probes} onChange={(e) => setProbes(e.target.checked)} />
            Ask AI engines (uses credits)
          </label>
        )}
        <button
          type="submit"
          disabled={!url.trim() || saving}
          className={cn(primaryBtn, "h-9 px-4 text-[12.5px]")}
        >
          <Plus className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Add monitor"}
        </button>
      </form>
      {error && (
        <ErrorState
          size="sm"
          detail={error}
          onRetry={() => {
            setError(null);
            setNonce((n) => n + 1);
          }}
        />
      )}
      {!monitors ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : monitors.length === 0 ? (
        <EmptyState
          size="sm"
          icon={CalendarClock}
          title="No scheduled rescans"
          description="A weekly full scan shows whether fixes land and flags new issues before they cost you citations."
        />
      ) : (
        <ul className="space-y-2">
          {monitors.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-gradient-to-b from-card/90 to-card/40 shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.05),0_8px_24px_-16px_rgb(0_0_0/0.5)] transition-colors duration-200 hover:border-border px-3.5 py-3"
            >
              <div className="min-w-0 flex-1 basis-[200px]">
                <div className="truncate text-[13.5px] font-medium text-foreground">
                  {displayUrl(m.url)}
                </div>
                <div className="text-[12px] text-muted-foreground">
                  {m.active
                    ? `Next run ${relativeTime(m.nextRunAt).replace(" ago", "")}`
                    : "Paused"}
                  {m.lastRunAt ? ` · last run ${relativeTime(m.lastRunAt)}` : ""}
                  {m.probes ? " · with AI answer checks" : ""}
                  {m.lastRunStatus === "error" && m.lastRunError ? ` · ${m.lastRunError}` : ""}
                </div>
              </div>
              {m.lastScoreDelta !== null && (
                <Chip
                  tone={
                    m.lastScoreDelta <= -REGRESSION_POINTS
                      ? "destructive"
                      : m.lastScoreDelta > 0
                        ? "success"
                        : "muted"
                  }
                >
                  {m.lastScoreDelta <= -REGRESSION_POINTS ? "Regressed " : ""}
                  {m.lastScoreDelta > 0 ? "+" : ""}
                  {m.lastScoreDelta} pts last scan
                </Chip>
              )}
              {m.lastRunStatus && (
                <Chip tone={m.lastRunStatus === "ok" ? "success" : "destructive"}>
                  {m.lastRunStatus === "ok" ? "Last run ok" : "Last run failed"}
                </Chip>
              )}
              <Segmented
                label="Cadence"
                value={m.cadence}
                onChange={(c) => void update(m, { cadence: c })}
                options={[
                  { value: "weekly", label: "Weekly" },
                  { value: "daily", label: "Daily" },
                ]}
              />
              {probesAvailable && (
                <button
                  type="button"
                  aria-pressed={m.probes}
                  onClick={() => void update(m, { probes: !m.probes })}
                  className={cn(ghostBtn, "px-3 py-1.5 text-[12px]")}
                >
                  {m.probes ? "AI checks on" : "AI checks off"}
                </button>
              )}
              <button
                type="button"
                onClick={() => void update(m, { active: !m.active })}
                className={cn(ghostBtn, "px-3 py-1.5 text-[12px]")}
              >
                {m.active ? "Pause" : "Resume"}
              </button>
              <button
                type="button"
                onClick={() => void remove(m)}
                className={cn(ghostBtn, "px-2.5 py-1.5 text-[12px]")}
                aria-label="Delete monitor"
              >
                <Trash className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11.5px] text-muted-foreground">
        Scheduled scans use the same page limit as manual scans and run in the background. A
        resolved finding that appears again in a later scan is reopened automatically.
      </p>
    </div>
  );
}
