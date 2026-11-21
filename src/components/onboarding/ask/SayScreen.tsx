"use client";

import { useState, type Ref } from "react";
import { motion } from "framer-motion";
import type { SayScreen as Screen } from "@/lib/onboarding/questions";
import { cn } from "@/lib/utils";
import { KeyHint } from "./KeyHint";
import { TypeLines, poseSrc } from "./text";

/**
 * Mox talks (Native's story screens): the line types itself beside a big 3D
 * Mox who drops in, lands with a squash and then floats. Tap, Space or →
 * moves on; the whole screen is the button.
 */
export function SayScreen({
  screen,
  reduce,
  headingRef,
  onNext,
}: {
  screen: Screen;
  reduce: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  onNext: () => void;
}) {
  const [typed, setTyped] = useState(reduce);
  return (
    // The whole screen moves on when tapped; keys and the dock's Continue
    // pill do the same for keyboards and screen readers.
    <div
      onClick={onNext}
      className="group relative grid h-full w-full cursor-pointer grid-rows-[minmax(0,1fr)_auto] items-center text-left"
    >
      <div className="mx-auto grid h-full min-h-0 w-full max-w-[920px] grid-cols-1 grid-rows-[minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[1.1fr_1fr] sm:grid-rows-1 sm:gap-8">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="order-2 px-2 text-center text-[clamp(1.25rem,3.6vw,2rem)] font-medium leading-[1.25] tracking-[-0.02em] outline-none sm:order-1 sm:text-left"
        >
          <TypeLines lines={screen.lines} reduce={reduce} onDone={() => setTyped(true)} />
        </h1>
        <div className="relative order-1 grid h-full max-h-[340px] min-h-0 place-items-center sm:order-2 sm:h-[min(52dvh,440px)] sm:max-h-none">
          {/* A soft lime pool under Mox */}
          <span
            aria-hidden
            className="absolute bottom-[6%] h-[14%] w-[54%] rounded-[50%] bg-[radial-gradient(closest-side,rgb(46_230_107/0.35),transparent)] blur-md"
          />
          <motion.img
            key={screen.pose}
            src={poseSrc(screen.pose)}
            alt=""
            draggable={false}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -60, scale: 0.85, rotate: -4 }}
            animate={
              reduce
                ? { opacity: 1 }
                : {
                    opacity: 1,
                    y: 0,
                    rotate: 0,
                    scaleY: [0.85, 1.06, 0.96, 1],
                    scaleX: [0.85, 0.96, 1.04, 1],
                  }
            }
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "relative h-full w-auto max-w-full object-contain",
              !reduce && "ob-mox-idle",
            )}
          />
        </div>
      </div>
      <div className="flex justify-center pb-1">
        <KeyHint visible={typed} />
      </div>
    </div>
  );
}
