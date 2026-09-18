"use client";

// Browser-facing surface for the `google-analytics` server functions (Google
// Analytics 4 + Search Console connector). RPC stubs dispatched to
// /api/rpc/google-analytics/<name>; implementations live in
// src/server/fns/google-analytics.ts. No token ever comes back.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/google-analytics";

export const getGoogleConnection = serverFn<typeof Handlers.getGoogleConnection>(
  "google-analytics/getGoogleConnection",
);
export const startGoogleConnect = serverFn<typeof Handlers.startGoogleConnect>(
  "google-analytics/startGoogleConnect",
);
export const completeGoogleConnect = serverFn<typeof Handlers.completeGoogleConnect>(
  "google-analytics/completeGoogleConnect",
);
export const listGa4Properties = serverFn<typeof Handlers.listGa4Properties>(
  "google-analytics/listGa4Properties",
);
export const listGscSites = serverFn<typeof Handlers.listGscSites>("google-analytics/listGscSites");
export const selectGa4Property = serverFn<typeof Handlers.selectGa4Property>(
  "google-analytics/selectGa4Property",
);
export const selectGscSite = serverFn<typeof Handlers.selectGscSite>(
  "google-analytics/selectGscSite",
);
export const removeAnalyticsSource = serverFn<typeof Handlers.removeAnalyticsSource>(
  "google-analytics/removeAnalyticsSource",
);
export const disconnectGoogle = serverFn<typeof Handlers.disconnectGoogle>(
  "google-analytics/disconnectGoogle",
);
export const syncAnalyticsNow = serverFn<typeof Handlers.syncAnalyticsNow>(
  "google-analytics/syncAnalyticsNow",
);
export const getSyncStatus = serverFn<typeof Handlers.getSyncStatus>(
  "google-analytics/getSyncStatus",
);
