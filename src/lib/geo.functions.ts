"use client";

// Browser-facing surface for the `geo` server functions (AI Visibility).
// Each export is an RPC stub dispatched to /api/rpc/geo/<name>; the
// implementations live in src/server/fns/geo.ts and never reach the bundle.
// Scan creation, status and cancellation are REST routes under /api/geo/scans.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/geo";

export const listScans = serverFn<typeof Handlers.listScans>("geo/listScans");
export const getScanFindings = serverFn<typeof Handlers.getScanFindings>("geo/getScanFindings");
export const getScanPages = serverFn<typeof Handlers.getScanPages>("geo/getScanPages");
export const getScanPage = serverFn<typeof Handlers.getScanPage>("geo/getScanPage");
export const compareScans = serverFn<typeof Handlers.compareScans>("geo/compareScans");
export const setFindingState = serverFn<typeof Handlers.setFindingState>("geo/setFindingState");
export const listMonitors = serverFn<typeof Handlers.listMonitors>("geo/listMonitors");
export const saveMonitor = serverFn<typeof Handlers.saveMonitor>("geo/saveMonitor");
export const deleteMonitor = serverFn<typeof Handlers.deleteMonitor>("geo/deleteMonitor");
export const getGeoSettings = serverFn<typeof Handlers.getGeoSettings>("geo/getGeoSettings");
