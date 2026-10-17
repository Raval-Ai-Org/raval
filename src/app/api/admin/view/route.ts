import { z } from "zod";
import { defineAdminRoute } from "@/server/admin/route";
import { readSupportView } from "@/server/admin/access-control.server";

export const dynamic = "force-dynamic";

const Query = z.object({
  session: z.string().uuid(),
  section: z.enum(["overview", "content", "accounts", "jobs"]).default("overview"),
});

// Read-only by construction: this route has no body and calls a database
// function that only selects. Every read is audited by that function.
export const GET = defineAdminRoute({
  name: "admin.view.read",
  permission: "support.impersonate",
  query: Query,
  handler: ({ query, admin, audit, can }) =>
    readSupportView(
      { actorId: admin.userId, actorRole: admin.role, audit },
      query.session,
      query.section,
      can("users.pii.read"),
    ),
});
