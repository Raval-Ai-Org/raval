"use client";

import { useState, type Ref } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Check } from "@/components/icons";
import { Mox } from "@/components/brand/mox/Mox";
import { HoldToEnter } from "./HoldToEnter";

/**
 * Onboarding's last step (Mellox 2.0, Holo's finish): Mox in the VR headset,
 * big, and one small button; the words are for screen readers only. Mox hops
 * when the button is pointed at; holding zooms into the visor and the glow
 * grows; with no press it goes in by itself after a few seconds. Nothing is
 * made or charged here; posts are made
 * later, when the person asks for them. Presentational: OnboardingPage and
 * the lab wire it.
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
  const [hold, setHold] = useState(0);
  // Mox reacts: pointing at the button makes Mox hop with excitement.
  const [eager, setEager] = useState(false);
  const learned = [
    "Brand DNA",
    language,
    products ? `${products} ${products === 1 ? "product" : "products"}` : null,
    channels ? `${channels} ${channels === 1 ? "channel" : "channels"}` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="relative flex min-h-[calc(100dvh-7rem)] flex-col items-center justify-center pb-20 text-center">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="absolute left-0 top-0 grid size-10 place-items-center rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] text-foreground/70 shadow-[var(--ds-card-shadow)] transition hover:-translate-x-0.5 hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
      </button>

      {/* Holo: Mox in the VR headset, big, alive (floating, hopping when
          the button is pointed at). Holding zooms into the visor; the
          teleport takes over from there. */}
      <div className="relative grid w-full place-items-center">
        <span
          aria-hidden
          className="absolute left-1/2 top-1/2 size-[min(110vw,80dvh,760px)] rounded-full bg-[radial-gradient(closest-side,rgb(46_230_107/0.34),rgb(25_214_230/0.12)_62%,transparent)] blur-2xl"
          style={{
            transform: `translate(-50%,-50%) scale(${1 + hold * 0.5})`,
            opacity: 0.75 + hold * 0.25,
          }}
        />
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 24, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 20 }}
          className="relative w-[min(94vw,82dvh,880px)]"
        >
          <motion.div
            animate={
              eager && !hold && !reduce
                ? { y: [0, -14, 0], rotate: [0, -2, 1.5, 0] }
                : { y: 0, rotate: 0 }
            }
            transition={
              eager && !hold
                ? { duration: 0.7, repeat: Infinity, ease: "easeInOut" }
                : { duration: 0.3 }
            }
          >
            <div
              style={{
                transform: `scale(${1 + hold * 0.4})`,
                transformOrigin: "50% 42%",
              }}
            >
              <Mox
                pose="visor"
                size={880}
                shadow={false}
                priority
                alt="Mox, ready to take you in"
                className="!w-full [&_img]:h-auto [&_img]:w-full"
              />
            </div>
          </motion.div>
        </motion.div>
      </div>

      <h1 ref={headingRef} tabIndex={-1} className="sr-only outline-none">
        <span className="ds-grad-text">Woohoo!</span>{" "}
        {brandName ? `${brandName} is ready.` : "You're ready."}
      </h1>

      <ul className="sr-only" aria-label="What Mox learned">
        {learned.map((l, i) => (
          <motion.li
            key={l}
            initial={reduce ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + i * 0.07, duration: 0.3 }}
            className="inline-flex items-center gap-1"
          >
            <Check className="size-3.5 text-[var(--mox-green)]" strokeWidth={3} aria-hidden />
            {l}
          </motion.li>
        ))}
      </ul>

      <motion.div
        className="absolute inset-x-0 bottom-4 flex justify-center"
        initial={reduce ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45, type: "spring", stiffness: 300, damping: 26 }}
      >
        <HoldToEnter
          onDone={onEnter}
          onProgress={setHold}
          onHoverChange={setEager}
          autoAfterMs={6000}
        />
      </motion.div>
    </div>
  );
}
