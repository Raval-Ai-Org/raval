"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";
import { Logo } from "@/components/brand/Logo";

/**
 * Minimal, animated auth shell.
 * Left: quiet brand canvas with a single drifting aurora.
 * Right: a focused, breathing card with the form.
 */
export function AuthShell({
  title,
  children,
  footer,
}: {
  title: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}) {
  // useReducedMotion returns null on the server and a boolean on the client.
  // To avoid SSR/CSR hydration mismatches, we start as false (matching the
  // server render) and update after mount.
  const reduceMotionRaw = useReducedMotion();
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    setReduce(!!reduceMotionRaw);
  }, [reduceMotionRaw]);
  const ease = [0.22, 1, 0.36, 1] as const;

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[hsl(var(--background))] text-foreground">
      <div className="relative z-10 mx-auto grid min-h-dvh w-full max-w-[1440px] gap-0 p-3 sm:p-5 lg:grid-cols-2 lg:p-6">
        {/* Brand pane */}
        <aside className="relative hidden overflow-hidden rounded-[32px] lg:block">
          <BrandCanvas reduce={!!reduce} />
          <div className="relative z-10 flex h-full flex-col justify-between p-12">
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease }}
            >
              <Logo height={30} />
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.9, ease }}
              className="font-display max-w-md text-[clamp(2.4rem,3.6vw,3.4rem)] font-medium leading-[1.05] tracking-[-0.02em] text-white"
            >
              Your AI{" "}
              <span className="text-emerald-300/95 [text-shadow:0_0_36px_rgba(52,211,153,0.35)]">
                marketing team.
              </span>
            </motion.h1>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.8 }}
              className="text-[11px] uppercase tracking-[0.22em] text-white/40"
            >
              © Raval Ai
            </motion.div>
          </div>
        </aside>

        {/* Form pane */}
        <section className="relative flex items-center justify-center px-2 py-8 sm:px-6">
          <div className="w-full max-w-[400px]">
            <div className="mb-8 flex justify-center lg:hidden">
              <Logo height={30} />
            </div>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease }}
            >
              <motion.h2
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.6, ease }}
                className="font-display mb-8 text-center text-[28px] font-semibold leading-[1.1] tracking-[-0.02em] text-foreground"
              >
                {title}
              </motion.h2>

              <motion.div
                initial="hidden"
                animate="show"
                variants={{
                  hidden: {},
                  show: { transition: { staggerChildren: 0.06, delayChildren: 0.2 } },
                }}
                className="space-y-4"
              >
                {children}
              </motion.div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.6 }}
              className="mt-8"
            >
              {footer}
            </motion.div>
          </div>
        </section>
      </div>
    </div>
  );
}

/** Stagger helper for form rows. */
export const authRow = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const } },
};

function BrandCanvas({ reduce }: { reduce: boolean }) {
  return (
    <div className="absolute inset-0 overflow-hidden rounded-[32px] bg-black">
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background: "radial-gradient(120% 90% at 0% 0%, #0b2a22 0%, #06120f 48%, #04070a 100%)",
        }}
      />
      {!reduce && (
        <>
          <motion.div
            aria-hidden
            className="absolute -left-32 top-1/4 h-[560px] w-[560px] rounded-full"
            style={{
              background:
                "radial-gradient(circle, rgba(16,185,129,0.42) 0%, rgba(16,185,129,0) 65%)",
              filter: "blur(48px)",
            }}
            animate={{ x: [0, 60, -10, 0], y: [0, -30, 20, 0], scale: [1, 1.06, 0.97, 1] }}
            transition={{ duration: 28, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            aria-hidden
            className="absolute -right-24 bottom-0 h-[580px] w-[580px] rounded-full"
            style={{
              background:
                "radial-gradient(circle, rgba(56,189,248,0.32) 0%, rgba(56,189,248,0) 65%)",
              filter: "blur(56px)",
            }}
            animate={{ x: [0, -40, 20, 0], y: [0, 30, -15, 0], scale: [1, 0.95, 1.05, 1] }}
            transition={{ duration: 32, repeat: Infinity, ease: "easeInOut" }}
          />
        </>
      )}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.08) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          maskImage: "radial-gradient(ellipse 75% 65% at 50% 50%, #000 35%, transparent 85%)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 50%, transparent 55%, rgba(0,0,0,0.55) 100%)",
        }}
      />
    </div>
  );
}
