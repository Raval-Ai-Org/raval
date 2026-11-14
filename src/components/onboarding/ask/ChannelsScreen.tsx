"use client";

import type { Ref } from "react";
import { motion } from "framer-motion";
import { Check } from "@/components/icons";
import { PlatformAppIcon, platformAppIconLabel } from "@/components/brand/PlatformAppIcon";
import {
  MAX_GOAL_CHANNELS,
  ONBOARDING_CHANNELS,
  type OnboardingChannel,
} from "@/lib/onboarding/answers";
import type { ChannelsScreen as Screen } from "@/lib/onboarding/questions";
import { cn } from "@/lib/utils";
import { Highlighted } from "./text";

/**
 * Where the brand posts: every network by its own app icon (never a row of
 * names). Many can be picked; Continue lives in the dock.
 */
export function ChannelsScreen({
  screen,
  value,
  reduce,
  headingRef,
  onChange,
}: {
  screen: Screen;
  value: OnboardingChannel[];
  reduce: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  onChange: (next: OnboardingChannel[]) => void;
}) {
  const full = value.length >= MAX_GOAL_CHANNELS;
  const toggle = (id: OnboardingChannel) =>
    onChange(value.includes(id) ? value.filter((c) => c !== id) : full ? value : [...value, id]);
  return (
    <div className="flex h-full min-h-0 flex-col items-center">
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="ob-title shrink-0 px-2 text-center outline-none"
      >
        <Highlighted text={screen.title} />
      </h1>
      <p className="mt-1.5 shrink-0 px-4 text-center text-[13px] text-muted-foreground sm:text-[14px]">
        {full ? `Up to ${MAX_GOAL_CHANNELS} for now. You can add more later.` : screen.sub}
      </p>
      <div className="flex min-h-0 w-full flex-1 items-center justify-center">
        <div
          role="group"
          aria-label="Channels"
          className="mt-4 grid w-full max-w-[560px] grid-cols-4 gap-2.5 sm:gap-3.5"
        >
          {ONBOARDING_CHANNELS.map((id, i) => {
            const on = value.includes(id);
            return (
              <motion.button
                key={id}
                type="button"
                aria-pressed={on}
                disabled={!on && full}
                onClick={() => toggle(id)}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.85 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{
                  delay: reduce ? 0 : 0.06 + i * 0.04,
                  type: "spring",
                  stiffness: 300,
                  damping: 22,
                }}
                whileTap={reduce ? undefined : { scale: 0.92 }}
                className={cn(
                  "ob-card relative flex aspect-square max-h-[132px] flex-col items-center justify-center gap-1.5 rounded-[22px] p-2 disabled:opacity-40",
                  on && "ob-card-on",
                )}
              >
                <motion.span
                  animate={on && !reduce ? { rotate: [0, -8, 6, 0], scale: [1, 1.12, 1] } : {}}
                  transition={{ duration: 0.45 }}
                  className="block"
                >
                  <PlatformAppIcon platform={id} size={40} />
                </motion.span>
                <span className="text-[11.5px] font-semibold text-foreground/80 sm:text-[12.5px]">
                  {platformAppIconLabel(id)}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "absolute right-2 top-2 grid size-5 place-items-center rounded-full transition-all duration-300",
                    on ? "scale-100 bg-primary text-primary-foreground" : "scale-0",
                  )}
                >
                  <Check className="size-3" strokeWidth={3} />
                </span>
              </motion.button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
