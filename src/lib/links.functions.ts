"use client";
// Browser stubs for the link marketplace server functions. Type-only import of
// the handlers, so nothing server-side reaches the bundle.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/links";

export const getOverview = serverFn<typeof Handlers.getOverview>("links/getOverview");
export const findPlacements = serverFn<typeof Handlers.findPlacements>("links/findPlacements");
export const suggestLinkText = serverFn<typeof Handlers.suggestLinkText>("links/suggestLinkText");
export const writeBrief = serverFn<typeof Handlers.writeBrief>("links/writeBrief");
export const saveSelection = serverFn<typeof Handlers.saveSelection>("links/saveSelection");
export const getOrder = serverFn<typeof Handlers.getOrder>("links/getOrder");
export const confirmOrder = serverFn<typeof Handlers.confirmOrder>("links/confirmOrder");
export const discardDraft = serverFn<typeof Handlers.discardDraft>("links/discardDraft");
export const recheckPlacement =
  serverFn<typeof Handlers.recheckPlacement>("links/recheckPlacement");
export const getCreditHistory =
  serverFn<typeof Handlers.getCreditHistory>("links/getCreditHistory");
