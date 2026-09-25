import "server-only";
import { createServerFn } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rateLimitFor } from "@/server/rate-limit";
import { CHANGE_TYPES, METRICS } from "@/lib/experiments/constants";

// Proof Engine (ADR-0024, src/server/experiments/). Reading needs membership;
// anything that changes an experiment or a repository needs editor; report
// branding needs admin. With the flag off every function answers 404.

const uuid = z.string().uuid();
const ws = { workspaceId: uuid };
const metric = z.enum(METRICS as unknown as [string, ...string[]]);
const changeType = z.enum(CHANGE_TYPES as unknown as [string, ...string[]]);
const hash = z.string().min(8).max(128);

async function ctx(
  context: Parameters<typeof import("@/server/experiments/core.server").experimentCtx>[0],
  workspaceId: string,
  minRole: "viewer" | "editor" | "admin" = "viewer",
) {
  const core = await import("@/server/experiments/core.server");
  return core.experimentCtx(context, workspaceId, minRole);
}
const svc = () => import("@/server/experiments/service.server");

/** Whether the Proof Engine is on for this workspace (for showing its entry). Never 404s. */
export const getProofEngineStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object(ws).parse(data))
  .handler(async ({ data, context }) => {
    const { requireWorkspaceRole } = await import("@/server/workspace-access.server");
    await requireWorkspaceRole(context, data.workspaceId, "viewer");
    const { isProofEngineEnabled } = await import("@/lib/feature-flags");
    return { enabled: isProofEngineEnabled(data.workspaceId) };
  });

export const getExperimentsOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object(ws).parse(data))
  .handler(async ({ data, context }) =>
    (await svc()).overview(await ctx(context, data.workspaceId)),
  );

export const getExperiment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ ...ws, experimentId: uuid }).parse(data))
  .handler(async ({ data, context }) =>
    (await svc()).getDetail(await ctx(context, data.workspaceId), data.experimentId),
  );

export const getDelivery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ ...ws, deliveryId: uuid }).parse(data))
  .handler(async ({ data, context }) =>
    (await svc()).getDelivery(await ctx(context, data.workspaceId), data.deliveryId),
  );

export const detectPageGroups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("analytics-sync")])
  .inputValidator((data) => z.object(ws).parse(data))
  .handler(async ({ data, context }) => {
    const groups = await import("@/server/experiments/groups.server");
    return groups.detectGroups(await ctx(context, data.workspaceId, "editor"));
  });

export const checkGroupEligibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("analytics")])
  .inputValidator((data) =>
    z.object({ ...ws, groupId: uuid, metric, force: z.boolean().optional() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const groups = await import("@/server/experiments/groups.server");
    return groups.groupEligibility(
      await ctx(context, data.workspaceId),
      data.groupId,
      data.metric as never,
      { force: data.force },
    );
  });

export const prepareGroupSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("experiment-propose")])
  .inputValidator((data) => z.object({ ...ws, groupId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const integration = await import("@/server/experiments/integration.server");
    return integration.prepareIntegration(
      await ctx(context, data.workspaceId, "editor"),
      data.groupId,
    );
  });

export const approveGroupSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((data) => z.object({ ...ws, deliveryId: uuid, contentHash: hash }).parse(data))
  .handler(async ({ data, context }) => {
    const deliveries = await import("@/server/experiments/deliveries.server");
    const c = await ctx(context, data.workspaceId, "editor");
    const row = await deliveries.approveAndOpen(c, data.deliveryId, data.contentHash);
    return { prUrl: row.pr_url, prNumber: row.pr_number };
  });

export const discardDelivery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("experiment-action")])
  .inputValidator((data) => z.object({ ...ws, deliveryId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const deliveries = await import("@/server/experiments/deliveries.server");
    await deliveries.discardDraftDelivery(
      await ctx(context, data.workspaceId, "editor"),
      data.deliveryId,
    );
    return { ok: true };
  });

export const suggestHypotheses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("experiment-propose")])
  .inputValidator((data) => z.object({ ...ws, groupId: uuid, metric }).parse(data))
  .handler(async ({ data, context }) =>
    (await svc()).suggestHypotheses(
      await ctx(context, data.workspaceId, "editor"),
      data.groupId,
      data.metric as never,
    ),
  );

