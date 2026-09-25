// competitors.ts — RPC for the Competitors surface.
//
// Reads use the caller's RLS-bound client; anything that costs money or
// changes data checks the workspace role first and then hands off to a
// dynamically imported server module, so the research providers never reach
// the read path.
import "server-only";
import { z } from "zod";
import { createServerFn } from "@/server/server-fn";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rateLimitFor } from "@/server/rate-limit";
import { requireWorkspaceRole } from "@/server/workspace-access.server";
import { assertPublicUrl } from "@/server/safe-fetch";
import type { CompetitorOverview, CompetitorView } from "@/lib/competitors/contracts";

export type {
  CompetitorOverview,
  CompetitorView,
  CompetitorUpdateView,
  CompetitorProfile,
  CompetitorSuggestion,
  CompetitorRelationship,
  CompetitorStatus,
  CompetitorUpdateKind,
  CompetitorSourceLink,
} from "@/lib/competitors/contracts";
export { UPDATE_KIND_LABELS, RELATIONSHIP_LABELS } from "@/lib/competitors/contracts";

const uuid = z.string().uuid();

export const getCompetitorOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<CompetitorOverview> => {
    await requireWorkspaceRole(context, data.workspaceId, "viewer");
    const { loadOverview } = await import("@/server/competitors/store.server");
    return loadOverview(context.supabase, data.workspaceId);
  });

/**
 * Find competitors from the business Mellox already understands. Tight rate
 * limit: this is several searches plus a model call, and a workspace discovers
 * its market once, not hourly.
 */
export const discoverCompetitors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("competitor-discovery")])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ suggestions: CompetitorView[]; searched: number; available: boolean }> => {
      await requireWorkspaceRole(context, data.workspaceId, "editor");
      const { runDiscoveryForWorkspace } = await import("@/server/competitors/workspace.server");
      return runDiscoveryForWorkspace({
        supabase: context.supabase,
        workspaceId: data.workspaceId,
        userId: context.userId,
      });
    },
  );

/** Automatically create the initial, researched set after Brand DNA is saved. */
export const bootstrapCompetitors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("competitor-discovery")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        scanSeed: z
          .object({
            hostname: z.string().min(3).max(255),
            siteName: z.string().max(100),
            description: z.string().max(240),
          })
          .optional(),
      })
      .parse(data),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ competitors: CompetitorView[]; searched: number; available: boolean }> => {
      await requireWorkspaceRole(context, data.workspaceId, "editor");
      const { bootstrapCompetitorsForWorkspace } =
        await import("@/server/competitors/workspace.server");
      return bootstrapCompetitorsForWorkspace({
        supabase: context.supabase,
        workspaceId: data.workspaceId,
        userId: context.userId,
        scanSeed: data.scanSeed,
      });
    },
  );

/** Add a competitor by hand. Always starts tracked — the user already decided. */
export const addCompetitor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("competitor-profile")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        url: z.string().min(3).max(2048),
        name: z.string().max(200).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<CompetitorView> => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const clean = data.url.trim().replace(/\/+$/, "");
    const url = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
    let safeUrl: URL;
    try {
      safeUrl = assertPublicUrl(url);
    } catch (error) {
      throw new Error(
        error instanceof Error ? error.message : "That website address can't be used",
      );
    }
    const { upsertCompetitor } = await import("@/server/competitors/store.server");
    const { kickCompetitor } = await import("@/server/competitors/service.server");
    const competitor = await upsertCompetitor({
      workspaceId: data.workspaceId,
      userId: context.userId,
      name: data.name?.trim() || safeUrl.hostname.replace(/^www\./, ""),
      domain: safeUrl.hostname,
      url: safeUrl.toString(),
      source: "manual",
      status: "tracked",
    });
    if (!competitor) throw new Error("That website address can't be used");
    // Research starts after the response is sent, so the card appears at once
    // and fills in rather than making the user wait on a crawl.
    kickCompetitor(competitor.id);
    return competitor;
  });

/** Track or ignore. Tracking queues research immediately. */
export const setCompetitorStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        competitorId: uuid,
        status: z.enum(["tracked", "ignored", "suggested"]),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const { setStatus } = await import("@/server/competitors/store.server");
    await setStatus({
      workspaceId: data.workspaceId,
      competitorId: data.competitorId,
      status: data.status,
    });
    if (data.status === "tracked") {
      const { kickCompetitor } = await import("@/server/competitors/service.server");
      kickCompetitor(data.competitorId);
    }
    return { ok: true };
  });

/** Accept several suggestions at once — the onboarding and Discover flows. */
export const trackCompetitors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("competitor-profile")])
  .inputValidator((data) =>
    z.object({ workspaceId: uuid, competitorIds: z.array(uuid).min(1).max(20) }).parse(data),
  )
  .handler(async ({ data, context }): Promise<{ tracked: number }> => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const { setStatus } = await import("@/server/competitors/store.server");
    const { kickCompetitor } = await import("@/server/competitors/service.server");
    let tracked = 0;
    for (const competitorId of data.competitorIds) {
      await setStatus({ workspaceId: data.workspaceId, competitorId, status: "tracked" });
      tracked += 1;
    }
    // Only the first few are kicked inline; the rest are due and the cron
    // sweep picks them up, so accepting ten competitors does not start ten
    // crawls in one request.
    for (const competitorId of data.competitorIds.slice(0, 2)) kickCompetitor(competitorId);
    return { tracked };
  });

export const refreshCompetitor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("competitor-profile")])
  .inputValidator((data) =>
    z.object({ workspaceId: uuid, competitorId: uuid, full: z.boolean().optional() }).parse(data),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const { requestRefresh } = await import("@/server/competitors/store.server");
    const { kickCompetitor } = await import("@/server/competitors/service.server");
    await requestRefresh({
      workspaceId: data.workspaceId,
      competitorId: data.competitorId,
      full: data.full ?? false,
    });
    kickCompetitor(data.competitorId);
    return { ok: true };
  });

export const markCompetitorUpdatesRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ workspaceId: uuid, competitorId: uuid.nullable().optional() }).parse(data),
  )
  .handler(async ({ data, context }): Promise<{ marked: number }> => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const { markUpdatesRead } = await import("@/server/competitors/store.server");
    return { marked: await markUpdatesRead({ ...data, competitorId: data.competitorId ?? null }) };
  });

export const removeCompetitor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid, competitorId: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const { deleteCompetitor } = await import("@/server/competitors/store.server");
    await deleteCompetitor(data);
    return { ok: true };
  });
