import { defineCronRoute } from "@/server/cron";
import { runSlackJobs } from "@/server/slack/worker.server";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export const POST = defineCronRoute({
  job: "slack",
  expectedIntervalSeconds: 60,
  handler: runSlackJobs,
});
