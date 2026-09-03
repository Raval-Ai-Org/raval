"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Data considered fresh for 60s across the app — dedupes remounts
        // and avoids refetches on tab focus for hot navigations.
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: "always",
        retry: 1,
      },
      mutations: { retry: 0 },
    },
  });
}

function RouteProgress() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const [pending, setPending] = useState(false);

  // The App Router swaps the tree once the next segment is ready; drive the
  // bar off the pathname change so a navigation still reads as "loading →
  // settled" the way it did under the previous router.
  useEffect(() => {
    setPending(true);
    const done = setTimeout(() => setPending(false), 220);
    return () => clearTimeout(done);
  }, [pathname]);

  useEffect(() => {
    let raf = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (pending) {
      setVisible(true);
      setProgress(8);
      const tick = () => {
        setProgress((p) => (p < 85 ? p + (85 - p) * 0.08 : p));
        raf = window.requestAnimationFrame(tick);
      };
      raf = window.requestAnimationFrame(tick);
    } else if (visible) {
      setProgress(100);
      timeout = setTimeout(() => {
        setVisible(false);
        setProgress(0);
      }, 260);
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (timeout) clearTimeout(timeout);
    };
  }, [pending, visible]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[200] h-[2px]"
      style={{ opacity: visible ? 1 : 0, transition: "opacity 240ms ease" }}
    >
      <div
        className="h-full origin-left bg-gradient-to-r from-[hsl(var(--brand-green))] via-[hsl(var(--brand-blue))] to-[hsl(var(--brand-green))]"
        style={{
          width: `${progress}%`,
          transition: "width 220ms cubic-bezier(0.22, 1, 0.36, 1)",
          boxShadow: "0 0 12px color-mix(in oklab, hsl(var(--brand-green)) 60%, transparent)",
        }}
      />
    </div>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  const pathname = usePathname();
  const reduce = useReducedMotion();

  // Group transitions by top-level segment so nested tabs (e.g. /app → /app/analytics)
  // don't fully unmount the shell — only the leaf content re-animates.
  const segment = "/" + (pathname.split("/")[1] ?? "");

  return (
    <QueryClientProvider client={queryClient}>
      <RouteProgress />
      <main id="main-content">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={segment}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6, filter: "blur(4px)" }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4, filter: "blur(4px)" }}
            transition={{ duration: reduce ? 0.15 : 0.32, ease: [0.22, 1, 0.36, 1] }}
            style={{ willChange: "opacity, transform, filter" }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>
      <Toaster />
    </QueryClientProvider>
  );
}
