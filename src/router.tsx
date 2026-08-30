import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
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
  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Preload on hover / focus / touchstart — router fetches the chunk +
    // runs the loader before the click lands.
    defaultPreload: "intent",
    // Small debounce so a pointer sweep across a nav bar doesn't fire N
    // preloads. 50ms is TanStack's recommended sweet spot.
    defaultPreloadDelay: 50,
    // Let TanStack Query own freshness for preloaded data.
    defaultPreloadStaleTime: 0,
    // Show pending UI immediately when a transition takes longer than the
    // preload could satisfy (e.g. cold cache, slow network).
    defaultPendingMs: 0,
  });
  return router;
};
