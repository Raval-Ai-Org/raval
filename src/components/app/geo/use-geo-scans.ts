"use client";

// State for the AI Visibility panel: scan history, the scan being viewed, and
// the scan in progress. Progress is read-only polling of GET /api/geo/scans/:id
// (paused while the tab is hidden); the crawl itself runs on the server.

import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/authed-fetch";
import { emitAppEvent } from "@/lib/app-events";
import { listScans } from "@/lib/geo.functions";
import { useVisibleInterval } from "@/hooks/use-visible-interval";
import type { GeoScanMode, GeoScanSummary, GeoScanView } from "@/lib/geo/contracts";

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  const text = await res.text();
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const isActive = (s: { status: string }) => s.status === "queued" || s.status === "running";

function errorStatus(error: unknown): number | null {
  return error && typeof error === "object" && "status" in error
    ? typeof error.status === "number"
      ? error.status
      : null
    : null;
}

export function useGeoScans(workspaceId: string) {
  const [history, setHistory] = useState<GeoScanSummary[] | null>(null);
  const [current, setCurrent] = useState<GeoScanView | null>(null);
  const [active, setActive] = useState<GeoScanView | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchScan = useCallback(
    async (id: string): Promise<GeoScanView> => {
      const res = await authedFetch(
        `/api/geo/scans/${id}?workspaceId=${encodeURIComponent(workspaceId)}`,
      );
      const json = await readJson(res);
      if (!res.ok) {
        const error = new Error(
          (json?.error as string) ?? `Couldn't load the scan (${res.status})`,
        );
        Object.assign(error, { status: res.status });
        throw error;
      }
      return json!.scan as GeoScanView;
    },
    [workspaceId],
  );

  const refreshHistory = useCallback(async () => {
    const rows = await listScans({ data: { workspaceId, limit: 30 } });
    setHistory(rows);
    return rows;
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setCurrent(null);
    setActive(null);
    setError(null);
    (async () => {
      try {
        const rows = await refreshHistory();
        const running = rows.find(isActive);
        const completed = rows.filter((r) => r.status === "succeeded");
        const loadOptional = async (id: string) => {
          try {
            return await fetchScan(id);
          } catch (error) {
            if (errorStatus(error) === 404) return null;
            throw error;
          }
        };
        const [runningView, latestView] = await Promise.all([
          running ? loadOptional(running.id) : null,
          completed.reduce<Promise<GeoScanView | null>>(
            async (promise, summary) => (await promise) ?? loadOptional(summary.id),
            Promise.resolve(null),
          ),
        ]);
        if (cancelled) return;
        setActive(runningView && isActive(runningView) ? runningView : null);
        setCurrent(latestView);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Couldn't load AI Visibility scans");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, refreshHistory, fetchScan]);

  const settle = useCallback(
    async (scan: GeoScanView) => {
      setActive(null);
      if (scan.status === "succeeded") {
        setCurrent(scan);
        emitAppEvent("geo:audit-complete");
      } else if (scan.status === "failed") {
        setError(scan.error ?? "The scan failed. Try again in a few minutes.");
      }
      await refreshHistory().catch(() => undefined);
    },
    [refreshHistory],
  );

  useVisibleInterval(
    () => {
      if (!active) return;
      fetchScan(active.id)
        .then((scan) => (isActive(scan) ? setActive(scan) : void settle(scan)))
        .catch(() => undefined);
    },
    2000,
    [active?.id],
  );

  const start = useCallback(
    async (opts: {
      url: string;
      mode: GeoScanMode;
      probes?: boolean;
      trigger?: "manual" | "chat";
    }) => {
      setStarting(true);
      setError(null);
      try {
        const res = await authedFetch("/api/geo/scans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, ...opts }),
        });
        const json = await readJson(res);
        if (res.status === 409 && typeof json?.activeScanId === "string") {
          setActive(await fetchScan(json.activeScanId));
          setError((json.error as string) ?? "A scan is already running.");
          return;
        }
        if (!res.ok) throw new Error((json?.error as string) ?? `Scan failed (${res.status})`);
        const scan = json!.scan as GeoScanView;
        if (isActive(scan)) {
          setActive(scan);
          await refreshHistory().catch(() => undefined);
        } else {
          await settle(scan);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Scan failed");
      } finally {
        setStarting(false);
      }
    },
    [workspaceId, fetchScan, refreshHistory, settle],
  );

  const cancel = useCallback(async () => {
    if (!active) return;
    const res = await authedFetch(`/api/geo/scans/${active.id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    });
    const json = await readJson(res);
    if (!res.ok) {
      setError((json?.error as string) ?? "Couldn't cancel the scan");
      return;
    }
    const scan = json?.scan as GeoScanView | undefined;
    if (scan && !isActive(scan)) await settle(scan);
    else if (scan) setActive(scan);
  }, [active, workspaceId, settle]);

  const view = useCallback(
    async (id: string) => {
      try {
        setCurrent(await fetchScan(id));
      } catch (e) {
        if (errorStatus(e) === 404) {
          setHistory((rows) => rows?.filter((scan) => scan.id !== id) ?? null);
          return;
        }
        setError(e instanceof Error ? e.message : "Couldn't load that scan");
      }
    },
    [fetchScan],
  );

  return {
    history,
    current,
    active,
    loading,
    starting,
    error,
    setError,
    start,
    cancel,
    view,
    refreshHistory,
  };
}
