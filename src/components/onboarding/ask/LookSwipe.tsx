"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import { AnimatePresence, motion, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import { Heart, X } from "@/components/icons";
import { LOOK_SAMPLES, type LookSample } from "@/lib/onboarding/answers";
import type { SwipeScreen } from "@/lib/onboarding/questions";
import { swipeFromDrag } from "@/lib/studio/idea-deck";
import { cn } from "@/lib/utils";
import { Confetti } from "./Confetti";
import { Highlighted } from "./text";

/** Enough swipes to say something about a look; the dock's Continue shows after it. */
export const LOOK_MIN_SWIPES = 4;

/**
 * "Which posts feel like you?": a deck of real Mellox posts. Right (or →)
 * likes, left (or ←) skips — the same gesture as the ideas deck in Studio,
 * so it teaches it too. Likes only steer the look when two agree
 * (`pickedMedium`).
 */
export function LookSwipe({
  screen,
  likes,
  skips,
  reduce,
  headingRef,
  onSwipe,
  onDone,
}: {
  screen: SwipeScreen;
  likes: string[];
  skips: string[];
  reduce: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  onSwipe: (id: string, liked: boolean) => void;
  onDone: () => void;
}) {
  const seen = new Set([...likes, ...skips]);
  const left = LOOK_SAMPLES.filter((s) => !seen.has(s.id));
  const [exitDir, setExitDir] = useState<1 | -1>(1);
  const [burst, setBurst] = useState(0);
  const swiped = seen.size;
  const top = left[0];

  const swipe = (liked: boolean) => {
    if (!top) return;
    setExitDir(liked ? 1 : -1);
    if (liked && likes.length === 0 && !reduce) setBurst((n) => n + 1);
    onSwipe(top.id, liked);
    if (left.length === 1) window.setTimeout(onDone, reduce ? 80 : 380);
  };

  const swipeRef = useRef(swipe);
  swipeRef.current = swipe;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,[contenteditable]")) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        swipeRef.current(true);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        swipeRef.current(false);
      }
    };
    // Capture, so the page's ←/→ (back/next) never fires while the deck is up.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

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
        {swiped >= LOOK_MIN_SWIPES && top ? "Keep going, or continue when you like." : screen.sub}
      </p>

      <div className="relative mt-3 flex min-h-0 w-full flex-1 items-center justify-center sm:mt-5">
        <Confetti fire={burst} />
        <div className="relative aspect-[4/5] h-full max-h-[440px] max-w-full">
          <AnimatePresence custom={exitDir}>
            {left
              .slice(0, 3)
              .reverse()
              .map((s) => {
                const depth = left.indexOf(s);
                return depth === 0 ? (
                  <TopCard key={s.id} sample={s} reduce={reduce} onSwipe={swipe} />
                ) : (
                  <motion.div
                    key={s.id}
                    initial={false}
                    animate={{ scale: 1 - depth * 0.05, y: depth * 14, opacity: 1 - depth * 0.25 }}
                    transition={{ type: "spring", stiffness: 260, damping: 26 }}
                    className="absolute inset-0 overflow-hidden rounded-[26px] bg-card shadow-[0_18px_40px_-24px_rgb(0_0_0/0.35)]"
                    aria-hidden
                  >
                    <img src={s.src} alt="" className="size-full object-cover" draggable={false} />
                  </motion.div>
                );
              })}
          </AnimatePresence>
          {!top && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute inset-0 grid place-items-center rounded-[26px] border border-dashed border-border text-center text-[14px] text-muted-foreground"
            >
              Mox has your taste.
            </motion.div>
          )}
        </div>
      </div>

      <div className="mt-3 flex shrink-0 items-center gap-4">
        <SwipeButton label="Not for me" onClick={() => swipe(false)} disabled={!top}>
          <X className="size-5" />
        </SwipeButton>
        <span className="min-w-[64px] text-center text-[12px] tabular-nums text-muted-foreground">
          {Math.min(swiped + 1, LOOK_SAMPLES.length)} / {LOOK_SAMPLES.length}
        </span>
        <SwipeButton label="Feels like me" onClick={() => swipe(true)} disabled={!top} primary>
          <Heart className="size-5" />
        </SwipeButton>
      </div>
    </div>
  );
}

function SwipeButton({
  label,
  primary,
  disabled,
  onClick,
  children,
}: {
  label: string;
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      whileTap={{ scale: 0.88 }}
      whileHover={{ y: -2 }}
      className={cn(
        "grid size-12 place-items-center rounded-full shadow-[0_10px_24px_-14px_rgb(0_0_0/0.4)] transition-colors disabled:opacity-40",
        primary
          ? "bg-primary text-primary-foreground"
          : "border border-border bg-card text-foreground/70 hover:text-foreground",
      )}
    >
      {children}
    </motion.button>
  );
}

function TopCard({
  sample,
  reduce,
  onSwipe,
}: {
  sample: LookSample;
  reduce: boolean;
  onSwipe: (liked: boolean) => void;
}) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-220, 220], [-14, 14]);
  const like = useTransform(x, [20, 110], [0, 1]);
  const nope = useTransform(x, [-110, -20], [1, 0]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const action = swipeFromDrag(info.offset.x, info.velocity.x);
    if (action) onSwipe(action === "save");
  };

  return (
    <motion.div
      style={{ x, rotate }}
      drag={reduce ? false : "x"}
      dragSnapToOrigin
      dragElastic={0.7}
      onDragEnd={onDragEnd}
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.92, y: 18 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={
        reduce
          ? { opacity: 0 }
          : (((dir: 1 | -1) => ({
              x: dir * 460,
              rotate: dir * 20,
              opacity: 0,
              transition: { duration: 0.34 },
            })) as never)
      }
      transition={{ type: "spring", stiffness: 300, damping: 26 }}
      className="absolute inset-0 cursor-grab touch-pan-y overflow-hidden rounded-[26px] bg-card shadow-[0_28px_60px_-28px_rgb(0_0_0/0.45)] active:cursor-grabbing"
    >
      <img
        src={sample.src}
        alt={sample.alt}
        className="pointer-events-none size-full object-cover"
        draggable={false}
      />
      <motion.span
        style={{ opacity: like }}
        className="absolute left-4 top-4 -rotate-12 rounded-full bg-primary px-3 py-1 text-[13px] font-bold text-primary-foreground shadow"
      >
        Like
      </motion.span>
      <motion.span
        style={{ opacity: nope }}
        className="absolute right-4 top-4 rotate-12 rounded-full bg-foreground px-3 py-1 text-[13px] font-bold text-background shadow"
      >
        Skip
      </motion.span>
    </motion.div>
  );
}
