"use client";
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/webflow";

export const getWebflowConnection = serverFn<typeof Handlers.getWebflowConnection>(
  "webflow/getWebflowConnection",
);
export const startWebflowConnect = serverFn<typeof Handlers.startWebflowConnect>(
  "webflow/startWebflowConnect",
);
export const completeWebflowConnect = serverFn<typeof Handlers.completeWebflowConnect>(
  "webflow/completeWebflowConnect",
);
export const refreshWebflowSites = serverFn<typeof Handlers.refreshWebflowSites>(
  "webflow/refreshWebflowSites",
);
export const selectWebflowSite = serverFn<typeof Handlers.selectWebflowSite>(
  "webflow/selectWebflowSite",
);
export const disconnectWebflow = serverFn<typeof Handlers.disconnectWebflow>(
  "webflow/disconnectWebflow",
);
export const getWebflowData = serverFn<typeof Handlers.getWebflowData>("webflow/getWebflowData");
