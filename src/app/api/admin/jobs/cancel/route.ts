import { z } from "zod";
import { defineAdminRoute } from "@/server/admin/route";
import { cancelStudio } from "@/server/admin/jobs.server";

export const dynamic = "force-dynamic";

const Body = z.object({
  jobId: z.string().uuid(),
  reason: z.string().trim().min(10).max(300),
});

// Runs the owner's own cancel (cancelStudioJob + billing settlement) for a Studio
// job that is still in flight. Audited with its reason, success or failure.
export const POST = defineAdminRoute({
  name: "admin.jobs.cancel",
  permission: "jobs.manage",
  write: true,
  body: Body,
  handler: ({ body, admin, audit }) =>
    cancelStudio({ actorId: admin.userId, actorRole: admin.role, audit }, body.jobId, body.reason),
});
