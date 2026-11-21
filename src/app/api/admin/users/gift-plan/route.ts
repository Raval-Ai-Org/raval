import { z } from "zod";
import { defineAdminRoute } from "@/server/admin/route";
import { GIFT_PLANS, giftUserPlan, USER_PLAN_MONTHS_MAX } from "@/server/admin/user-grants.server";

export const dynamic = "force-dynamic";

const Body = z.object({
  userId: z.string().uuid(),
  plan: z.enum(GIFT_PLANS),
  months: z.number().int().min(1).max(USER_PLAN_MONTHS_MAX),
  reason: z.string().trim().min(10).max(300),
  operationId: z.string().uuid(),
});

// Gives a plan for a number of months through the billing module's manual
// activation (a card subscription is refused there: change it in Stripe).
export const POST = defineAdminRoute({
  name: "admin.users.gift-plan",
  permission: "entitlements.override",
  danger: true,
  body: Body,
  handler: ({ body, admin, audit }) =>
    giftUserPlan({ actorId: admin.userId, actorRole: admin.role, audit }, body),
});
