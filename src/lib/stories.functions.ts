"use client";

// Browser-facing surface for the `stories` server functions (ADR-0030). RPC
// stubs dispatched to /api/rpc/stories/<name>; the implementations live in
// src/server/fns/stories.ts.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/stories";

export const getStoriesStatus = serverFn<typeof Handlers.getStoriesStatus>(
  "stories/getStoriesStatus",
);
export const shareVideoAsStory = serverFn<typeof Handlers.shareVideoAsStory>(
  "stories/shareVideoAsStory",
);
export const shareStoryAsReel = serverFn<typeof Handlers.shareStoryAsReel>(
  "stories/shareStoryAsReel",
);
export const getStoryAnalytics = serverFn<typeof Handlers.getStoryAnalytics>(
  "stories/getStoryAnalytics",
);
