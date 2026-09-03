"use client";

// Browser-facing surface for the `coach` server functions. Each export is an
// RPC stub with the same call signature as before — `await fn({ data })` —
// dispatched to /api/rpc/coach/<name>. The implementations live in
// src/server/fns/coach.ts and never reach the client bundle.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/coach";

export type { CoachIntent, CoachAction, CoachInsight, CoachBriefing } from "@/server/fns/coach";

export const getCoachBriefing =
  serverFn<typeof Handlers.getCoachBriefing>("coach/getCoachBriefing");
