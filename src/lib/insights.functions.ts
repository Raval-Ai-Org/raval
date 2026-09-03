"use client";

// Browser-facing surface for the `insights` server functions. Each export is an
// RPC stub with the same call signature as before — `await fn({ data })` —
// dispatched to /api/rpc/insights/<name>. The implementations live in
// src/server/fns/insights.ts and never reach the client bundle.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/insights";

export type { SmartSuggestion } from "@/server/fns/insights";

export const persistGeoAudit = serverFn<typeof Handlers.persistGeoAudit>(
  "insights/persistGeoAudit",
);
export const getGeoTrend = serverFn<typeof Handlers.getGeoTrend>("insights/getGeoTrend");
export const refreshSuggestions = serverFn<typeof Handlers.refreshSuggestions>(
  "insights/refreshSuggestions",
);
export const upsertMemoryInsights = serverFn<typeof Handlers.upsertMemoryInsights>(
  "insights/upsertMemoryInsights",
);
export const listMemoryInsights = serverFn<typeof Handlers.listMemoryInsights>(
  "insights/listMemoryInsights",
);
