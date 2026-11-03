"use client";

// Browser-facing surface for the `pulse` server functions. RPC stubs
// dispatched to /api/rpc/pulse/<name>; the implementations live in
// src/server/fns/pulse.ts.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/pulse";

export const getWorkspacePulse =
  serverFn<typeof Handlers.getWorkspacePulse>("pulse/getWorkspacePulse");
