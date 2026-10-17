import { z } from "zod";
import { defineAdminRoute } from "@/server/admin/route";
import { nudgeStudio } from "@/server/admin/jobs.server";

export const dynamic = "force-dynamic";

const Body = z.object({
  jobId: z.string().uuid(),
  reason: z.string().trim().min(10).max(300),
});

// One poll of a running Studio job, the same step a customer's page poll takes.
// It adds no new work and no new spend. Audited with its reason.
export const POST = defineAdminRoute({
  name: "admin.jobs.nudge",
  permission: "jobs.manage",
  write: true,
  body: Body,
  handler: ({ body, admin, audit }) =>
    nudgeStudio({ actorId: admin.userId, actorRole: admin.role, audit }, body.jobId, body.reason),
});
