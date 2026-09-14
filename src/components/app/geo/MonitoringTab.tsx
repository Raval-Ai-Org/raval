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

export function MonitoringTab({
  workspaceId,
  defaultUrl,
}: {
  workspaceId: string;
  defaultUrl: string;
}) {
  const [monitors, setMonitors] = useState<GeoMonitor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState(defaultUrl);
  const [cadence, setCadence] = useState<"weekly" | "daily">("weekly");
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
      const monitor = await saveMonitor({ data: { workspaceId, url, cadence, active: true } });
      setMonitors((rows) => [...(rows ?? []), monitor]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the monitor");
    } finally {
      setSaving(false);
    }
  };

  const update = async (m: GeoMonitor, patch: Partial<Pick<GeoMonitor, "active" | "cadence">>) => {
    setError(null);
    try {
      const saved = await saveMonitor({
        data: {
          workspaceId,
          id: m.id,
          url: m.url,
          cadence: patch.cadence ?? m.cadence,
          active: patch.active ?? m.active,
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
        className="flex flex-col gap-2 rounded-xl border border-border/60 bg-card/50 p-3 sm:flex-row sm:items-center"
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
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-card/50 px-3.5 py-3"
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
                  {m.lastRunStatus === "error" && m.lastRunError ? ` · ${m.lastRunError}` : ""}
                </div>
              </div>
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
        Scheduled scans use the same page limit as manual scans and run in the background.
      </p>
    </div>
  );
}
