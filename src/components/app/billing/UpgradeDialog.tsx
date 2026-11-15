"use client";

// The upgrade window, wired to the real plan and balance. Opens only from a
// person's click (the Upgrade button, a lock, or the button on an "out of
// credits" toast), except in the app with no plan at all (`requirePlan`):
// there is no Free plan (pricing v4, ADR-0050), so it stays open and can't be
// closed until a plan is chosen. Plan & billing stays reachable from it.
// What it looks like is `UpgradeScreen`.
//
import { useEffect, useState } from "react";
import { onAppEvent } from "@/lib/app-events";
import { planRank, type BillingInterval } from "@/lib/billing/catalog";
import { asPlan, nextPlan, suggestedPlan, type BillingBlock } from "@/lib/billing/present";
import { useEntitlements } from "@/lib/billing/use-entitlements";
import { UpgradeWindow, type UpgradeChoice, type UpgradeView } from "./UpgradeScreen";
import { useBillingActions } from "./use-billing-actions";

export function UpgradeDialog({ requirePlan = false }: { requirePlan?: boolean }) {
  const [open, setOpen] = useState(false);
  const [block, setBlock] = useState<BillingBlock | null>(null);
  const [view, setView] = useState<UpgradeView>("plans");
  const [interval, setBillingInterval] = useState<BillingInterval>("year");
  const [packsAsked, setPacksAsked] = useState(false);
  const { data } = useEntitlements({ enabled: open || requirePlan });
  const actions = useBillingActions(data);
  const current = asPlan(data?.entitledPlan);
  // No plan: the app is locked behind the plan picker (data stays readable
  // through Plan & billing). Only while billing is enforced.
  const mustChoose =
    requirePlan && Boolean(data) && current === "free" && data?.enforcement === "on";
  // With no plan, a plan is the answer (credits every month), not a pack.
  const shownView = current === "free" && !packsAsked ? "plans" : view;

  useEffect(
    () =>
      onAppEvent("open:upgrade", (event) => {
        const next = event.detail ?? null;
        setBlock(next);
        setView(next?.code === "insufficient_balance" ? "credits" : "plans");
        setPacksAsked(false);
        setOpen(true);
      }),
    [],
  );

  // A reason (locked feature, limit, empty balance) picks the plan that fixes
  // it; a plain "Upgrade" recommends the most popular plan.
  const recommended = block
    ? suggestedPlan(block, current)
    : planRank("growth") > planRank(current)
      ? "growth"
      : nextPlan(current);
  const intervalFor = (item: UpgradeChoice) => (item.kind === "plan" ? interval : undefined);

  async function choose(item: UpgradeChoice) {
    await actions.purchase({ kind: item.kind, key: item.key, interval: intervalFor(item) });
  }

  return (
    <UpgradeWindow
      open={open || mustChoose}
      required={mustChoose}
      onOpenChange={(next) => {
        if (!next && mustChoose) return;
        setOpen(next);
      }}
      screen={
        data
          ? {
              current,
              block,
              recommended,
              view: shownView,
              onViewChange: (next) => {
                setPacksAsked(next === "credits");
                setView(next);
              },
              interval,
              onIntervalChange: setBillingInterval,
              canBuy: Boolean(data.isOwner),
              paymentsAvailable: data.checkoutMode === "card",
              busy: actions.busy,
              askSent: actions.sent.has("ask-owner"),
              balance: data.meters.credits.available,
              showVideoPacks: false,
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
