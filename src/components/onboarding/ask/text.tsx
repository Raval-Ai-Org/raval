"use client";

import { useEffect, useState } from "react";
import { onboardingArt } from "@/lib/onboarding/art";
import { cn } from "@/lib/utils";

/** "Pick your **role**" → parts; the bold ones are drawn in the Mox gradient. */
export function splitBold(text: string): { text: string; bold: boolean }[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part) =>
      part.startsWith("**") && part.endsWith("**")
        ? { text: part.slice(2, -2), bold: true }
        : { text: part, bold: false },
    );
}

export function Highlighted({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className}>
      {splitBold(text).map((p, i) =>
        p.bold ? (
          <span key={i} className="ds-grad-text font-bold">
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  );
}

/**
 * Lines that type themselves, one after the other (Native's statement
 * screens). Screen readers get the whole text at once; reduced motion shows
 * it whole.
 */
export function TypeLines({
  lines,
  reduce,
  speed = 24,
  onDone,
  className,
}: {
  lines: string[];
  reduce: boolean;
  /** ms per character */
  speed?: number;
  onDone?: () => void;
  className?: string;
}) {
  const plain = lines.map((l) => l.replace(/\*\*/g, ""));
  const total = plain.reduce((n, l) => n + l.length, 0);
  const [shown, setShown] = useState(reduce ? total : 0);

  useEffect(() => {
    if (reduce) {
      setShown(total);
      onDone?.();
      return;
    }
    setShown(0);
    let n = 0;
    const timer = window.setInterval(() => {
      n += 1;
      setShown(n);
      if (n >= total) {
        window.clearInterval(timer);
        onDone?.();
      }
    }, speed);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.join("\n"), reduce, speed, total]);

  let budget = shown;
  return (
    <span className={cn("block", className)}>
      <span className="sr-only">{plain.join(" ")}</span>
      <span aria-hidden>
        {lines.map((line, li) => {
          const parts = splitBold(line);
          const lineLen = plain[li].length;
          const visible = Math.max(0, Math.min(lineLen, budget));
          budget -= lineLen;
          let left = visible;
          const typing = visible > 0 && visible < lineLen;
          return (
            <span key={li} className={cn("block", visible === 0 && "invisible")}>
              {parts.map((p, pi) => {
                const take = Math.max(0, Math.min(p.text.length, left));
                left -= p.text.length;
                const t = p.text.slice(0, take);
                const ghost = p.text.slice(take);
                return (
                  <span key={pi} className={p.bold ? "font-bold" : undefined}>
                    <span className={p.bold ? "ds-grad-text" : undefined}>{t}</span>
                    <span className="opacity-0">{ghost}</span>
                  </span>
                );
              })}
              {typing && <span className="ob-caret" />}
            </span>
          );
        })}
      </span>
    </span>
  );
}

/** A Mox picture by name: the onboarding art, or the original renders. */
export function poseSrc(pose: string): string {
  if (pose === "wave") return "/brand/mox/wave.webp";
  if (pose === "visor") return "/brand/mox/visor.webp";
  return onboardingArt(pose) ?? "/brand/mox/wave.webp";
}
