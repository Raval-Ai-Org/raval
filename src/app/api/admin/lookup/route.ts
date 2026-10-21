import { z } from "zod";
import { defineAdminRoute } from "@/server/admin/route";
import { lookup } from "@/server/admin/insight.server";

export const dynamic = "force-dynamic";

const Query = z.object({ q: z.string().trim().min(3).max(100) });

export const GET = defineAdminRoute({
  name: "admin.lookup",
  permission: "lookup.read",
  query: Query,
  handler: ({ query, can }) => lookup(query.q, can("users.pii.read")),
});
