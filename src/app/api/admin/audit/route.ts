import { z } from "zod";
import { listAudit } from "@/server/admin/audit-read.server";
import { defineAdminRoute, pageQuery } from "@/server/admin/route";

export const dynamic = "force-dynamic";

const iso = z.string().datetime({ offset: true });

const Query = z.object({
  actor: z.string().uuid().optional(),
  action: z.string().trim().max(80).optional(),
  targetType: z.string().trim().max(40).optional(),
  targetId: z.string().trim().max(80).optional(),
  from: iso.optional(),
  to: iso.optional(),
  failed: z.enum(["1", "0"]).optional(),
  ...pageQuery,
});

// Read-only by design: no route edits or deletes an audit row, and the table
// refuses it even for the service role.
export const GET = defineAdminRoute({
  name: "admin.audit.list",
  permission: "audit.read",
  query: Query,
  handler: ({ query, can }) =>
    listAudit(
      {
        actor: query.actor,
        action: query.action,
        targetType: query.targetType,
        targetId: query.targetId,
        from: query.from,
        to: query.to,
        failedOnly: query.failed === "1",
        page: query.page,
        pageSize: query.pageSize,
      },
      can("users.pii.read"),
    ),
});
