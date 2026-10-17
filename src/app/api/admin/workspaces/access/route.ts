import { z } from "zod";
import { defineAdminRoute } from "@/server/admin/route";
import { setWorkspaceAccess } from "@/server/admin/access-control.server";

export const dynamic = "force-dynamic";

const Body = z.object({
  workspaceId: z.string().uuid(),
  mode: z.enum(["active", "read_only", "suspended"]),
  reason: z.string().trim().min(10).max(300),
});

// Locks (or unlocks) every member of one workspace, so it needs a fresh second
// factor and a written reason. The mode and its audit row are one transaction.
export const POST = defineAdminRoute({
  name: "admin.workspaces.access",
  permission: "workspaces.suspend",
  danger: true,
  body: Body,
  handler: ({ body, admin, audit }) =>
    setWorkspaceAccess(
      { actorId: admin.userId, actorRole: admin.role, audit },
      body.workspaceId,
      body.mode,
      body.reason,
    ),
});
