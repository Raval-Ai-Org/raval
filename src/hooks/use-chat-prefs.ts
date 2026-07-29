import { useCallback, useEffect, useState } from "react";

export type ChatDensity = "comfortable" | "compact";

const DENSITY_KEY = "chat-density";
const MOTION_KEY = "chat-reduced-motion";

/**
 * Per-user chat surface preferences:
 *  - density: comfortable | compact (spacing + font scale)
 *  - reducedMotion: disables shimmer / streaming caret / framer animations
 *
 * Persisted to localStorage and reflected as data-attributes on <html> so
 * styles.css and any chat-scoped CSS can react globally.
 */
export function useChatPrefs() {
  const [density, setDensityState] = useState<ChatDensity>("comfortable");
  const [reducedMotion, setReducedMotionState] = useState<boolean>(false);
  const [mounted, setMounted] = useState(false);

  // Hydrate from storage / system once mounted (avoids SSR mismatch).
  useEffect(() => {
    try {
      const d = localStorage.getItem(DENSITY_KEY) as ChatDensity | null;
      if (d === "compact" || d === "comfortable") setDensityState(d);

      const rmRaw = localStorage.getItem(MOTION_KEY);
      if (rmRaw === "1" || rmRaw === "0") {
        setReducedMotionState(rmRaw === "1");
      } else if (typeof window !== "undefined" && window.matchMedia) {
        setReducedMotionState(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      }
    } catch {
      /* storage disabled */
    }
    setMounted(true);
  }, []);

  // Persist + apply to <html> so global CSS can react.
  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    root.dataset.chatDensity = density;
    root.dataset.chatMotion = reducedMotion ? "reduced" : "full";
    try {
      localStorage.setItem(DENSITY_KEY, density);
      localStorage.setItem(MOTION_KEY, reducedMotion ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [density, reducedMotion, mounted]);

  return {
    mounted,
    density,
    setDensity: setDensityState,
    toggleDensity: useCallback(
      () => setDensityState((d) => (d === "compact" ? "comfortable" : "compact")),
      [],
    ),
    reducedMotion,
    setReducedMotion: setReducedMotionState,
    toggleReducedMotion: useCallback(() => setReducedMotionState((v) => !v), []),
  };
}
