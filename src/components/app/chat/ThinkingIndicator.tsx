"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * The Mellox mark as a live presence: still when idle, a slow breathing
 * orbit while Mellox is working. Used next to the reply that is being written.
 */
export function MelloxPulse({ active, className }: { active: boolean; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <span
      aria-hidden
      className={cn("mx-pulse relative grid size-7 shrink-0 place-items-center", className)}
      data-active={active ? "true" : "false"}
    >
      <motion.span
        className="mx-pulse__orbit absolute inset-0 rounded-full"
        // The orbit is a loading signal, so it keeps turning with reduced motion.
        animate={active ? { rotate: 360 } : { rotate: 0 }}
        transition={active ? { duration: 2.4, ease: "linear", repeat: Infinity } : {}}
      />
      <motion.span
        className="mx-pulse__core relative grid size-[18px] place-items-center"
        animate={active && !reduce ? { scale: [1, 0.86, 1] } : { scale: 1 }}
        transition={active && !reduce ? { duration: 1.6, ease: "easeInOut", repeat: Infinity } : {}}
      >
        <svg viewBox="0 0 24 24" className="size-full" fill="none">
          <path
            d="M12 2.5c.5 4.9 2.6 7 7.5 7.5-4.9.5-7 2.6-7.5 7.5-.5-4.9-2.6-7-7.5-7.5 4.9-.5 7-2.6 7.5-7.5Z"
            fill="currentColor"
          />
          <path
            d="M19 15.5c.2 2 1 2.8 3 3-2 .2-2.8 1-3 3-.2-2-1-2.8-3-3 2-.2 2.8-1 3-3Z"
            fill="currentColor"
            opacity=".55"
          />
        </svg>
      </motion.span>
    </span>
  );
}

const LABELS = ["Thinking", "Reading your brand", "Putting it together"];

/** Shown between sending and the first words of the reply. */
export function ThinkingIndicator({ label }: { label?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (label) return;
    const t = window.setInterval(() => setI((n) => Math.min(n + 1, LABELS.length - 1)), 2600);
    return () => window.clearInterval(t);
  }, [label]);
  const text = label ?? LABELS[i];

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="flex items-center gap-2.5 py-1"
      role="status"
      aria-live="polite"
    >
      <MelloxPulse active />
      <span className="relative h-5 overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={text}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22 }}
            className="mx-shimmer block text-[14px] font-medium leading-5"
          >
            {text}
          </motion.span>
        </AnimatePresence>
      </span>
    </motion.div>
  );
}
