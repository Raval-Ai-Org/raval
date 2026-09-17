"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Reveal streamed text at an even pace instead of in network-sized chunks.
 *
 * Tokens arrive in bursts; rendering them as they land makes a reply jump.
 * This walks the visible length toward the received text every frame, going
 * faster the further behind it is, so it never lags noticeably and always
 * catches up after the stream ends. Text that was never streaming (history,
 * a finished reply) shows in full immediately.
 */
export function useSmoothText(target: string, streaming: boolean, disabled = false): string {
  const animate = !disabled && streaming;
  const [shown, setShown] = useState(() => (animate ? "" : target));
  const shownLen = useRef(animate ? 0 : target.length);
  const everStreamed = useRef(animate);
  const targetRef = useRef(target);
  targetRef.current = target;

  if (streaming) everStreamed.current = true;

  useEffect(() => {
    // Never animated (loaded from history) or motion is off: show it all.
    if (disabled || !everStreamed.current) {
      shownLen.current = target.length;
      setShown(target);
      return;
    }
    // Content was replaced with something shorter (tags stripped): follow it.
    if (target.length < shownLen.current) {
      shownLen.current = target.length;
      setShown(target);
    }
  }, [target, disabled]);

  useEffect(() => {
    if (disabled || !everStreamed.current) return;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      const full = targetRef.current;
      const remaining = full.length - shownLen.current;
      if (remaining > 0) {
        // ~60fps; render at most every 24ms so long markdown stays cheap.
        if (now - last >= 24) {
          const perFrame = streaming
            ? Math.max(2, Math.ceil(remaining / 14))
            : Math.max(6, Math.ceil(remaining / 5));
          let next = Math.min(full.length, shownLen.current + perFrame);
          // Finish the word we're in, so text doesn't break mid-word.
          const space = full.indexOf(" ", next);
          if (space !== -1 && space - next < 12) next = space;
          shownLen.current = next;
          setShown(full.slice(0, next));
          last = now;
        }
        raf = requestAnimationFrame(tick);
      } else if (streaming) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [streaming, disabled]);

  return disabled || !everStreamed.current ? target : shown;
}
