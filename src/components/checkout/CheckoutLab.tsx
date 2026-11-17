"use client";

// Development-only: every /checkout scene with sample data, no Stripe or server.
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { BillingInterval } from "@/lib/billing/catalog";
import { CheckoutShell } from "./checkout-parts";
import { LaunchStep } from "./LaunchStep";
import { CardVisual, EMPTY_CARD, PayStep, type CardState } from "./PayStep";
import { PlanStep } from "./PlanStep";

const SCENES = [
  "plans",
  "feature",
  "credits",
  "member",
  "unavailable",
  "pay",
  "card",
  "launch",
] as const;
type Scene = (typeof SCENES)[number];

export function CheckoutLab() {
  const asked = useSearchParams().get("scene") as Scene | null;
  const scene: Scene = asked && SCENES.includes(asked) ? asked : "plans";
  const [interval, setBillingInterval] = useState<BillingInterval>("year");
  // One card, playing through what a customer sees: empty → typing → ready.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (scene !== "card") return;
    const id = window.setInterval(() => setTick((n) => (n + 1) % 4), 1600);
    return () => window.clearInterval(id);
  }, [scene]);
  const demo: CardState = [
    EMPTY_CARD,
    { ...EMPTY_CARD, focused: true, empty: false },
    { ...EMPTY_CARD, empty: false, complete: true },
    { ...EMPTY_CARD, empty: false, complete: true, saving: true },
  ][tick];
  const noop = () => undefined;
  const step = scene === "pay" ? "pay" : scene === "launch" ? "launch" : "plan";
  return (
    <CheckoutShell step={step} back={{ label: "Back to Mellox", onClick: noop }}>
      {scene === "card" ? (
        <div className="mx-auto max-w-[380px]">
          <CardVisual state={demo} holder="you@company.com" paying={false} />
        </div>
      ) : scene === "pay" ? (
        <PayStep
          item={{ kind: "plan", key: "growth", interval }}
          returnPath="/projects"
          subscribed
          onIntervalChange={setBillingInterval}
          onChangePlan={noop}
          onPaid={noop}
          onChanged={noop}
        />
      ) : scene === "launch" ? (
        <LaunchStep sessionId={null} changedTo="growth" onOpenApp={noop} onRetry={noop} />
      ) : (
        <PlanStep
          current="free"
          view={scene === "credits" ? "credits" : "plans"}
          onViewChange={noop}
          interval={interval}
          onIntervalChange={setBillingInterval}
          recommended={scene === "feature" ? "growth" : null}
          block={
            scene === "feature"
              ? { code: "upgrade_required", feature: "campaigns", requiredPlan: "growth" }
              : null
          }
          canBuy={scene !== "member"}
          paymentsAvailable={scene !== "unavailable"}
          askSent={false}
          busy={false}
          balance={35 * 30}
          onPick={noop}
          onAskOwner={noop}
        />
      )}
    </CheckoutShell>
  );
}
