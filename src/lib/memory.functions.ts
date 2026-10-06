"use client";
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/memory";

// Memory (ADR-0033). Browser stubs for src/server/fns/memory.ts.
export const getMemoryStatus = serverFn<typeof Handlers.getMemoryStatus>("memory/getMemoryStatus");
export const getMemory = serverFn<typeof Handlers.getMemory>("memory/getMemory");
export const addMemory = serverFn<typeof Handlers.addMemory>("memory/addMemory");
export const editMemory = serverFn<typeof Handlers.editMemory>("memory/editMemory");
export const removeMemory = serverFn<typeof Handlers.removeMemory>("memory/removeMemory");
export const restoreMemory = serverFn<typeof Handlers.restoreMemory>("memory/restoreMemory");
export const clearMemory = serverFn<typeof Handlers.clearMemory>("memory/clearMemory");
export const setMemoryEnabled =
  serverFn<typeof Handlers.setMemoryEnabled>("memory/setMemoryEnabled");
export const proposeMemories = serverFn<typeof Handlers.proposeMemories>("memory/proposeMemories");
