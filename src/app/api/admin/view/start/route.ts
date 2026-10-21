import { z } from "zod";
import { defineAdminRoute } from "@/server/admin/route";
import { startSupportView } from "@/server/admin/access-control.server";

export const dynamic = "force-dynamic";

const Body = z.object({
  workspaceId: z.string().uuid(),
  reason: z.string().trim().min(10).max(300),
});

// Opening a view of a customer's workspace needs a fresh second factor and a
// written reason. It lasts 30 minutes and an admin has one at a time.
export const POST = defineAdminRoute({
  name: "admin.view.start",
  permission: "support.impersonate",
  danger: true,
  body: Body,
  handler: ({ body, admin, audit }) =>
    startSupportView(
      { actorId: admin.userId, actorRole: admin.role, audit },
      body.workspaceId,
      body.reason,
    ),
});
