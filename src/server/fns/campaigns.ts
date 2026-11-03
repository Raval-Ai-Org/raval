import "server-only";
import { createServerFn } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rateLimitFor } from "@/server/rate-limit";
import type { ServerFnContext } from "@/server/server-fn";
import type { CampaignView, CampaignsHome } from "@/lib/campaigns/contracts";

// Campaigns (ADR-0039, src/server/campaigns/). Reading needs membership;
// every change needs editor. Planning and "Write it for me" are paid and
// metered; starting, pausing and ending are a person's click and free.

const uuid = z.string().uuid();
const svc = () => import("@/server/campaigns/service.server");

async function caller(
  context: ServerFnContext,
  workspaceId: string,
  minRole: "viewer" | "editor" | "admin",
) {
  const { assertCampaignsEnabled } = await svc();
  assertCampaignsEnabled(workspaceId);
  const { requireWorkspaceRole } = await import("@/server/workspace-access.server");
  const role = await requireWorkspaceRole(context, workspaceId, minRole);
  return { workspaceId, userId: context.userId, role };
}

export const getCampaignsHome = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<CampaignsHome> => {
    const who = await caller(context, data.workspaceId, "viewer");
    const s = await svc();
    await s.settleFinished(data.workspaceId).catch(() => undefined);
    return s.getCampaignsHome(who);
  });

export const getCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid, campaignId: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<CampaignView> => {
    const who = await caller(context, data.workspaceId, "viewer");
    return (await svc()).getCampaign(who, data.campaignId);
  });

export const saveCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("autopilot-write")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        campaignId: uuid.nullish(),
        brief: z.record(z.string(), z.unknown()),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<CampaignView> => {
    const who = await caller(context, data.workspaceId, "editor");
    return (await svc()).saveCampaign(who, { id: data.campaignId ?? null, brief: data.brief });
  });

export const editCampaignPiece = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("autopilot-write")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        campaignId: uuid,
        pieceId: z.string().regex(/^[a-z0-9-]{1,40}$/),
        patch: z
          .object({
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            time: z.string().regex(/^\d{2}:\d{2}$/),
            title: z.string().trim().max(120),
            idea: z.string().trim().max(700),
            visual: z.string().trim().max(300),
            mediaIds: z.array(uuid).max(6),
          })
          .partial(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<CampaignView> => {
    const who = await caller(context, data.workspaceId, "editor");
    return (await svc()).editPiece(who, {
      campaignId: data.campaignId,
      pieceId: data.pieceId,
      patch: data.patch,
    });
  });

export const planCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("generate")])
  .inputValidator((data) =>
    z
      .object({ workspaceId: uuid, campaignId: uuid, idempotencyKey: z.string().min(8).max(120) })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<CampaignView> => {
    const who = await caller(context, data.workspaceId, "editor");
    return (await svc()).planCampaign(who, {
      campaignId: data.campaignId,
      idempotencyKey: `campaign-plan:${data.campaignId}:${data.idempotencyKey}`,
    });
  });

export const writeCampaignBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("generate")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        type: z.string().min(2).max(40),
        name: z.string().max(80).optional(),
        about: z.string().max(800).optional(),
        productIds: z.array(uuid).max(3).optional(),
        idempotencyKey: z.string().min(8).max(120),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const who = await caller(context, data.workspaceId, "editor");
    return (await svc()).writeCampaignBrief(who, {
      type: data.type,
      name: data.name,
      about: data.about,
      productIds: data.productIds,
      idempotencyKey: `campaign-write:${data.idempotencyKey}`,
    });
  });

const one = z.object({ workspaceId: uuid, campaignId: uuid });

export const startCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("autopilot-write")])
  .inputValidator((data) => one.parse(data))
  .handler(async ({ data, context }): Promise<CampaignView> => {
    const who = await caller(context, data.workspaceId, "editor");
    return (await svc()).startCampaign(who, data.campaignId);
  });

export const pauseCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("autopilot-write")])
  .inputValidator((data) => one.extend({ paused: z.boolean() }).parse(data))
  .handler(async ({ data, context }): Promise<CampaignView> => {
    const who = await caller(context, data.workspaceId, "editor");
    return (await svc()).pauseCampaign(who, data.campaignId, data.paused);
  });

export const endCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("autopilot-write")])
  .inputValidator((data) => one.parse(data))
  .handler(async ({ data, context }): Promise<CampaignView> => {
    const who = await caller(context, data.workspaceId, "editor");
    return (await svc()).endCampaign(who, data.campaignId);
  });

export const setCampaignCount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("autopilot-write")])
  .inputValidator((data) =>
    one.extend({ count: z.number().int().min(0).max(100_000_000).nullable() }).parse(data),
  )
  .handler(async ({ data, context }): Promise<CampaignView> => {
    const who = await caller(context, data.workspaceId, "editor");
    return (await svc()).setCampaignCount(who, { campaignId: data.campaignId, count: data.count });
  });

export const deleteCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("autopilot-write")])
  .inputValidator((data) => one.parse(data))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const who = await caller(context, data.workspaceId, "admin");
    await (await svc()).deleteCampaign(who, data.campaignId);
    return { ok: true };
  });
