import { ROLE_PRESETS } from "@/lib/admin/permissions";
import type { AdminMe } from "@/lib/admin/types";
import { adminMfaRequired } from "@/server/admin/config.server";
import { defineAdminRoute } from "@/server/admin/route";

export const dynamic = "force-dynamic";

// Who the signed-in admin is and what they may see. The browser uses it to
// decide what to show; every other route checks the permission itself.
export const GET = defineAdminRoute({
  name: "admin.me",
  permission: "any",
  handler: ({ admin }): AdminMe => ({
    userId: admin.userId,
    role: admin.role,
    roleLabel: ROLE_PRESETS[admin.role].label,
    permissions: admin.permissions,
    source: admin.source,
    billing: admin.billing,
    mfaRequired: adminMfaRequired(),
  }),
});
