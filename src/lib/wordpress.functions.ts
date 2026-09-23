"use client";
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/wordpress";
export const getWordPressConnection = serverFn<typeof Handlers.getWordPressConnection>(
  "wordpress/getWordPressConnection",
);
export const connectWordPress = serverFn<typeof Handlers.connectWordPress>(
  "wordpress/connectWordPress",
);
export const startWordPressOAuth = serverFn<typeof Handlers.startWordPressOAuth>(
  "wordpress/startWordPressOAuth",
);
export const completeWordPressOAuth = serverFn<typeof Handlers.completeWordPressOAuth>(
  "wordpress/completeWordPressOAuth",
);
export const refreshWordPress = serverFn<typeof Handlers.refreshWordPress>(
  "wordpress/refreshWordPress",
);
export const selectWordPressSite = serverFn<typeof Handlers.selectWordPressSite>(
  "wordpress/selectWordPressSite",
);
export const disconnectWordPress = serverFn<typeof Handlers.disconnectWordPress>(
  "wordpress/disconnectWordPress",
);
export const getWordPressData = serverFn<typeof Handlers.getWordPressData>(
  "wordpress/getWordPressData",
);
export const publishWordPress = serverFn<typeof Handlers.publishWordPress>(
  "wordpress/publishWordPress",
);
