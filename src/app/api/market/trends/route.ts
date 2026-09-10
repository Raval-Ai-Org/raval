import { z } from "zod";
import { jsonError, requireUserId } from "@/server/api-auth";
import { requireWorkspaceAccess } from "@/lib/sdr.helpers.server";
import {
  pollGoogleTrendsCollection,
  requestGoogleTrendsCollection,
} from "@/lib/dataforseo/google-trends-collection.server";
import { ensureMarketBrainSchedule } from "@/lib/market-brain-scheduler.server";
import { marketLog, operationId, withMarketTimeout } from "@/lib/market-reliability.server";

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

export async function POST(request: Request) {
  const operation = operationId("market-scan");
  marketLog("scan request received", { operation });
  const auth = await requireUserId(request);
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return jsonError(400, "Invalid request body");
  }

  const access = await requireWorkspaceAccess(request, body.workspaceId);
  if (!access.ok) return access.response;
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
      marketLog("schedule registration failed", { operation, reason: error instanceof Error ? error.message : "unknown" });
    });
    marketLog("scan response returned", { operation, state: result.state, collectionId: result.collectionId });
    return Response.json({ success: true, source: "google_trends", ...result });
  } catch (error) {
    marketLog("scan request failed", { operation, reason: error instanceof Error ? error.message : "unknown" });
    return Response.json(
      { status: "failed", data: null, error: { message: "Market scan could not be started" } },
      { status: 502 },
    );
  }
}

export async function GET(request: Request) {
  const operation = operationId("market-poll");
  marketLog("poll request received", { operation });
  const auth = await requireUserId(request);
  if (!auth.ok) return auth.response;

  const collectionId = new URL(request.url).searchParams.get("collectionId");
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (!collectionId || !z.string().uuid().safeParse(collectionId).success) {
    return jsonError(400, "collectionId is required");
  }
  if (!workspaceId || !z.string().uuid().safeParse(workspaceId).success) {
    return jsonError(400, "workspaceId is required");
  }
  const access = await requireWorkspaceAccess(request, workspaceId);
  if (!access.ok) return access.response;

  try {
    const result = await pollGoogleTrendsCollection(collectionId, operation);
    marketLog("poll response returned", { operation, state: result.state, collectionId });
    return Response.json({ success: true, source: "google_trends", ...result });
  } catch (error) {
    marketLog("poll request failed", { operation, reason: error instanceof Error ? error.message : "unknown" });
    return Response.json(
      { status: "failed", data: null, error: { message: "Market scan could not be polled" } },
      { status: 502 },
    );
  }
}
