"use client";

// One place for every billing button: Upgrade now, buy a pack, ask the owner.
// Owners pay through Stripe Checkout; teammates can still ask their owner.

import { useCallback, useState } from "react";
import { toast } from "@/lib/toast";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { emitAppEvent } from "@/lib/app-events";
import { authedFetch } from "@/lib/authed-fetch";
import type { BillingInterval, PaidPlanId } from "@/lib/billing/catalog";
import type { BillingView } from "@/lib/billing/use-entitlements";

export type PurchaseKind = "plan" | "credit_pack" | "video_pack";

function prepareCheckoutTab(): Window | null {
  const tab = window.open("about:blank", "_blank");
  if (!tab) return null;
  tab.opener = null;
  tab.document.title = "Opening secure checkout...";
  tab.document.body.style.cssText =
    "margin:0;min-height:100vh;display:grid;place-items:center;background:#09090b;color:#fafafa;font:500 15px system-ui,sans-serif";
  tab.document.body.textContent = "Opening secure Stripe checkout...";
  return tab;
}

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
  /** Keys of team upgrade requests just sent (shown as "Sent to the owner"). */
  const [sent, setSent] = useState<Set<string>>(new Set());

  const markSent = (key: string) => setSent((prev) => new Set(prev).add(key));

  const purchase = useCallback(
    async (args: {
      kind: PurchaseKind;
      key: string;
      interval?: BillingInterval;
      trial?: boolean;
    }): Promise<"redirected" | "changed" | "failed"> => {
      if (!data?.isOwner) return "failed";
      if (data.checkoutMode !== "card") {
        toast.warning("Payments are temporarily unavailable. Please try again shortly.");
        return "failed";
      }
      setBusy(args.key);
      try {
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
        // Reserve the tab during the click event. Opening it after the API
        // request resolves would be blocked as a popup by some browsers.
        const checkoutTab = prepareCheckoutTab();
        if (!checkoutTab) {
          toast.warning("Allow pop-ups for Mellox to open secure Stripe checkout in a new tab.");
          return "failed";
        }
        try {
          const result = await post("/api/billing/checkout", {
            kind: args.kind,
            key: args.key,
            quantity: 1,
            interval: args.interval,
            trial: args.trial,
            returnPath: window.location.pathname,
          });
          if (typeof result.url !== "string") throw new Error("Checkout did not open. Try again.");
          checkoutTab.location.href = result.url;
          checkoutTab.focus();
          toast.success("Secure checkout opened in a new tab.");
          return "redirected";
        } catch (cause) {
          checkoutTab.close();
          throw cause;
        }
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
