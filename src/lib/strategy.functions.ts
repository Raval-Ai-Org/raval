"use client";

// Browser-facing surface for the `strategy` server functions (ADR-0032). RPC
// stubs dispatched to /api/rpc/strategy/<name>; the implementations live in
// src/server/fns/strategy.ts.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/strategy";

export const getStrategy = serverFn<typeof Handlers.getStrategy>("strategy/getStrategy");
export const generateStrategy = serverFn<typeof Handlers.generateStrategy>(
  "strategy/generateStrategy",
);
export const saveStrategy = serverFn<typeof Handlers.saveStrategy>("strategy/saveStrategy");
