"use client";

// Browser-facing surface for the `connectors` server functions (GitHub first).
// RPC stubs dispatched to /api/rpc/connectors/<name>; implementations live in
// src/server/fns/connectors.ts. No credential or token ever comes back.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/connectors";
import { CONNECTOR_BROADCAST_CHANNEL, type ConnectorBroadcast } from "@/lib/connectors/types";

export const getConnectors = serverFn<typeof Handlers.getConnectors>("connectors/getConnectors");
export const startGithubInstall = serverFn<typeof Handlers.startGithubInstall>(
  "connectors/startGithubInstall",
);
export const completeGithubInstall = serverFn<typeof Handlers.completeGithubInstall>(
  "connectors/completeGithubInstall",
);
export const verifyConnection = serverFn<typeof Handlers.verifyConnection>(
  "connectors/verifyConnection",
);
export const disconnectConnection = serverFn<typeof Handlers.disconnectConnection>(
  "connectors/disconnectConnection",
);
export const listGithubRepositories = serverFn<typeof Handlers.listGithubRepositories>(
  "connectors/listGithubRepositories",
);
export const selectGithubRepository = serverFn<typeof Handlers.selectGithubRepository>(
  "connectors/selectGithubRepository",
);
export const updateSource = serverFn<typeof Handlers.updateSource>("connectors/updateSource");
export const removeSource = serverFn<typeof Handlers.removeSource>("connectors/removeSource");
export const inspectSource = serverFn<typeof Handlers.inspectSource>("connectors/inspectSource");
export const getSiteSource = serverFn<typeof Handlers.getSiteSource>("connectors/getSiteSource");
export const verifySourceOwnership = serverFn<typeof Handlers.verifySourceOwnership>(
  "connectors/verifySourceOwnership",
);
export const setAgentConsent = serverFn<typeof Handlers.setAgentConsent>(
  "connectors/setAgentConsent",
);

/** Tell every open Mellox tab that a connection finished (the install runs in a popup). */
export function broadcastConnector(message: ConnectorBroadcast): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(CONNECTOR_BROADCAST_CHANNEL);
    channel.postMessage(message);
    channel.close();
  } catch {
    /* unavailable — the Integrations view refreshes on focus */
  }
}

export function subscribeConnectors(onMessage: (m: ConnectorBroadcast) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(CONNECTOR_BROADCAST_CHANNEL);
  channel.onmessage = (event) => onMessage(event.data as ConnectorBroadcast);
  return () => channel.close();
}
