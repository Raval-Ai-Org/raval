"use client";
// engage.functions.ts — browser stubs for Engage (Inbox).
// Types are re-exported so components never import a server module.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/engage";

export type {
  EngageComment,
  EngageDraft,
  EngageHome,
  EngagePage,
  EngagePlatform,
  EngageStatus,
  EngageSyncResult,
} from "@/lib/engage/contracts";

export const getEngageHome = serverFn<typeof Handlers.getEngageHome>("engage/getEngageHome");
export const syncEngage = serverFn<typeof Handlers.syncEngage>("engage/syncEngage");
export const draftEngageReply =
  serverFn<typeof Handlers.draftEngageReply>("engage/draftEngageReply");
export const sendEngageReply = serverFn<typeof Handlers.sendEngageReply>("engage/sendEngageReply");
export const dismissEngageComment = serverFn<typeof Handlers.dismissEngageComment>(
  "engage/dismissEngageComment",
);
export const startMetaConnect =
  serverFn<typeof Handlers.startMetaConnect>("engage/startMetaConnect");
export const disconnectMeta = serverFn<typeof Handlers.disconnectMeta>("engage/disconnectMeta");
