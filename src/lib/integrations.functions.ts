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
export const listMailchimpAudiences = serverFn<typeof Handlers.listMailchimpAudiences>(
  "integrations/listMailchimpAudiences",
);
export const saveEmailDraft = serverFn<typeof Handlers.saveEmailDraft>(
  "integrations/saveEmailDraft",
);
export const savePostToDrive = serverFn<typeof Handlers.savePostToDrive>(
  "integrations/savePostToDrive",
);
export const saveGmailDraft = serverFn<typeof Handlers.saveGmailDraft>(
  "integrations/saveGmailDraft",
);
export const sendAdToGoogleAds = serverFn<typeof Handlers.sendAdToGoogleAds>(
  "integrations/sendAdToGoogleAds",
);
export const exportCalendarToSheets = serverFn<typeof Handlers.exportCalendarToSheets>(
  "integrations/exportCalendarToSheets",
);
export const getAppReports = serverFn<typeof Handlers.getAppReports>("integrations/getAppReports");
export const refreshAppReports = serverFn<typeof Handlers.refreshAppReports>(
  "integrations/refreshAppReports",
);
