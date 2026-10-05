import "server-only";
import { createServerFn } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rateLimitFor } from "@/server/rate-limit";
import { SUBJECT_KINDS, TwinInputSchema } from "@/lib/audience/contracts";
import type { ServerFnContext } from "@/server/server-fn";
import type { WorkspaceRole } from "@/server/api-auth";

// Audience (ADR-0031, src/server/audience/). Reading needs membership;
// scoring, checking, comparing and editing groups need editor. With the flag
// off every function except the status check answers 404.

const uuid = z.string().uuid();
const ws = { workspaceId: uuid };
const key = z.string().min(8).max(80);
const svc = () => import("@/server/audience/service.server");

async function caller(context: ServerFnContext, workspaceId: string, minRole: WorkspaceRole) {
  const service = await svc();
  service.assertAudienceEnabled(workspaceId);
  const { requireWorkspaceRole } = await import("@/server/workspace-access.server");
  const role = await requireWorkspaceRole(context, workspaceId, minRole);
  return { service, caller: { workspaceId, userId: context.userId, role } };
}

/** Whether Audience is on for this workspace (for showing its entry). Never 404s. */
export const getAudienceStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object(ws).parse(data))
  .handler(async ({ data, context }) => {
    const { requireWorkspaceRole } = await import("@/server/workspace-access.server");
    await requireWorkspaceRole(context, data.workspaceId, "viewer");
    const { isAudienceEnabled } = await import("@/lib/feature-flags");
    return { enabled: isAudienceEnabled(data.workspaceId) };
  });

export const getAudience = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object(ws).parse(data))
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "viewer");
    return c.service.getAudienceView(c.caller);
  });

/** Build or refresh the groups from Brand DNA and stored research. Included work. */
export const buildAudience = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("audience-write")])
  .inputValidator((data) => z.object({ ...ws, key }).parse(data))
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "editor");
    return c.service.buildAudience(c.caller, data.key);
  });

export const saveAudienceGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("audience-write")])
  .inputValidator((data) =>
    z.object({ ...ws, id: uuid.nullable(), group: TwinInputSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "editor");
    return c.service.saveTwin(c.caller, data.id, data.group);
  });

export const removeAudienceGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("audience-write")])
  .inputValidator((data) => z.object({ ...ws, id: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "editor");
    await c.service.archiveTwin(c.caller, data.id);
    return { ok: true };
  });

/** Scores that still match each piece's saved text. */
export const getAudienceScores = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ ...ws, contentItemIds: z.array(uuid).max(200) }).parse(data))
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "viewer");
    return c.service.getScores(c.caller, data.contentItemIds);
  });

export const getContentAudience = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ ...ws, contentItemId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "viewer");
    return c.service.getContentAudience(c.caller, data.contentItemId);
  });

/** The Mellox Score for one saved piece: one cheap model call, included. */
export const predictContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("audience-score")])
  .inputValidator((data) => z.object({ ...ws, contentItemId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "editor");
    return c.service.predictContent(c.caller, data.contentItemId);
  });

/** Ask a simulated panel about one saved piece. Charged. */
export const startAudienceCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("audience-run")])
  .inputValidator((data) => z.object({ ...ws, contentItemId: uuid, key }).parse(data))
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "editor");
    return c.service.startPulse(c.caller, data.contentItemId, data.key);
  });

/** Write other versions of one saved piece and rank them. Charged. */
export const startAudienceComparison = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("audience-run")])
  .inputValidator((data) => z.object({ ...ws, contentItemId: uuid, key }).parse(data))
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "editor");
    return c.service.startComparison(c.caller, data.contentItemId, data.key);
  });

/** Rank versions the caller already has (video concepts). Charged. */
export const startAudienceRanking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("audience-run")])
  .inputValidator((data) =>
    z
      .object({
        ...ws,
        key,
        kind: z.enum(SUBJECT_KINDS),
        platform: z.string().trim().max(30).default(""),
        variants: z
          .array(
            z.object({
              ref: z.string().min(1).max(80),
              label: z.string().trim().min(1).max(60),
              title: z.string().trim().max(200).default(""),
              body: z.string().trim().min(10).max(4000),
            }),
          )
          .min(2)
          .max(5),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "editor");
    return c.service.startRanking(c.caller, data);
  });

export const getAudienceRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ ...ws, runId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "viewer");
    return c.service.getRun(c.caller, data.runId);
  });

export const cancelAudienceRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("audience-write")])
  .inputValidator((data) => z.object({ ...ws, runId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "editor");
    return c.service.cancelRun(c.caller, data.runId);
  });

export const listAudiencePredictions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ ...ws, limit: z.number().int().min(1).max(50).default(20) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "viewer");
    return c.service.listRecentPredictions(c.caller, data.limit);
  });
