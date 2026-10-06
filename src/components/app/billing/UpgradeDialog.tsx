"use client";

// The upgrade window, wired to the real plan and balance. Opens only from a
// person's click (the Upgrade button, a lock, or the button on an "out of
// credits" toast). What it looks like is `UpgradeScreen`.
//
// Until card payment is connected, choosing a plan or pack shows a short
// confirm step and sends a request; Mellox activates it after payment.

import { useEffect, useState } from "react";
import { onAppEvent } from "@/lib/app-events";
import { PLANS, planRank, type BillingInterval } from "@/lib/billing/catalog";
import { asPlan, nextPlan, suggestedPlan, type BillingBlock } from "@/lib/billing/present";
import { useEntitlements } from "@/lib/billing/use-entitlements";
import { UpgradeWindow, type UpgradeChoice, type UpgradeView } from "./UpgradeScreen";
import { useBillingActions } from "./use-billing-actions";

export function UpgradeDialog() {
  const [open, setOpen] = useState(false);
  const [block, setBlock] = useState<BillingBlock | null>(null);
  const [view, setView] = useState<UpgradeView>("plans");
  const [interval, setBillingInterval] = useState<BillingInterval>("year");
  const [pending, setPending] = useState<UpgradeChoice | null>(null);
  const [contact, setContact] = useState("");
  const [sent, setSent] = useState<UpgradeChoice | null>(null);
  const { data } = useEntitlements({ enabled: open });
  const actions = useBillingActions(data);

  useEffect(
    () =>
      onAppEvent("open:upgrade", (event) => {
        const next = event.detail ?? null;
        setBlock(next);
        setView(next?.code === "insufficient_balance" ? "credits" : "plans");
        setPending(null);
        setSent(null);
        setOpen(true);
      }),
    [],
  );

  const current = asPlan(data?.entitledPlan);
  // A reason (locked feature, limit, empty balance) picks the plan that fixes
  // it; a plain "Upgrade" recommends the most popular plan.
  const recommended = block
    ? suggestedPlan(block, current)
    : planRank("growth") > planRank(current)
      ? "growth"
      : nextPlan(current);
  const requestMode = data?.checkoutMode !== "card";
  const intervalFor = (item: UpgradeChoice) => (item.kind === "plan" ? interval : undefined);

  async function choose(item: UpgradeChoice) {
    if (requestMode) {
      setPending(item);
      return;
    }
    await actions.purchase({ kind: item.kind, key: item.key, interval: intervalFor(item) });
  }

  async function sendRequest() {
    if (!pending) return;
    const outcome = await actions.purchase({
      kind: pending.kind,
      key: pending.key,
      interval: intervalFor(pending),
      contact,
    });
    if (outcome === "requested") {
      setSent(pending);
      setPending(null);
    }
  }

  return (
    <UpgradeWindow
      open={open}
      onOpenChange={setOpen}
      pending={pending}
      sent={sent}
      contact={contact}
      onContactChange={setContact}
      onBack={() => setPending(null)}
      onSend={() => void sendRequest()}
      screen={
        data
          ? {
              current,
              block,
              recommended,
              view,
              onViewChange: setView,
              interval,
              onIntervalChange: setBillingInterval,
              canBuy: Boolean(data.isOwner),
              busy: actions.busy,
              askSent: actions.sent.has("ask-owner"),
              balance: data.meters.credits.available,
              showVideoPacks: block?.meter === "video" || PLANS[current].allowances.videoUnits > 0,
              onChoose: (item) => void choose(item),
              onAskOwner: (plan) =>
                void actions.askOwner({
                  feature: block?.feature ?? block?.limit ?? block?.meter,
                  requiredPlan: plan ?? recommended ?? undefined,
                }),
            }
          : null
      }
    />
  );
}
