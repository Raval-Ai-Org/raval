"use client";

// Mount point for the billing surfaces. Render <BillingPanel /> once per page
// shell: it holds Plan & billing, the upgrade screen, and the bridge that turns
// a server "402" into a toast with a button (never an automatic pop-up).

import { useEffect } from "react";
import { toast } from "sonner";
import { emitAppEvent, onAppEvent } from "@/lib/app-events";
import { isBillingMessage } from "@/lib/billing/present";
import { BillingCenter } from "./billing/BillingCenter";
import { UpgradeDialog } from "./billing/UpgradeDialog";
import { upgradeCopy } from "./billing/UpgradePrompt";

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
  useEffect(() => {
    filterBillingErrorToasts();
    return onAppEvent("billing:blocked", (event) => {
      const block = event.detail;
      if (!block) return;
      emitAppEvent("billing:changed");
      const copy = upgradeCopy(block);
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
    </>
  );
}
