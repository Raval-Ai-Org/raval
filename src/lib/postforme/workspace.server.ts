import "server-only";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createPostForMeAdapter } from "@/lib/postforme/client.server";
import { isIntegrationsEnabled, isStoriesEnabled } from "@/lib/feature-flags";
import { composioConfigured } from "@/server/integrations/composio/gateway.server";
import type { ComposioHooks, SocialApiDeps, PostQuota } from "@/lib/postforme/handlers";

export const postForMeDb = supabaseAdmin as any;

const quota: PostQuota = {
  async check(workspaceId, needed) {
    const today = new Date();
    const start = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    ).toISOString();
    const { data, error } = await postForMeDb
      .from("social_usage_events")
      .select("targets")
      .eq("workspace_id", workspaceId)
      .gte("created_at", start);
    if (error) throw new Error("Could not check publishing activity");
    const used = (data ?? []).reduce(
      (total: number, event: { targets: number | null }) => total + Math.max(1, event.targets ?? 1),
      0,
    );
    return { ok: used + needed <= 100, used, limit: 100 };
  },
  async record(event) {
    const { error } = await postForMeDb.from("social_usage_events").insert({
      workspace_id: event.workspaceId,
      provider: "postforme",
      operation: event.operation,
      provider_post_id: event.providerPostId,
      content_item_id: event.contentItemId,
      user_id: event.userId,
      targets: event.targets,
    });
    if (error) throw new Error(error.message);
  },
};

// Composio-connected accounts (ADR-0042), loaded only when they can exist.
const composioHooks: ComposioHooks = {
  accounts: async (workspaceId) =>
    (await import("@/server/social/composio/service.server")).composioAccounts(workspaceId),
  deliver: async (args) => (await import("@/server/social/composio/service.server")).deliver(args),
  disconnect: async (workspaceId, accountId) => {
    const service = await import("@/server/social/composio/service.server");
    const out = await service.disconnectDestination(workspaceId, accountId);
    if (!out.found) return false;
    // The last destination of a connection gone: remove the connection too.
    if (out.integrationAccountId && out.remaining === 0) {
      const { retire } = await import("@/server/integrations/accounts.server");
      await retire({
        workspaceId,
        accountId: out.integrationAccountId,
        userId: null,
        reason: "disconnected by a person",
      });
    }
    return true;
  },
  retry: async (args) =>
    (await import("@/server/social/composio/service.server")).retryFailed(args),
  cancel: async (workspaceId, itemId) =>
    (await import("@/server/social/composio/service.server")).cancelPending(workspaceId, itemId),
  hasRows: async (workspaceId, itemId, status) =>
    (await import("@/server/social/composio/service.server")).hasComposioRows(
      workspaceId,
      itemId,
      status,
    ),
};

async function designedMedia(item: any): Promise<string[] | null> {
  const [{ ensureCarouselMedia }, { ensureStoryMedia }] = await Promise.all([
    import("@/server/studio/carousel-assets.server"),
    import("@/server/studio/story-assets.server"),
  ]);
  return (await ensureStoryMedia(item)) ?? (await ensureCarouselMedia(item));
}

export function getPostForMeDeps(workspaceId: string): SocialApiDeps {
  return {
    api: createPostForMeAdapter(workspaceId),
    db: postForMeDb,
    brandId: workspaceId,
    quota,
    storiesEnabled: isStoriesEnabled(workspaceId),
    designedMedia,
    ...(composioConfigured() && isIntegrationsEnabled(workspaceId)
      ? { composio: composioHooks }
      : {}),
  };
}

/** Scheduled Composio posts whose time has come (run-schedules hook). */
export async function runDueComposioPosts() {
  if (!composioConfigured()) return { sent: 0, failed: 0, cancelled: 0 };
  const [{ runDueComposioPublications }, { composioMediaFor, recomputeSocialItemStatus }] =
    await Promise.all([
      import("@/server/social/composio/service.server"),
      import("@/lib/postforme/handlers"),
    ]);
  return runDueComposioPublications(
    {
      mediaFor: (item) => composioMediaFor(item, { db: postForMeDb, designedMedia }),
      recompute: (itemId) => recomputeSocialItemStatus(postForMeDb, itemId),
    },
    { max: 20, budgetMs: 40_000 },
  );
}
