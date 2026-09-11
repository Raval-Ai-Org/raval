import { z } from "zod";
import { defineRoute } from "@/server/route";
import { analyzeMarketCollection, MarketIntelligenceError } from "@/lib/market-intelligence.server";
import {
  MARKET_INTELLIGENCE_ROUTE_TIMEOUT_MS,
  marketFailure,
  marketLog,
  MarketTimeoutError,
  operationId,
  withMarketTimeout,
} from "@/lib/market-reliability.server";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  workspaceId: z.string().uuid(),
  collectionId: z.string().uuid(),
  analysisType: z.string().trim().min(1).max(60).optional(),
});

export const POST = defineRoute({
  name: "market/intelligence",
  auth: "workspace",
  body: BodySchema,
  workspaceId: ({ body }) => body.workspaceId,
  // DataForSEO queries plus a Claude analysis, both billed per run, scoped to
  // the validated user+workspace.
  rateLimit: ({ userId, workspaceId }) => ({ tier: "audit", subject: `${userId}:${workspaceId}` }),
  handler: async ({ body }) => {
    const operation = operationId("market-intelligence");
    marketLog("intelligence API request received", { operation, collectionId: body.collectionId });

    try {
      const result = await withMarketTimeout(
        analyzeMarketCollection({
          collectionId: body.collectionId,
          workspaceId: body.workspaceId,
          analysisType: body.analysisType,
          operation,
        }),
        MARKET_INTELLIGENCE_ROUTE_TIMEOUT_MS,
        "Market intelligence took too long to generate. Please retry.",
      );
      marketLog("intelligence API response returned", {
        operation,
        state: result.state,
        code: result.error?.code,
      });
      return Response.json({
        success: result.state !== "failed",
        source: "market_intelligence",
        ...result,
      });
    } catch (error) {
      if (error instanceof MarketIntelligenceError) {
        marketLog("intelligence API failed", {
          operation,
          code: error.code,
          message: error.message,
        });
        return marketFailure(
          error.status,
          { message: error.message, code: error.code },
          { collectionId: body.collectionId },
        );
      }
      if (error instanceof MarketTimeoutError) {
        marketLog("intelligence API timed out", { operation, message: error.message });
        return marketFailure(
          504,
          { message: error.message, code: error.code },
          { collectionId: body.collectionId },
        );
      }
      console.error("[market] intelligence API failed", { operation, error });
      return marketFailure(
        502,
        { message: "Market intelligence service unavailable", code: "unexpected_error" },
        { collectionId: body.collectionId },
      );
    }
  },
});
