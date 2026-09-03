"use client";

// Browser-facing surface for the `competitor-watch` server functions. Each export is an
// RPC stub with the same call signature as before — `await fn({ data })` —
// dispatched to /api/rpc/competitor-watch/<name>. The implementations live in
// src/server/fns/competitor-watch.ts and never reach the client bundle.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/competitor-watch";

export type { CompetitorWatch, CompetitorAlert } from "@/server/fns/competitor-watch";

export const listCompetitorWatches = serverFn<typeof Handlers.listCompetitorWatches>(
  "competitor-watch/listCompetitorWatches",
);
export const addCompetitorWatch = serverFn<typeof Handlers.addCompetitorWatch>(
  "competitor-watch/addCompetitorWatch",
);
export const removeCompetitorWatch = serverFn<typeof Handlers.removeCompetitorWatch>(
  "competitor-watch/removeCompetitorWatch",
);
export const toggleCompetitorWatch = serverFn<typeof Handlers.toggleCompetitorWatch>(
  "competitor-watch/toggleCompetitorWatch",
);
export const runCompetitorWatchNow = serverFn<typeof Handlers.runCompetitorWatchNow>(
  "competitor-watch/runCompetitorWatchNow",
);
export const listCompetitorAlerts = serverFn<typeof Handlers.listCompetitorAlerts>(
  "competitor-watch/listCompetitorAlerts",
);
export const markCompetitorAlertsRead = serverFn<typeof Handlers.markCompetitorAlertsRead>(
  "competitor-watch/markCompetitorAlertsRead",
);
