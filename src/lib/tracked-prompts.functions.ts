"use client";

// Browser-facing stubs for the `tracked-prompts` server functions
// (src/server/fns/tracked-prompts.ts), dispatched to /api/rpc/tracked-prompts/<name>.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/tracked-prompts";

export type {
  TrackedPromptCheck,
  TrackedPromptView,
  TrackedPromptsOverview,
} from "@/server/geo/tracked-prompts.server";

export const getTrackedPrompts = serverFn<typeof Handlers.getTrackedPrompts>(
  "tracked-prompts/getTrackedPrompts",
);
export const suggestTrackedPrompts = serverFn<typeof Handlers.suggestTrackedPrompts>(
  "tracked-prompts/suggestTrackedPrompts",
);
export const addTrackedPrompt = serverFn<typeof Handlers.addTrackedPrompt>(
  "tracked-prompts/addTrackedPrompt",
);
export const setTrackedPromptPaused = serverFn<typeof Handlers.setTrackedPromptPaused>(
  "tracked-prompts/setTrackedPromptPaused",
);
export const deleteTrackedPrompt = serverFn<typeof Handlers.deleteTrackedPrompt>(
  "tracked-prompts/deleteTrackedPrompt",
);
export const checkTrackedPromptNow = serverFn<typeof Handlers.checkTrackedPromptNow>(
  "tracked-prompts/checkTrackedPromptNow",
);
