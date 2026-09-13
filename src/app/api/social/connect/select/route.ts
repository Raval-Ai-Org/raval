// GET  /api/social/connect/select — re-read a pending Page selection.
// POST /api/social/connect/select — connect the chosen Facebook Pages.
// Both are bound to the user + workspace that started the connection.
import { z } from "zod";
import { defineRoute } from "@/server/route";
import { getPendingHandler, selectPendingHandler } from "@/lib/socialapi/handlers";
import { withSocialApi } from "@/lib/socialapi/route.server";

export const dynamic = "force-dynamic";

export const GET = defineRoute({
  name: "social/connect/pending",
  auth: "workspace",
  query: z.object({ workspaceId: z.string(), connectionId: z.string().min(1).max(200) }),
  workspaceId: ({ query }) => query.workspaceId,
  minRole: "editor",
  handler: ({ query, workspaceId, userId }) =>
    withSocialApi(workspaceId, (deps) =>
      getPendingHandler({ workspaceId, userId, connectionId: query.connectionId }, deps),
    ),
});

export const POST = defineRoute({
  name: "social/connect/select",
  auth: "workspace",
  body: z.object({
    workspaceId: z.string(),
    connectionId: z.string().min(1).max(200),
    pageIds: z.array(z.string().min(1).max(100)).max(5).default([]),
  }),
  workspaceId: ({ body }) => body.workspaceId,
  minRole: "editor",
  handler: ({ body, workspaceId, userId }) =>
    withSocialApi(workspaceId, (deps) =>
      selectPendingHandler(
        { workspaceId, userId, connectionId: body.connectionId, pageIds: body.pageIds },
        deps,
      ),
    ),
});
