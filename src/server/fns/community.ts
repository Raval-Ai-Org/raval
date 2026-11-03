// community.ts — RPC for Community Intelligence (Brain → Market → Communities).
//
// Reading needs membership and uses the caller's RLS client. Looking for
// threads (included, rate-limited, at most every few hours) and changing
// watches or a thread's status need editor. A reply draft is a person's click
// through runMetered (`community_reply`). Mellox never posts a reply.
import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerFn, type ServerFnContext } from "@/server/server-fn";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rateLimitFor } from "@/server/rate-limit";
import { HttpError } from "@/server/http-error";
import type { CommunityHome, CommunityReply, CommunityThreadView } from "@/lib/community/contracts";

export type {
  CommunityHome,
  CommunityReply,
  CommunityThreadView,
  CommunityWatch,
  CommunitySignals,
  CommunitySource,
  MatchKind,
  ThreadStatus,
} from "@/lib/community/contracts";

const uuid = z.string().uuid();
const svc = () => import("@/server/community/service.server");

async function caller(context: ServerFnContext, workspaceId: string, minRole: "viewer" | "editor") {
  const { isCommunityEnabled } = await import("@/lib/feature-flags");
  if (!isCommunityEnabled(workspaceId)) throw new HttpError(404, "Not found");
  const { requireWorkspaceRole } = await import("@/server/workspace-access.server");
  const role = await requireWorkspaceRole(context, workspaceId, minRole);
  return { workspaceId, userId: context.userId, role };
}

const db = (context: ServerFnContext) => context.supabase as unknown as SupabaseClient;

export const getCommunityHome = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<CommunityHome> => {
    await caller(context, data.workspaceId, "viewer");
    return (await svc()).getCommunityHome(db(context), data.workspaceId);
  });

export const getCommunityThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid, threadId: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<CommunityThreadView> => {
    await caller(context, data.workspaceId, "viewer");
    return (await svc()).getCommunityThread(db(context), data.workspaceId, data.threadId);
  });

/** Look for threads now; the first time this also starts the daily refresh. */
export const refreshCommunity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("community-refresh")])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const c = await caller(context, data.workspaceId, "editor");
    const { requireBillingFeature } = await import("@/server/billing/feature.server");
    await requireBillingFeature({ ...c, feature: "market_brain", spending: true });
    return (await svc()).requestRefresh(data.workspaceId, context.userId);
  });

export const pauseCommunity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("setup-write")])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await caller(context, data.workspaceId, "editor");
    await (await svc()).pauseRefresh(data.workspaceId);
    return { ok: true };
  });

export const setCommunityThreadStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("setup-write")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        threadId: uuid,
        status: z.enum(["new", "saved", "replied", "hidden"]),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await caller(context, data.workspaceId, "editor");
    await (await svc()).setThreadStatus(data.workspaceId, data.threadId, data.status);
    return { ok: true };
  });

export const addCommunityWatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("setup-write")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        kind: z.enum(["keyword", "community"]),
        value: z.string().trim().min(2).max(80),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await caller(context, data.workspaceId, "editor");
    await (await svc()).addWatch(data.workspaceId, context.userId, data.kind, data.value);
    return { ok: true };
  });

export const removeCommunityWatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("setup-write")])
  .inputValidator((data) => z.object({ workspaceId: uuid, watchId: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await caller(context, data.workspaceId, "editor");
    await (await svc()).removeWatch(data.workspaceId, data.watchId);
    return { ok: true };
  });

/** Draft a reply for a person to post. Charged per draft. */
export const draftCommunityReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("community-reply")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        threadId: uuid,
        note: z.string().trim().max(400).optional(),
        idempotencyKey: uuid.optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<CommunityReply> => {
    const c = await caller(context, data.workspaceId, "editor");
    const service = await svc();
    // Read with the caller's own client: the thread must belong to this workspace.
    const thread = await service.getCommunityThread(db(context), data.workspaceId, data.threadId);
    const [{ runMetered }, { draftCommunityReply: draft }, { runWithScope }] = await Promise.all([
      import("@/server/billing/metered.server"),
      import("@/server/community/reply.server"),
      import("@/server/request-context"),
    ]);
    const metered = await runMetered(
      {
        ...c,
        action: "community_reply",
        idempotencyKey: data.idempotencyKey ?? crypto.randomUUID(),
        route: "community.reply",
      },
      () =>
        runWithScope({ workspaceId: data.workspaceId, route: "community.reply" }, () =>
          draft({ workspaceId: data.workspaceId, thread, note: data.note }),
        ),
    );
    await service.saveReply(data.workspaceId, data.threadId, metered.result);
    return metered.result;
  });
