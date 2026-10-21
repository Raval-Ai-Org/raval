import { z } from "zod";
import { defineAdminRoute } from "@/server/admin/route";
import { setUserSuspended } from "@/server/admin/users.server";

export const dynamic = "force-dynamic";

const Body = z.object({
  userId: z.string().uuid(),
  suspend: z.boolean(),
  reason: z.string().trim().min(10).max(300),
});

// Suspending ends every open session and blocks sign-in (the ban is Supabase
// Auth's own). The change and its audit row are written in one transaction.
export const POST = defineAdminRoute({
  name: "admin.users.suspend",
  permission: "users.suspend",
  write: true,
  body: Body,
  handler: ({ body, admin, audit }) =>
    setUserSuspended(
      { actorId: admin.userId, actorRole: admin.role, audit },
      body.userId,
      body.suspend,
      body.reason,
    ),
});
