"use client";
// community.functions.ts — browser stubs for Community Intelligence.
// Types are re-exported so components never import a server module.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/community";

export type {
  CommunityHome,
  CommunityReply,
  CommunityThreadView,
  CommunityWatch,
  CommunitySignals,
  CommunitySource,
  MatchKind,
  ThreadStatus,
} from "@/lib/community/contracts";

export const getCommunityHome = serverFn<typeof Handlers.getCommunityHome>(
  "community/getCommunityHome",
);
export const getCommunityThread = serverFn<typeof Handlers.getCommunityThread>(
  "community/getCommunityThread",
);
export const refreshCommunity = serverFn<typeof Handlers.refreshCommunity>(
  "community/refreshCommunity",
);
export const pauseCommunity = serverFn<typeof Handlers.pauseCommunity>("community/pauseCommunity");
export const setCommunityThreadStatus = serverFn<typeof Handlers.setCommunityThreadStatus>(
  "community/setCommunityThreadStatus",
);
export const addCommunityWatch = serverFn<typeof Handlers.addCommunityWatch>(
  "community/addCommunityWatch",
);
export const removeCommunityWatch = serverFn<typeof Handlers.removeCommunityWatch>(
  "community/removeCommunityWatch",
);
export const draftCommunityReply = serverFn<typeof Handlers.draftCommunityReply>(
  "community/draftCommunityReply",
);
