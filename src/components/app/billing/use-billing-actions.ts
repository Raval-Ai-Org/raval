"use client";

// One place for every billing button: Upgrade now, buy a pack, ask the owner.
// With Stripe connected ("card") the buttons open checkout; until then
// ("request") they send a request that Mellox activates from /admin.

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { emitAppEvent } from "@/lib/app-events";
import { authedFetch } from "@/lib/authed-fetch";
import type { BillingInterval, PaidPlanId } from "@/lib/billing/catalog";
import type { BillingView } from "@/lib/billing/use-entitlements";

export type PurchaseKind = "plan" | "credit_pack" | "video_pack";

async function post(path: string, body: unknown, method = "POST") {
  const response = await authedFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(result.message ?? result.error ?? "Something went wrong. Try again."));
  }
  return result;
}

export function useBillingActions(data: BillingView | undefined) {
  const workspaceId = useOptionalWorkspaceId();
  const [busy, setBusy] = useState<string | null>(null);
  /** Keys of items a request was just sent for (shown as "Request sent"). */
  const [sent, setSent] = useState<Set<string>>(new Set());

  const markSent = (key: string) => setSent((prev) => new Set(prev).add(key));

  const purchase = useCallback(
    async (args: {
      kind: PurchaseKind;
      key: string;
      interval?: BillingInterval;
      trial?: boolean;
      contact?: string;
    }): Promise<"redirected" | "requested" | "changed" | "failed"> => {
      if (!data?.isOwner) return "failed";
      setBusy(args.key);
      try {
        if (data.checkoutMode === "card") {
          const subscribed = ["active", "past_due", "paused", "trialing"].includes(data.status);
          if (args.kind === "plan" && subscribed && !args.trial) {
            // Existing subscribers change plan in place (prorated by Stripe).
            await post("/api/billing/subscription/change", {
              plan: args.key as PaidPlanId,
              interval: args.interval ?? "month",
            });
            toast.success("Plan updated.");
            emitAppEvent("billing:changed");
            return "changed";
          }
          const result = await post("/api/billing/checkout", {
            kind: args.kind,
            key: args.key,
            quantity: 1,
            interval: args.interval,
            trial: args.trial,
            returnPath: window.location.pathname,
          });
          if (typeof result.url !== "string") throw new Error("Checkout did not open. Try again.");
          window.location.assign(result.url);
          return "redirected";
        }
        await post("/api/billing/requests", {
          kind: args.kind,
          key: args.key,
          interval: args.interval,
          contact: args.contact || undefined,
        });
        markSent(args.key);
        emitAppEvent("billing:changed");
        return "requested";
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : "Something went wrong. Try again.");
        return "failed";
      } finally {
        setBusy(null);
      }
    },
    [data],
  );

  const askOwner = useCallback(
    async (args: { feature?: string; requiredPlan?: string; message?: string }) => {
      if (!workspaceId) return false;
      setBusy("ask-owner");
      try {
        await post("/api/billing/upgrade-requests", { workspaceId, ...args });
        markSent("ask-owner");
        return true;
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : "Could not send the request.");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [workspaceId],
  );

  return { busy, sent, purchase, askOwner };
}
