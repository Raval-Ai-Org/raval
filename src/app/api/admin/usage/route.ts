import { z } from "zod";
import { defineAdminRoute } from "@/server/admin/route";
import { getUsage } from "@/server/admin/usage.server";

export const dynamic = "force-dynamic";

const Query = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) });

export const GET = defineAdminRoute({
  name: "admin.usage",
  permission: "usage.read",
  query: Query,
  handler: ({ query }) => getUsage(query.days),
});
