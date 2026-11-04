"use client";

// The way into the app (Mellox 2.0, ADR-0044; Holo's "teleport"): Mox waves,
// puts the headset on, the visor lights up, the camera flies into it, a
// tunnel of Mox-coloured light, a white flash. `onCovered` fires under the
// flash: navigate then, and the app builds in behind (`EntryBloom`).
// Reduced motion: a plain fade. The light tunnel only runs on capable devices.

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Mox } from "./Mox";

export type Beat = "wave" | "headset" | "glow" | "dolly" | "tunnel" | "flash";

const AT: Record<Beat, number> = {
  wave: 0,
  headset: 520,
  glow: 1000,
  dolly: 1420,
  tunnel: 1760,
  flash: 2380,
};
const COVERED_AT = 2520;

/** Where the visor's middle sits on visor.webp, as a transform origin. */
const VISOR_ORIGIN = "51.5% 43.5%";

const PALETTE = ["#F2F23A", "#C6F24E", "#2EE66B", "#19D6E6", "#1E7BF5", "#ffffff"];

function capable(): boolean {
  if (typeof navigator === "undefined") return false;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return (navigator.hardwareConcurrency ?? 4) >= 4 && !conn?.saveData;
}

/** Light streaks rushing past from the centre, drawn for under a second. */
function Tunnel() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !capable()) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = (canvas.width = window.innerWidth * dpr);
    const h = (canvas.height = window.innerHeight * dpr);
    const cx = w / 2;
    const cy = h / 2;
    const stars = Array.from({ length: 160 }, () => ({
      a: Math.random() * Math.PI * 2,
      r: Math.random() * 40 * dpr,
      v: (2 + Math.random() * 6) * dpr,
      c: PALETTE[Math.floor(Math.random() * PALETTE.length)],
      wd: (0.6 + Math.random() * 2.2) * dpr,
    }));
    const start = performance.now();
    let raf = 0;
    const frame = (t: number) => {
      const k = Math.min((t - start) / 900, 1);
      ctx.fillStyle = `rgba(10, 30, 24, ${0.28 - k * 0.12})`;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      for (const s of stars) {
        const r0 = s.r;
        s.v *= 1.07;
        s.r += s.v;
        const x0 = cx + Math.cos(s.a) * r0;
        const y0 = cy + Math.sin(s.a) * r0;
        const x1 = cx + Math.cos(s.a) * s.r;
        const y1 = cy + Math.sin(s.a) * s.r;
        ctx.strokeStyle = s.c;
        ctx.globalAlpha = 0.35 + k * 0.6;
        ctx.lineWidth = s.wd * (1 + k * 2);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        if (s.r > Math.hypot(cx, cy)) {
          s.r = Math.random() * 30 * dpr;
          s.v = (2 + Math.random() * 6) * dpr;
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      if (k < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} aria-hidden className="absolute inset-0 h-full w-full" />;
}

export function VisorTransition({
  onCovered,
  reduced = false,
  freeze,
}: {
  onCovered: () => void;
  reduced?: boolean;
  /** Labs only: hold on one beat for a visual check. */
  freeze?: Beat;
}) {
  const [beat, setBeat] = useState<Beat>(freeze ?? "wave");
  // Holo fills the screen with the character: size both renders to the
  // viewport (visor.webp is 1456×1080, wave.webp 1142×1377).
  const [view, setView] = useState({ w: 1440, h: 900 });
  useEffect(() => {
    const on = () => setView({ w: window.innerWidth, h: window.innerHeight });
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const visorSize = Math.round(Math.min(view.w * 0.96, view.h * 1.05 * (1456 / 1080)));
  const waveSize = Math.round(Math.min(view.w * 0.8, view.h * 0.92 * (1142 / 1377)));
  const done = useRef(onCovered);
  done.current = onCovered;

  useEffect(() => {
    if (freeze) return;
    if (reduced) {
      const t = window.setTimeout(() => done.current(), 320);
      return () => window.clearTimeout(t);
    }
    const timers = (Object.keys(AT) as Beat[]).map((b) =>
      window.setTimeout(() => setBeat(b), AT[b]),
    );
    timers.push(window.setTimeout(() => done.current(), COVERED_AT));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [reduced, freeze]);

  const past = (b: Beat) => AT[beat] >= AT[b];

  return (
    <motion.div
      role="status"
      aria-live="polite"
      aria-label="Entering Mellox"
      className="fixed inset-0 z-[200] overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduced ? 0.3 : 0.35 }}
      style={{ background: reduced ? "#ffffff" : "var(--mox-backdrop)" }}
    >
      {!reduced && (
        <>
          <div aria-hidden className="absolute inset-0 bg-white/55" />
          <div className="absolute inset-0 grid place-items-center">
            <motion.div
              className="relative"
              style={{ transformOrigin: VISOR_ORIGIN }}
              initial={{ scale: 0.6, y: 30, opacity: 0 }}
              animate={
                past("dolly")
                  ? { scale: 5, y: 0, opacity: past("tunnel") ? 0 : 1, filter: "blur(6px)" }
                  : past("headset")
                    ? { scale: 1, y: 0, opacity: 1, filter: "blur(0px)" }
                    : { scale: 1, y: 0, opacity: 1, filter: "blur(0px)" }
              }
              transition={
                past("dolly")
                  ? { duration: 0.62, ease: [0.7, 0, 0.84, 0] }
                  : { type: "spring", stiffness: 260, damping: 18 }
              }
            >
              <AnimatePresence mode="popLayout" initial={false}>
                {past("headset") ? (
                  <motion.div
                    key="visor"
                    // Putting the headset on: a small dip as it settles.
                    initial={{ opacity: 0, scale: 0.97, y: 0 }}
                    animate={{ opacity: 1, scale: 1, y: [0, 5, 0] }}
                    transition={{ duration: 0.42, ease: "easeInOut" }}
                    className="relative"
                  >
                    <Mox
                      pose="visor"
                      size={visorSize}
                      float={false}
                      shadow={false}
                      priority
                      alt=""
                    />
                    {/* The visor lighting up: a sweep, then two pulses. */}
                    <motion.span
                      aria-hidden
                      className="pointer-events-none absolute rounded-[40%] mix-blend-screen"
                      style={{
                        left: "27%",
                        top: "30%",
                        width: "47%",
                        height: "27%",
                        background:
                          "linear-gradient(100deg, transparent 0%, rgba(217,245,58,0.95) 40%, rgba(46,230,107,0.9) 60%, transparent 100%)",
                        backgroundSize: "220% 100%",
                        filter: "blur(6px)",
                      }}
                      initial={{ opacity: 0, backgroundPositionX: "120%" }}
                      animate={
                        past("glow")
                          ? { opacity: [0, 1, 0.55, 1, 0.8], backgroundPositionX: ["120%", "-20%"] }
                          : { opacity: 0 }
                      }
                      transition={{ duration: 0.75, ease: "easeOut" }}
                    />
                    <motion.span
                      aria-hidden
                      className="pointer-events-none absolute rounded-full"
                      style={{
                        left: "18%",
                        top: "18%",
                        width: "66%",
                        height: "52%",
                        background:
                          "radial-gradient(closest-side, rgba(46,230,107,0.55), transparent)",
                        filter: "blur(18px)",
                      }}
                      initial={{ opacity: 0 }}
                      animate={past("glow") ? { opacity: [0, 0.9, 0.5, 1] } : { opacity: 0 }}
                      transition={{ duration: 0.8 }}
                    />
                  </motion.div>
                ) : (
                  <motion.div
                    key="wave"
                    initial={{ opacity: 0, rotate: -6 }}
                    animate={{ opacity: 1, rotate: [0, -4, 4, -2, 0] }}
                    exit={{ opacity: 0, y: 4, scale: 0.97 }}
                    transition={{ duration: 0.5 }}
                  >
                    <Mox pose="wave" size={waveSize} float={false} shadow={false} priority alt="" />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </div>
          {past("tunnel") && (
            <motion.div
              className="absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.18 }}
              style={{
                background:
                  "radial-gradient(circle at 50% 50%, #2ee66b 0%, #0f9a4a 35%, #0b3d33 100%)",
              }}
            >
              <Tunnel />
            </motion.div>
          )}
          <motion.div
            aria-hidden
            className="absolute inset-0 bg-white"
            initial={{ opacity: 0 }}
            animate={{ opacity: past("flash") ? 1 : 0 }}
            transition={{ duration: 0.16 }}
          />
        </>
      )}
    </motion.div>
  );
}

const BLOOM_KEY = "mox:bloom";

/** Mark that the next page should build in from the flash. */
export function markEntryBloom() {
  try {
    sessionStorage.setItem(BLOOM_KEY, "1");
  } catch {
    /* ignore */
  }
}

/**
 * The last beat, on the app's side: the white flash fades away while the
 * window settles from 0.96 to full size. Renders nothing unless the
 * cinematic just played.
 */
export function EntryBloom() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    try {
      if (sessionStorage.getItem(BLOOM_KEY)) {
        sessionStorage.removeItem(BLOOM_KEY);
        setOn(true);
      }
    } catch {
      /* ignore */
    }
  }, []);
  return (
    <AnimatePresence>
      {on && (
        <motion.div
          key="bloom"
          aria-hidden
          className="pointer-events-none fixed inset-0 z-[200] bg-white"
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.05 }}
          onAnimationComplete={() => setOn(false)}
        />
      )}
    </AnimatePresence>
  );
}
