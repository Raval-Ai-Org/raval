"use client";

// Step 2, Payment: Stripe's own fields (wallets, card, 3-D Secure) inside
// Mellox's layout, through an Elements-mode Checkout Session made by
// /api/billing/checkout (ui: "elements"). The card never touches Mellox: the
// fields are Stripe's iframes. Fulfilment is unchanged: the webhook and the
// status poll on Launch activate the plan from Stripe's paid state.
//
// An existing subscriber changing plan pays nothing here: the change is made
// in place and Stripe prorates it on the next invoice.

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { loadStripe, type Appearance, type Stripe } from "@stripe/stripe-js";
import {
  CheckoutElementsProvider,
  ExpressCheckoutElement,
  PaymentElement,
  useCheckoutElements,
} from "@stripe/react-stripe-js/checkout";
import {
  AlertCircle,
  ArrowRight,
  Bolt,
  Building2,
  Check,
  Lock,
  MessageSquare,
  PenLine,
  RefreshCw,
  Rocket,
  Spinner,
  Video,
} from "@/components/icons";
import { authedFetch } from "@/lib/authed-fetch";
import { CREDIT_PACKS, PLANS, creditsOf, type BillingInterval } from "@/lib/billing/catalog";
import type { CheckoutItem } from "@/lib/billing/checkout-link";
import { planOutcomes } from "@/lib/billing/plan-economics";
import { formatNumber, formatUsd, planPrice } from "@/lib/billing/present";
import { cn } from "@/lib/utils";
import { CtaButton, MOX, PROMISES } from "./checkout-parts";

type Opened = { sessionId: string; clientSecret: string; publishableKey: string };

const stripeByKey = new Map<string, Promise<Stripe | null>>();
function stripeFor(key: string) {
  let promise = stripeByKey.get(key);
  if (!promise) {
    promise = loadStripe(key);
    stripeByKey.set(key, promise);
  }
  return promise;
}

function isDark() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

function appearance(dark: boolean): Appearance {
  return {
    theme: dark ? "night" : "stripe",
    variables: {
      colorPrimary: dark ? "#3fe46e" : "#0f9a4a",
      colorBackground: dark ? "#16181d" : "#ffffff",
      colorText: dark ? "#f4f5f6" : "#0b0d10",
      colorDanger: "#e5484d",
      fontFamily: '"Google Sans Flex", "Segoe UI", system-ui, sans-serif',
      fontSizeBase: "14px",
      borderRadius: "12px",
      spacingUnit: "4px",
    },
    rules: {
      ".Input": {
        border: dark ? "1px solid rgba(255,255,255,0.10)" : "1px solid rgba(11,13,16,0.08)",
        backgroundColor: dark ? "#1d2027" : "#f6f7f9",
        boxShadow: "none",
        padding: "12px 14px",
      },
      ".Input:focus": {
        border: "1px solid #3fe46e",
        boxShadow: "0 0 0 3px rgba(63,228,110,0.22)",
      },
      ".Label": { fontWeight: "600", fontSize: "12.5px" },
      ".Tab": { boxShadow: "none", border: "1px solid rgba(11,13,16,0.08)" },
      ".Tab--selected": {
        border: "1px solid #3fe46e",
        boxShadow: "0 0 0 2px rgba(63,228,110,0.2)",
      },
    },
  };
}

/* ───────────────────────────── summary ───────────────────────────── */

