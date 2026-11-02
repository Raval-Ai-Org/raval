"use client";
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/integrations";

export const getIntegrations = serverFn<typeof Handlers.getIntegrations>(
  "integrations/getIntegrations",
);
export const startAppConnect = serverFn<typeof Handlers.startAppConnect>(
  "integrations/startAppConnect",
);
export const completeAppConnect = serverFn<typeof Handlers.completeAppConnect>(
  "integrations/completeAppConnect",
);
export const disconnectApp = serverFn<typeof Handlers.disconnectApp>("integrations/disconnectApp");
