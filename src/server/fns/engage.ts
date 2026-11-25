// engage.ts — RPC for Engage (Inbox): comments on the brand's own Instagram
// and Facebook posts. Reading needs membership and uses the caller's RLS
// client. Refreshing, drafting, sending, dismissing and disconnecting need
// editor. A draft is a person's click through runMetered (`engage_reply`,
// included); a reply is sent only when a person presses Send.
import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerFn, type ServerFnContext } from "@/server/server-fn";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rateLimitFor } from "@/server/rate-limit";
import { HttpError } from "@/server/http-error";
import type {
  EngageDmStatus,
  EngageDraft,
  EngageHome,
  EngagePost,
  EngageRule,
  EngageStatus,
  EngageSyncResult,
} from "@/lib/engage/contracts";

export type {
  EngageAnswer,
  EngageComment,
  EngageDmStatus,
  EngageExample,
  EngagePost,
  EngageRule,
  RuleInput,
  EngageDraft,
  EngageHome,
  EngagePage,
  EngagePlatform,
  EngageStatus,
  EngageSyncResult,
} from "@/lib/engage/contracts";

const uuid = z.string().uuid();
const svc = () => import("@/server/engage/service.server");

async function caller(context: ServerFnContext, workspaceId: string, minRole: "viewer" | "editor") {
  const { isEngageEnabled } = await import("@/lib/feature-flags");
  if (!isEngageEnabled(workspaceId)) throw new HttpError(404, "Not found");
  const { requireWorkspaceRole } = await import("@/server/workspace-access.server");
  const role = await requireWorkspaceRole(context, workspaceId, minRole);
  return { workspaceId, userId: context.userId, role };
}

export const getEngageHome = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<EngageHome> => {
    await caller(context, data.workspaceId, "viewer");
    return (await svc()).getEngageHome(
      context.supabase as unknown as SupabaseClient,
      data.workspaceId,
    );
  });

export const syncEngage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("engage-sync")])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<EngageSyncResult> => {
    const c = await caller(context, data.workspaceId, "editor");
    const { requireBillingFeature } = await import("@/server/billing/feature.server");
    await requireBillingFeature({ ...c, feature: "publishing" });
    return (await svc()).syncEngage(data.workspaceId);
  });

export const draftEngageReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("engage-reply")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        commentId: uuid,
        note: z.string().trim().max(400).optional(),
        idempotencyKey: z.string().min(8).max(100).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<EngageDraft> => {
    const c = await caller(context, data.workspaceId, "editor");
    const service = await svc();
    const { comment } = await service.commentFor(data.workspaceId, data.commentId);
    const guidance = comment.rule_id
      ? await (
          await import("@/server/engage/automations.server")
        ).ruleGuidance(data.workspaceId, comment.rule_id)
      : null;
    if (comment.status === "replied" || comment.status === "dismissed")
      throw new HttpError(409, "This comment is already done.");
    const [{ runMetered }, { draftEngageReply: draft }, { runWithScope }] = await Promise.all([
      import("@/server/billing/metered.server"),
      import("@/server/engage/reply.server"),
      import("@/server/request-context"),
    ]);
    const metered = await runMetered(
      {
        ...c,
        action: "engage_reply",
        idempotencyKey: data.idempotencyKey ?? crypto.randomUUID(),
        route: "engage.reply",
      },
      () =>
        runWithScope({ workspaceId: data.workspaceId, route: "engage.reply" }, () =>
          draft({
            workspaceId: data.workspaceId,
            platform: comment.platform,
            comment: {
              body: comment.body,
              authorName: comment.author_name,
              postCaption: comment.post_caption,
            },
            note: data.note,
            guidance,
          }),
        ),
    );
    const { text, removed } = metered.result;
    if (comment.status !== "sending")
      await service.saveEngageDraft(data.workspaceId, data.commentId, text);
    return { text, removed };
  });

export const sendEngageReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("engage-send")])
  .inputValidator((data) =>
    z.object({ workspaceId: uuid, commentId: uuid, text: z.string().max(8_000) }).parse(data),
  )
  .handler(async ({ data, context }): Promise<{ status: EngageStatus }> => {
    await caller(context, data.workspaceId, "editor");
    const { brandDomainFor } = await import("@/server/engage/reply.server");
    return (await svc()).sendEngageReply({
      workspaceId: data.workspaceId,
      commentId: data.commentId,
      text: data.text,
      userId: context.userId,
      brandDomain: await brandDomainFor(data.workspaceId),
    });
  });

export const dismissEngageComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("setup-write")])
  .inputValidator((data) => z.object({ workspaceId: uuid, commentId: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await caller(context, data.workspaceId, "editor");
    await (await svc()).dismissEngageComment(data.workspaceId, data.commentId);
    return { ok: true };
  });

/** The Facebook Login for Business address, opened in the sign-in window. */
export const startMetaConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-connect")])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    await caller(context, data.workspaceId, "editor");
    const { startMetaOAuth } = await import("@/server/engage/meta/oauth.server");
    return { url: await startMetaOAuth(context.userId, data.workspaceId) };
  });

