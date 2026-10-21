import { z } from "zod";
import { revokeOverride } from "@/server/admin/entitlements.server";
import { defineAdminRoute } from "@/server/admin/route";

export const dynamic = "force-dynamic";

// End an override now. The row is kept (with who ended it and why) so the
// history stays complete.
export const POST = defineAdminRoute({
  name: "admin.entitlements.override-revoke",
  permission: "entitlements.override",
  write: true,
  body: z.object({ id: z.string().uuid(), reason: z.string().trim().min(10).max(300) }),
  handler: async ({ body, admin, audit }) => {
    await revokeOverride(
      { actorId: admin.userId, actorRole: admin.role, audit },
      body.id,
      body.reason,
    );
    return { ok: true };
  },
});
