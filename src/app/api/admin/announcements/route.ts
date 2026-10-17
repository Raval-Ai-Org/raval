import { z } from "zod";
import { defineAdminRoute } from "@/server/admin/route";
import { listAnnouncements, saveAnnouncement } from "@/server/admin/announcements.server";

export const dynamic = "force-dynamic";

const Body = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().max(600).default(""),
  tone: z.enum(["info", "success", "warning"]),
  linkUrl: z.string().trim().url().startsWith("https://").max(300).nullable().default(null),
  dismissible: z.boolean(),
  active: z.boolean(),
  startsAt: z.string().datetime().nullable().default(null),
  endsAt: z.string().datetime().nullable().default(null),
  reason: z.string().trim().min(10).max(300),
});

export const GET = defineAdminRoute({
  name: "admin.announcements.list",
  permission: "announcements.manage",
  handler: () => listAnnouncements(),
});

export const POST = defineAdminRoute({
  name: "admin.announcements.save",
  permission: "announcements.manage",
  write: true,
  body: Body,
  handler: ({ body, admin, audit }) =>
    saveAnnouncement({ actorId: admin.userId, actorRole: admin.role, audit }, body),
});
