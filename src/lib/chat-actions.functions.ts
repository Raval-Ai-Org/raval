"use client";
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/chat-actions";

// The buttons a chat reply offers (ADR-0033). Browser stubs for
// src/server/fns/chat-actions.ts.
export const getChatActions = serverFn<typeof Handlers.getChatActions>(
  "chat-actions/getChatActions",
);
export const runChatAction = serverFn<typeof Handlers.runChatAction>("chat-actions/runChatAction");
