import "server-only";
import { createServerFn, type ServerFnContext } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rateLimitFor } from "@/server/rate-limit";
import { getWorkspaceRole } from "@/server/workspace-access.server";
import { roleAtLeast } from "@/server/api-auth";
import { ForbiddenError } from "@/server/http-error";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runMetered } from "@/server/billing/metered.server";
import { requireBillingFeature } from "@/server/billing/feature.server";

// AI Visibility fix workflow (src/server/geo/fixes/service.server.ts). Reading
// needs membership; proposing, approving, discarding and verifying need
// editor; connecting providers stays admin (src/server/fns/connectors.ts).

const uuid = z.string().uuid();
const branch = z.string().min(1).max(200);

async function fixContext(context: ServerFnContext, workspaceId: string) {
  const role = await getWorkspaceRole(context, workspaceId);
  if (!role) throw new ForbiddenError();
  const { supabase, userId } = context;
  return {
    supabase,
    userId,
    workspaceId,
    role,
    canPropose: roleAtLeast(role, "editor"),
    canManage: roleAtLeast(role, "admin"),
  };
}

function requireEditor(ctx: { canPropose: boolean }) {
  if (!ctx.canPropose) throw new ForbiddenError("Editor role required");
}

export const getFixAvailability = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid, findingId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const svc = await import("@/server/geo/fixes/service.server");
    return svc.getFixAvailability(await fixContext(context, data.workspaceId), data.findingId);
  });

export const listFixBranches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector")])
  .inputValidator((data) => z.object({ workspaceId: uuid, sourceId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const ctx = await fixContext(context, data.workspaceId);
    requireEditor(ctx);
    const svc = await import("@/server/geo/fixes/service.server");
    return svc.listFixBranches(ctx, data.sourceId);
  });

export const previewFix = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector")])
  .inputValidator((data) =>
    z
      .object({ workspaceId: uuid, findingId: uuid, sourceId: uuid, baseBranch: branch })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const ctx = await fixContext(context, data.workspaceId);
    requireEditor(ctx);
    const svc = await import("@/server/geo/fixes/service.server");
    return svc.previewFix(ctx, data);
  });

export const createFixProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("geo-fix")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        findingId: uuid,
        sourceId: uuid,
        baseBranch: branch,
        replaceDraft: z.boolean().optional(),
        idempotencyKey: uuid.optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const ctx = await fixContext(context, data.workspaceId);
    requireEditor(ctx);
    const svc = await import("@/server/geo/fixes/service.server");
    // Charged only when a proposal is written; "needs a manual fix" and
    // other refusals cost nothing.
    const { result } = await runMetered(
      {
        workspaceId: data.workspaceId,
        userId: context.userId,
        role: ctx.role,
        action: "geo_fix",
        idempotencyKey: data.idempotencyKey ?? crypto.randomUUID(),
        route: "geo.fix.propose",
      },
      async (charge) => {
        const out = await svc.createProposal(ctx, data);
        if (!out.ok) charge.setCapturedAmount(0);
        return out;
      },
    );
    return result;
  });

export const getFixProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ workspaceId: uuid, proposalId: uuid, sync: z.boolean().optional() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const svc = await import("@/server/geo/fixes/service.server");
    return svc.getProposal(await fixContext(context, data.workspaceId), data.proposalId, {
      sync: data.sync,
    });
  });

export const approveFixProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        proposalId: uuid,
        contentHash: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const ctx = await fixContext(context, data.workspaceId);
    requireEditor(ctx);
    const svc = await import("@/server/geo/fixes/service.server");
    const { data: row } = await supabaseAdmin
      .from("geo_fix_proposals")
      .select("provider")
      .eq("id", data.proposalId)
      .eq("workspace_id", data.workspaceId)
      .maybeSingle();
    if (row && row.provider !== "github") {
      // WordPress / Webflow: the one-click fix is charged when it is applied.
      const { result } = await runMetered(
        {
          workspaceId: data.workspaceId,
          userId: context.userId,
          role: ctx.role,
          action: "geo_cms_fix",
          idempotencyKey: `proposal:${data.proposalId}`,
          route: "geo.cms.fix",
        },
        () => svc.approveAndApply(ctx, data),
      );
      return result;
    }
    await requireBillingFeature({
      workspaceId: data.workspaceId,
      userId: context.userId,
      role: ctx.role,
      feature: "geo_apply_fixes",
      spending: true,
    });
    return svc.approveAndApply(ctx, data);
  });

