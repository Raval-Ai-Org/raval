import { z } from "zod";
import { defineAdminRoute } from "@/server/admin/route";
import { endSupportView } from "@/server/admin/access-control.server";

export const dynamic = "force-dynamic";

const Body = z.object({ sessionId: z.string().uuid() });

export const POST = defineAdminRoute({
  name: "admin.view.end",
  permission: "support.impersonate",
  write: true,
  body: Body,
  handler: ({ body, admin, audit }) =>
    endSupportView({ actorId: admin.userId, actorRole: admin.role, audit }, body.sessionId),
});
