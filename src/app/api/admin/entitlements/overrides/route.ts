import { z } from "zod";
import { MAX_OVERRIDE_LIMIT } from "@/lib/billing/overrides";
import { createOverride } from "@/server/admin/entitlements.server";
import { defineAdminRoute } from "@/server/admin/route";

export const dynamic = "force-dynamic";

const iso = z.string().datetime({ offset: true });

const Body = z
  .object({
    workspaceId: z.string().uuid(),
    scope: z.enum(["account", "workspace"]),
    kind: z.enum(["feature", "limit"]),
    key: z.string().regex(/^[A-Za-z0-9_]{1,64}$/),
    allowed: z.boolean().optional(),
    limitValue: z.number().int().min(0).max(MAX_OVERRIDE_LIMIT).optional(),
    startsAt: iso.optional(),
    expiresAt: iso.optional(),
    reason: z.string().trim().min(10).max(300),
  })
  .refine(
    (value) =>
      value.kind === "feature" ? value.allowed !== undefined : value.limitValue !== undefined,
    {
      message: "Give the value for this kind of override",
    },
  );

// Add an exception to a plan. It replaces any open override for the same target,
// ends by itself at expiresAt, and is recorded with the reason in the audit log.
export const POST = defineAdminRoute({
  name: "admin.entitlements.override-create",
  permission: "entitlements.override",
  write: true,
  body: Body,
  handler: async ({ body, admin, audit }) => {
    const row = await createOverride({ actorId: admin.userId, actorRole: admin.role, audit }, body);
    return { ok: true, id: row.id };
  },
});
