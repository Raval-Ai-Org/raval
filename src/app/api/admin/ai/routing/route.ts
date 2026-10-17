import { z } from "zod";
import { defineAdminRoute } from "@/server/admin/route";
import { setRouteOverride } from "@/server/admin/ai-controls.server";

export const dynamic = "force-dynamic";

const Body = z.object({
  route: z.string().min(1).max(80),
  models: z.array(z.string().min(3).max(80)).min(1).max(4).nullable(),
  effort: z.enum(["low", "medium", "high"]).nullable(),
  reason: z.string().trim().min(10).max(300),
});

// Changing which model answers a feature affects quality and cost for everyone,
// so it needs a fresh second factor. Models are limited to the ones the built-in
// plans already use; an environment variable still outranks the override.
export const POST = defineAdminRoute({
  name: "admin.ai.routing.set",
  permission: "ai.routing.manage",
  danger: true,
  body: Body,
  handler: ({ body, admin, audit }) =>
    setRouteOverride({ actorId: admin.userId, actorRole: admin.role, audit }, body),
});
