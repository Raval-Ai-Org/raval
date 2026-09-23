"use client";

/**
 * The shell behind every authentication screen.
 *
 * Left: a branded canvas. Right: the form.
 *
 * The canvas used to fetch a random Pexels stock video, rotate it on a
 * 45–90 second random timer, and fall back — when the request failed — to an
 * MDN tutorial clip of a flower, tagged `provider: "Mellox AI"`. On top of the
 * video sat eight stacked overlay layers and two permanently-animating 500px
 * `blur(64px)` blobs. The first thing a user saw of Mellox was therefore
 * unbranded stock footage, or a blurry flower, running a constant GPU cost.
 *
 * It is now `AuthShowcase`: a light stage that plays short scenes of the
 * product itself, drawn as interface cards. No network request, and a still
 * scene for reduced motion.
 */

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { useReducedMotionSafe } from "@/hooks/use-reduced-motion-safe";
import { Logo } from "@/components/brand/Logo";
import { AuthShowcase } from "@/components/auth/AuthShowcase";
import { duration, ease } from "@/lib/motion";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: ReactNode;
  /** One line under the title. Optional — omit rather than pad. */
  subtitle?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}) {
  const reduce = useReducedMotionSafe();

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      <div className="relative z-10 mx-auto grid min-h-dvh w-full max-w-[1440px] lg:grid-cols-2">
        <aside className="relative hidden p-3 lg:block">
          <AuthShowcase reduce={reduce} />
        </aside>

        <section className="relative flex items-center justify-center px-5 py-10 sm:px-8">
          <div className="w-full max-w-[380px]">
            <div className="mb-8 flex justify-center lg:hidden">
              <Logo height={30} />
            </div>

            {/* One short entrance. The previous version chained a 0.7s card
                reveal, a 0.1s-delayed title, a 0.2s delayChildren stagger and
                a 0.5s-delayed footer — roughly 1.3s before the form was fully
                readable, which reads as a slow app rather than a polished one. */}
            <motion.div
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: reduce ? duration.fast : duration.medium,
                ease: ease.emphasized,
              }}
            >
              <h1 className="text-center font-display text-2xl font-semibold tracking-tight text-foreground">
                {title}
              </h1>
              {subtitle ? (
                <p className="mt-2 text-center text-sm text-muted-foreground">{subtitle}</p>
              ) : null}

              <div className="mt-7 space-y-4">{children}</div>
              <div className="mt-7">{footer}</div>
            </motion.div>
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * Retained so `LoginPage` / `SignupPage` can keep tagging their field rows.
 * The stagger is gone — the rows now arrive with the card — so this is an
 * identity variant, kept to avoid touching both forms for no visual gain.
 */
export const authRow = {
  hidden: { opacity: 1, y: 0 },
  show: { opacity: 1, y: 0 },
};
