import { z } from "zod";
import { defineAdminRoute } from "@/server/admin/route";
import { getAnalytics } from "@/server/admin/insight.server";

export const dynamic = "force-dynamic";

const Query = z.object({ days: z.coerce.number().int().min(7).max(90).default(30) });

export const GET = defineAdminRoute({
  name: "admin.analytics",
  permission: "analytics.read",
  query: Query,
  handler: ({ query }) => getAnalytics(query.days),
});
