import { z } from "zod";
import { defineRoute } from "@/server/route";
import {
  pollMarketSignalsCollection,
  requestMarketSignalsCollection,
} from "@/lib/market-signals-collection.server";
import { ensureMarketBrainSchedule } from "@/lib/market-brain-scheduler.server";
import {
  marketFailure,
  marketLog,
  MARKET_SCAN_ROUTE_TIMEOUT_MS,
  MarketTimeoutError,
  operationId,
  withMarketTimeout,
} from "@/lib/market-reliability.server";

export const dynamic = "force-dynamic";

const keyword = z
  .string()
  .trim()
  .min(2)
  .max(100)
  .refine((value) => !/[<>|"\-+=~!:*()[\]{}]/.test(value), "Invalid keyword");

const BodySchema = z.object({
  workspaceId: z.string().uuid(),
  keywords: z.array(keyword).min(1).max(5),
  location: z.string().trim().min(1).max(200).optional(),
});

const PollQuerySchema = z.object({
  collectionId: z.string().uuid(),
  workspaceId: z.string().uuid(),
});

export const POST = defineRoute({
  name: "market/trends",
  auth: "workspace",
  body: BodySchema,
  workspaceId: ({ body }) => body.workspaceId,
  // Each scan is a billed Tavily search and feeds a billed analysis; shares
  // the per-workspace "audit" bucket with /api/market/intelligence.
  rateLimit: ({ userId, workspaceId }) => ({ tier: "audit", subject: `${userId}:${workspaceId}` }),
  handler: async ({ body }) => {
    const operation = operationId("market-scan");
    marketLog("scan request received", { operation });
    marketLog("workspace resolved", { operation, workspaceId: body.workspaceId });

    try {
      // The search itself now runs inline here (Tavily answers within the
      // request; there is no provider task to create and poll for), so the
      // whole scan is bounded the same way the intelligence route bounds its
      // Claude call.
      const result = await withMarketTimeout(
        requestMarketSignalsCollection(
          { keywords: body.keywords, location: body.location },
          body.workspaceId,
          operation,
        ),
        MARKET_SCAN_ROUTE_TIMEOUT_MS,
        "Market scan took too long. Please retry.",
      );
      marketLog("keywords generated", { operation, count: body.keywords.length });

      await withMarketTimeout(
        ensureMarketBrainSchedule({
          workspaceId: body.workspaceId,
          keywords: body.keywords,
          location: body.location ?? null,
        }),
        5_000,
        "Market schedule registration timed out",
      ).catch((error) => {
        marketLog("schedule registration failed", {
          operation,
          reason: error instanceof Error ? error.message : "unknown",
        });
      });
      marketLog("scan response returned", {
        operation,
        state: result.state,
        collectionId: result.collectionId,
        error: result.error?.message,
      });
      return Response.json({
        success: result.state !== "failed",
        source: "tavily_market_signals",
        ...result,
      });
    } catch (error) {
      if (error instanceof MarketTimeoutError) {
        marketLog("scan request timed out", { operation, message: error.message });
        return marketFailure(504, { message: error.message, code: error.code });
      }
      marketLog("scan request failed", {
        operation,
        reason: error instanceof Error ? error.message : "unknown",
      });
      return marketFailure(502, {
        message: "Market scan could not be started",
        code: "scan_start_failed",
      });
    }
  },
});

export const GET = defineRoute({
  name: "market/trends:poll",
  auth: "workspace",
  query: PollQuerySchema,
  workspaceId: ({ query }) => query.workspaceId,
  handler: async ({ query }) => {
    const { collectionId } = query;
    const operation = operationId("market-poll");
    marketLog("poll request received", { operation });

    try {
      const result = await pollMarketSignalsCollection(collectionId, query.workspaceId, operation);
      marketLog("poll response returned", {
        operation,
        state: result.state,
        collectionId,
        error: result.error?.message,
      });
      return Response.json({
        success: result.state !== "failed",
        source: "tavily_market_signals",
        ...result,
      });
    } catch (error) {
      marketLog("poll request failed", {
        operation,
        collectionId,
        reason: error instanceof Error ? error.message : "unknown",
      });
      return marketFailure(
        502,
        { message: "Market scan status could not be checked", code: "poll_failed" },
        { collectionId },
      );
    }
  },
});
