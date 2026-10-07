"use client";

// Mount point for the billing surfaces. Render <BillingPanel /> once per page
// shell: it holds Plan & billing, the upgrade screen, and the bridge that turns
// a server "402" into a toast with a button (never an automatic pop-up).

import { useEffect, useRef } from "react";
import { toast } from "@/lib/toast";
import { emitAppEvent, onAppEvent } from "@/lib/app-events";
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
  useEffect(() => {
    const url = new URL(window.location.href);
    const tab = url.searchParams.get("billing");
    if (!tab) return;
    url.searchParams.delete("billing");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    // A short delay lets the billing windows mount their listeners first.
    window.setTimeout(() => {
      if (tab === "plans") emitAppEvent("open:upgrade", undefined);
      else if (tab === "topup")
        emitAppEvent("open:upgrade", { code: "insufficient_balance", meter: "credits" });
      else emitAppEvent("open:usage");
    }, 300);
  }, []);
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
