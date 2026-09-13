// POST /api/sdr/publish — publish approved content to selected destinations
// through the active distribution provider. Server-side approval gate, target
// accounts restricted to the workspace, provider-side validation (SocialAPI) or
// authoritative limits (SDR), duplicate-safe claims, plan credit quota. The
// webhook receiver and reconcile sweep own terminal delivery state afterwards.
import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { getWorkspaceSdrConfig } from "@/lib/sdr.helpers.server";
import {
  publishContentItemsHandler,
  handleSdrDisabled,
  type PublishSelection,
} from "@/lib/sdr.handlers";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getDistributionProviderForWorkspace } from "@/lib/feature-flags";
import { publishHandler } from "@/lib/socialapi/handlers";
import { withSocialApi } from "@/lib/socialapi/route.server";

export const dynamic = "force-dynamic";

const SELECTION_TYPES: readonly string[] = ["account", "platform", "all"];

// Fields are validated individually below with the messages clients rely on.
const BodySchema = z.record(z.unknown());

export function readDistributionOptions(raw: unknown): { tiktokPrivacyLevel: string | null } {
  const value = (raw as { tiktokPrivacyLevel?: unknown } | null)?.tiktokPrivacyLevel;
  return {
    tiktokPrivacyLevel: typeof value === "string" && /^[A-Z_]{3,40}$/.test(value) ? value : null,
  };
}

export const POST = defineRoute({
  name: "sdr/publish",
  auth: "workspace",
  body: BodySchema,
  workspaceId: ({ body }) => body.workspaceId,
  minRole: "editor",
  handler: async ({ body, workspaceId, userId }) => {
    const contentItemIds = Array.isArray(body.contentItemIds)
      ? body.contentItemIds.filter((x: unknown): x is string => typeof x === "string")
      : [];
    if (contentItemIds.length === 0) return jsonError(400, "contentItemIds required");
    const selection = body.selection as PublishSelection | undefined;
    if (!selection || !SELECTION_TYPES.includes(selection.type)) {
      return jsonError(400, "Invalid destination selection");
    }

    const provider = getDistributionProviderForWorkspace(workspaceId);
    // Distribution off → refuse honestly; nothing is marked published.
    if (!provider) {
      const out = await handleSdrDisabled({ workspaceId, contentItemIds, kind: "publish" });
      return Response.json(out.body, { status: out.status });
    }

    if (provider === "socialapi") {
      const { tiktokPrivacyLevel } = readDistributionOptions(body.options);
      return withSocialApi(workspaceId, (deps) =>
        publishHandler(
          { workspaceId, userId, contentItemIds, selection, tiktokPrivacyLevel },
          deps,
        ),
      );
    }

    try {
      const { token, baseUrl } = await getWorkspaceSdrConfig(workspaceId);
      const out = await publishContentItemsHandler(
        { workspaceId, contentItemIds, selection },
        { sdrBaseUrl: baseUrl, token, db: supabaseAdmin },
      );
      return Response.json(out.body, { status: out.status });
    } catch (e) {
      return jsonError(503, e instanceof Error ? e.message : "SDR publish failed");
    }
  },
});
