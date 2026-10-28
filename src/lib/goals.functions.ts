"use client";

// Browser-facing surface for the `goals` server functions (ADR-0035). RPC
// stubs dispatched to /api/rpc/goals/<name>; the implementations live in
// src/server/fns/goals.ts.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/goals";

export const getGoals = serverFn<typeof Handlers.getGoals>("goals/getGoals");
export const saveGoals = serverFn<typeof Handlers.saveGoals>("goals/saveGoals");
