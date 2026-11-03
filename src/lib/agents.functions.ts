"use client";
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/agents";

export const getAgents = serverFn<typeof Handlers.getAgents>("agents/getAgents");
