"use client";

// One place for every billing button: Upgrade now, buy a pack, ask the owner.
// Owners pay on /checkout (Stripe Elements in Mellox's page); teammates ask their owner.

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/toast";
import { checkoutHref } from "@/lib/billing/checkout-link";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
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
  /** Keys of team upgrade requests just sent (shown as "Sent to the owner"). */
  const [sent, setSent] = useState<Set<string>>(new Set());

  const markSent = (key: string) => setSent((prev) => new Set(prev).add(key));

  const router = useRouter();
  /**
   * Buying always happens on the full-screen checkout (/checkout), in this tab:
   * Stripe's fields sit inside Mellox's own page, never a new tab.
   */
  const purchase = useCallback(
    (args: { kind: PurchaseKind; key: string; interval?: BillingInterval }) => {
      if (!data?.isOwner || args.kind === "video_pack") return;
      const item =
        args.kind === "plan"
          ? {
              kind: "plan" as const,
              key: args.key as PaidPlanId,
              interval: args.interval ?? ("year" as const),
            }
          : { kind: "credit_pack" as const, key: args.key };
      router.push(checkoutHref({ item, from: window.location.pathname, workspaceId }));
    },
    [data, router, workspaceId],
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
