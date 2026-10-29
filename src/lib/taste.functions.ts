"use client";

// Browser-facing surface for the `taste` server functions (ADR-0038). RPC
// stubs dispatched to /api/rpc/taste/<name>; the implementations live in
// src/server/fns/taste.ts.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/taste";

export const getTaste = serverFn<typeof Handlers.getTaste>("taste/getTaste");
export const setReaction = serverFn<typeof Handlers.setReaction>("taste/setReaction");
export const resetTaste = serverFn<typeof Handlers.resetTaste>("taste/resetTaste");
