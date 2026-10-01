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
import { runMetered } from "@/server/billing/metered.server";
import { requireBillingFeature } from "@/server/billing/feature.server";
import { requireWithinLimit } from "@/server/billing/guards.server";
import { chargeCompetitorProfile } from "@/server/billing/async-charges.server";

/** Profile status per competitor, so only real research is charged. */
async function profileStatuses(
  context: { supabase: import("@supabase/supabase-js").SupabaseClient },
  workspaceId: string,
  ids: string[],
): Promise<Map<string, string | null>> {
  const { data } = await (context.supabase as import("@supabase/supabase-js").SupabaseClient)
    .from("workspace_competitors")
    .select("id,profile_status")
    .eq("workspace_id", workspaceId)
    .in("id", ids);
  return new Map((data ?? []).map((row) => [String(row.id), row.profile_status as string | null]));
}

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
  .inputValidator((data) =>
    z.object({ workspaceId: uuid, idempotencyKey: uuid.optional() }).parse(data),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ suggestions: CompetitorView[]; searched: number; available: boolean }> => {
      const role = await requireWorkspaceRole(context, data.workspaceId, "editor");
      const { runDiscoveryForWorkspace } = await import("@/server/competitors/workspace.server");
      const metered = await runMetered(
        {
          workspaceId: data.workspaceId,
          userId: context.userId,
          role,
          action: "competitor_discovery",
          idempotencyKey: data.idempotencyKey ?? crypto.randomUUID(),
          route: "competitors.discovery",
        },
        async (charge) => {
          const result = await runDiscoveryForWorkspace({
            supabase: context.supabase,
            workspaceId: data.workspaceId,
            userId: context.userId,
          });
          if (result.searched === 0) charge.setCapturedAmount(0);
          return result;
        },
      );
      return metered.result;
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
      const role = await requireWorkspaceRole(context, data.workspaceId, "editor");
      await requireBillingFeature({
        workspaceId: data.workspaceId,
        userId: context.userId,
        role,
        feature: "competitors",
        spending: true,
      });
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
    const role = await requireWorkspaceRole(context, data.workspaceId, "editor");
    await requireWithinLimit({
      workspaceId: data.workspaceId,
      userId: context.userId,
      role,
      limit: "competitors",
      feature: "competitors",
    });
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
    await chargeCompetitorProfile({
      workspaceId: data.workspaceId,
      userId: context.userId,
      role,
      competitorId: competitor.id,
      profileStatus: competitor.profileStatus,
    });
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
    const role = await requireWorkspaceRole(context, data.workspaceId, "editor");
    if (data.status === "tracked") {
      await requireWithinLimit({
        workspaceId: data.workspaceId,
        userId: context.userId,
        role,
        limit: "competitors",
        feature: "competitors",
      });
    }
    const { setStatus } = await import("@/server/competitors/store.server");
    await setStatus({
      workspaceId: data.workspaceId,
      competitorId: data.competitorId,
      status: data.status,
    });
    if (data.status === "tracked") {
      const statuses = await profileStatuses(context as never, data.workspaceId, [
        data.competitorId,
      ]);
      await chargeCompetitorProfile({
        workspaceId: data.workspaceId,
        userId: context.userId,
        role,
        competitorId: data.competitorId,
        profileStatus: statuses.get(data.competitorId),
      });
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
    const role = await requireWorkspaceRole(context, data.workspaceId, "editor");
    await requireWithinLimit({
      workspaceId: data.workspaceId,
      userId: context.userId,
      role,
      limit: "competitors",
      delta: data.competitorIds.length,
      feature: "competitors",
    });
    const { setStatus } = await import("@/server/competitors/store.server");
    const { kickCompetitor } = await import("@/server/competitors/service.server");
    const statuses = await profileStatuses(context as never, data.workspaceId, data.competitorIds);
    let tracked = 0;
    for (const competitorId of data.competitorIds) {
      await chargeCompetitorProfile({
        workspaceId: data.workspaceId,
        userId: context.userId,
        role,
        competitorId,
        profileStatus: statuses.get(competitorId),
      });
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
    const role = await requireWorkspaceRole(context, data.workspaceId, "editor");
    const { requestRefresh } = await import("@/server/competitors/store.server");
    const { kickCompetitor } = await import("@/server/competitors/service.server");
    // A full refresh researches the profile again (a quick one only sweeps
    // for updates, which is included).
    if (data.full) {
      await chargeCompetitorProfile({
        workspaceId: data.workspaceId,
        userId: context.userId,
        role,
        competitorId: data.competitorId,
        profileStatus: "pending",
        requireTracked: true,
      });
    }
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
