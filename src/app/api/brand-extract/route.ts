import { z } from "zod";
import { after } from "next/server";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { assertPublicUrl } from "@/server/safe-fetch";
import { normalizeUrl } from "@/lib/crawl/html";
import { runBrandExtraction } from "@/lib/brand-extract.server";
import type { BrandExtractEvent } from "@/lib/brand-extract-events";
import { normalizeDomain } from "@/lib/workspace/domain";
import { userSafeMessage } from "@/lib/user-errors";
import { paidTargetForUserRoute } from "@/server/billing/accounts.server";
import { beginDeferredMetered } from "@/server/billing/metered.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEntitlements } from "@/server/billing/entitlements.server";
import { billingSchemaReady } from "@/server/billing/schema.server";
import { creditsFor } from "@/lib/billing/catalog";
import { BrandFrozenError, SpendNotAllowedError } from "@/server/billing/errors";

export const dynamic = "force-dynamic";

const SCAN_FAILED = "We couldn't finish reading your site. Please try again.";

const BodySchema = z.object({
  url: z.string().min(1).max(2000),
});

// Streams NDJSON events ({type: "progress" | "error" | "result"}) while the
// pipeline in src/lib/brand-extract.server.ts crawls and analyses the site.
export const POST = defineRoute({
  name: "brand-extract",
  auth: "user",
  body: BodySchema,
  // Multi-page crawl + Claude extraction — expensive and slow.
  rateLimit: "audit",
  handler: async ({ body, request, userId, attributedWorkspaceId, supabase }) => {
    let safeUrl: URL;
    try {
      safeUrl = assertPublicUrl(normalizeUrl(body.url));
    } catch {
      return jsonError(400, "URL is not allowed");
    }

    const target = await paidTargetForUserRoute({
      attributedWorkspaceId,
      userId,
      supabase: supabase as unknown as SupabaseClient,
    });
    const entitlements = await getEntitlements({ ...target, userId });
    if (entitlements.enforcement === "on") {
      if (entitlements.frozen) throw new BrandFrozenError();
      if (entitlements.role === "viewer") throw new SpendNotAllowedError();
    }
    const domain = normalizeDomain(safeUrl.hostname);
    if (!domain) return jsonError(400, "Invalid website domain");
    const marker = new Date().toISOString();
    const { error: allowanceError } = !(await billingSchemaReady())
      ? { error: null }
      : await supabaseAdmin.from("brand_scan_allowances" as never).insert({
          account_id: entitlements.accountId,
          normalized_domain: domain,
          kind: "brand_dna",
          used_at: marker,
        } as never);
    if (allowanceError && allowanceError.code !== "23505") {
      throw new Error("Could not check the free Brand DNA scan.");
    }
    const free = !allowanceError;
    let charge: Awaited<ReturnType<typeof beginDeferredMetered>> | undefined;
    if (!free) {
      charge = await beginDeferredMetered({
        workspaceId: target.workspaceId,
        userId,
        role: target.role,
        actionName: "brand_dna_rescan",
        meter: "credits",
        amount: creditsFor("brand_dna_rescan"),
        idempotencyKey: request.headers.get("Idempotency-Key") ?? crypto.randomUUID(),
        route: "brand-extract",
      });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let finalEvent: BrandExtractEvent | null = null;
        await runBrandExtraction(safeUrl, (event) => {
          if (event.type === "result") {
            finalEvent = event;
            return;
          }
          // A stream skips the route's error filter, so failures are made safe here.
          const safe =
            event.type === "error"
              ? { ...event, error: userSafeMessage(event.error, SCAN_FAILED) }
              : event;
          try {
            controller.enqueue(encoder.encode(JSON.stringify(safe) + "\n"));
          } catch {
            // Client disconnected; the pipeline finishes and is discarded.
          }
        });
        try {
          if (finalEvent) {
            try {
              await charge?.capture();
            } catch {
              console.error("[billing] Brand DNA capture failed");
              try {
                controller.enqueue(
                  encoder.encode(
                    JSON.stringify({
                      type: "error",
                      stage: "billing",
                      code: "billing_capture_failed",
                      error: "Could not complete billing. Please contact support.",
                    }) + "\n",
                  ),
                );
              } catch {
                // The client disconnected; billing remains open for recovery.
              }
              return;
            }
            try {
              controller.enqueue(encoder.encode(JSON.stringify(finalEvent) + "\n"));
            } catch {
              // Provider work finished; capture remains valid after disconnect.
            }
            if (target.workspaceId && target.role !== "viewer") {
              const workspaceId = target.workspaceId;
              after(async () => {
                try {
                  const db = supabaseAdmin as unknown as SupabaseClient;
                  const existing = await db
                    .from("brand_visual_capture_jobs")
                    .select("id")
                    .eq("workspace_id", workspaceId)
                    .limit(1);
                  if (existing.error || existing.data?.length) return;
                  const { startVisualCapture } =
                    await import("@/server/brand-visuals/service.server");
                  const job = await startVisualCapture(
                    { workspaceId, userId, role: target.role },
                    {
                      url: safeUrl.href,
                      idempotencyKey: `initial-visual:${workspaceId}`,
                      maxPages: 4,
                    },
                  );
                  const { advanceVisualCapture } =
                    await import("@/server/brand-visuals/worker.server");
                  await advanceVisualCapture(job.id, workspaceId);
                } catch (error) {
                  console.warn(
                    "[brand-extract] visual capture could not start",
                    error instanceof Error ? error.message : error,
                  );
                }
              });
            }
          } else {
            await charge?.release();
            if (free) {
              await supabaseAdmin
                .from("brand_scan_allowances" as never)
                .delete()
                .eq("account_id", entitlements.accountId)
                .eq("normalized_domain", domain)
                .eq("kind", "brand_dna")
                .eq("used_at", marker);
            }
          }
        } finally {
          try {
            controller.close();
          } catch {
            // The client disconnected after the job completed.
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  },
});
