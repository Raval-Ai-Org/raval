"use client";

// Mount point for the billing surfaces. Render <BillingPanel /> once per page
// shell: it holds Plan & billing, the upgrade screen, and the bridge that turns
// a server "402" into a toast with a button (never an automatic pop-up).

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { emitAppEvent, onAppEvent } from "@/lib/app-events";
import { authedFetch } from "@/lib/authed-fetch";
import { asPlan, freeNudge, isBillingMessage } from "@/lib/billing/present";
import { useEntitlements } from "@/lib/billing/use-entitlements";
import { BillingCenter } from "./billing/BillingCenter";
import { UpgradeDialog } from "./billing/UpgradeDialog";
import { plansFrom, upgradeCopy } from "./billing/UpgradePrompt";

export { WalletPill } from "./billing/WalletPill";

let errorToastsFiltered = false;

/**
 * A plan or balance limit is never shown as a red error. Components that
 * report failures with toast.error(message) pass the server's message through;
 * those billing messages are dropped here, because the friendly
 * "Upgrade / Get credits" toast below already covers them.
 */
function filterBillingErrorToasts() {
  if (errorToastsFiltered) return;
  errorToastsFiltered = true;
  const original = toast.error.bind(toast);
  const filtered: typeof toast.error = (message, data) => {
    if (isBillingMessage(message) || isBillingMessage(data?.description)) return "";
    return original(message, data);
  };
  toast.error = filtered;
}

function BlockedToasts() {
  const { data } = useEntitlements();
  const plan = useRef(data ? asPlan(data.entitledPlan) : undefined);
  plan.current = data ? asPlan(data.entitledPlan) : undefined;
  useEffect(() => {
    filterBillingErrorToasts();
    return onAppEvent("billing:blocked", (event) => {
      const block = event.detail;
      if (!block) return;
      emitAppEvent("billing:changed");
      const copy = upgradeCopy(block, plan.current);
      toast(copy.title, {
        id: `billing-${block.code}-${block.feature ?? block.meter ?? block.limit ?? ""}`,
        description: copy.text || undefined,
        ...(copy.action
          ? {
              action: {
                label: copy.action,
                onClick: () => emitAppEvent("open:upgrade", block),
              },
            }
          : {}),
        duration: 10_000,
      });
    });
  }, []);
  return null;
}

/**
 * On Free, tell the owner once per visit when the one-time credits are low,
 * gone or about to end. A toast with a button: the upgrade screen still opens
 * only when they click.
 */
function FreeNudges() {
  const { data } = useEntitlements();
  const free = Boolean(data?.isOwner) && asPlan(data?.entitledPlan) === "free";
  const credits = data?.meters.credits.available;
  const nextExpiry = data?.meters.credits.nextExpiry ?? null;
  useEffect(() => {
    if (!free || typeof credits !== "number") return;
    const nudge = freeNudge({ credits, nextExpiry });
    if (!nudge) return;
    const key = `mellox:free-nudge:${nudge.id}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
    } catch {
      return;
    }
    toast(nudge.title, {
      id: key,
      description: `${nudge.text} ${plansFrom()}`,
      action: {
        label: "See plans",
        onClick: () =>
          emitAppEvent(
            "open:upgrade",
            nudge.id === "empty" ? { code: "insufficient_balance", meter: "credits" } : undefined,
          ),
      },
      duration: 12_000,
    });
  }, [free, credits, nextExpiry]);
  return null;
}

/** Email links such as /projects?billing=topup open Plan & billing on that tab. */
function BillingDeepLink() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const url = new URL(window.location.href);
    const tab = url.searchParams.get("billing");
    if (!tab) return;
    const sessionId = url.searchParams.get("checkout_session_id");
    url.searchParams.delete("billing");
    url.searchParams.delete("checkout_session_id");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    let stopped = false;
    const later = (work: () => void) => window.setTimeout(work, 300);

    async function checkoutStatus() {
      if (!sessionId) return null;
      const response = await authedFetch(
        `/api/billing/checkout/status?sessionId=${encodeURIComponent(sessionId)}`,
      );
      if (!response.ok) throw new Error("Checkout status is unavailable.");
      return response.json() as Promise<{
        state: "active" | "processing" | "open" | "expired" | "failed";
        kind: "plan" | "credit_pack" | "video_pack";
      }>;
    }

    async function confirmPayment() {
      later(() => emitAppEvent("open:usage"));
      if (!sessionId) {
        toast.info("Payment submitted", {
          description: "Your plan and balance will refresh as soon as Stripe confirms it.",
        });
        await queryClient.invalidateQueries({ queryKey: ["billing"] });
        return;
      }
      const toastId = "billing-checkout-return";
      toast.loading("Confirming your payment…", {
        id: toastId,
        description: "Keep this page open while Stripe activates your purchase.",
        duration: Infinity,
      });
      try {
        for (let attempt = 0; attempt < 24 && !stopped; attempt++) {
          try {
            const result = await checkoutStatus();
            if (result?.state === "active") {
              await queryClient.invalidateQueries({ queryKey: ["billing"] });
              emitAppEvent("billing:changed");
              toast.success(result.kind === "plan" ? "Your plan is active" : "Credits added", {
                id: toastId,
                description: "Your purchase is ready to use.",
                duration: 6_000,
              });
              return;
            }
            if (result?.state === "expired") {
              toast.error("Checkout expired", {
                id: toastId,
                description: "No payment was completed. You can start checkout again.",
              });
              return;
            }
            if (result?.state === "failed") {
              toast.error("Payment was not completed", {
                id: toastId,
                description:
                  "Your plan was not activated. Any temporary bank authorization will be released automatically.",
              });
              return;
            }
          } catch {
            // A transient Stripe or database error should not end confirmation.
            // The next poll also repairs fulfillment from Stripe's paid state.
          }
          await new Promise((resolve) => window.setTimeout(resolve, 1_250));
        }
        if (!stopped) {
          await queryClient.invalidateQueries({ queryKey: ["billing"] });
          toast.info("Payment confirmation is taking longer", {
            id: toastId,
            description:
              "Keep this page open. Stripe retries automatically and your plan will activate as soon as payment is confirmed.",
            duration: 10_000,
          });
        }
      } catch {
        if (!stopped) {
          toast.info("Payment submitted", {
            id: toastId,
            description: "Your plan will refresh as soon as Stripe confirms it.",
            duration: 10_000,
          });
        }
      }
    }

    async function cancelCheckout() {
      if (sessionId) {
        try {
          const response = await authedFetch("/api/billing/checkout/status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId }),
          });
          const result = (await response.json().catch(() => null)) as {
            completed?: boolean;
          } | null;
          if (response.ok && result?.completed) {
            await confirmPayment();
            return;
          }
        } catch {
          // The checkout page was still canceled; a later retry can close an
          // open reservation after it expires.
        }
      }
      toast.info("Checkout canceled", { description: "No charge was made." });
      later(() => emitAppEvent("open:upgrade", undefined));
    }

    if (tab === "success" || tab === "return") void confirmPayment();
    else if (tab === "cancel") void cancelCheckout();
    else
      later(() => {
        if (tab === "plans") emitAppEvent("open:upgrade", undefined);
        else if (tab === "topup")
          emitAppEvent("open:upgrade", { code: "insufficient_balance", meter: "credits" });
        else emitAppEvent("open:usage");
      });

    return () => {
      stopped = true;
    };
  }, [queryClient]);
  return null;
}

export function BillingPanel() {
  return (
    <>
      <BillingDeepLink />
      <BillingCenter />
      <UpgradeDialog />
      <BlockedToasts />
      <FreeNudges />
    </>
  );
}
