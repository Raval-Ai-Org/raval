import { z } from "zod";
import { defineAdminRoute } from "@/server/admin/route";
import { getWorkspaceDetail } from "@/server/admin/workspaces.server";

export const dynamic = "force-dynamic";

export const GET = defineAdminRoute({
  name: "admin.workspaces.detail",
  permission: "workspaces.read",
  query: z.object({ id: z.string().uuid() }),
  handler: ({ query, can }) =>
    getWorkspaceDetail(query.id, can("users.pii.read"), can("audit.read")),
});
