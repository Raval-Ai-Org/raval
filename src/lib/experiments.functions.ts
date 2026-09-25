"use client";

// Browser-facing surface for the `experiments` server functions (Proof Engine,
// ADR-0024). RPC stubs dispatched to /api/rpc/experiments/<name>; the
// implementations live in src/server/fns/experiments.ts.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/experiments";

export const getExperimentsOverview = serverFn<typeof Handlers.getExperimentsOverview>(
  "experiments/getExperimentsOverview",
);
export const getExperiment = serverFn<typeof Handlers.getExperiment>("experiments/getExperiment");
export const getDelivery = serverFn<typeof Handlers.getDelivery>("experiments/getDelivery");
export const detectPageGroups = serverFn<typeof Handlers.detectPageGroups>(
  "experiments/detectPageGroups",
);
export const checkGroupEligibility = serverFn<typeof Handlers.checkGroupEligibility>(
  "experiments/checkGroupEligibility",
);
export const prepareGroupSetup = serverFn<typeof Handlers.prepareGroupSetup>(
  "experiments/prepareGroupSetup",
);
export const approveGroupSetup = serverFn<typeof Handlers.approveGroupSetup>(
  "experiments/approveGroupSetup",
);
export const discardDelivery = serverFn<typeof Handlers.discardDelivery>(
  "experiments/discardDelivery",
);
export const suggestHypotheses = serverFn<typeof Handlers.suggestHypotheses>(
  "experiments/suggestHypotheses",
);
export const createExperiment = serverFn<typeof Handlers.createExperiment>(
  "experiments/createExperiment",
);
export const retryPrepare = serverFn<typeof Handlers.retryPrepare>("experiments/retryPrepare");
export const editExperimentValue = serverFn<typeof Handlers.editExperimentValue>(
  "experiments/editExperimentValue",
);
export const refreshShip = serverFn<typeof Handlers.refreshShip>("experiments/refreshShip");
export const approveExperiment = serverFn<typeof Handlers.approveExperiment>(
  "experiments/approveExperiment",
);
export const discardExperiment = serverFn<typeof Handlers.discardExperiment>(
  "experiments/discardExperiment",
);
export const cancelExperiment = serverFn<typeof Handlers.cancelExperiment>(
  "experiments/cancelExperiment",
);
export const stopExperiment = serverFn<typeof Handlers.stopExperiment>(
  "experiments/stopExperiment",
);
export const prepareDecision = serverFn<typeof Handlers.prepareDecision>(
  "experiments/prepareDecision",
);
export const approveDecision = serverFn<typeof Handlers.approveDecision>(
  "experiments/approveDecision",
);
export const keepExperiment = serverFn<typeof Handlers.keepExperiment>(
  "experiments/keepExperiment",
);
export const closeExperiment = serverFn<typeof Handlers.closeExperiment>(
  "experiments/closeExperiment",
);
export const setReportBranding = serverFn<typeof Handlers.setReportBranding>(
  "experiments/setReportBranding",
);
export const getExperimentReport = serverFn<typeof Handlers.getExperimentReport>(
  "experiments/getExperimentReport",
);
export const getProofEngineStatus = serverFn<typeof Handlers.getProofEngineStatus>(
  "experiments/getProofEngineStatus",
);
