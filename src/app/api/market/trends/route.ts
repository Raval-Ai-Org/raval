import { z } from "zod";
import { defineRoute } from "@/server/route";
import {
  pollGoogleTrendsCollection,
  requestGoogleTrendsCollection,
} from "@/lib/dataforseo/google-trends-collection.server";
import { ensureMarketBrainSchedule } from "@/lib/market-brain-scheduler.server";
import {
  marketFailure,
  marketLog,
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
  language: z
    .string()
    .trim()
    .regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/)
    .optional(),
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  timeRange: z
    .enum([
      "past_hour",
      "past_4_hours",
      "past_day",
      "past_7_days",
      "past_30_days",
      "past_90_days",
      "past_12_months",
      "past_5_years",
      "2004_present",
    ])
    .optional(),
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
  // Each scan is a billed DataForSEO query and feeds a billed analysis; shares
  // the per-workspace "audit" bucket with /api/market/intelligence.
  rateLimit: ({ userId, workspaceId }) => ({ tier: "audit", subject: `${userId}:${workspaceId}` }),
  handler: async ({ body }) => {
    const operation = operationId("market-scan");
    marketLog("scan request received", { operation });
    marketLog("workspace resolved", { operation, workspaceId: body.workspaceId });

    try {
      const result = await requestGoogleTrendsCollection(
        {
          keywords: body.keywords,
          location: body.location,
          language: body.language,
          dateFrom: body.dateFrom,
          dateTo: body.dateTo,
          timeRange: body.timeRange,
        },
        body.workspaceId,
        operation,
      );
      marketLog("keywords generated", { operation, count: body.keywords.length });
      const schedulePayload: {
        workspaceId: string;
        keywords: string[];
        location?: string | null;
        language?: string | null;
        dateFrom?: string;
        dateTo?: string;
        timeRange?: string;
      } = {
        workspaceId: body.workspaceId,
        keywords: body.keywords,
        location: body.location ?? null,
      };

      if (body.language) schedulePayload.language = body.language;
      if (body.dateFrom) schedulePayload.dateFrom = body.dateFrom;
      if (body.dateTo) schedulePayload.dateTo = body.dateTo;
      if (body.timeRange) schedulePayload.timeRange = body.timeRange;

      await withMarketTimeout(
        ensureMarketBrainSchedule(schedulePayload),
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
        source: "google_trends",
        ...result,
      });
    } catch (error) {
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
      const result = await pollGoogleTrendsCollection(collectionId, operation);
      marketLog("poll response returned", {
        operation,
        state: result.state,
        collectionId,
        error: result.error?.message,
      });
      return Response.json({
        success: result.state !== "failed",
        source: "google_trends",
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
