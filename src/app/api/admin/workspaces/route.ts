import { z } from "zod";
import { defineAdminRoute, pageQuery } from "@/server/admin/route";
import { listWorkspaces } from "@/server/admin/workspaces.server";

export const dynamic = "force-dynamic";

const Query = z.object({
  q: z.string().trim().max(120).optional(),
  filter: z.enum(["all", "frozen", "paid", "free", "recent"]).default("all"),
  ...pageQuery,
});

export const GET = defineAdminRoute({
  name: "admin.workspaces.list",
  permission: "workspaces.read",
  query: Query,
  handler: ({ query, can }) =>
    listWorkspaces(
      { search: query.q, filter: query.filter, page: query.page, pageSize: query.pageSize },
      can("users.pii.read"),
    ),
});
