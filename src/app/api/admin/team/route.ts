import { z } from "zod";
import { ADMIN_ROLE_KEYS, PERMISSIONS } from "@/lib/admin/permissions";
import { defineAdminRoute } from "@/server/admin/route";
import { listTeam, saveTeamMember } from "@/server/admin/team.server";

export const dynamic = "force-dynamic";

const Body = z
  .object({
    userId: z.string().uuid().optional(),
    email: z.string().trim().email().max(254).optional(),
    role: z.enum(ADMIN_ROLE_KEYS),
    status: z.enum(["active", "disabled"]),
    extraPermissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length).default([]),
    deniedPermissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length).default([]),
    note: z.string().trim().max(300).optional(),
    reason: z.string().trim().min(10).max(300),
  })
  .refine((value) => Boolean(value.userId) !== Boolean(value.email), {
    message: "Give either userId or email",
  });

export const GET = defineAdminRoute({
  name: "admin.team.list",
  permission: "admins.read",
  handler: ({ can }) => listTeam(can("users.pii.read")),
});

// Who is an admin. Needs a fresh second-factor check and the slowest rate limit.
export const POST = defineAdminRoute({
  name: "admin.team.save",
  permission: "admins.manage",
  danger: true,
  body: Body,
  handler: async ({ body, admin, audit }) => {
    const userId = await saveTeamMember(
      { actorId: admin.userId, actorRole: admin.role, audit },
      body,
    );
    return { ok: true, userId };
  },
});
