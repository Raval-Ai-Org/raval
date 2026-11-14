"use client";

import { useEffect, useState } from "react";

const COLORS = ["#2EE66B", "#C6F432", "#0EA5E9", "#B489D1", "#FE7032"];

type Piece = { id: number; x: number; y: number; r: number; c: string; s: number; d: number };

/**
 * A short burst of Mox-gradient sparks from the centre. `fire` is a counter:
 * every increase is one burst. Pure CSS (`ob-spark`), nothing left behind.
 */
export function Confetti({ fire }: { fire: number }) {
  const [pieces, setPieces] = useState<Piece[]>([]);
  useEffect(() => {
    if (!fire) return;
    const next = Array.from({ length: 26 }, (_, i) => {
      const a = (i / 26) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 90 + Math.random() * 120;
      return {
        id: fire * 100 + i,
        x: Math.cos(a) * dist,
        y: Math.sin(a) * dist - 40,
        r: Math.random() * 360,
        c: COLORS[i % COLORS.length],
        s: 6 + Math.random() * 6,
        d: Math.random() * 0.12,
      };
    });
    setPieces(next);
    const t = window.setTimeout(() => setPieces([]), 1100);
    return () => window.clearTimeout(t);
  }, [fire]);

  if (!pieces.length) return null;
  return (
    <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 z-20">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="ob-spark absolute block rounded-[2px]"
          style={
            {
              width: p.s,
              height: p.s * 0.45,
              background: p.c,
              "--x": `${p.x}px`,
              "--y": `${p.y}px`,
              "--r": `${p.r}deg`,
              animationDelay: `${p.d}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </span>
  );
}
