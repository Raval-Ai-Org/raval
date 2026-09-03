"use client";

// Browser-facing surface for the `workspaces` server functions. Each export is an
// RPC stub with the same call signature as before — `await fn({ data })` —
// dispatched to /api/rpc/workspaces/<name>. The implementations live in
// src/server/fns/workspaces.ts and never reach the client bundle.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/workspaces";

export const renameWorkspace = serverFn<typeof Handlers.renameWorkspace>(
  "workspaces/renameWorkspace",
);
export const getWorkspaceDetails = serverFn<typeof Handlers.getWorkspaceDetails>(
  "workspaces/getWorkspaceDetails",
);
export const listApprovals = serverFn<typeof Handlers.listApprovals>("workspaces/listApprovals");
export const decideApproval = serverFn<typeof Handlers.decideApproval>("workspaces/decideApproval");
export const createWorkspace = serverFn<typeof Handlers.createWorkspace>(
  "workspaces/createWorkspace",
);
export const ensureAuthWorkspace = serverFn<typeof Handlers.ensureAuthWorkspace>(
  "workspaces/ensureAuthWorkspace",
);
export const acceptWorkspaceInvite = serverFn<typeof Handlers.acceptWorkspaceInvite>(
  "workspaces/acceptWorkspaceInvite",
);
export const getWorkspaceMemberProfiles = serverFn<typeof Handlers.getWorkspaceMemberProfiles>(
  "workspaces/getWorkspaceMemberProfiles",
);
