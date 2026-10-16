import { z } from "zod";
import { defineAdminRoute } from "@/server/admin/route";
import { getUserDetail } from "@/server/admin/users.server";

export const dynamic = "force-dynamic";

export const GET = defineAdminRoute({
  name: "admin.users.detail",
  permission: "users.read",
  query: z.object({ id: z.string().uuid() }),
  handler: ({ query, can }) => getUserDetail(query.id, can("users.pii.read"), can("audit.read")),
});
