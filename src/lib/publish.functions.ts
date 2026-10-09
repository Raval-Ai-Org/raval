"use client";

// Browser-facing surface for the `publish` server functions
// (src/server/fns/publish.ts), dispatched to /api/rpc/publish/<name>.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/publish";

export const getPublishQueue = serverFn<typeof Handlers.getPublishQueue>("publish/getPublishQueue");
