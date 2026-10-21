import { z } from "zod";
import { defineAdminRoute } from "@/server/admin/route";
import { listSwitches, setSwitch, SWITCH_KEYS } from "@/server/admin/switches.server";

export const dynamic = "force-dynamic";

const Body = z.object({
  key: z.enum(SWITCH_KEYS),
  engaged: z.boolean(),
  reason: z.string().trim().min(10).max(300),
});

export const GET = defineAdminRoute({
  name: "admin.switches.list",
  permission: "health.read",
  handler: ({ can }) => listSwitches(can("users.pii.read")),
});

// Stopping a paid area affects every customer at once, so it needs a fresh
// second-factor check, a written reason, and it is audited with the change.
export const POST = defineAdminRoute({
  name: "admin.switches.set",
  permission: "emergency.manage",
  danger: true,
  body: Body,
  handler: ({ body, admin, audit }) =>
    setSwitch(
      { actorId: admin.userId, actorRole: admin.role, audit },
      body.key,
      body.engaged,
      body.reason,
    ),
});
