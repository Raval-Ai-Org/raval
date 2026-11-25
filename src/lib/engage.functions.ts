"use client";
// engage.functions.ts — browser stubs for Engage (Inbox).
// Types are re-exported so components never import a server module.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/engage";

export type {
  EngageAnswer,
  EngageComment,
  EngageDmStatus,
  EngageExample,
  EngageMoxState,
  EngageQuestion,
  EngagePost,
  EngageRule,
  RuleInput,
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
export const listEngagePosts = serverFn<typeof Handlers.listEngagePosts>("engage/listEngagePosts");
export const saveEngageRule = serverFn<typeof Handlers.saveEngageRule>("engage/saveEngageRule");
export const deleteEngageRule =
  serverFn<typeof Handlers.deleteEngageRule>("engage/deleteEngageRule");
export const setEngageRuleStatus = serverFn<typeof Handlers.setEngageRuleStatus>(
  "engage/setEngageRuleStatus",
);
export const reorderEngageRules = serverFn<typeof Handlers.reorderEngageRules>(
  "engage/reorderEngageRules",
);
export const setEngageAutomations = serverFn<typeof Handlers.setEngageAutomations>(
  "engage/setEngageAutomations",
);
export const saveEngageAnswer =
  serverFn<typeof Handlers.saveEngageAnswer>("engage/saveEngageAnswer");
export const deleteEngageAnswer = serverFn<typeof Handlers.deleteEngageAnswer>(
  "engage/deleteEngageAnswer",
);
export const deleteEngageExample = serverFn<typeof Handlers.deleteEngageExample>(
  "engage/deleteEngageExample",
);
export const sendEngageDm = serverFn<typeof Handlers.sendEngageDm>("engage/sendEngageDm");
export const setEngageAutoReply =
  serverFn<typeof Handlers.setEngageAutoReply>("engage/setEngageAutoReply");
export const saveEngageGuidelines =
  serverFn<typeof Handlers.saveEngageGuidelines>("engage/saveEngageGuidelines");
export const answerEngageQuestion =
  serverFn<typeof Handlers.answerEngageQuestion>("engage/answerEngageQuestion");
export const dismissEngageQuestion =
  serverFn<typeof Handlers.dismissEngageQuestion>("engage/dismissEngageQuestion");
