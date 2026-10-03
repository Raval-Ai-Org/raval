"use client";

// Browser-facing surface for the `mcp` server functions (Settings → AI
// assistants). RPC stubs dispatched to /api/rpc/mcp/<name>; implementations
// live in src/server/fns/mcp.ts.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/mcp";

export const getMcpSettings = serverFn<typeof Handlers.getMcpSettings>("mcp/getMcpSettings");
export const updateMcpSettings =
  serverFn<typeof Handlers.updateMcpSettings>("mcp/updateMcpSettings");
export const listMcpActivity = serverFn<typeof Handlers.listMcpActivity>("mcp/listMcpActivity");
