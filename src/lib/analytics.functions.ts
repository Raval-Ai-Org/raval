"use client";

// Browser-facing surface for the `analytics` server functions. Each export is an
// RPC stub with the same call signature as before — `await fn({ data })` —
// dispatched to /api/rpc/analytics/<name>. The implementations live in
// src/server/fns/analytics.ts and never reach the client bundle.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/analytics";

export type { AnalyticsSummary, DrilldownItem } from "@/server/fns/analytics";

export const getAnalyticsSummary = serverFn<typeof Handlers.getAnalyticsSummary>(
  "analytics/getAnalyticsSummary",
);
export const getAnalyticsDrilldown = serverFn<typeof Handlers.getAnalyticsDrilldown>(
  "analytics/getAnalyticsDrilldown",
);
export const getAnalyticsReport = serverFn<typeof Handlers.getAnalyticsReport>(
  "analytics/getAnalyticsReport",
);
export const getAnalyticsInsights = serverFn<typeof Handlers.getAnalyticsInsights>(
  "analytics/getAnalyticsInsights",
);
export const refreshAnalyticsInsights = serverFn<typeof Handlers.refreshAnalyticsInsights>(
  "analytics/refreshAnalyticsInsights",
);
export const getAnalyticsChatContext = serverFn<typeof Handlers.getAnalyticsChatContext>(
  "analytics/getAnalyticsChatContext",
);
