import "server-only";
import { createServerFn, type ServerFnContext } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rateLimitFor } from "@/server/rate-limit";
import { getWorkspaceRole } from "@/server/workspace-access.server";
import { roleAtLeast } from "@/server/api-auth";
import { ForbiddenError } from "@/server/http-error";

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
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const ctx = await fixContext(context, data.workspaceId);
    requireEditor(ctx);
    const svc = await import("@/server/geo/fixes/service.server");
    return svc.createProposal(ctx, data);
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
    return svc.approveAndApply(ctx, data);
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
    const svc = await import("@/server/geo/fixes/batch.server");
    return svc.createFixBatch(ctx, data);
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

export const listFixActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid, scanId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const svc = await import("@/server/geo/fixes/service.server");
    return svc.listFixActivity(await fixContext(context, data.workspaceId), data.scanId);
  });