/** WordPress / Webflow: put back the values an applied change replaced. */
export const undoCmsFix = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((data) => z.object({ workspaceId: uuid, proposalId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const ctx = await fixContext(context, data.workspaceId);
    requireEditor(ctx);
    const svc = await import("@/server/geo/fixes/service.server");
    return svc.undoCmsProposal(ctx, data.proposalId);
  });

/** GitHub / WordPress / Webflow: what each can do for this scan's website. */
export const getSiteConnections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector")])
  .inputValidator((data) => z.object({ workspaceId: uuid, scanId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const ctx = await fixContext(context, data.workspaceId);
    const svc = await import("@/server/geo/fixes/site-connections.server");
    return svc.getSiteConnections(ctx, await svc.scanHost(ctx, data.scanId));
  });

/** "Fix all" on a WordPress / Webflow site. */
export const getCmsFixAll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid, scanId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const svc = await import("@/server/geo/fixes/cms-fix-all.server");
    return svc.getCmsFixAll(await fixContext(context, data.workspaceId), data.scanId);
  });

export const startCmsFixAll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((data) => z.object({ workspaceId: uuid, scanId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const ctx = await fixContext(context, data.workspaceId);
    requireEditor(ctx);
    await requireBillingFeature({
      workspaceId: data.workspaceId,
      userId: context.userId,
      role: ctx.role,
      feature: "geo_apply_fixes",
      spending: true,
    });
    const svc = await import("@/server/geo/fixes/cms-fix-all.server");
    return svc.startCmsFixAll(ctx, data.scanId);
  });

export const applyCmsFixAll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        scanId: uuid,
        items: z
          .array(z.object({ proposalId: uuid, contentHash: z.string().regex(/^[0-9a-f]{64}$/) }))
          .min(1)
          .max(10),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const ctx = await fixContext(context, data.workspaceId);
    requireEditor(ctx);
    const svc = await import("@/server/geo/fixes/cms-fix-all.server");
    // One hold for the batch; only changes that really applied are charged.
    const { result } = await runMetered(
      {
        workspaceId: data.workspaceId,
        userId: context.userId,
        role: ctx.role,
        action: "geo_cms_fix",
        quantity: data.items.length,
        idempotencyKey: `cms-fix-all:${data.items
          .map((item) => item.proposalId)
          .sort()
          .join(",")}`,
        route: "geo.cms.fix",
      },
      async (charge) => {
        const out = await svc.applyCmsFixAll(ctx, data);
        const applied = out.results.filter((item) => item.ok).length;
        charge.setCapturedAmount(Math.round((charge.amount / data.items.length) * applied));
        return out;
      },
    );
    return result;
  });

export const discardFixProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((data) =>
    z
      .object({ workspaceId: uuid, proposalId: uuid, closePullRequest: z.boolean().default(false) })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const ctx = await fixContext(context, data.workspaceId);
    requireEditor(ctx);
    const svc = await import("@/server/geo/fixes/service.server");
    return svc.discardProposal(ctx, data);
  });

export const requestVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("geo-verify")])
  .inputValidator((data) =>
    z.object({ workspaceId: uuid, findingIds: z.array(uuid).min(1).max(20) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const ctx = await fixContext(context, data.workspaceId);
    requireEditor(ctx);
    const svc = await import("@/server/geo/fixes/service.server");
    return svc.requestVerification(ctx, data);
  });

export const getVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid, verificationId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const svc = await import("@/server/geo/fixes/service.server");
    return svc.getVerification(await fixContext(context, data.workspaceId), data.verificationId);
  });

