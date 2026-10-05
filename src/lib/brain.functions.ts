"use client";

// Browser-facing surface for the `brain` server functions (ADR-0032). RPC stubs
// dispatched to /api/rpc/brain/<name>; the implementations live in
// src/server/fns/brain.ts.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/brain";

export const getBrainOverview =
  serverFn<typeof Handlers.getBrainOverview>("brain/getBrainOverview");
