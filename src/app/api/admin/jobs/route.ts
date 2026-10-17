import { z } from "zod";
import { defineAdminRoute, pageQuery } from "@/server/admin/route";
import { listJobs } from "@/server/admin/jobs.server";

export const dynamic = "force-dynamic";

const Query = z.object({
  source: z.enum(["all", "studio", "geo_scan", "experiment", "autopilot"]).default("all"),
  state: z.enum(["all", "active", "failed", "stuck"]).default("all"),
  ...pageQuery,
});

export const GET = defineAdminRoute({
  name: "admin.jobs.list",
  permission: "jobs.read",
  query: Query,
  handler: ({ query }) => listJobs(query),
});
