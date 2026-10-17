import { z } from "zod";
import { exportAudit } from "@/server/admin/export.server";
import { defineAdminRoute } from "@/server/admin/route";

export const dynamic = "force-dynamic";

const iso = z.string().datetime({ offset: true });

const Body = z.object({
  actor: z.string().uuid().optional(),
  action: z.string().trim().max(80).optional(),
  targetType: z.string().trim().max(40).optional(),
  targetId: z.string().trim().max(80).optional(),
  from: iso.optional(),
  to: iso.optional(),
  failedOnly: z.boolean().optional(),
  reason: z.string().trim().min(10).max(300),
});

// Copies sensitive history out of the console: its own permission, a written
// reason, a row cap, a fresh second factor, and an audit row of its own.
export const POST = defineAdminRoute({
  name: "admin.audit.export",
  permission: "data.export",
  danger: true,
  body: Body,
  handler: ({ body, admin, audit, can }) => {
    const { reason, ...filter } = body;
    return exportAudit(
      { actorId: admin.userId, actorRole: admin.role, audit },
      filter,
      reason,
      can("users.pii.read"),
    );
  },
});
