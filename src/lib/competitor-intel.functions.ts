"use client";

// Browser-facing surface for the `competitor-intel` server functions. Each
// export is an RPC stub with the same call signature as before —
// `await fn({ data })` — dispatched to /api/rpc/competitor-intel/<name>. The
// implementations live in src/server/fns/competitor-intel.ts and never reach
// the client bundle.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/competitor-intel";

export type { CompetitorIntelRun } from "@/server/research/competitor-intel.server";

export const startCompetitorIntel = serverFn<typeof Handlers.startCompetitorIntel>(
  "competitor-intel/startCompetitorIntel",
);
export const getCompetitorIntelRun = serverFn<typeof Handlers.getCompetitorIntelRun>(
  "competitor-intel/getCompetitorIntelRun",
);
export const listCompetitorIntelRuns = serverFn<typeof Handlers.listCompetitorIntelRuns>(
  "competitor-intel/listCompetitorIntelRuns",
);
