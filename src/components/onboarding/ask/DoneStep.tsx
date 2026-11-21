"use client";

import { useState, type Ref } from "react";
import { motion } from "framer-motion";
import { HoldToEnter } from "../HoldToEnter";
import { Confetti } from "./Confetti";
import { DoneBrains, type Learned } from "./AfterSteps";
import { Highlighted } from "./text";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * The finish over the 3D Mox world (Native's "Done!"). Mox stands on the
 * right of the picture, so everything sits on the left on wide screens and
 * under him on phones (`.ob-scene-content`). The four brains land one by one
 * with what each learned, then the press-and-hold goes in. Nothing is made
 * or charged here.
 */
export function DoneStep({
  brandName,
  learned,
  plan,
  reduce,
  headingRef,
  onEnter,
}: {
  brandName: string;
  learned: Learned;
  /** "3 posts a week · you approve each one", from the answers. */
  plan: string | null;
  reduce: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  onEnter: () => void;
}) {
  const [hold, setHold] = useState(0);
  const rise = (delay: number) =>
    reduce
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.2 } }
      : {
          initial: { opacity: 0, y: 18 },
          animate: { opacity: 1, y: 0 },
          transition: { delay, duration: 0.7, ease: EASE },
        };
  return (
    <div className="ob-scene-content" data-side="left">
      <div className="ob-scene-panel relative">
        <Confetti fire={reduce ? 0 : 1} />
        <motion.p
          {...rise(0.1)}
          className="ob-hide-short text-[12px] font-semibold uppercase tracking-[0.14em] text-[rgb(22_25_27/0.6)]"
        >
          You're all set
        </motion.p>
        <motion.h1
          ref={headingRef}
          tabIndex={-1}
          {...rise(0.18)}
          style={{ scale: 1 + hold * 0.03 }}
          className="ob-title ob-title-xl mt-2 outline-none"
        >
          <Highlighted text={`**Done!** Mox knows ${brandName || "your brand"}.`} />
        </motion.h1>
        {plan && (
          <motion.p
            {...rise(0.3)}
            className="ob-hide-short mt-3 text-[14px] leading-snug text-[rgb(22_25_27/0.75)]"
          >
            {plan}
          </motion.p>
        )}
        <div className="mt-5">
          <DoneBrains learned={learned} reduce={reduce} />
        </div>
        <motion.div {...rise(1.05)} className="ob-scene-action mt-6">
          <HoldToEnter
            onDone={onEnter}
            onProgress={setHold}
            autoAfterMs={9000}
            label="Hold to go in"
          />
        </motion.div>
      </div>
    </div>
  );
}
