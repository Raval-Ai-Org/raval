"use client";

// Browser-facing surface for the `audience` server functions (ADR-0031). RPC
// stubs dispatched to /api/rpc/audience/<name>; the implementations live in
// src/server/fns/audience.ts.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/audience";

export const getAudienceStatus = serverFn<typeof Handlers.getAudienceStatus>(
  "audience/getAudienceStatus",
);
export const getAudience = serverFn<typeof Handlers.getAudience>("audience/getAudience");
export const buildAudience = serverFn<typeof Handlers.buildAudience>("audience/buildAudience");
export const saveAudienceGroup = serverFn<typeof Handlers.saveAudienceGroup>(
  "audience/saveAudienceGroup",
);
export const removeAudienceGroup = serverFn<typeof Handlers.removeAudienceGroup>(
  "audience/removeAudienceGroup",
);
export const getAudienceScores = serverFn<typeof Handlers.getAudienceScores>(
  "audience/getAudienceScores",
);
export const getContentAudience = serverFn<typeof Handlers.getContentAudience>(
  "audience/getContentAudience",
);
export const predictContent = serverFn<typeof Handlers.predictContent>("audience/predictContent");
export const startAudienceCheck = serverFn<typeof Handlers.startAudienceCheck>(
  "audience/startAudienceCheck",
);
export const startAudienceComparison = serverFn<typeof Handlers.startAudienceComparison>(
  "audience/startAudienceComparison",
);
export const startAudienceRanking = serverFn<typeof Handlers.startAudienceRanking>(
  "audience/startAudienceRanking",
);
export const getAudienceRun = serverFn<typeof Handlers.getAudienceRun>("audience/getAudienceRun");
export const cancelAudienceRun = serverFn<typeof Handlers.cancelAudienceRun>(
  "audience/cancelAudienceRun",
);
export const listAudiencePredictions = serverFn<typeof Handlers.listAudiencePredictions>(
  "audience/listAudiencePredictions",
);
