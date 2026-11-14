"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight } from "@/components/icons";

/** "Space or → to continue" (keyboards), "Tap to continue" (touch). */
export function KeyHint({ visible, label = "to continue" }: { visible: boolean; label?: string }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.span
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground"
        >
          <span className="hidden items-center gap-1.5 [@media(hover:hover)]:inline-flex">
            <kbd className="ob-kbd">Space</kbd>
            or
            <kbd className="ob-kbd">
              <ArrowRight className="size-3" aria-hidden />
            </kbd>
            {label}
          </span>
          <span className="[@media(hover:hover)]:hidden">Tap {label}</span>
        </motion.span>
      )}
    </AnimatePresence>
  );
}
