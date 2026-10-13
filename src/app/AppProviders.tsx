"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ConnectWindowReturn } from "@/components/app/connectors/ConnectWindowReturn";
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

export default function AppProviders({ children }: { children: React.ReactNode }) {
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
        {/* Public website analytics are consent-gated by MarketingLayout.
            Never record authenticated workspace/Google reports with Clarity. */}
        <ConnectWindowReturn />
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
