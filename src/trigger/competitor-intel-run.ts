// competitor-intel-run.ts — the Trigger.dev task backing Competitor
// Intelligence once Trigger.dev is configured (ADR-0018). Task logic is a
// thin adapter over the same plain function
// (runCompetitorIntel/persistCompetitorIntelOutcome) the inline fallback in
// src/server/research/competitor-intel.server.ts already uses, so the
// business logic is unit-testable without a running Trigger.dev instance.
import { task } from "@trigger.dev/sdk";
import {
  persistCompetitorIntelOutcome,
  runCompetitorIntel,
} from "@/server/research/competitor-intel.server";

export type CompetitorIntelRunPayload = {
  runId: string;
    workspaceId: string;
  competitorUrl: string;
};

export const competitorIntelRun = task({
  id: "competitor-intel-run",
  maxDuration: 300,
  run: async (payload: CompetitorIntelRunPayload) => {
    try {
      const result = await runCompetitorIntel(payload.competitorUrl);
      await persistCompetitorIntelOutcome(payload.runId, { status: "succeeded", result });
      return { ok: true as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Competitor intelligence run failed";
      await persistCompetitorIntelOutcome(payload.runId, { status: "failed", error: message });
      throw error;
    }
  },
});
