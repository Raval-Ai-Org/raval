import { z } from "zod";
import { defineAdminRoute } from "@/server/admin/route";
import { getCostPerOutput } from "@/server/admin/usage.server";

export const dynamic = "force-dynamic";

const Query = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) });

/** Cost per Studio job / UGC render (incl. failures), per stage, and prompt-cache share. */
export const GET = defineAdminRoute({
  name: "admin.usage.cost",
  permission: "usage.read",
  query: Query,
  handler: ({ query }) => getCostPerOutput(query.days),
});