/* ── "Fix all automatically": one pull request, one approval ── */

export const getFixAllPreflight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid, scanId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const svc = await import("@/server/geo/fixes/batch.server");
    return svc.getFixAllPreflight(await fixContext(context, data.workspaceId), data.scanId);
  });

export const createFixBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("geo-fix-batch")])
  .inputValidator((data) =>
    z.object({ workspaceId: uuid, scanId: uuid, sourceId: uuid, baseBranch: branch }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const ctx = await fixContext(context, data.workspaceId);
    requireEditor(ctx);
    await requireBillingFeature({
      workspaceId: data.workspaceId,
      userId: context.userId,
      role: ctx.role,
      feature: "geo_agent",
      spending: true,
    });
    const svc = await import("@/server/geo/fixes/batch.server");
    // "Fix all" costs one GEO fix per finding it writes a fix for. Hold for the
    // findings it will try; only the ones it actually fixed are charged.
    const preflight = await svc.getFixAllPreflight(ctx, data.scanId);
    const findings = Math.min(preflight.fixable.length, preflight.maxFindings);
    if (findings < 1) return svc.createFixBatch(ctx, data);
    const { beginAsyncCharge } = await import("@/server/billing/async-charges.server");
    const charge = await beginAsyncCharge({
      workspaceId: data.workspaceId,
      userId: context.userId,
      role: ctx.role,
      kind: "fix_batch",
      action: "geo_fix",
      quantity: findings,
      requestKey: `${data.scanId}:${Date.now()}`,
      route: "geo.fix.batch",
    });
    try {
      const batch = await svc.createFixBatch(ctx, data);
      await charge.link("fix_batch", batch.id);
      return batch;
    } catch (error) {
      await charge.release();
      throw error;
    }
  });

export const getFixBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ workspaceId: uuid, batchId: uuid, sync: z.boolean().optional() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const svc = await import("@/server/geo/fixes/batch.server");
    return svc.getFixBatch(await fixContext(context, data.workspaceId), data.batchId, {
      sync: data.sync,
    });
  });

export const approveFixBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((data) =>
    z
      .object({ workspaceId: uuid, batchId: uuid, contentHash: z.string().regex(/^[0-9a-f]{64}$/) })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const ctx = await fixContext(context, data.workspaceId);
    requireEditor(ctx);
    const svc = await import("@/server/geo/fixes/batch.server");
    return svc.approveFixBatch(ctx, data);
  });

// Merging puts the change live on the website, so it is an admin's click.
export const mergeFixBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((data) => z.object({ workspaceId: uuid, batchId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const ctx = await fixContext(context, data.workspaceId);
    if (!ctx.canManage) throw new ForbiddenError("Admin role required");
    const svc = await import("@/server/geo/fixes/batch.server");
    return svc.mergeFixBatch(ctx, data);
  });

export const mergeFixProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((data) => z.object({ workspaceId: uuid, proposalId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const ctx = await fixContext(context, data.workspaceId);
    if (!ctx.canManage) throw new ForbiddenError("Admin role required");
    const svc = await import("@/server/geo/fixes/service.server");
    return svc.mergeProposal(ctx, data);
  });

export const discardFixBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((data) =>
    z
      .object({ workspaceId: uuid, batchId: uuid, closePullRequest: z.boolean().default(false) })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const ctx = await fixContext(context, data.workspaceId);
    requireEditor(ctx);
    const svc = await import("@/server/geo/fixes/batch.server");
    return svc.discardFixBatch(ctx, data);
  });

// Before and after the first live fix, from stored scans and prompt checks. Starts nothing.
export const getFixImpact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid, scanId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const svc = await import("@/server/geo/fixes/impact.server");
    return svc.getFixImpact(await fixContext(context, data.workspaceId), data.scanId);
  });

export const listFixActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid, scanId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const svc = await import("@/server/geo/fixes/service.server");
    return svc.listFixActivity(await fixContext(context, data.workspaceId), data.scanId);
  });
