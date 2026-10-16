import { z } from "zod";
import { defineAdminRoute, pageQuery } from "@/server/admin/route";
import { listUsers } from "@/server/admin/users.server";

export const dynamic = "force-dynamic";

const Query = z.object({
  q: z.string().trim().max(120).optional(),
  filter: z.enum(["all", "suspended", "unconfirmed", "recent", "admins"]).default("all"),
  sort: z.enum(["created", "last_seen"]).default("created"),
  ...pageQuery,
});

export const GET = defineAdminRoute({
  name: "admin.users.list",
  permission: "users.read",
  query: Query,
  handler: ({ query, can }) =>
    listUsers(
      {
        search: query.q,
        filter: query.filter,
        sort: query.sort,
        page: query.page,
        pageSize: query.pageSize,
      },
      can("users.pii.read"),
    ),
});
