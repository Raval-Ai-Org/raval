// POST /api/integrations/github/webhook — GitHub App → Mellox webhook receiver
// (the URL configured on the "Mellox AI Production" GitHub App).
//
// Unauthenticated by design: the X-Hub-Signature-256 HMAC is the
// authentication (src/server/connectors/github/webhook.ts). Verified
// deliveries claim X-GitHub-Delivery in sdr_webhook_events (provider =
// 'github'), which is both the receipt log and the deduplication key.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { forgetInstallationToken } from "@/server/connectors/github/api.server";
import {
  handleGitHubWebhook,
  MAX_WEBHOOK_BYTES,
  type WebhookReceipt,
} from "@/server/connectors/github/webhook";

export const dynamic = "force-dynamic";

function receiptRow(r: WebhookReceipt) {
  return {
    provider: "github",
    event: r.event.slice(0, 80),
    workspace_id: r.workspaceId,
    outcome: r.outcome,
    reason: r.reason.slice(0, 200),
    delivery_id: r.outcome === "verified" ? r.deliveryId : null,
  };
}

async function connectionIds(installationId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("workspace_connections")
    .select("id")
    .eq("provider", "github")
    .eq("external_account_id", installationId);
  return (data ?? []).map((r) => r.id);
}

export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_WEBHOOK_BYTES)
    return Response.json({ ok: false, error: "Payload too large" }, { status: 413 });
  const rawBody = await request.text();

  const out = await handleGitHubWebhook(
    {
      rawBody,
      signature: request.headers.get("x-hub-signature-256"),
      event: request.headers.get("x-github-event"),
      deliveryId: request.headers.get("x-github-delivery"),
    },
    {
      secret: process.env.GITHUB_WEBHOOK_SECRET ?? "",
      recordRejection: (r) => {
        void supabaseAdmin
          .from("sdr_webhook_events")
          .insert(receiptRow(r))
          .then(({ error }) => {
            if (error) console.error("[github:webhook] rejection not recorded", error.message);
          });
      },
      claimDelivery: async (r) => {
        const { error } = await supabaseAdmin.from("sdr_webhook_events").insert(receiptRow(r));
        if (!error) return true;
        if (error.code === "23505") return false;
        // Receipt log unavailable: process anyway — every handler is idempotent.
        console.error("[github:webhook] delivery claim failed", error.message);
        return true;
      },
      findConnections: async (installationId) => {
        const { data, error } = await supabaseAdmin
          .from("workspace_connections")
          .select("id, workspace_id, status")
          .eq("provider", "github")
          .eq("external_account_id", installationId);
        if (error) throw new Error(error.message);
        return (data ?? []).map((r) => ({
          id: r.id,
          workspaceId: r.workspace_id,
          status: r.status,
        }));
      },
      updateConnections: async (installationId, patch) => {
        // A connection disconnected inside Mellox stays disconnected until an admin reconnects.
        const { error } = await supabaseAdmin
          .from("workspace_connections")
          .update({ ...patch, permissions: patch.permissions as Json | undefined })
          .eq("provider", "github")
          .eq("external_account_id", installationId)
          .neq("status", "revoked");
        if (error) throw new Error(error.message);
      },
      markSourcesAccessLost: async (installationId, repositoryIds) => {
        const ids = await connectionIds(installationId);
        if (!ids.length) return 0;
        let query = supabaseAdmin
          .from("workspace_sources")
          .update({ status: "access_lost" })
          .in("connection_id", ids);
        if (repositoryIds !== "all") query = query.in("external_id", repositoryIds);
        const { data, error } = await query.select("id");
        if (error) throw new Error(error.message);
        return data?.length ?? 0;
      },
      restoreSources: async (installationId, repositoryIds) => {
        const { data: active } = await supabaseAdmin
          .from("workspace_connections")
          .select("id")
          .eq("provider", "github")
          .eq("external_account_id", installationId)
          .eq("status", "active");
        const ids = (active ?? []).map((r) => r.id);
        if (!ids.length) return 0;
        const { data, error } = await supabaseAdmin
          .from("workspace_sources")
          .update({ status: "active" })
          .in("connection_id", ids)
          .in("external_id", repositoryIds)
          .select("id");
        if (error) throw new Error(error.message);
        return data?.length ?? 0;
      },
      audit: async (connection, action, payload) => {
        const { error } = await supabaseAdmin.from("audit_logs").insert({
          workspace_id: connection.workspaceId,
          user_id: null,
          action,
          entity: "connector",
          payload: { connectionId: connection.id, source: "github_webhook", ...payload } as Json,
        });
        if (error) console.error("[github:webhook] audit not recorded", error.message);
      },
      forgetToken: forgetInstallationToken,
      onPullRequest: async (installationId, pr) => {
        if (pr.headRef.startsWith("mellox/exp-")) {
          const { handleExperimentPullRequest } =
            await import("@/server/experiments/deliveries.server");
          return handleExperimentPullRequest(await connectionIds(installationId), pr);
        }
        if (pr.headRef.startsWith("mellox/post-")) {
          const { handlePublicationPullRequest } = await import("@/server/articles/publish.server");
          return handlePublicationPullRequest(await connectionIds(installationId), pr);
        }
        const { handlePullRequestWebhook } = await import("@/server/geo/fixes/service.server");
        return handlePullRequestWebhook(await connectionIds(installationId), pr);
      },
      onChecksCompleted: async (installationId, repositoryId, headSha) => {
        const { refreshChecksForCommit } = await import("@/server/geo/fixes/service.server");
        return refreshChecksForCommit(await connectionIds(installationId), repositoryId, headSha);
      },
      onAccessLost: async (installationId) => {
        const { markProposalsAccessLost } = await import("@/server/geo/fixes/service.server");
        return markProposalsAccessLost(await connectionIds(installationId));
      },
    },
  ).catch((error: unknown) => {
    console.error(
      "[github:webhook] handler failed",
      error instanceof Error ? error.message : error,
    );
    // 500 makes GitHub retry the delivery.
    return { status: 500, body: { ok: false, error: "Webhook processing failed" } };
  });

  return Response.json(out.body, { status: out.status });
}

export async function GET() {
  return Response.json({ ok: true, hint: "GitHub App webhooks are delivered here via POST" });
}
