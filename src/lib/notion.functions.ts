"use client";
import { serverFn } from "@/lib/rpc-client";
import type * as Notion from "@/server/fns/notion";
export const getNotionConnection = serverFn<typeof Notion.getNotionConnection>(
  "notion/getNotionConnection",
);
export const startNotionConnect = serverFn<typeof Notion.startNotionConnect>(
  "notion/startNotionConnect",
);
export const disconnectNotion = serverFn<typeof Notion.disconnectNotion>("notion/disconnectNotion");
export const listNotionDestinations = serverFn<typeof Notion.listNotionDestinations>(
  "notion/listNotionDestinations",
);
export const selectNotionDestination = serverFn<typeof Notion.selectNotionDestination>(
  "notion/selectNotionDestination",
);
export const createNotionDestination = serverFn<typeof Notion.createNotionDestination>(
  "notion/createNotionDestination",
);
export const exportToNotion = serverFn<typeof Notion.exportToNotion>("notion/exportToNotion");
export const previewNotionImport = serverFn<typeof Notion.previewNotionImport>(
  "notion/previewNotionImport",
);
export const importFromNotion = serverFn<typeof Notion.importFromNotion>("notion/importFromNotion");
export const syncNotionNow = serverFn<typeof Notion.syncNotionNow>("notion/syncNotionNow");
export const listNotionConflicts = serverFn<typeof Notion.listNotionConflicts>(
  "notion/listNotionConflicts",
);
export const resolveNotionConflict = serverFn<typeof Notion.resolveNotionConflict>(
  "notion/resolveNotionConflict",
);
