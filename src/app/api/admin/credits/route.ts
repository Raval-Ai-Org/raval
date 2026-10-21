import { z } from "zod";
import { defineAdminRoute } from "@/server/admin/route";
import { CREDIT_GRANT_LIMITS, grantGoodwill } from "@/server/admin/credits.server";

export const dynamic = "force-dynamic";

const Body = z
  .object({
    workspaceId: z.string().uuid(),
    meter: z.enum(["credits", "video"]),
    amount: z.number().int().min(1),
    reason: z.string().trim().min(10).max(300),
    operationId: z.string().uuid(),
  })
  .refine((value) => value.amount <= CREDIT_GRANT_LIMITS[value.meter], {
    message: "Amount is over the limit for one adjustment",
    path: ["amount"],
  });

// Money-adjacent, so it is a "danger" route: a fresh second factor, the slowest
// rate limit, a written reason, and an audit row for success and failure alike.
export const POST = defineAdminRoute({
  name: "admin.credits.grant",
  permission: "credits.grant",
  danger: true,
  body: Body,
  handler: ({ body, admin, audit }) =>
    grantGoodwill({ actorId: admin.userId, actorRole: admin.role, audit }, body),
});
