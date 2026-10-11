"use client";

// The plans on the public pricing page: the same cards as the upgrade window inside the product
// (src/components/app/billing/UpgradeScreen.tsx), drawn from the same catalog with the same helpers, so the two
// always show the same plans, prices and lines. Three cards side by side, the biggest plan as a row under them.

import { ArrowRight, Building2, Check, Columns2, ShieldCheck, Video, Zap, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { CREDIT_ACTIONS, PLANS, type BillingInterval, type PaidPlanId } from "@/lib/billing/catalog";
import { formatMeter, formatNumber, formatUsd, planPrice } from "@/lib/billing/present";
import { PAID_PLANS } from "@/marketing/lib/pricing";
import SectionHead from "./SectionHead";

const APP_URL = "/signup";
const CARDS = PAID_PLANS.slice(0, 3);
const STRIP = PAID_PLANS[3];
const FEATURED: PaidPlanId = "growth";

/** Roughly how many posts a month of credits makes, rounded down (the product's own sum). */
function postsFrom(credits: number): number {
  const posts = Math.floor(credits / CREDIT_ACTIONS.post_set.credits);
  const step = 10 ** Math.max(0, String(posts).length - 2);
  return Math.floor(posts / step) * step;
}

/** A year's price as a daily figure: "$4.08". */
const perDay = (yearUsd: number) => `$${(yearUsd / 365).toFixed(2)}`;

/** What a plan gives every month, as short lines. */
function planNumbers(plan: PaidPlanId): { Icon: LucideIcon; main: string; note?: string }[] {
  const def = PLANS[plan];
  return [
    {
      Icon: Zap,
      main: `${formatNumber(def.allowances.credits)} credits a month`,
      note: `about ${formatNumber(postsFrom(def.allowances.credits))} posts`,
    },
    { Icon: Video, main: `${formatMeter("video", def.allowances.videoUnits)} a month` },
    {
      Icon: Building2,
      main: `${formatNumber(def.brands)} ${def.brands === 1 ? "brand" : "brands"}`,
      note: def.seats === null ? "unlimited seats" : `${formatNumber(def.seats)} team seats`,
    },
  ];
}

function PlanCard({
  plan,
  interval,
  onYearly,
  index,
}: {
  plan: PaidPlanId;
  interval: BillingInterval;
  onYearly: () => void;
  index: number;
}) {
  const def = PLANS[plan];
  const price = planPrice(plan, interval);
  const yearlySaving = planPrice(plan, "year").savings;
  const below = PAID_PLANS[PAID_PLANS.indexOf(plan) - 1];
  const featured = plan === FEATURED;
  return (
    <article
      className={`pp-card ${featured ? "featured" : ""}`}
      data-reveal
      style={{ transitionDelay: `${index * 90}ms` }}
    >
      <div className="pp-top">
        <h3>{def.label}</h3>
        {def.badge && <span className="pp-badge">{def.badge}</span>}
      </div>
      <p className="pp-fit">{def.fit}</p>

      <p className="pp-price" aria-live="polite">
        {interval === "year" && <span className="old">{formatUsd(def.priceMonthlyUsd)}</span>}
        <span className="now">{formatUsd(Math.round(price.perMonth))}</span>
        <span className="per">a month</span>
      </p>
      <p className="pp-billed">
        {interval === "year" ? (
          <>
            <span>
              {formatUsd(price.billed)} a year · {perDay(price.billed)} a day
            </span>
            <span className="pp-save">Save {formatUsd(price.savings)}</span>
          </>
        ) : (
          <>
            Billed monthly
            <button type="button" onClick={onYearly}>
              Save {formatUsd(yearlySaving)} with yearly
            </button>
          </>
        )}
      </p>

      <a href={APP_URL} className={`pp-buy ${featured ? "lime" : ""}`}>
        Get {def.label}
        {featured && <ArrowRight size={18} aria-hidden="true" />}
      </a>

      <ul className="pp-numbers">
        {planNumbers(plan).map((row) => (
          <li key={row.main}>
            <row.Icon size={16} strokeWidth={2.2} aria-hidden="true" />
            <b>{row.main}</b>
            {row.note && <span>· {row.note}</span>}
          </li>
        ))}
      </ul>

      <p className="pp-label">{below ? `Everything in ${PLANS[below].label}, plus` : "What you can do"}</p>
      <ul className="pp-list">
        {def.highlights.map((line) => (
          <li key={line}>
            <span className="pp-tick">
              <Check strokeWidth={3} aria-hidden="true" />
            </span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

/** The biggest plan as one slim row under the three cards. */
function PlanStrip({ plan, interval }: { plan: PaidPlanId; interval: BillingInterval }) {
  const def = PLANS[plan];
  const price = planPrice(plan, interval);
  return (
    <article className="pp-strip" data-reveal>
      <div className="pp-strip-text">
        <h3>
          {def.label}
          <span>{def.fit}</span>
        </h3>
        <p>
          {formatNumber(def.brands)} brands · {formatNumber(def.allowances.credits)} credits and{" "}
          {formatMeter("video", def.allowances.videoUnits)} a month · a dedicated account manager
        </p>
      </div>
      <p className="pp-strip-price" aria-live="polite">
        {formatUsd(Math.round(price.perMonth))}
        <span> a month</span>
      </p>
      <div className="pp-strip-buttons">
        <a href="/demo?interest=scale" className="pp-talk">
          Talk to us
        </a>
        <a href={APP_URL} className="pp-buy">
          Get {def.label}
        </a>
      </div>
    </article>
  );
}

export default function PricingPlans() {
  const [interval, setInterval] = useState<BillingInterval>("year");

  return (
    <section id="plans" className="px-section">
      <div className="px-inner">
        <SectionHead
          icon={<Columns2 size={32} strokeWidth={1.4} aria-hidden="true" />}
          label="Plans"
          title="Simple plans. Credits you control."
          blurb="The same plans you see inside Mellox. Credits pay for the work, video has its own allowance, and posting to every network is unlimited."
          wide
        />

        <div className="px-toggle" role="group" aria-label="Billing period" data-reveal>
          <button type="button" aria-pressed={interval === "month"} onClick={() => setInterval("month")}>
            Monthly
          </button>
          <button type="button" aria-pressed={interval === "year"} onClick={() => setInterval("year")}>
            Yearly <span className="px-free-tag">2 months free</span>
          </button>
        </div>

        <div className="pp-plans">
          {CARDS.map((plan, i) => (
            <PlanCard key={plan} plan={plan} interval={interval} onYearly={() => setInterval("year")} index={i} />
          ))}
        </div>
        <PlanStrip plan={STRIP} interval={interval} />

        <ul className="pp-promises" data-reveal>
          <li>
            <ShieldCheck size={16} aria-hidden="true" />
            Change or cancel any time
          </li>
          <li>
            <Check size={14} strokeWidth={3} aria-hidden="true" />
            Keep everything you&apos;ve made
          </li>
          <li>
            <Check size={14} strokeWidth={3} aria-hidden="true" />
            Prices in US dollars
          </li>
        </ul>
      </div>
    </section>
  );
}
