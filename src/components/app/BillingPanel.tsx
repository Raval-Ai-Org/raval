"use client";

// Mount point for the billing surfaces. Render <BillingPanel /> once per page
// shell: it holds Plan & billing, the upgrade screen, and the bridge that turns
// a server "402" into a toast with a button (never an automatic pop-up).

import { useEffect } from "react";
import { toast } from "sonner";
import { emitAppEvent, onAppEvent } from "@/lib/app-events";
import { blockHeadline } from "@/lib/billing/present";
import { BillingCenter } from "./billing/BillingCenter";
import { UpgradeDialog } from "./billing/UpgradeDialog";

export { WalletPill } from "./billing/WalletPill";

function BlockedToasts() {
  useEffect(
    () =>
      onAppEvent("billing:blocked", (event) => {
        const block = event.detail;
        if (!block) return;
        emitAppEvent("billing:changed");
        toast(blockHeadline(block), {
          id: `billing-${block.code}-${block.feature ?? block.meter ?? block.limit ?? ""}`,
          action: {
            label: block.code === "insufficient_balance" ? "Get more" : "See options",
            onClick: () => emitAppEvent("open:upgrade", block),
          },
          duration: 8000,
        });
      }),
    [],
  );
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
    const tabs = ["overview", "plans", "topup", "prices", "history"] as const;
    const match = tabs.find((item) => item === tab);
    // A short delay lets the billing window mount its listener first.
    window.setTimeout(() => emitAppEvent("open:usage", { tab: match ?? "overview" }), 300);
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
