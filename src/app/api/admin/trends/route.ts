import { z } from "zod";
import { defineAdminRoute } from "@/server/admin/route";
import { listTrends, saveTrend } from "@/server/admin/trends.server";
import { INDUSTRIES } from "@/lib/studio/knowledge/industries";
import { RADAR_SCOPES, RADAR_STATUSES } from "@/lib/trends/radar";

export const dynamic = "force-dynamic";

const INDUSTRY_IDS = INDUSTRIES.map((i) => i.id) as [string, ...string[]];
const words = (max: number, items: number) =>
  z.array(z.string().trim().min(1).max(max)).max(items).default([]);

const Body = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(2).max(120),
  brief: z.string().trim().max(2000).default(""),
  whatToMake: z.string().trim().max(1200).default(""),
  doNots: z.string().trim().max(800).default(""),
  scope: z.enum(RADAR_SCOPES),
  industries: z.array(z.enum(INDUSTRY_IDS)).max(25).default([]),
  workspaceIds: z.array(z.string().uuid()).max(200).default([]),
  languages: words(40, 20),
  platforms: words(30, 10),
  tags: words(60, 20),
  links: z.array(z.string().trim().url().startsWith("https://").max(400)).max(10).default([]),
  media: z
    .array(
      z.object({
        path: z.string().max(200),
        kind: z.enum(["image", "video"]),
        caption: z.string().trim().max(200).nullable().default(null),
      }),
    )
    .max(12)
    .default([]),
  allowMood: z.boolean().default(false),
  priority: z.number().int().min(1).max(5).default(3),
  status: z.enum(RADAR_STATUSES),
  startsAt: z.string().datetime().nullable().default(null),
  endsAt: z.string().datetime().nullable().default(null),
  reason: z.string().trim().min(10).max(300),
});

export const GET = defineAdminRoute({
  name: "admin.trends.list",
  permission: "trends.manage",
  handler: () => listTrends(),
});

export const POST = defineAdminRoute({
  name: "admin.trends.save",
  permission: "trends.manage",
  write: true,
  body: Body,
  handler: ({ body, admin, audit }) =>
    saveTrend({ actorId: admin.userId, actorRole: admin.role, audit }, body),
});
