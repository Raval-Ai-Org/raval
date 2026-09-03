"use client";

// Browser-facing surface for the `content` server functions. Each export is an
// RPC stub with the same call signature as before — `await fn({ data })` —
// dispatched to /api/rpc/content/<name>. The implementations live in
// src/server/fns/content.ts and never reach the client bundle.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/content";

export type { ContentItem, NextStepSuggestion } from "@/server/fns/content";

export const listContentItems = serverFn<typeof Handlers.listContentItems>(
  "content/listContentItems",
);
export const createContentItem = serverFn<typeof Handlers.createContentItem>(
  "content/createContentItem",
);
export const updateContentItem = serverFn<typeof Handlers.updateContentItem>(
  "content/updateContentItem",
);
export const deleteContentItem = serverFn<typeof Handlers.deleteContentItem>(
  "content/deleteContentItem",
);
export const rescheduleContentItem = serverFn<typeof Handlers.rescheduleContentItem>(
  "content/rescheduleContentItem",
);
export const regenerateContentItem = serverFn<typeof Handlers.regenerateContentItem>(
  "content/regenerateContentItem",
);
export const generateContentBatch = serverFn<typeof Handlers.generateContentBatch>(
  "content/generateContentBatch",
);
export const setContentItemStatus = serverFn<typeof Handlers.setContentItemStatus>(
  "content/setContentItemStatus",
);
export const listAgencyFeed = serverFn<typeof Handlers.listAgencyFeed>("content/listAgencyFeed");
export const suggestNextSteps = serverFn<typeof Handlers.suggestNextSteps>(
  "content/suggestNextSteps",
);
export const generateNextPost = serverFn<typeof Handlers.generateNextPost>(
  "content/generateNextPost",
);
