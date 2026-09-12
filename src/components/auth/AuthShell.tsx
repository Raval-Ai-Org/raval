"use client";

/**
 * The shell behind every authentication screen.
 *
 * Left: a branded canvas. Right: the form.
 *
 * The canvas used to fetch a random Pexels stock video, rotate it on a
 * 45–90 second random timer, and fall back — when the request failed — to an
 * MDN tutorial clip of a flower, tagged `provider: "Raval AI"`. On top of the
 * video sat eight stacked overlay layers and two permanently-animating 500px
 * `blur(64px)` blobs. The first thing a user saw of Mellox was therefore
 * unbranded stock footage, or a blurry flower, running a constant GPU cost.
 *
 * It is now drawn from the design tokens: no network request, no rotation, no
 * infinite animation, and it reads as Mellox in both themes.
 */

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";
import { Logo } from "@/components/brand/Logo";
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
  // useReducedMotion returns null on the server and a boolean on the client,
  // so start at false to match the server render and update after mount.
  const prefersReduced = useReducedMotion();
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    setReduce(!!prefersReduced);
  }, [prefersReduced]);

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      <div className="relative z-10 mx-auto grid min-h-dvh w-full max-w-[1440px] lg:grid-cols-2">
        <aside className="relative hidden p-3 lg:block">
          <BrandCanvas reduce={reduce} />
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

const PROOF_POINTS = [
  "Grounded in your Brand DNA",
  "Answer- and generative-engine optimisation",
  "Publishing across every channel",
];

function BrandCanvas({ reduce }: { reduce: boolean }) {
  return (
    <div className="absolute inset-3 overflow-hidden rounded-[28px] bg-[hsl(220_28%_7%)]">
      {/* Mesh: two brand-tinted pools and one deep well. Static gradients, so
          there is nothing to animate and nothing to download. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background: [
            "radial-gradient(80% 60% at 12% 8%, hsl(var(--brand) / 0.30) 0%, transparent 60%)",
            "radial-gradient(70% 55% at 88% 78%, hsl(var(--primary) / 0.55) 0%, transparent 62%)",
            "radial-gradient(120% 100% at 50% 120%, hsl(220 28% 4%) 0%, transparent 70%)",
          ].join(","),
        }}
      />

      {/* One slow breath, on opacity only — no blur to re-rasterise each frame. */}
      {!reduce && (
        <motion.div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(55% 45% at 70% 25%, hsl(var(--brand) / 0.22) 0%, transparent 65%)",
          }}
          animate={{ opacity: [0.55, 1, 0.55] }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      {/* Dot grid, masked to the centre so the edges stay clean. */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.14]"
        style={{
          backgroundImage: "radial-gradient(hsl(0 0% 100% / 0.5) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
          maskImage: "radial-gradient(ellipse 70% 60% at 50% 45%, #000 30%, transparent 85%)",
          WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 50% 45%, #000 30%, transparent 85%)",
        }}
      />

      <div className="relative flex h-full flex-col justify-between p-10">
        <Logo height={28} className="[&_span]:text-white [&_div]:text-white" />

        <div>
          <p className="max-w-[22ch] font-display text-[2rem] font-semibold leading-[1.15] tracking-tight text-white">
            The marketing intelligence layer.
          </p>
          <ul className="mt-7 space-y-3">
            {PROOF_POINTS.map((point) => (
              <li key={point} className="flex items-center gap-2.5 text-sm text-white/72">
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full bg-brand shadow-[0_0_10px_hsl(var(--brand)/0.8)]"
                />
                {point}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