export function itemSummary(item: CheckoutItem) {
  if (item.kind === "plan") {
    const def = PLANS[item.key];
    const price = planPrice(item.key, item.interval);
    const made = planOutcomes(item.key);
    return {
      title: `Mellox ${def.label}`,
      sub:
        item.interval === "year"
          ? `${formatUsd(Math.round(price.perMonth))}/month · billed yearly`
          : "Billed monthly",
      was: item.interval === "year" ? def.priceMonthlyUsd * 12 : null,
      due: price.billed,
      savings: price.savings,
      renews: item.interval === "year" ? "Renews every year" : "Renews every month",
      facts: [
        { Icon: Bolt, text: `${formatNumber(made.credits)} credits every month` },
        { Icon: PenLine, text: "Unlimited text posts and publishing" },
        {
          Icon: Video,
          text: `About ${formatNumber(made.imagePosts)} image posts or ${formatNumber(made.videos)} videos`,
        },
        {
          Icon: MessageSquare,
          text: `${formatNumber(def.allowances.proMessages)} Mellox Pro messages`,
        },
        {
          Icon: Building2,
          text: `${formatNumber(def.brands)} ${def.brands === 1 ? "brand" : "brands"} · ${def.seats === null ? "unlimited seats" : `${formatNumber(def.seats)} seats`}`,
        },
      ],
    };
  }
  const pack = CREDIT_PACKS.find((row) => row.key === item.key) ?? CREDIT_PACKS[0];
  const credits = creditsOf(pack.credits + pack.bonusCredits);
  return {
    title: `${formatNumber(credits)} credits`,
    sub: "One-time top-up",
    was: null,
    due: pack.usd,
    savings: 0,
    renews: "Valid for 12 months, on every brand",
    facts: [
      { Icon: Bolt, text: `${formatNumber(credits)} credits, added right after payment` },
      { Icon: Rocket, text: `About ${formatNumber(credits)} image posts` },
    ],
  };
}

