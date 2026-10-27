import { z } from "zod";
import { defineRoute } from "@/server/route";
import { HttpError } from "@/server/http-error";
import { cancelStudioJob } from "@/server/studio/runner.server";
import { settleStudioBilling } from "@/server/billing/studio-async.server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = defineRoute({
  name: "studio/jobs:cancel-all",
  auth: "workspace",
  minRole: "editor",
  body: z.object({ workspaceId: z.string().uuid() }),
  workspaceId: ({ body }) => body.workspaceId,
  rateLimit: "generate",
  handler: async ({ workspaceId, supabase }) => {
    const { data, error } = await supabase
      .from("studio_jobs")
      .select("id")
      .eq("workspace_id", workspaceId)
      .in("status", ["running", "queued"])
      .limit(100);
    if (error) throw new HttpError(503, "Could not load pending generations.");
    let cancelled = 0;
    for (const row of data ?? []) {
      const job = await cancelStudioJob(supabase, workspaceId, row.id);
      await settleStudioBilling(job);
      if (job.status === "cancelled") cancelled++;
    }
    return { cancelled };
  },
});
