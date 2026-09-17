// marketing-coach-flags.server.ts — off by default (ADR-0019/0021):
// getCoachBriefing() calls synthesizeCoachBriefing() directly when this is
// false, so default behavior is byte-for-byte the pre-Mastra code path.
import "server-only";

export function marketingCoachWorkflowEnabled(): boolean {
  return (
    (process.env.FEATURE_FLAG_MARKETING_COACH_WORKFLOW_ENABLED ?? "false").trim().toLowerCase() ===
    "true"
  );
}
