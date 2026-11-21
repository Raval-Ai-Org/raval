"use client";

// /checkout, wired: reads the link (`checkout-link.ts`), loads the person's
// plan for the workspace they came from, and moves between Plan → Payment →
// Launch in the URL, so Back, refresh and a bank redirect all land on the
// right step. Full screen on its own route: nothing in the app frame can clip it.

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { authedFetch } from "@/lib/authed-fetch";
import { ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import type { PromoOffer } from "@/lib/billing/promo";
import {
  checkoutHref,
  readCheckoutLink,
  type CheckoutItem,
  type CheckoutLink,
} from "@/lib/billing/checkout-link";
import type { BillingInterval, PaidPlanId } from "@/lib/billing/catalog";
import { asPlan } from "@/lib/billing/present";
import type { BillingView } from "@/lib/billing/use-entitlements";
import { CheckoutShell } from "./checkout-parts";
import { LaunchStep } from "./LaunchStep";
import { PayStep } from "./PayStep";
import { PlanStep } from "./PlanStep";

const SUBSCRIBED = ["active", "past_due", "paused", "trialing"];

export function CheckoutFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const link = useMemo(() => readCheckoutLink(new URLSearchParams(params.toString())), [params]);
  const [changedTo, setChangedTo] = useState<PaidPlanId | null>(null);
  const [askSent, setAskSent] = useState(false);
  const [asking, setAsking] = useState(false);

  const ws = link.workspaceId;
  const { data, error, refetch, isLoading } = useQuery<BillingView>({
    queryKey: ["billing", "entitlements", ws ?? "own"],
    queryFn: async () => {
      const query = ws ? `?workspaceId=${encodeURIComponent(ws)}` : "";
      const response = await authedFetch(`/api/billing/entitlements${query}`, {
        workspaceId: ws ?? undefined,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(typeof body?.error === "string" ? body.error : "Couldn't load your plan.");
      return body as BillingView;
    },
    staleTime: 15_000,
  });

  /** Every move is a URL change, so the browser's Back works step by step. */
  const go = useCallback(
    (next: Partial<CheckoutLink> & { item?: CheckoutItem | null }, replace = false) => {
      const merged = { ...link, ...next };
      const href = checkoutHref({
        step: merged.step,
        view: merged.view,
        item: merged.item,
        interval: merged.interval,
        recommended: merged.recommended,
        block: merged.block,
        from: merged.from,
        workspaceId: merged.workspaceId,
        required: merged.required,
        promo: merged.promo,
      });
      const withSession =
        merged.step === "launch" && merged.sessionId
          ? `${href}&checkout_session_id=${encodeURIComponent(merged.sessionId)}`
          : href;
      if (replace) router.replace(withSession, { scroll: false });
      else router.push(withSession, { scroll: true });
    },
    [link, router],
  );

  // A trial code in the link: what it gives this account (the server decides).
  const promoQuery = useQuery<PromoOffer, Error>({
    queryKey: ["billing", "promo", link.promo],
    enabled: Boolean(link.promo),
    retry: false,
    staleTime: Infinity,
    queryFn: async () => {
      const response = await authedFetch("/api/billing/promo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: link.promo }),
      });
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!response.ok)
        throw new Error(String(body?.message ?? body?.error ?? "That code isn't valid."));
      return body as unknown as PromoOffer;
    },
  });
  const promo = link.promo && promoQuery.data ? promoQuery.data : null;

  const current = asPlan(data?.entitledPlan);
  const subscribed = Boolean(data && SUBSCRIBED.includes(data.status));
  const locked = link.required && current === "free";
  // With no plan there is nowhere in the app to go back to: Back signs out.
  const leave = () => {
    if (!locked) return router.push(link.from);
    void supabase.auth.signOut().finally(() => router.replace("/login"));
  };

  const back =
    link.step === "pay"
      ? { label: "Plans", onClick: () => go({ step: "plan", item: null }) }
      : link.step === "plan"
        ? {
            label: locked ? "Sign out" : "Back to Mellox",
            onClick: leave,
          }
        : null;

  async function askOwner(plan: PaidPlanId | null) {
    if (!ws) {
      toast.info("Open Upgrade from inside the workspace to ask its owner.");
      return;
    }
    setAsking(true);
    try {
      const response = await authedFetch("/api/billing/upgrade-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: ws,
          feature: link.block?.feature ?? link.block?.limit ?? link.block?.meter,
          requiredPlan: plan ?? link.recommended ?? undefined,
        }),
      });
      if (!response.ok) throw new Error("Could not send the request.");
      setAskSent(true);
      toast.success("Sent to the owner");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not send the request.");
    } finally {
      setAsking(false);
    }
  }

  let body: React.ReactNode;
  if (error && !data) {
    body = (
      <ErrorState
        title="Couldn't load your plan"
        description={error instanceof Error ? error.message : undefined}
        onRetry={() => void refetch()}
      />
    );
  } else if (link.step === "launch" || changedTo) {
    body = (
      <LaunchStep
        sessionId={link.sessionId}
        changedTo={changedTo}
        onOpenApp={() => router.push(link.from)}
        onRetry={() => {
          setChangedTo(null);
          go({ step: link.item ? "pay" : "plan", sessionId: null });
        }}
      />
    );
  } else if (isLoading || !data) {
    body = (
      <div className="space-y-6">
        <Skeleton className="h-28 w-2/3 rounded-3xl" />
        <div className="grid gap-5 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[460px] rounded-[26px]" />
          ))}
        </div>
      </div>
    );
  } else if (link.step === "pay" && link.item && data.isOwner) {
    body = (
      <PayStep
        item={link.item}
        returnPath={link.from}
        subscribed={subscribed}
        promo={link.item.kind === "plan" && !subscribed ? promo : null}
        onIntervalChange={(interval: BillingInterval) =>
          link.item?.kind === "plan" && go({ item: { ...link.item, interval }, interval }, true)
        }
        onChangePlan={() => go({ step: "plan", item: null })}
        onPaid={(sessionId) => go({ step: "launch", sessionId }, true)}
        onChanged={() => setChangedTo(link.item?.kind === "plan" ? link.item.key : null)}
      />
    );
  } else {
    body = (
      <PlanStep
        current={current}
        view={link.view}
        onViewChange={(view) => go({ view, step: "plan", item: null }, true)}
        interval={link.interval}
        onIntervalChange={(interval) => go({ interval }, true)}
        recommended={link.recommended}
        block={link.block}
        canBuy={Boolean(data.isOwner)}
        paymentsAvailable={data.checkoutMode === "card"}
        askSent={askSent}
        busy={asking}
        balance={data.meters.credits.available}
        promo={promo}
        promoCode={link.promo}
        promoChecking={promoQuery.isFetching}
        promoError={link.promo && promoQuery.error ? promoQuery.error.message : null}
        canUsePromo={current === "free" && !subscribed && !data.trial.used}
        onPromo={(code) => go({ promo: code, view: "plans" }, true)}
        onPick={(item) =>
          go({ step: "pay", item, interval: item.kind === "plan" ? item.interval : link.interval })
        }
        onAskOwner={(plan) => void askOwner(plan)}
      />
    );
  }

  return (
    <CheckoutShell
      step={
        changedTo ? "launch" : link.step === "pay" && data && !data.isOwner ? "plan" : link.step
      }
      back={back}
    >
      {body}
    </CheckoutShell>
  );
}
