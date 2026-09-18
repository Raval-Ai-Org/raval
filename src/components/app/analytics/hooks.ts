"use client";

// React Query hooks for the analytics surface. Every key includes the
// workspace id (the provider drops them on workspace switch).
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { addAppEventListener, emitAppEvent, removeAppEventListener } from "@/lib/app-events";
import {
  getAnalyticsInsights,
  getAnalyticsReport,
  refreshAnalyticsInsights,
} from "@/lib/analytics.functions";
import { getGoogleConnection, syncAnalyticsNow } from "@/lib/google-analytics.functions";
import type {
  AiVisibilityReport,
  GoogleConnectionView,
  InsightsView,
  OverviewReport,
  SearchReport,
  WebsiteReport,
} from "@/lib/analytics/types";
import { useServerFn } from "@/lib/use-server-fn";
import { useAnalyticsRange } from "./range";

type SectionMap = {
  overview: OverviewReport;
  website: WebsiteReport;
  search: SearchReport;
  "ai-visibility": AiVisibilityReport;
};

export const analyticsKeys = {
  all: (ws: string | null) => ["analytics", ws] as const,
  report: (ws: string | null, section: string, range: string) =>
    ["analytics", ws, "report", section, range] as const,
  insights: (ws: string | null, range: string) => ["analytics", ws, "insights", range] as const,
  google: (ws: string | null) => ["analytics", ws, "google-connection"] as const,
};

/** Refetch everything analytics when data changes (sync finished, scan finished). */
export function useAnalyticsInvalidation() {
  const ws = useOptionalWorkspaceId();
  const qc = useQueryClient();
  useEffect(() => {
    if (!ws) return;
    const invalidate = () => {
      void qc.invalidateQueries({ queryKey: analyticsKeys.all(ws) });
      void qc.invalidateQueries({ queryKey: ["analytics-summary", ws] });
    };
    addAppEventListener("analytics:changed", invalidate);
    addAppEventListener("geo:audit-complete", invalidate);
    return () => {
      removeAppEventListener("analytics:changed", invalidate);
      removeAppEventListener("geo:audit-complete", invalidate);
    };
  }, [qc, ws]);
}

export function useAnalyticsReport<S extends keyof SectionMap>(section: S) {
  const ws = useOptionalWorkspaceId();
  const { range, key } = useAnalyticsRange();
  const fetcher = useServerFn(getAnalyticsReport);
  return useQuery<SectionMap[S]>({
    queryKey: analyticsKeys.report(ws, section, key),
    enabled: !!ws,
    queryFn: async () => {
      const res = await fetcher({ data: { workspaceId: ws as string, section, range } });
      return res.report as SectionMap[S];
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

export function useGoogleConnection() {
  const ws = useOptionalWorkspaceId();
  const fetcher = useServerFn(getGoogleConnection);
  const qc = useQueryClient();
  const query = useQuery<GoogleConnectionView>({
    queryKey: analyticsKeys.google(ws),
    enabled: !!ws,
    queryFn: () => fetcher({ data: { workspaceId: ws as string } }),
    staleTime: 15_000,
    // Poll while a sync is queued or running.
    refetchInterval: (q) => {
      const d = q.state.data;
      const busy = [d?.ga4?.run, d?.gsc?.run].some(
        (r) => r && (r.status === "queued" || r.status === "running"),
      );
      return busy ? 4000 : false;
    },
  });
  // When a running sync finishes, refresh every report.
  const busy = [query.data?.ga4?.run, query.data?.gsc?.run]
    .map((r) => (r && (r.status === "queued" || r.status === "running") ? r.id : ""))
    .join("|");
  useEffect(() => {
    return () => {
      if (busy.replace(/\|/g, "")) {
        void qc.invalidateQueries({ queryKey: analyticsKeys.all(ws) });
      }
    };
  }, [busy, qc, ws]);
  return query;
}

export function useSyncNow() {
  const ws = useOptionalWorkspaceId();
  const fn = useServerFn(syncAnalyticsNow);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fn({ data: { workspaceId: ws as string } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: analyticsKeys.google(ws) });
    },
  });
}

export function useInsights() {
  const ws = useOptionalWorkspaceId();
  const { range, key } = useAnalyticsRange();
  const fetcher = useServerFn(getAnalyticsInsights);
  return useQuery<InsightsView>({
    queryKey: analyticsKeys.insights(ws, key),
    enabled: !!ws,
    queryFn: () => fetcher({ data: { workspaceId: ws as string, range } }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

export function useRefreshInsights() {
  const ws = useOptionalWorkspaceId();
  const { range, key } = useAnalyticsRange();
  const fn = useServerFn(refreshAnalyticsInsights);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fn({ data: { workspaceId: ws as string, range } }),
    onSuccess: (view) => {
      qc.setQueryData(analyticsKeys.insights(ws, key), view);
      emitAppEvent("analytics:changed");
    },
  });
}
