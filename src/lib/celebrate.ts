"use client";

// A short confetti burst in Mox's colours (Mellox 2.0, ADR-0044) for real
// milestones only: first posts ready, Start here finished. One canvas over
// the page for ~1.6 s, then it removes itself. Nothing with reduced motion.

const COLOURS = ["#C6F24E", "#2EE66B", "#19D6E6", "#1E7BF5", "#F2F23A", "#ffffff"];

function reducedMotion(): boolean {
  try {
    return (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.dataset.chatMotion === "reduced"
    );
  } catch {
    return true;
  }
}

type Bit = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  spin: number;
  w: number;
  h: number;
  colour: string;
  round: boolean;
};

/** Fire once from a point (0–1 of the viewport); defaults to the top centre. */
export function celebrate(origin: { x?: number; y?: number } = {}): void {
  if (typeof window === "undefined" || reducedMotion()) return;
  const canvas = document.createElement("canvas");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100vw",
    height: "100vh",
    pointerEvents: "none",
    zIndex: "200",
  });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    return;
  }
  ctx.scale(dpr, dpr);

  const ox = (origin.x ?? 0.5) * W;
  const oy = (origin.y ?? 0.32) * H;
  const count = W < 640 ? 70 : 120;
  const bits: Bit[] = Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 5 + Math.random() * 9;
    return {
      x: ox,
      y: oy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 6,
      r: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.4,
      w: 6 + Math.random() * 6,
      h: 4 + Math.random() * 4,
      colour: COLOURS[Math.floor(Math.random() * COLOURS.length)],
      round: Math.random() < 0.3,
    };
  });

  const start = performance.now();
  const LIFE = 1600;
  const frame = (now: number) => {
    const t = now - start;
    ctx.clearRect(0, 0, W, H);
    const fade = Math.max(0, 1 - Math.max(0, t - LIFE * 0.6) / (LIFE * 0.4));
    for (const b of bits) {
      b.vx *= 0.985;
      b.vy = b.vy * 0.985 + 0.32;
      b.x += b.vx;
      b.y += b.vy;
      b.r += b.spin;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(b.x, b.y);
      ctx.rotate(b.r);
      ctx.fillStyle = b.colour;
      if (b.round) {
        ctx.beginPath();
        ctx.arc(0, 0, b.h / 1.6, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      }
      ctx.restore();
    }
    if (t < LIFE) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

/** Celebrate a milestone at most once per browser (keyed). */
export function celebrateOnce(key: string, origin?: { x?: number; y?: number }): void {
  try {
    const k = `mox:celebrated:${key}`;
    if (localStorage.getItem(k)) return;
    localStorage.setItem(k, "1");
  } catch {
    // Storage blocked: still celebrate, it's harmless.
  }
  celebrate(origin);
}
