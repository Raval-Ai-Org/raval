import { z } from "zod";
import { defineRoute } from "@/server/route";
import { getLatestMarketBrain } from "@/lib/market-brain-latest.server";
import { marketFailure, marketLog, operationId } from "@/lib/market-reliability.server";

export const dynamic = "force-dynamic";

const QuerySchema = z.object({ workspaceId: z.string().uuid() });

// Read-only: returns the stored latest result, its analysis and any scan still
// running. No provider calls, so no rate limit.
export const GET = defineRoute({
  name: "market/latest",
  auth: "workspace",
  query: QuerySchema,
  workspaceId: ({ query }) => query.workspaceId,
  handler: async ({ query }) => {
    const operation = operationId("market-latest");
    try {
      const latest = await getLatestMarketBrain(query.workspaceId);
      marketLog("latest result returned", {
        operation,
        hasResult: Boolean(latest.result),
        hasIntelligence: Boolean(latest.intelligence),
        activeScan: Boolean(latest.activeScan),
      });
      return Response.json(
        { success: true, ...latest },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      marketLog("latest result failed", {
        operation,
        reason: error instanceof Error ? error.message : "unknown",
      });
      return marketFailure(502, {
        message: "Market Brain results could not be loaded",
        code: "latest_failed",
      });
    }
  },
});
