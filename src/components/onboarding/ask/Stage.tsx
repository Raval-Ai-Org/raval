"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Logo } from "@/components/brand/Logo";
import { ArrowLeft, ArrowRight, Spinner } from "@/components/icons";
import { dsPrimaryBtn } from "@/components/app/surface/buttons";
import { onboardingArt } from "@/lib/onboarding/art";
import { cn } from "@/lib/utils";

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** Screens glide in the direction of travel; transform and opacity only. */
const SLIDE = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 36, y: 6, scale: 0.985 }),
  center: { opacity: 1, x: 0, y: 0, scale: 1, transition: { duration: 0.55, ease: EASE_OUT } },
  exit: (dir: number) => ({
    opacity: 0,
    x: dir * -28,
    scale: 0.99,
    transition: { duration: 0.24, ease: [0.4, 0, 1, 1] as const },
  }),
};
const FADE = {
  enter: { opacity: 0 },
  center: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.12 } },
};

/** Which picture sits behind the screen (Native: scenes only at the ends). */
export type StageScene = "world" | "wash" | "finish";

export type StageAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  /** A quiet pill instead of the gradient one (e.g. "Later"). */
  quiet?: boolean;
  hint?: string | null;
};

/**
 * The one-question shell: never scrolls. Header (logo · progress · Skip),
 * the answer trail, the stage (fills what's left; a screen sizes itself to
 * it) and the dock (Back · scan pill · the primary pill), so the primary
 * action is always on screen, phone or desktop.
 */
