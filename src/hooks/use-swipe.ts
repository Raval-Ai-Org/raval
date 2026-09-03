"use client";

import { useEffect } from "react";

type Handlers = {
  /** Called when user swipes right past threshold (finger moves L→R). */
  onSwipeRight?: () => void;
  /** Called when user swipes left past threshold (finger moves R→L). */
  onSwipeLeft?: () => void;
  /** Only fire onSwipeRight when the gesture starts within this many px from left edge. */
  edgeStartLeftPx?: number;
  /** Only fire onSwipeLeft when the gesture starts within this many px from right edge. */
  edgeStartRightPx?: number;
  /** Minimum horizontal distance in px to trigger (default 60). */
  threshold?: number;
  /** Maximum vertical drift allowed to still count as horizontal swipe (default 60). */
  maxVertical?: number;
  /** Disable entirely (e.g. on desktop). */
  enabled?: boolean;
};

/**
 * Global touch swipe detector used to open/close the mobile side drawers.
 * Attaches passive listeners to window so it works no matter which surface
 * the finger starts on.
 */
export function useSwipe({
  onSwipeRight,
  onSwipeLeft,
  edgeStartLeftPx,
  edgeStartRightPx,
  threshold = 60,
  maxVertical = 60,
  enabled = true,
}: Handlers) {
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    let startX = 0;
    let startY = 0;
    let startedFromLeft = false;
    let startedFromRight = false;
    let active = false;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        active = false;
        return;
      }
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      const vw = window.innerWidth;
      startedFromLeft = edgeStartLeftPx == null ? true : startX <= edgeStartLeftPx;
      startedFromRight = edgeStartRightPx == null ? true : startX >= vw - edgeStartRightPx;
      active = true;
    };

    const onEnd = (e: TouchEvent) => {
      if (!active) return;
      active = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dy) > maxVertical) return;
      if (Math.abs(dx) < threshold) return;
      if (dx > 0 && onSwipeRight && startedFromLeft) onSwipeRight();
      else if (dx < 0 && onSwipeLeft && startedFromRight) onSwipeLeft();
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchend", onEnd);
    };
  }, [
    onSwipeRight,
    onSwipeLeft,
    edgeStartLeftPx,
    edgeStartRightPx,
    threshold,
    maxVertical,
    enabled,
  ]);
}
