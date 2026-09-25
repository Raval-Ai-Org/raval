"use client";

// Browser-facing surface for the `site-publishing` server functions
// (publishing Studio articles to the workspace's website). RPC stubs
// dispatched to /api/rpc/site-publishing/<name>; implementations live in
// src/server/fns/site-publishing.ts.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/site-publishing";

export const previewArticlePublish = serverFn<typeof Handlers.previewArticlePublish>(
  "site-publishing/previewArticlePublish",
);
export const publishArticle = serverFn<typeof Handlers.publishArticle>(
  "site-publishing/publishArticle",
);
export const getArticlePublication = serverFn<typeof Handlers.getArticlePublication>(
  "site-publishing/getArticlePublication",
);
export const cancelArticlePublication = serverFn<typeof Handlers.cancelArticlePublication>(
  "site-publishing/cancelArticlePublication",
);
export const recheckArticlePublication = serverFn<typeof Handlers.recheckArticlePublication>(
  "site-publishing/recheckArticlePublication",
);
export const setupSiteBlog = serverFn<typeof Handlers.setupSiteBlog>(
  "site-publishing/setupSiteBlog",
);
