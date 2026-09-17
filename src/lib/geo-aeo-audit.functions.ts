"use client";

// Browser-facing surface for the `geo-aeo-audit` server function. Dispatched
// to /api/rpc/geo-aeo-audit/<name>. The implementation lives in
// src/server/fns/geo-aeo-audit.ts and never reaches the client bundle.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/geo-aeo-audit";

export const runGeoAeoAudit = serverFn<typeof Handlers.runGeoAeoAudit>(
  "geo-aeo-audit/runGeoAeoAudit",
);
