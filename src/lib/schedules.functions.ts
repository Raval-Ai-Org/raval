"use client";

// Browser-facing surface for the `schedules` server functions. Each export is an
// RPC stub with the same call signature as before — `await fn({ data })` —
// dispatched to /api/rpc/schedules/<name>. The implementations live in
// src/server/fns/schedules.ts and never reach the client bundle.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/schedules";

export type { ScheduledJob } from "@/server/fns/schedules";

export const listScheduledJobs = serverFn<typeof Handlers.listScheduledJobs>(
  "schedules/listScheduledJobs",
);
export const createScheduledJob = serverFn<typeof Handlers.createScheduledJob>(
  "schedules/createScheduledJob",
);
export const updateScheduledJob = serverFn<typeof Handlers.updateScheduledJob>(
  "schedules/updateScheduledJob",
);
export const deleteScheduledJob = serverFn<typeof Handlers.deleteScheduledJob>(
  "schedules/deleteScheduledJob",
);
export const runScheduledJobNow = serverFn<typeof Handlers.runScheduledJobNow>(
  "schedules/runScheduledJobNow",
);
