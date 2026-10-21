import { z } from "zod";
import { defineAdminRoute } from "@/server/admin/route";
import { listFlags, saveFlag } from "@/server/admin/flags.server";
import { FLAG_KEY_PATTERN } from "@/lib/flags/evaluate";

export const dynamic = "force-dynamic";

const Body = z.object({
  key: z
    .string()
    .regex(FLAG_KEY_PATTERN, "Use lowercase letters, numbers, . - _ (3–60 characters)"),
  description: z.string().trim().max(300).default(""),
  enabled: z.boolean(),
  rolloutPercent: z.number().int().min(0).max(100),
  workspaceIds: z.array(z.string().uuid()).max(200).default([]),
  expiresAt: z.string().datetime().nullable().default(null),
  reason: z.string().trim().min(10).max(300),
});

export const GET = defineAdminRoute({
  name: "admin.flags.list",
  permission: "flags.read",
  handler: () => listFlags(),
});

export const POST = defineAdminRoute({
  name: "admin.flags.save",
  permission: "flags.manage",
  write: true,
  body: Body,
  handler: ({ body, admin, audit }) =>
    saveFlag({ actorId: admin.userId, actorRole: admin.role, audit }, body),
});
