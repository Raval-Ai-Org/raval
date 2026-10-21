import { z } from "zod";
import { defineAdminRoute } from "@/server/admin/route";
import { revokeUserSessions } from "@/server/admin/users.server";

export const dynamic = "force-dynamic";

const Body = z.object({
  userId: z.string().uuid(),
  reason: z.string().trim().min(10).max(300),
});

// Signs the person out everywhere. They can sign in again.
export const POST = defineAdminRoute({
  name: "admin.users.revoke-sessions",
  permission: "users.sessions.revoke",
  write: true,
  body: Body,
  handler: ({ body, admin, audit }) =>
    revokeUserSessions(
      { actorId: admin.userId, actorRole: admin.role, audit },
      body.userId,
      body.reason,
    ),
});
