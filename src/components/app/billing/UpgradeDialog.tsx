"use client";

// Every "Upgrade", lock, "Get credits" and "See plans" press (`open:upgrade`)
// goes to the full-screen checkout (/checkout: Plan → Payment → Launch). It
// used to be a window inside the app canvas, where the plans were squeezed and
// cut off; the page has the whole screen. The reason travels in the link, so
// the page still leads with the plan that fixes it.
//
// In the app with no plan at all (`requirePlan`, pricing v4 has no Free plan,
// ADR-0050) the person is sent there straight away while billing is enforced.

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { onAppEvent } from "@/lib/app-events";
import { planRank } from "@/lib/billing/catalog";
import { checkoutHref } from "@/lib/billing/checkout-link";
import { asPlan, nextPlan, suggestedPlan } from "@/lib/billing/present";
import { useEntitlements } from "@/lib/billing/use-entitlements";

export function UpgradeDialog({ requirePlan = false }: { requirePlan?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const workspaceId = useOptionalWorkspaceId();
  const { data } = useEntitlements({ enabled: requirePlan });
  const current = asPlan(data?.entitledPlan);
  const mustChoose =
    requirePlan && Boolean(data) && current === "free" && data?.enforcement === "on";

  const state = useRef({ current, pathname, workspaceId });
  state.current = { current, pathname, workspaceId };

  useEffect(
    () =>
      onAppEvent("open:upgrade", (event) => {
        const block = event.detail ?? null;
        const { current: plan, pathname: from, workspaceId: ws } = state.current;
        const recommended = block
          ? suggestedPlan(block, plan)
          : planRank("growth") > planRank(plan)
            ? "growth"
            : nextPlan(plan);
        router.push(
          checkoutHref({
            view: block?.code === "insufficient_balance" && plan !== "free" ? "credits" : "plans",
            block,
            recommended,
            from: from ?? undefined,
            workspaceId: ws,
          }),
        );
      }),
    [router],
  );

  useEffect(() => {
    if (!mustChoose) return;
    router.replace(
      checkoutHref({
        required: true,
        from: pathname ?? undefined,
        workspaceId,
        recommended: "growth",
      }),
    );
  }, [mustChoose, pathname, router, workspaceId]);

  return null;
}
