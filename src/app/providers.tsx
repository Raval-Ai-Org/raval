"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/hooks/use-theme";

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

  // The App Router swaps the tree once the next segment is ready, so by the
  // time the pathname changes the navigation is already done. Showing the bar
  // then is honest only about "something happened" — keep it very short so a
  // hot navigation reads as instant rather than as half a second of loading.
  useEffect(() => {
    setPending(true);
    const done = setTimeout(() => setPending(false), 90);
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
      }, 160);
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
      style={{
        opacity: visible ? 1 : 0,
        transition: `opacity var(--motion-duration-medium) var(--motion-ease-standard)`,
      }}
    >
      <div
        className="h-full origin-left bg-brand"
        style={{
          width: `${progress}%`,
          transition: `width var(--motion-duration-base) var(--motion-ease-emphasized)`,
        }}
      />
    </div>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);

  // There used to be an AnimatePresence crossfade here, keyed on the top-level
  // route segment, with mode="wait" and a blur filter. mode="wait" holds the
  // incoming page until the outgoing one finishes leaving, so every navigation
  // cost roughly 640ms before the new screen even started to appear — and the
  // blur made text shimmer through the whole transition. The route progress bar
  // above is the navigation feedback; the content itself now swaps immediately.
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouteProgress />
        <main id="main-content">{children}</main>
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
