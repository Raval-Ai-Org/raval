"use client";

// Browser-facing surface for the `autopilot` server functions (ADR-0028). RPC
// stubs dispatched to /api/rpc/autopilot/<name>; the implementations live in
// src/server/fns/autopilot.ts.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/autopilot";

export const getAutopilotStatus = serverFn<typeof Handlers.getAutopilotStatus>(
  "autopilot/getAutopilotStatus",
);
export const getAutopilot = serverFn<typeof Handlers.getAutopilot>("autopilot/getAutopilot");
export const suggestAutopilotStrategy = serverFn<typeof Handlers.suggestAutopilotStrategy>(
  "autopilot/suggestAutopilotStrategy",
);
export const startAutopilot = serverFn<typeof Handlers.startAutopilot>("autopilot/startAutopilot");
export const updateAutopilot = serverFn<typeof Handlers.updateAutopilot>(
  "autopilot/updateAutopilot",
);
export const setAutopilotPaused = serverFn<typeof Handlers.setAutopilotPaused>(
  "autopilot/setAutopilotPaused",
);
export const stopAutopilot = serverFn<typeof Handlers.stopAutopilot>("autopilot/stopAutopilot");
export const approveAutopilotPlan = serverFn<typeof Handlers.approveAutopilotPlan>(
  "autopilot/approveAutopilotPlan",
);
export const decideAutopilotAction = serverFn<typeof Handlers.decideAutopilotAction>(
  "autopilot/decideAutopilotAction",
);
export const retryAutopilotAction = serverFn<typeof Handlers.retryAutopilotAction>(
  "autopilot/retryAutopilotAction",
);
export const decideOpportunity = serverFn<typeof Handlers.decideOpportunity>(
  "autopilot/decideOpportunity",
);
export const getAgencyAutopilot = serverFn<typeof Handlers.getAgencyAutopilot>(
  "autopilot/getAgencyAutopilot",
);
