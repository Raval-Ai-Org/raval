"use client";

// Browser-facing surface for the `geo-agent` server functions (Mellox GEO
// Engineer). RPC stubs dispatched to /api/rpc/geo-agent/<name>; the
// implementations live in src/server/fns/geo-agent.ts. Runs come back as
// reviewable plans, diffs and an activity log — never tokens or raw file text.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/geo-agent";

export const startAgentRun = serverFn<typeof Handlers.startAgentRun>("geo-agent/startAgentRun");
export const getAgentRun = serverFn<typeof Handlers.getAgentRun>("geo-agent/getAgentRun");
export const getAgentRunForFinding = serverFn<typeof Handlers.getAgentRunForFinding>(
  "geo-agent/getAgentRunForFinding",
);
export const listAgentRuns = serverFn<typeof Handlers.listAgentRuns>("geo-agent/listAgentRuns");
export const approveAgentPlan = serverFn<typeof Handlers.approveAgentPlan>(
  "geo-agent/approveAgentPlan",
);
export const reviseAgentPlan = serverFn<typeof Handlers.reviseAgentPlan>(
  "geo-agent/reviseAgentPlan",
);
export const submitAgentInputs = serverFn<typeof Handlers.submitAgentInputs>(
  "geo-agent/submitAgentInputs",
);
export const cancelAgentRun = serverFn<typeof Handlers.cancelAgentRun>("geo-agent/cancelAgentRun");
export const retryAgentRun = serverFn<typeof Handlers.retryAgentRun>("geo-agent/retryAgentRun");
