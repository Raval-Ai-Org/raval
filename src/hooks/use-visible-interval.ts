"use client";

import { useEffect, useRef } from "react";

/**
 * setInterval that only fires while the tab is visible. When the tab is
 * hidden the interval is cleared; when it becomes visible again the callback
 * runs once (to refresh stale data) and the interval resumes. This avoids
 * burning CPU + network on background tabs across every polling surface
 * (Studio, Competitor Watch, Client Portal, Suggestions, etc.).
 */
export function useVisibleInterval(cb: () => void, delayMs: number, deps: unknown[] = []) {
  const cbRef = useRef(cb);
  cbRef.current = cb;

  useEffect(() => {
    if (typeof document === "undefined") return;
    let timer: number | undefined;
    const start = () => {
      if (timer !== undefined) return;
      timer = window.setInterval(() => cbRef.current(), delayMs);
    };
    const stop = () => {
      if (timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
    };
    const onVis = () => {
      if (document.hidden) {
        stop();
      } else {
        // refresh immediately on re-focus, then resume ticking
        try {
          cbRef.current();
        } catch {
          /* ignore */
        }
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delayMs, ...deps]);
}
