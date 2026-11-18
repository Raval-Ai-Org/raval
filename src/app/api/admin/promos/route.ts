import { z } from "zod";
import { defineAdminRoute } from "@/server/admin/route";
import { recordAdminAudit } from "@/server/admin/audit.server";
import { PROMO_LIMITS } from "@/lib/billing/promo";

export const dynamic = "force-dynamic";

// Trial codes: list (with who used one), create, pause, cap. Codes only give
// the trial tier for a few days and still need a card (promo.server.ts).
export const GET = defineAdminRoute({
  name: "admin.promos.list",
  permission: "entitlements.read",
  query: z.object({ redemptionsFor: z.string().uuid().optional() }),
  handler: async ({ query }) => {
    const { listPromos, listRedemptions } = await import("@/server/billing/promo.server");
    if (query.redemptionsFor) return { redemptions: await listRedemptions(query.redemptionsFor) };
    return { codes: await listPromos() };
  },
});

const Create = z.object({
  code: z.string().trim().min(4).max(32),
  label: z.string().trim().max(80).default(""),
  days: z.number().int().min(PROMO_LIMITS.days.min).max(PROMO_LIMITS.days.max),
  credits: z.number().int().min(PROMO_LIMITS.credits.min).max(PROMO_LIMITS.credits.max),
  maxUses: z.number().int().min(1).max(PROMO_LIMITS.uses.max).nullable(),
  expiresAt: z.string().datetime().nullable(),
  note: z.string().trim().max(300).default(""),
  reason: z.string().trim().min(10).max(300),
});

export const POST = defineAdminRoute({
  name: "admin.promos.create",
  permission: "entitlements.override",
  write: true,
  body: Create,
  handler: async ({ body, admin, audit }) => {
    const { createPromo } = await import("@/server/billing/promo.server");
    const row = await createPromo(admin.userId, body);
    await recordAdminAudit(
      {
        actorUserId: admin.userId,
        actorRole: admin.role,
        action: "promo.created",
        targetType: "promo_code",
        targetId: row.id,
        reason: body.reason,
        after: {
          code: row.code,
          days: row.trial_days,
          credits: row.credits,
          maxUses: row.max_redemptions,
        },
      },
      audit,
    );
    return { code: row };
  },
});

const Update = z.object({
  id: z.string().uuid(),
  active: z.boolean().optional(),
  maxUses: z.number().int().min(1).max(PROMO_LIMITS.uses.max).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  label: z.string().trim().max(80).optional(),
  reason: z.string().trim().min(10).max(300),
});

export const PATCH = defineAdminRoute({
  name: "admin.promos.update",
  permission: "entitlements.override",
  write: true,
  body: Update,
  handler: async ({ body, admin, audit }) => {
    const { updatePromo } = await import("@/server/billing/promo.server");
    const { id, reason, ...patch } = body;
    const { before, after } = await updatePromo(id, patch);
    await recordAdminAudit(
      {
        actorUserId: admin.userId,
        actorRole: admin.role,
        action: "promo.updated",
        targetType: "promo_code",
        targetId: id,
        reason,
        before: {
          active: before.active,
          maxUses: before.max_redemptions,
          expiresAt: before.expires_at,
        },
        after: {
          active: after.active,
          maxUses: after.max_redemptions,
          expiresAt: after.expires_at,
        },
      },
      audit,
    );
    return { code: after };
  },
});
