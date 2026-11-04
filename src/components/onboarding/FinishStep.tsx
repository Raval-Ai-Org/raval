"use client";

import type { Ref } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Check } from "@/components/icons";
import { dsGhostBtn } from "@/components/app/surface/buttons";
import { Mox } from "@/components/brand/mox/Mox";
import { cn } from "@/lib/utils";
import { HoldToEnter } from "./HoldToEnter";

/**
 * Onboarding's last step (Mellox 2.0): what Mox learned, then press and hold
 * to go in. Nothing is made or charged here; posts are made later, when the
 * person asks for them. Presentational: OnboardingPage and the lab wire it.
 */
export function FinishStep({
  brandName,
  language,
  products,
  channels,
  headingRef,
  reduce,
  onBack,
  onEnter,
}: {
  brandName: string;
  language: string;
  products: number;
  channels: number;
  headingRef?: Ref<HTMLHeadingElement>;
  reduce?: boolean;
  onBack: () => void;
  onEnter: () => void;
}) {
  const learned = [
    "Brand DNA",
    `Writes in ${language}`,
    products ? `${products} ${products === 1 ? "product" : "products"}` : null,
    channels ? `${channels} ${channels === 1 ? "channel" : "channels"}` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative grid place-items-center">
        {/* A slow ring of light around Mox, like the Holo finish. */}
        <span
          aria-hidden
          className="absolute left-1/2 top-[44%] size-[min(78vw,320px)] -translate-x-1/2 -translate-y-1/2"
        >
          <span className="mox-orbit absolute inset-0 rounded-full" />
          <span className="absolute inset-[12%] rounded-full bg-[radial-gradient(closest-side,rgb(46_230_107/0.35),transparent)] blur-xl" />
        </span>
        <Mox pose="visor" size={260} priority alt="Mox, ready to take you in" />
      </div>

      <h1
        ref={headingRef}
        tabIndex={-1}
        className="mt-4 text-[clamp(1.8rem,4.4vw,2.6rem)] font-bold leading-[1.05] tracking-[-0.035em] outline-none"
      >
        <span className="ds-grad-text">Woohoo!</span> {brandName ? `${brandName} is` : "You're"} all
        set.
      </h1>
      <p className="mt-2 text-[14px] text-muted-foreground">
        Press and hold. I&apos;ll take you in.
      </p>

      <ul className="mt-5 flex flex-wrap justify-center gap-2" aria-label="What Mox learned">
        {learned.map((l, i) => (
          <motion.li
            key={l}
            initial={reduce ? false : { opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: 0.15 + i * 0.08, type: "spring", stiffness: 420, damping: 26 }}
            className="flex h-9 items-center gap-1.5 rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] pl-1.5 pr-3.5 text-[13px] font-semibold shadow-[var(--ds-card-shadow)]"
          >
            <span className="ds-grad-pill grid size-6 place-items-center rounded-full">
              <Check className="size-3.5" strokeWidth={3} aria-hidden />
            </span>
            {l}
          </motion.li>
        ))}
      </ul>

      <div className="mt-8">
        <HoldToEnter onDone={onEnter} />
      </div>
      <button
        type="button"
        onClick={onBack}
        className={cn(dsGhostBtn, "mt-5 h-10 px-4 text-[13px]")}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back
      </button>
    </div>
  );
}