function OrderSummary({
  item,
  onIntervalChange,
  switching,
  onChangePlan,
  inPlace,
}: {
  item: CheckoutItem;
  /** A plan change on a live subscription: Stripe prorates, nothing is due here. */
  inPlace: boolean;
  onIntervalChange: (interval: BillingInterval) => void;
  switching: boolean;
  onChangePlan: () => void;
}) {
  const s = itemSummary(item);
  const yearly = item.kind === "plan" ? planPrice(item.key, "year").savings : 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="checkout-rise relative overflow-hidden rounded-[24px] border border-foreground/[0.07] bg-card p-5 shadow-[0_24px_50px_-36px_rgb(0_0_0/0.45)]">
        {/* Fully inside the card: the section clips, so Mox never sits on its edge. */}
        <div className="pointer-events-none absolute right-4 top-4 h-[88px] w-[72px]">
          <Image
            src={MOX.thumbs}
            alt=""
            fill
            sizes="72px"
            className="checkout-float object-contain"
          />
        </div>
        <p className="text-[15px] font-semibold">Order summary</p>
        <div className="mt-4 flex items-start gap-3 pr-20">
          <span className="checkout-cta grid h-10 w-10 shrink-0 place-items-center rounded-xl">
            <Bolt className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold">{s.title}</p>
            <p className="text-[12.5px] text-muted-foreground">{s.sub}</p>
            <button
              type="button"
              onClick={onChangePlan}
              className="mt-0.5 text-[12px] font-medium text-foreground/70 underline-offset-2 hover:underline"
            >
              Change {item.kind === "plan" ? "plan" : "pack"}
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-1.5 border-t border-foreground/[0.07] pt-4 text-[13px]">
          {s.was !== null && (
            <div className="flex justify-between text-muted-foreground">
              <span>12 months at the monthly price</span>
              <span className="tabular-nums line-through">{formatUsd(s.was)}</span>
            </div>
          )}
          {s.savings > 0 && (
            <div className="flex justify-between font-medium text-[#218358] dark:text-[#3dd68c]">
              <span>Yearly saving</span>
              <span className="tabular-nums">−{formatUsd(s.savings)}</span>
            </div>
          )}
          <div className="flex items-end justify-between pt-1">
            <span className="text-[15px] font-semibold">{inPlace ? "New price" : "Due today"}</span>
            <span className="text-[28px] font-bold leading-none tracking-tight tabular-nums">
              {formatUsd(s.due)}
            </span>
          </div>
          <p className="text-right text-[11.5px] text-muted-foreground">
            {inPlace
              ? "The difference for this period is prorated on your next invoice."
              : `${s.renews}. Tax may apply.`}
          </p>
        </div>

        {item.kind === "plan" && (
          <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-2xl bg-foreground/[0.04] px-3.5 py-3">
            <span className="relative inline-flex">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={item.interval === "year"}
                disabled={switching}
                onChange={(event) => onIntervalChange(event.target.checked ? "year" : "month")}
              />
              <span className="h-6 w-10 rounded-full bg-foreground/15 transition-colors peer-checked:bg-[#3fe46e] peer-disabled:opacity-60" />
              <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold">
                Pay yearly, save {formatUsd(yearly)}
              </span>
              <span className="block text-[11.5px] text-muted-foreground">
                20% off, the same credits every month.
              </span>
            </span>
            {switching && <Spinner className="h-4 w-4 animate-spin" />}
          </label>
        )}
      </div>

      <div
        className="checkout-rise rounded-[24px] border border-foreground/[0.07] bg-card p-5"
        style={{ animationDelay: "90ms" }}
      >
        <p className="text-[13px] font-semibold">What you get</p>
        <ul className="mt-3 space-y-2.5">
          {s.facts.map((row) => (
            <li key={row.text} className="flex items-start gap-2.5 text-[12.5px] leading-[18px]">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-[#3fe46e]/15">
                <row.Icon className="h-3.5 w-3.5 text-[#0f9a4a]" strokeWidth={2.3} />
              </span>
              <span className="pt-0.5">{row.text}</span>
            </li>
          ))}
        </ul>
      </div>

      <div
        className="checkout-rise rounded-[24px] border border-foreground/[0.07] bg-card p-5"
        style={{ animationDelay: "160ms" }}
      >
        <ul className="space-y-3">
          {PROMISES.map(({ Icon, title, text }) => (
            <li key={title} className="flex items-start gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-foreground/[0.08]">
                <Icon className="h-4 w-4 text-foreground/75" />
              </span>
              <span>
                <span className="block text-[12.5px] font-semibold">{title}</span>
                <span className="block text-[11.5px] text-muted-foreground">{text}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ───────────────────────────── the card ───────────────────────────── */

export type CardState = {
  focused: boolean;
  empty: boolean;
  complete: boolean;
  /** "card", "link", "apple_pay"… as Stripe reports the chosen method. */
  method: string;
  /** A card the customer saved before is selected. */
  saved: boolean;
  /** "Save this card" is ticked. */
  saving: boolean;
};
export const EMPTY_CARD: CardState = {
  focused: false,
  empty: true,
  complete: false,
  method: "card",
  saved: false,
  saving: false,
};

/**
 * A card that comes alive while the person types. The digits are typed into
 * Stripe's secure field, which Mellox can't read (by design), so the card shows
 * progress, never the number: it lifts on focus, fills while typing, turns
 * "Ready" when Stripe says the details are complete, and says when a saved
 * card is used or this one will be saved.
 */
export function CardVisual({
  state,
  holder,
  paying,
}: {
  state: CardState;
  holder: string | null;
  paying: boolean;
}) {
  const typing = !state.empty && !state.complete;
  const ready = state.complete;
  const label = state.saved
    ? "Saved card"
    : state.method === "card"
      ? ready
        ? "Ready to pay"
        : typing
          ? "Checking with Stripe…"
          : "Your card"
      : state.method.replace(/_/g, " ");
  return (
    <div className="flex justify-center py-1 [perspective:1000px]">
      <div
        aria-hidden
        className={cn(
          "relative aspect-[1.586] w-full max-w-[340px] overflow-hidden rounded-[20px] p-5 text-[#0b1a10] shadow-[0_24px_50px_-22px_rgb(15_154_74/0.65)] transition-transform duration-500 ease-out [transform-style:preserve-3d]",
          state.focused && !ready && "[transform:rotateX(8deg)_rotateY(-10deg)_translateY(-4px)]",
          ready && "[transform:rotateX(0deg)_rotateY(0deg)_scale(1.02)]",
          paying && "animate-pulse",
        )}
        style={{ backgroundImage: "var(--mox-gradient)" }}
      >
        {/* sheen */}
        <span className="checkout-card-sheen pointer-events-none absolute inset-0" />
        <span className="absolute -bottom-16 -right-10 h-44 w-44 rounded-full bg-white/25 blur-2xl" />
        <div className="relative flex items-start justify-between">
          <span className="text-[13px] font-bold tracking-wide">Mellox</span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10.5px] font-bold capitalize transition-colors",
              ready || state.saved ? "bg-[#0b1a10] text-white" : "bg-white/45",
            )}
          >
            {ready || state.saved ? "✓ " : ""}
            {label}
          </span>
        </div>
        {/* chip */}
        <span className="relative mt-4 block h-7 w-10 rounded-md bg-gradient-to-br from-[#fff7d1] to-[#e8c766] shadow-inner">
          <span className="absolute inset-x-1 top-1/2 h-px bg-black/20" />
          <span className="absolute inset-y-1 left-1/2 w-px bg-black/20" />
        </span>
        <p className="relative mt-4 flex gap-3 font-mono text-[17px] font-semibold tracking-[0.12em]">
          {[0, 1, 2, 3].map((group) => (
            <span
              key={group}
              className={cn(
                "transition-opacity duration-300",
                state.saved || ready
                  ? "opacity-100"
                  : typing
                    ? group < 3
                      ? "opacity-100"
                      : "animate-pulse opacity-70"
                    : "opacity-45",
              )}
            >
              ••••
            </span>
          ))}
        </p>
        <div className="relative mt-3 flex items-end justify-between text-[10.5px] font-semibold uppercase tracking-wider">
          <span className="min-w-0 flex-1 truncate opacity-80">{holder ?? "Card holder"}</span>
          <span className="shrink-0 opacity-80">
            {state.saving ? "Saved for next time" : "Secured by Stripe"}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── the form ───────────────────────────── */

function PaymentForm({
  due,
  onPaid,
  sessionId,
}: {
  due: number;
  onPaid: (sessionId: string) => void;
  sessionId: string;
}) {
  const result = useCheckoutElements();
  const [email, setEmail] = useState("");
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [card, setCard] = useState<CardState>(EMPTY_CARD);
  /** Apple Pay / Google Pay / Link buttons only exist on some devices and domains. */
  const [wallets, setWallets] = useState(false);

  if (result.type === "loading") return <FormSkeleton />;
  if (result.type === "error")
    return <Problem text={result.error.message || "Secure checkout couldn't load."} />;
  const checkout = result.checkout;
  const needsEmail = !checkout.email;

  async function pay(expressEvent?: Parameters<typeof checkout.confirm>[0]) {
    setError(null);
    setPaying(true);
    try {
      if (needsEmail && !expressEvent) {
        const updated = await checkout.updateEmail(email.trim());
        if (updated.type === "error") {
          setError(updated.error.message);
          return;
        }
      }
      const confirmed = await checkout.confirm({ redirect: "if_required", ...expressEvent });
      if (confirmed.type === "error") {
        setError(confirmed.error.message);
        return;
      }
      onPaid(sessionId);
    } catch {
      setError("The payment couldn't be sent. Nothing was charged; please try again.");
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ExpressCheckoutElement
        onReady={(event) => setWallets(Boolean(event.availablePaymentMethods))}
        onConfirm={(event) => void pay({ expressCheckoutConfirmEvent: event })}
      />
      {wallets && (
        <div className="flex items-center gap-3 text-[11.5px] font-medium text-muted-foreground">
          <span className="h-px flex-1 bg-foreground/[0.08]" />
          or pay with card
          <span className="h-px flex-1 bg-foreground/[0.08]" />
        </div>
      )}
      {needsEmail && (
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-semibold">Email for receipts</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@company.com"
            className="h-[46px] w-full rounded-xl border border-foreground/[0.08] bg-[#f6f7f9] px-3.5 text-[14px] outline-none transition focus:border-[#3fe46e] focus:ring-[3px] focus:ring-[#3fe46e]/25 dark:bg-[#1d2027]"
          />
        </label>
      )}
      <CardVisual state={card} holder={checkout.email ?? (email.trim() || null)} paying={paying} />
      <PaymentElement
        options={{ layout: "tabs" }}
        onFocus={() => setCard((prev) => ({ ...prev, focused: true }))}
        onBlur={() => setCard((prev) => ({ ...prev, focused: false }))}
        onChange={(event) =>
          setCard((prev) => ({
            ...prev,
            empty: event.empty,
            complete: event.complete,
            method: event.value.type,
            saved: Boolean(event.value.payment_method),
            saving: Boolean(event.value.savePaymentMethod),
          }))
        }
      />
      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-[#e5484d]/10 px-3 py-2.5 text-[13px] text-[#c62a2f]"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}
      <CtaButton
        className="h-[52px] w-full text-[15px]"
        disabled={paying || (needsEmail && !/^\S+@\S+\.\S+$/.test(email.trim()))}
        onClick={() => void pay()}
      >
        {paying ? (
          <>
            <Spinner className="h-4 w-4 animate-spin" /> Confirming with your bank…
          </>
        ) : (
          <>
            Pay {formatUsd(due)} and launch <ArrowRight className="h-4 w-4" />
          </>
        )}
      </CtaButton>
      <p className="text-center text-[11.5px] leading-relaxed text-muted-foreground">
        By paying you agree to the{" "}
        <a href="/terms" target="_blank" rel="noreferrer" className="underline">
          Terms
        </a>{" "}
        and{" "}
        <a href="/privacy" target="_blank" rel="noreferrer" className="underline">
          Privacy Policy
        </a>
        . Cancel anytime in Plan &amp; billing.
      </p>
    </div>
  );
}

function FormSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading secure checkout">
      <div className="h-[46px] animate-pulse rounded-xl bg-foreground/[0.06]" />
      <div className="mx-auto h-3 w-32 animate-pulse rounded bg-foreground/[0.05]" />
      <div className="h-[46px] animate-pulse rounded-xl bg-foreground/[0.06]" />
      <div className="grid grid-cols-2 gap-3">
        <div className="h-[46px] animate-pulse rounded-xl bg-foreground/[0.06]" />
        <div className="h-[46px] animate-pulse rounded-xl bg-foreground/[0.06]" />
      </div>
      <div className="h-[52px] animate-pulse rounded-full bg-foreground/[0.08]" />
    </div>
  );
}

function Problem({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 py-6 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-full bg-[#e5484d]/10 text-[#e5484d]">
        <AlertCircle className="h-5 w-5" />
      </span>
      <p className="max-w-[340px] text-[13.5px]">{text}</p>
      <p className="text-[12px] text-muted-foreground">Nothing was charged.</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-foreground/15 px-4 text-[13px] font-semibold"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Try again
        </button>
      )}
    </div>
  );
}

/* ───────────────────────────── the step ───────────────────────────── */

export function PayStep({
  item,
  returnPath,
  subscribed,
  onIntervalChange,
  onChangePlan,
  onPaid,
  onChanged,
}: {
  item: CheckoutItem;
  returnPath: string;
  /** Has a live subscription: a plan change is made in place, not paid here. */
  subscribed: boolean;
  onIntervalChange: (interval: BillingInterval) => void;
  onChangePlan: () => void;
  onPaid: (sessionId: string) => void;
  onChanged: () => void;
}) {
  const changeInPlace = subscribed && item.kind === "plan";
  const [opened, setOpened] = useState<Opened | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(!changeInPlace);
  const itemKey = `${item.kind}:${item.key}:${item.kind === "plan" ? item.interval : ""}`;

  useEffect(() => {
    if (changeInPlace) return;
    let live = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const response = await authedFetch("/api/billing/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: item.kind,
            key: item.key,
            quantity: 1,
            interval: item.kind === "plan" ? item.interval : undefined,
            returnPath,
            ui: "elements",
          }),
        });
        const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (!response.ok)
          throw new Error(String(body.message ?? body.error ?? "Secure checkout couldn't open."));
        if (typeof body.clientSecret !== "string" || typeof body.publishableKey !== "string")
          throw new Error("Secure checkout couldn't open.");
        if (live)
          setOpened({
            sessionId: String(body.sessionId),
            clientSecret: body.clientSecret,
            publishableKey: body.publishableKey,
          });
      } catch (cause) {
        if (live)
          setError(cause instanceof Error ? cause.message : "Secure checkout couldn't open.");
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
    // itemKey covers the item; attempt retries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey, attempt, changeInPlace, returnPath]);

  const options = useMemo(
    () =>
      opened
        ? {
            clientSecret: opened.clientSecret,
            elementsOptions: {
              appearance: appearance(isDark()),
              // "Save this card" for next time, and a returning customer's
              // saved cards, both Stripe's own controls.
              savedPaymentMethod: { enableSave: "auto" as const, enableRedisplay: "auto" as const },
              fonts: [
                {
                  cssSrc:
                    "https://fonts.googleapis.com/css2?family=Google+Sans+Flex:wght@400;500;600&display=swap",
                },
              ],
            },
          }
        : null,
    [opened],
  );

  const summary = itemSummary(item);

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="checkout-rise rounded-[26px] border border-foreground/[0.07] bg-card p-5 shadow-[0_30px_60px_-40px_rgb(0_0_0/0.45)] sm:p-7">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h1 className="text-[22px] font-bold tracking-tight">
            {changeInPlace ? "Confirm your new plan" : "Payment"}
          </h1>
          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
            <Lock className="h-3 w-3" /> Encrypted by Stripe
          </span>
        </div>

        {changeInPlace ? (
          <ChangePlan item={item} onChanged={onChanged} />
        ) : error ? (
          <Problem text={error} onRetry={() => setAttempt((n) => n + 1)} />
        ) : loading || !opened || !options ? (
          <FormSkeleton />
        ) : (
          <CheckoutElementsProvider
            key={opened.clientSecret}
            stripe={stripeFor(opened.publishableKey)}
            options={options}
          >
            <PaymentForm due={summary.due} sessionId={opened.sessionId} onPaid={onPaid} />
          </CheckoutElementsProvider>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-foreground/[0.06] pt-4 text-[11.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5 text-[#30a46c]" strokeWidth={3} /> Card, Apple Pay, Google
            Pay and Link
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5 text-[#30a46c]" strokeWidth={3} /> 3-D Secure where your
            bank asks
          </span>
        </div>
      </div>

      <OrderSummary
        item={item}
        switching={loading && !changeInPlace}
        inPlace={changeInPlace}
        onIntervalChange={onIntervalChange}
        onChangePlan={onChangePlan}
      />
    </div>
  );
}

function ChangePlan({ item, onChanged }: { item: CheckoutItem; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (item.kind !== "plan") return null;
  const def = PLANS[item.key];
  async function change() {
    if (item.kind !== "plan") return;
    setBusy(true);
    setError(null);
    try {
      const response = await authedFetch("/api/billing/subscription/change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: item.key, interval: item.interval }),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok)
        throw new Error(String(body.message ?? body.error ?? "The plan didn't change."));
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The plan didn't change.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[14px] leading-relaxed text-muted-foreground">
        You'll move to <b className="text-foreground">{def.label}</b> right away, on the card you
        already use. Stripe works out the difference for the rest of this period and adds it to your
        next invoice. Nothing else to fill in.
      </p>
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-[#e5484d]/10 px-3 py-2.5 text-[13px] text-[#c62a2f]"
        >
          {error}
        </p>
      )}
      <CtaButton
        className={cn("h-[52px] w-full text-[15px]")}
        disabled={busy}
        onClick={() => void change()}
      >
        {busy ? <Spinner className="h-4 w-4 animate-spin" /> : null}
        {busy ? "Switching…" : `Switch to ${def.label}`}
        {!busy && <ArrowRight className="h-4 w-4" />}
      </CtaButton>
    </div>
  );
}
