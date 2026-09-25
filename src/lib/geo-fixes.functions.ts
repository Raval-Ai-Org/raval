"use client";

// Browser-facing surface for the `geo-fixes` server functions (AI Visibility
// fix workflow). RPC stubs dispatched to /api/rpc/geo-fixes/<name>; the
// implementations live in src/server/fns/geo-fixes.ts. No token or file
// content beyond reviewable diffs ever comes back.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/geo-fixes";

export const getFixAvailability = serverFn<typeof Handlers.getFixAvailability>(
  "geo-fixes/getFixAvailability",
);
export const listFixBranches = serverFn<typeof Handlers.listFixBranches>(
  "geo-fixes/listFixBranches",
);
export const previewFix = serverFn<typeof Handlers.previewFix>("geo-fixes/previewFix");
export const createFixProposal = serverFn<typeof Handlers.createFixProposal>(
  "geo-fixes/createFixProposal",
);
export const getFixProposal = serverFn<typeof Handlers.getFixProposal>("geo-fixes/getFixProposal");
export const approveFixProposal = serverFn<typeof Handlers.approveFixProposal>(
  "geo-fixes/approveFixProposal",
);
export const undoCmsFix = serverFn<typeof Handlers.undoCmsFix>("geo-fixes/undoCmsFix");
export const getSiteConnections = serverFn<typeof Handlers.getSiteConnections>(
  "geo-fixes/getSiteConnections",
);
export const getCmsFixAll = serverFn<typeof Handlers.getCmsFixAll>("geo-fixes/getCmsFixAll");
export const startCmsFixAll = serverFn<typeof Handlers.startCmsFixAll>("geo-fixes/startCmsFixAll");
export const applyCmsFixAll = serverFn<typeof Handlers.applyCmsFixAll>("geo-fixes/applyCmsFixAll");
export const discardFixProposal = serverFn<typeof Handlers.discardFixProposal>(
  "geo-fixes/discardFixProposal",
);
export const requestVerification = serverFn<typeof Handlers.requestVerification>(
  "geo-fixes/requestVerification",
);
export const getVerification = serverFn<typeof Handlers.getVerification>(
  "geo-fixes/getVerification",
);
export const getFixAllPreflight = serverFn<typeof Handlers.getFixAllPreflight>(
  "geo-fixes/getFixAllPreflight",
);
export const createFixBatch = serverFn<typeof Handlers.createFixBatch>("geo-fixes/createFixBatch");
export const getFixBatch = serverFn<typeof Handlers.getFixBatch>("geo-fixes/getFixBatch");
export const approveFixBatch = serverFn<typeof Handlers.approveFixBatch>(
  "geo-fixes/approveFixBatch",
);
export const discardFixBatch = serverFn<typeof Handlers.discardFixBatch>(
  "geo-fixes/discardFixBatch",
);
export const listFixActivity = serverFn<typeof Handlers.listFixActivity>(
  "geo-fixes/listFixActivity",
);
