import { z } from "zod";
import { defineAdminRoute } from "@/server/admin/route";
import { addUserNote } from "@/server/admin/users.server";

export const dynamic = "force-dynamic";

const Body = z.object({
  userId: z.string().uuid(),
  body: z.string().trim().min(1).max(2000),
});

// Internal notes are written once and never edited. Customers cannot read them.
export const POST = defineAdminRoute({
  name: "admin.users.add-note",
  permission: "users.notes.write",
  write: true,
  body: Body,
  handler: ({ body, admin, audit }) =>
    addUserNote({ actorId: admin.userId, actorRole: admin.role, audit }, body.userId, body.body),
});