export const disconnectMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await caller(context, data.workspaceId, "editor");
    await (await svc()).disconnectMeta(data.workspaceId, context.userId);
    return { ok: true };
  });

// ── Automations and Train Mox ─────────────────────────────────────────────

const auto = () => import("@/server/engage/automations.server");

const ruleInput = z
  .object({
    name: z.string().max(200).optional(),
    platforms: z
      .array(z.enum(["instagram", "facebook"]))
      .max(2)
      .optional(),
    postScope: z.enum(["any", "posts"]).optional(),
    postIds: z.array(z.string().max(80)).max(30).optional(),
    match: z.enum(["keywords", "any"]).optional(),
    keywords: z.array(z.string().max(100)).max(40).optional(),
    wholeWord: z.boolean().optional(),
    replyMode: z.enum(["fixed", "mox", "none"]).optional(),
    replies: z.array(z.string().max(2_200)).max(12).optional(),
    moxGuidance: z.string().max(1_000).nullable().optional(),
    dmEnabled: z.boolean().optional(),
    dmMessage: z.string().max(1_000).nullable().optional(),
    dmLink: z.string().max(2_000).nullable().optional(),
    sendMode: z.enum(["auto", "approve"]).optional(),
  })
  .strict();

/** Recent posts, for choosing which posts an automation listens to. */
export const listEngagePosts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("engage-sync")])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<EngagePost[]> => {
    await caller(context, data.workspaceId, "editor");
    return (await auto()).listEngagePosts(data.workspaceId);
  });

export const saveEngageRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("setup-write")])
  .inputValidator((data) =>
    z.object({ workspaceId: uuid, id: uuid.optional(), rule: ruleInput }).parse(data),
  )
  .handler(async ({ data, context }): Promise<EngageRule> => {
    const c = await caller(context, data.workspaceId, "editor");
    return (await auto()).saveRule({
      workspaceId: data.workspaceId,
      userId: c.userId,
      id: data.id,
      input: data.rule,
    });
  });

export const deleteEngageRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("setup-write")])
  .inputValidator((data) => z.object({ workspaceId: uuid, id: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const c = await caller(context, data.workspaceId, "editor");
    await (await auto()).deleteRule(data.workspaceId, c.userId, data.id);
    return { ok: true };
  });

export const setEngageRuleStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("setup-write")])
  .inputValidator((data) =>
    z.object({ workspaceId: uuid, id: uuid, status: z.enum(["live", "paused"]) }).parse(data),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const c = await caller(context, data.workspaceId, "editor");
    await (await auto()).setRuleStatus(data.workspaceId, c.userId, data.id, data.status);
    return { ok: true };
  });

export const reorderEngageRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("setup-write")])
  .inputValidator((data) => z.object({ workspaceId: uuid, ids: z.array(uuid).max(40) }).parse(data))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await caller(context, data.workspaceId, "editor");
    await (await auto()).reorderRules(data.workspaceId, data.ids);
    return { ok: true };
  });

export const setEngageAutomations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("setup-write")])
  .inputValidator((data) => z.object({ workspaceId: uuid, on: z.boolean() }).parse(data))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const c = await caller(context, data.workspaceId, "editor");
    await (await auto()).setAutomations(data.workspaceId, c.userId, data.on);
    return { ok: true };
  });

export const saveEngageAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("setup-write")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        id: uuid.optional(),
        question: z.string().max(600),
        answer: z.string().max(3_000),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const c = await caller(context, data.workspaceId, "editor");
    await (await auto()).saveAnswer({ ...data, userId: c.userId });
    return { ok: true };
  });

export const deleteEngageAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("setup-write")])
  .inputValidator((data) => z.object({ workspaceId: uuid, id: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await caller(context, data.workspaceId, "editor");
    await (await auto()).deleteAnswer(data.workspaceId, data.id);
    return { ok: true };
  });

export const deleteEngageExample = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("setup-write")])
  .inputValidator((data) => z.object({ workspaceId: uuid, id: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await caller(context, data.workspaceId, "editor");
    await (await auto()).deleteExample(data.workspaceId, data.id);
    return { ok: true };
  });

/** Send the private message an automation prepared, from a person's click. */
export const sendEngageDm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("engage-send")])
  .inputValidator((data) => z.object({ workspaceId: uuid, commentId: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<{ dmStatus: EngageDmStatus }> => {
    await caller(context, data.workspaceId, "editor");
    const status = await (
      await svc()
    ).sendPrivateReply(data.workspaceId, data.commentId, context.userId);
    return { dmStatus: status };
  });
