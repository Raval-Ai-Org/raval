"use client";

// Browser-facing surface for the `campaign-generation` server function.
// Dispatched to /api/rpc/campaign-generation/<name>. The implementation
// lives in src/server/fns/campaign-generation.ts and never reaches the
// client bundle.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/campaign-generation";

export const generateCampaignBrief = serverFn<typeof Handlers.generateCampaignBrief>(
  "campaign-generation/generateCampaignBrief",
);
