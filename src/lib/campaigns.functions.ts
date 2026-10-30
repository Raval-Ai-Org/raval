"use client";

// Browser-facing surface for the `campaigns` server functions (ADR-0039). RPC
// stubs dispatched to /api/rpc/campaigns/<name>; the implementations live in
// src/server/fns/campaigns.ts.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/campaigns";

export const getCampaignsHome = serverFn<typeof Handlers.getCampaignsHome>(
  "campaigns/getCampaignsHome",
);
export const getCampaign = serverFn<typeof Handlers.getCampaign>("campaigns/getCampaign");
export const saveCampaign = serverFn<typeof Handlers.saveCampaign>("campaigns/saveCampaign");
export const editCampaignPiece = serverFn<typeof Handlers.editCampaignPiece>(
  "campaigns/editCampaignPiece",
);
export const planCampaign = serverFn<typeof Handlers.planCampaign>("campaigns/planCampaign");
export const writeCampaignBrief = serverFn<typeof Handlers.writeCampaignBrief>(
  "campaigns/writeCampaignBrief",
);
export const startCampaign = serverFn<typeof Handlers.startCampaign>("campaigns/startCampaign");
export const pauseCampaign = serverFn<typeof Handlers.pauseCampaign>("campaigns/pauseCampaign");
export const endCampaign = serverFn<typeof Handlers.endCampaign>("campaigns/endCampaign");
export const setCampaignCount = serverFn<typeof Handlers.setCampaignCount>(
  "campaigns/setCampaignCount",
);
export const deleteCampaign = serverFn<typeof Handlers.deleteCampaign>("campaigns/deleteCampaign");
