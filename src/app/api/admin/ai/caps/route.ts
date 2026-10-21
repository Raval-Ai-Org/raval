import { z } from "zod";
import { defineAdminRoute } from "@/server/admin/route";
import { setSpendCap } from "@/server/admin/ai-controls.server";

export const dynamic = "force-dynamic";

const usd = z.number().min(0).max(1_000_000).nullable();

const Body = z
  .object({
    scope: z.enum(["global", "workspace"]),
    workspaceId: z.string().uuid().nullable().default(null),
    dailyUsd: usd,
    monthlyUsd: usd,
    reason: z.string().trim().min(10).max(300),
  })
  .refine((value) => value.scope === "global" || value.workspaceId !== null, {
    message: "A workspace cap needs a workspace",
    path: ["workspaceId"],
  });

// A cap can stop every customer's AI use (global) or one workspace's, so it is a
// "danger" route. Both limits null removes the cap.
export const POST = defineAdminRoute({
  name: "admin.ai.caps.set",
  permission: "ai.caps.manage",
  danger: true,
  body: Body,
  handler: ({ body, admin, audit }) =>
    setSpendCap({ actorId: admin.userId, actorRole: admin.role, audit }, body),
});