export const createExperiment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("experiment-propose")])
  .inputValidator((data) =>
    z
      .object({
        ...ws,
        groupId: uuid,
        metric,
        changeType,
        name: z.string().trim().min(3).max(160),
        hypothesis: z.string().trim().min(10).max(2000),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) =>
    (await svc()).createExperiment(await ctx(context, data.workspaceId, "editor"), {
      groupId: data.groupId,
      metric: data.metric as never,
      changeType: data.changeType as never,
      name: data.name,
      hypothesis: data.hypothesis,
    }),
  );

export const retryPrepare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("experiment-propose")])
  .inputValidator((data) => z.object({ ...ws, experimentId: uuid }).parse(data))
  .handler(async ({ data, context }) =>
    (await svc()).retryPrepare(await ctx(context, data.workspaceId, "editor"), data.experimentId),
  );

export const editExperimentValue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("experiment-action")])
  .inputValidator((data) =>
    z
      .object({
        ...ws,
        experimentId: uuid,
        path: z.string().min(1).max(600),
        value: z.string().min(1).max(8000),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) =>
    (await svc()).editValue(await ctx(context, data.workspaceId, "editor"), data),
  );

export const refreshShip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("experiment-action")])
  .inputValidator((data) => z.object({ ...ws, experimentId: uuid }).parse(data))
  .handler(async ({ data, context }) =>
    (await svc()).refreshShip(await ctx(context, data.workspaceId, "editor"), data.experimentId),
  );

export const approveExperiment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((data) =>
    z.object({ ...ws, experimentId: uuid, deliveryId: uuid, contentHash: hash }).parse(data),
  )
  .handler(async ({ data, context }) =>
    (await svc()).approveShip(await ctx(context, data.workspaceId, "editor"), data),
  );

export const discardExperiment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("experiment-action")])
  .inputValidator((data) => z.object({ ...ws, experimentId: uuid }).parse(data))
  .handler(async ({ data, context }) =>
    (await svc()).discardDraft(await ctx(context, data.workspaceId, "editor"), data.experimentId),
  );

export const cancelExperiment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("experiment-action")])
  .inputValidator((data) => z.object({ ...ws, experimentId: uuid }).parse(data))
  .handler(async ({ data, context }) =>
    (await svc()).cancelExperiment(
      await ctx(context, data.workspaceId, "editor"),
      data.experimentId,
    ),
  );

export const stopExperiment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("experiment-action")])
  .inputValidator((data) =>
    z.object({ ...ws, experimentId: uuid, reason: z.string().max(400).default("") }).parse(data),
  )
  .handler(async ({ data, context }) =>
    (await svc()).stopExperiment(
      await ctx(context, data.workspaceId, "editor"),
      data.experimentId,
      data.reason,
    ),
  );

export const prepareDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("experiment-propose")])
  .inputValidator((data) =>
    z.object({ ...ws, experimentId: uuid, kind: z.enum(["rollout", "rollback"]) }).parse(data),
  )
  .handler(async ({ data, context }) =>
    (await svc()).prepareDecision(
      await ctx(context, data.workspaceId, "editor"),
      data.experimentId,
      data.kind,
    ),
  );

export const approveDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((data) =>
    z.object({ ...ws, experimentId: uuid, deliveryId: uuid, contentHash: hash }).parse(data),
  )
  .handler(async ({ data, context }) =>
    (await svc()).approveDecision(await ctx(context, data.workspaceId, "editor"), data),
  );

export const keepExperiment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("experiment-action")])
  .inputValidator((data) => z.object({ ...ws, experimentId: uuid }).parse(data))
  .handler(async ({ data, context }) =>
    (await svc()).keepAsIs(await ctx(context, data.workspaceId, "editor"), data.experimentId),
  );

export const closeExperiment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("experiment-action")])
  .inputValidator((data) => z.object({ ...ws, experimentId: uuid }).parse(data))
  .handler(async ({ data, context }) =>
    (await svc()).closeStopped(await ctx(context, data.workspaceId, "editor"), data.experimentId),
  );

export const setReportBranding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("experiment-action")])
  .inputValidator((data) =>
    z
      .object({
        ...ws,
        displayName: z.string().max(80).nullable(),
        logo: z
          .object({
            base64: z.string().max(1_400_000),
            contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
          })
          .nullable(),
        removeLogo: z.boolean().default(false),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const report = await import("@/server/experiments/report.server");
    return report.setBranding(await ctx(context, data.workspaceId, "admin"), data);
  });

export const getExperimentReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ ...ws, experimentId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const c = await ctx(context, data.workspaceId);
    const core = await import("@/server/experiments/core.server");
    await core.loadExperiment(c, data.experimentId); // RLS: the caller's own workspace
    const report = await import("@/server/experiments/report.server");
    return report.buildReport(data.experimentId, c.workspaceId);
  });