export function Stage({
  scene,
  progress,
  minutes,
  hideHeader,
  trail,
  screenKey,
  reduce,
  children,
  onBack,
  onSkip,
  skipping,
  scan,
  action,
  direction = 1,
}: {
  scene: StageScene;
  progress: number;
  minutes?: number | null;
  hideHeader?: boolean;
  trail?: ReactNode;
  screenKey: string;
  reduce: boolean;
  children: ReactNode;
  onBack?: (() => void) | null;
  onSkip?: (() => void) | null;
  skipping?: boolean;
  scan?: ReactNode;
  action?: StageAction | null;
  /** 1 forward, -1 back: screens slide the way the person is going. */
  direction?: 1 | -1;
}) {
  const world = onboardingArt("world-day");
  const finish = onboardingArt("world-finish");
  const sceneSrc = scene === "finish" ? finish : world;
  // Where Mox stands in the scene picture; the content goes on the other side.
  const side = scene === "finish" ? "right" : "left";

  return (
    <div
      data-mellox-app
      data-ob-stage
      data-scene={scene}
      className="ob-root relative grid h-dvh grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden bg-background text-foreground"
    >
      {/* Backgrounds: the 3D Mox world at the ends (Mox stays clear of the
          content: see .ob-scene-*), a soft still copy of it behind the questions.
          Only opacity and transform animate, so it stays smooth. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {world && (
          <motion.img
            src={world}
            alt=""
            className="ob-scene-blur absolute inset-0 size-full object-cover"
            initial={false}
            animate={{ opacity: scene === "wash" ? 0.55 : 0 }}
            transition={{ duration: reduce ? 0.2 : 0.9, ease: [0.16, 1, 0.3, 1] }}
          />
        )}
        <motion.div
          className="ob-wash absolute inset-0"
          initial={false}
          animate={{ opacity: scene === "wash" ? 1 : 0 }}
          transition={{ duration: reduce ? 0.2 : 0.9 }}
        />
        <AnimatePresence initial={false}>
          {scene !== "wash" && sceneSrc && (
            <motion.div
              key={scene}
              data-side={side}
              className="ob-scene-wrap absolute inset-x-0 top-0"
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.05 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? 0.2 : 1.2, ease: [0.16, 1, 0.3, 1] }}
            >
              <img src={sceneSrc} alt="" className="ob-scene size-full object-cover" />
              <span className="ob-scene-scrim absolute inset-0" />
            </motion.div>
          )}
        </AnimatePresence>
        {!reduce && scene === "wash" && <span className="ob-orb ob-orb-a" />}
        {!reduce && scene === "wash" && <span className="ob-orb ob-orb-b" />}
      </div>

      <header
        className={cn(
          "relative z-10 grid h-14 grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 sm:h-16 sm:px-6",
          hideHeader && "invisible",
        )}
      >
        <span className="justify-self-start">
          <span className="sm:hidden">
            <Logo markOnly height={26} />
          </span>
          <span className="hidden sm:block">
            <Logo height={28} />
          </span>
        </span>
        <div className="flex w-[150px] flex-col items-center gap-1 sm:w-[300px]">
          <div
            role="progressbar"
            aria-label="Setup progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/[0.07]"
          >
            <motion.div
              className="ds-grad-bar h-full rounded-full"
              initial={false}
              animate={{ width: `${Math.max(4, progress * 100)}%` }}
              transition={{ type: "spring", stiffness: 120, damping: 22 }}
            />
          </div>
          {minutes ? (
            <span className="text-[11px] font-medium text-muted-foreground">
              ~{minutes} min left
            </span>
          ) : (
            <span className="h-[16px]" />
          )}
        </div>
        <div className="justify-self-end">
          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              disabled={skipping}
              className="inline-flex h-8 items-center whitespace-nowrap rounded-full px-3 text-[12px] font-medium text-muted-foreground transition hover:bg-foreground/5 hover:text-foreground disabled:opacity-50"
            >
              {skipping ? <Spinner className="mr-1.5 size-3.5 animate-spin" aria-hidden /> : null}
              <span className="sm:hidden">Skip</span>
              <span className="hidden sm:inline">Skip for now</span>
            </button>
          )}
        </div>
      </header>

      <div className="relative z-10 min-w-0 overflow-hidden">
        {trail ?? <div className="h-2" />}
      </div>

      <main className="ob-stage relative z-10 min-h-0 px-4 pb-2 pt-1 sm:px-8 sm:pt-3">
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <motion.div
            key={screenKey}
            custom={direction}
            variants={reduce ? FADE : SLIDE}
            initial="enter"
            animate="center"
            exit="exit"
            className="mx-auto h-full w-full max-w-[1080px] will-change-transform"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="relative z-20 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-1 sm:px-6 sm:pb-5">
        <div className="flex min-w-[44px] justify-start">
          {onBack && (
            <motion.button
              type="button"
              onClick={onBack}
              aria-label="Back"
              whileTap={{ scale: 0.9 }}
              className="ob-glass grid size-11 place-items-center rounded-full text-foreground/70 transition hover:-translate-x-0.5 hover:text-foreground"
            >
              <ArrowLeft className="size-4" aria-hidden />
            </motion.button>
          )}
        </div>
        <div className="order-first flex w-full justify-center sm:order-none sm:w-auto sm:flex-1">
          {scan}
        </div>
        <div className="flex min-w-[44px] flex-col items-end gap-1">
          <AnimatePresence initial={false}>
            {action && (
              <motion.button
                key="primary"
                type="button"
                onClick={action.onClick}
                disabled={action.disabled || action.busy}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                whileTap={{ scale: 0.95 }}
                className={cn(
                  action.quiet
                    ? "ob-glass inline-flex h-12 items-center gap-2 rounded-full px-5 text-[14px] font-semibold"
                    : cn(dsPrimaryBtn, "h-12 px-6 text-[14.5px]"),
                  "disabled:opacity-50",
                )}
              >
                {action.busy ? <Spinner className="size-4 animate-spin" aria-hidden /> : null}
                {action.label}
                {!action.busy && <ArrowRight className="size-4" aria-hidden />}
              </motion.button>
            )}
          </AnimatePresence>
          {action?.hint && (
            <p className="max-w-[220px] text-right text-[11px] leading-tight text-muted-foreground">
              {action.hint}
            </p>
          )}
        </div>
      </footer>
    </div>
  );
}
