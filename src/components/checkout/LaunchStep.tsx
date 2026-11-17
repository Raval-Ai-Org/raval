"use client";

// Step 3, Launch: ask the server until Stripe's payment is confirmed (the same
// status read the hosted checkout used; it also repairs fulfilment from
// Stripe's paid state), then Mox jumps and one button goes back into the app.
// Never claims success before the server says the purchase is active.

import Image from "next/image";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowRight, Check, Spinner } from "@/components/icons";
import { authedFetch } from "@/lib/authed-fetch";
import { emitAppEvent } from "@/lib/app-events";
import { PLANS, type PaidPlanId } from "@/lib/billing/catalog";
import { CtaButton, MOX, OutlineButton } from "./checkout-parts";

type State = "checking" | "active" | "slow" | "failed" | "expired";

const CONFETTI = ["#d9f53a", "#9cf03f", "#3fe46e", "#1fd6c4", "#0b0d10", "#ffffff"];

function Confetti() {
  return (
    <div
      aria-hidden
      className="checkout-confetti pointer-events-none fixed inset-0 z-30 overflow-hidden"
    >
      {Array.from({ length: 46 }, (_, i) => (
        <i
          key={i}
          style={
            {
              left: `${(i * 37) % 100}%`,
              background: CONFETTI[i % CONFETTI.length],
              animationDelay: `${(i % 12) * 60}ms`,
              animationDuration: `${2.2 + (i % 5) * 0.35}s`,
              "--dx": `${((i % 7) - 3) * 30}px`,
              boxShadow: i % 6 === 5 ? "0 0 0 1px rgb(0 0 0 / 0.08)" : undefined,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

export function LaunchStep({
  sessionId,
  changedTo,
  onOpenApp,
  onRetry,
}: {
  /** Paid through Stripe: confirm this session. */
  sessionId: string | null;
  /** Plan changed in place (no payment step): already active. */
  changedTo: PaidPlanId | null;
  onOpenApp: () => void;
  onRetry: () => void;
}) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<State>(changedTo ? "active" : "checking");
  const [kind, setKind] = useState<string>(changedTo ? "plan" : "");
  const [planKey, setPlanKey] = useState<string | null>(changedTo);

  useEffect(() => {
    if (!sessionId || changedTo) return;
    let stopped = false;
    void (async () => {
      for (let attempt = 0; attempt < 40 && !stopped; attempt++) {
        try {
          const response = await authedFetch(
            `/api/billing/checkout/status?sessionId=${encodeURIComponent(sessionId)}`,
          );
          if (response.ok) {
            const body = (await response.json()) as {
              state: "active" | "processing" | "open" | "expired" | "failed";
              kind: string;
              catalogKey?: string;
            };
            if (stopped) return;
            setKind(body.kind);
            setPlanKey(body.catalogKey ?? null);
            if (body.state === "active") {
              setState("active");
              return;
            }
            if (body.state === "failed" || body.state === "expired") {
              setState(body.state);
              return;
            }
          }
        } catch {
          // A blip in the network or Stripe is not an answer; ask again.
        }
        if (attempt === 14 && !stopped) setState("slow");
        await new Promise((resolve) => window.setTimeout(resolve, 1_500));
      }
    })();
    return () => {
      stopped = true;
    };
  }, [sessionId, changedTo]);

  useEffect(() => {
    if (state !== "active") return;
    void queryClient.invalidateQueries({ queryKey: ["billing"] });
    emitAppEvent("billing:changed");
  }, [state, queryClient]);

  const planLabel = planKey && planKey in PLANS ? PLANS[planKey as PaidPlanId].label : null;

  if (state === "active")
    return (
      <div className="relative mx-auto flex max-w-[560px] flex-col items-center pt-4 text-center">
        <Confetti />
        <div className="relative h-[230px] w-[180px]">
          <div className="absolute inset-6 rounded-full bg-[radial-gradient(closest-side,rgb(156_240_63/0.55),transparent)] blur-2xl" />
          <Image
            src={MOX.jump}
            alt=""
            fill
            sizes="180px"
            priority
            className="checkout-float object-contain"
          />
        </div>
        <span className="checkout-pop mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#30a46c]/12 px-3 py-1 text-[12.5px] font-semibold text-[#218358] dark:text-[#3dd68c]">
          <Check className="h-3.5 w-3.5" strokeWidth={3} />{" "}
          {changedTo ? "Plan switched" : "Payment confirmed"}
        </span>
        <h1 className="checkout-rise mt-4 text-[32px] font-bold leading-tight tracking-tight sm:text-[40px]">
          {kind === "plan" ? `Welcome to ${planLabel ?? "your new plan"}!` : "Your credits are in"}
        </h1>
        <p
          className="checkout-rise mt-3 max-w-[440px] text-[14px] leading-relaxed text-muted-foreground"
          style={{ animationDelay: "80ms" }}
        >
          {kind === "plan"
            ? "Everything on your plan is switched on and your monthly credits are ready. Mox is waiting for your first idea."
            : "They work on every brand on your account, for the next 12 months."}
        </p>
        <CtaButton
          className="checkout-rise mt-7 h-[52px] px-8 text-[15px]"
          style={{ animationDelay: "160ms" }}
          onClick={onOpenApp}
        >
          Start creating <ArrowRight className="h-4 w-4" />
        </CtaButton>
        <p className="mt-4 text-[12px] text-muted-foreground">
          Manage it any time in Plan &amp; billing.
        </p>
      </div>
    );

  if (state === "failed" || state === "expired")
    return (
      <div className="mx-auto flex max-w-[460px] flex-col items-center pt-10 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-[#e5484d]/10 text-[#e5484d]">
          <AlertCircle className="h-6 w-6" />
        </span>
        <h1 className="mt-4 text-[26px] font-bold tracking-tight">
          {state === "expired" ? "This checkout expired" : "The payment didn't go through"}
        </h1>
        <p className="mt-2 text-[14px] text-muted-foreground">
          Your plan wasn't changed. Any temporary hold from your bank is released by itself.
        </p>
        <div className="mt-6 flex gap-3">
          <OutlineButton className="h-11 px-5 text-[14px]" onClick={onOpenApp}>
            Back to Mellox
          </OutlineButton>
          <CtaButton className="h-11 px-5 text-[14px]" onClick={onRetry}>
            Try again
          </CtaButton>
        </div>
      </div>
    );

  return (
    <div
      className="mx-auto flex max-w-[460px] flex-col items-center pt-10 text-center"
      aria-live="polite"
    >
      <div className="relative h-[150px] w-[150px]">
        <Image
          src={MOX.visor}
          alt=""
          fill
          sizes="150px"
          className="checkout-float object-contain"
        />
      </div>
      <h1 className="mt-4 flex items-center gap-2 text-[24px] font-bold tracking-tight">
        <Spinner className="h-5 w-5 animate-spin" /> Launching your plan…
      </h1>
      <p className="mt-2 text-[14px] text-muted-foreground">
        {state === "slow"
          ? "Your bank is taking a little longer. Keep this page open; it switches on by itself the moment Stripe confirms."
          : "Stripe is confirming your payment. This takes a few seconds."}
      </p>
      {state === "slow" && (
        <OutlineButton className="mt-6 h-10 px-5 text-[13px]" onClick={onOpenApp}>
          Continue in Mellox
        </OutlineButton>
      )}
    </div>
  );
}
