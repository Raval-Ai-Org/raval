import { z } from "zod";
import { defineAdminRoute } from "@/server/admin/route";
import {
  CREDIT_EXPIRY_DAYS_MAX,
  giftUserCredits,
  USER_CREDIT_GIFT_MAX,
} from "@/server/admin/user-grants.server";

export const dynamic = "force-dynamic";

const Body = z.object({
  userId: z.string().uuid(),
  credits: z.number().int().min(1).max(USER_CREDIT_GIFT_MAX),
  reason: z.string().trim().min(10).max(300),
  operationId: z.string().uuid(),
  expiresInDays: z.number().int().min(1).max(CREDIT_EXPIRY_DAYS_MAX).nullable().optional(),
});

// Money-adjacent: a fresh second factor, the slowest rate limit, a written
// reason, and an audit row on the person for success and failure alike.
export const POST = defineAdminRoute({
  name: "admin.users.gift-credits",
  permission: "credits.grant",
  danger: true,
  body: Body,
  handler: ({ body, admin, audit }) =>
    giftUserCredits({ actorId: admin.userId, actorRole: admin.role, audit }, body),
});
