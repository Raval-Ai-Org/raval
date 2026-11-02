"use client";
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/wix";

export const getWixConnection = serverFn<typeof Handlers.getWixConnection>("wix/getWixConnection");
export const startWixConnect = serverFn<typeof Handlers.startWixConnect>("wix/startWixConnect");
export const completeWixConnect =
  serverFn<typeof Handlers.completeWixConnect>("wix/completeWixConnect");
export const refreshWixSite = serverFn<typeof Handlers.refreshWixSite>("wix/refreshWixSite");
export const disconnectWix = serverFn<typeof Handlers.disconnectWix>("wix/disconnectWix");
