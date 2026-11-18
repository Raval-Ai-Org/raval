import { z } from "zod";
import { defineAdminRoute } from "@/server/admin/route";
import {
  ACCESS_DAYS_MAX,
  ACCESS_TIERS,
  USER_CREDIT_GIFT_MAX,
  endAccessPass,
  giftAccessPass,
} from "@/server/admin/user-grants.server";

export const dynamic = "force-dynamic";

const Grant = z.object({
  userId: z.string().uuid(),
  tier: z.enum(ACCESS_TIERS),
  days: z.number().int().min(1).max(ACCESS_DAYS_MAX),
  credits: z.number().int().min(0).max(USER_CREDIT_GIFT_MAX),
  reason: z.string().trim().min(10).max(300),
  operationId: z.string().uuid(),
});

// Access for some days without a card: a plan or the trial tier, with credits
// that end with it. Fresh second factor, written reason, audited.
export const POST = defineAdminRoute({
  name: "admin.users.access-pass",
  permission: "entitlements.override",
  danger: true,
  body: Grant,
  handler: ({ body, admin, audit }) =>
    giftAccessPass({ actorId: admin.userId, actorRole: admin.role, audit }, body),
});

const End = z.object({
  userId: z.string().uuid(),
  reason: z.string().trim().min(10).max(300),
});

export const DELETE = defineAdminRoute({
  name: "admin.users.access-pass.end",
  permission: "entitlements.override",
  danger: true,
  body: End,
  handler: ({ body, admin, audit }) =>
    endAccessPass({ actorId: admin.userId, actorRole: admin.role, audit }, body),
});
