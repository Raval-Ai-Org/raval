"use client";

// The frame every /checkout step sits in: the Mellox mark, the three steps
// (Plan → Payment → Launch, as on Holo's checkout), a Back pill and a soft Mox
// wash. Presentational; `CheckoutFlow` feeds it.

import type { ReactNode } from "react";
import { Logo } from "@/components/brand/Logo";
import { ArrowLeft, Check, Lock, RotateCcw, ShieldCheck, Wallet } from "@/components/icons";
import type { CheckoutStep } from "@/lib/billing/checkout-link";
import { cn } from "@/lib/utils";

const STEPS: Array<[CheckoutStep, string]> = [
  ["plan", "Plan"],
  ["pay", "Payment"],
  ["launch", "Launch"],
];

export const MOX = {
  visor: "/brand/mox/visor-head.webp",
  thumbs: "/brand/mox/onboarding/pose-thumbs.webp",
  jump: "/brand/mox/onboarding/pose-jump.webp",
} as const;

function Stepper({ step }: { step: CheckoutStep }) {
  const at = STEPS.findIndex(([id]) => id === step);
  return (
    <ol className="flex items-center gap-1.5 sm:gap-2.5" aria-label="Checkout steps">
      {STEPS.map(([id, label], index) => {
        const done = index < at;
        const now = index === at;
        return (
          <li key={id} className="flex items-center gap-1.5 sm:gap-2.5">
            {index > 0 && (
              <span
                aria-hidden
                className={cn(
                  "h-px w-5 transition-colors duration-500 sm:w-10",
                  done || now ? "bg-foreground/40" : "bg-foreground/12",
                )}
              />
            )}
            <span
              aria-current={now ? "step" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 text-[12.5px] font-semibold transition-colors",
                now ? "text-foreground" : done ? "text-foreground/70" : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "grid h-5 w-5 place-items-center rounded-full text-[10.5px] transition-all duration-500",
                  done && "checkout-cta",
                  now && "bg-foreground text-background",
                  !done && !now && "bg-foreground/[0.07]",
                )}
              >
                {done ? <Check className="h-3 w-3" strokeWidth={3} /> : index + 1}
              </span>
              <span className={cn(!now && "max-sm:hidden")}>{label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function CheckoutShell({
  step,
  back,
  children,
}: {
  step: CheckoutStep;
  back: { label: string; onClick: () => void } | null;
  children: ReactNode;
}) {
  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-[hsl(var(--background))] text-foreground">
      {/* The Mox wash, drifting slowly behind everything. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="checkout-drift absolute -left-[20%] -top-[30%] h-[70vh] w-[70vw] rounded-full bg-[radial-gradient(closest-side,rgb(156_240_63/0.22),transparent)] blur-2xl" />
        <div
          className="checkout-drift absolute -right-[15%] top-[10%] h-[60vh] w-[55vw] rounded-full bg-[radial-gradient(closest-side,rgb(31_214_196/0.16),transparent)] blur-2xl"
          style={{ animationDelay: "-6s" }}
        />
      </div>

      <header className="sticky top-0 z-20 border-b border-foreground/[0.06] bg-[hsl(var(--background)/0.78)] backdrop-blur-xl">
        <div className="mx-auto grid h-14 max-w-[1120px] grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            {back ? (
              <button
                type="button"
                onClick={back.onClick}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-foreground/10 bg-background px-3 text-[12.5px] font-medium text-foreground/80 transition hover:border-foreground/25 hover:text-foreground"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span className="max-sm:hidden">{back.label}</span>
              </button>
            ) : null}
            <span className="max-md:hidden">
              <Logo height={18} />
            </span>
          </div>
          <Stepper step={step} />
          <div className="flex justify-end">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-foreground/[0.05] px-2.5 py-1 text-[11.5px] font-medium text-muted-foreground">
              <Lock className="h-3 w-3" strokeWidth={2.4} />
              <span className="max-sm:hidden">Secure checkout</span>
            </span>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-[1120px] px-4 pb-16 pt-6 sm:px-6 sm:pt-10">
        {children}
      </main>
    </div>
  );
}

/** The four promises, under the plans and beside the payment form. */
export const PROMISES = [
  { Icon: RotateCcw, title: "Cancel anytime", text: "One click in Plan & billing." },
  { Icon: Wallet, title: "Credits roll over", text: "Unused credits carry a month." },
  { Icon: ShieldCheck, title: "Paid through Stripe", text: "Mellox never sees your card." },
  { Icon: Check, title: "Keep what you make", text: "Every post stays yours." },
] as const;

export function PromiseRow({ className }: { className?: string }) {
  return (
    <ul className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>
      {PROMISES.map(({ Icon, title, text }) => (
        <li key={title} className="flex items-start gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-foreground/[0.05]">
            <Icon className="h-4 w-4 text-foreground/75" strokeWidth={2.1} />
          </span>
          <span className="min-w-0">
            <span className="block text-[12.5px] font-semibold leading-tight">{title}</span>
            <span className="block text-[11.5px] leading-snug text-muted-foreground">{text}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CtaButton({
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "checkout-cta inline-flex items-center justify-center gap-2 rounded-full font-semibold shadow-[0_14px_30px_-14px_rgb(63_228_110/0.9)] transition-[transform,filter,opacity] duration-200 hover:brightness-[1.04] active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-55",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function OutlineButton({
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full border border-foreground/15 bg-background font-semibold text-foreground transition hover:border-foreground/35 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-55",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
