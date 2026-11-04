"use client";

// The way into the app (Mellox 2.0, ADR-0044; Holo's "teleport"). Mox, in
// the VR headset, fills the screen; the visor lights up, a ring of light
// leaves it, the camera flies into the glass, a tunnel of Mox-coloured light
// rushes past, then a soft white flash. One continuous move, transforms and
// opacity only (no filter animation), so it stays smooth. `onCovered` fires
// under the flash: navigate then, and the app builds in behind (`EntryBloom`).
// Reduced motion: a plain fade. The light tunnel only runs on capable devices.

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Mox } from "./Mox";

export type Beat = "wave" | "headset" | "glow" | "dolly" | "tunnel" | "flash";

// "wave" is Mox arriving, "headset" a small nod, the rest as named.
const AT: Record<Beat, number> = {
  wave: 0,
  headset: 450,
  glow: 850,
  dolly: 1500,
  tunnel: 2050,
  flash: 2650,
};
const COVERED_AT = 2820;

/** Where the visor's middle sits on visor.webp, as a transform origin. */
const VISOR_ORIGIN = "51.5% 43.5%";

const PALETTE = ["#F2F23A", "#C6F24E", "#2EE66B", "#19D6E6", "#1E7BF5", "#ffffff"];
const EASE_OUT = [0.22, 1, 0.36, 1] as const;

function capable(): boolean {
  if (typeof navigator === "undefined") return false;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return (navigator.hardwareConcurrency ?? 4) >= 4 && !conn?.saveData;
}

/** Light streaks rushing past from the centre; draws until unmounted. */
function Tunnel() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !capable()) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = (canvas.width = window.innerWidth * dpr);
    const h = (canvas.height = window.innerHeight * dpr);
    const cx = w / 2;
    const cy = h / 2;
    const far = Math.hypot(cx, cy);
    const seed = (near = false) => ({
      a: Math.random() * Math.PI * 2,
      z: near ? 0.02 + Math.random() * 0.1 : 0.02 + Math.random() * 0.98,
      c: PALETTE[Math.floor(Math.random() * PALETTE.length)],
      wd: (0.8 + Math.random() * 2) * dpr,
    });
    const stars = Array.from({ length: 220 }, () => seed());
    const start = performance.now();
    let prev = start;
    let raf = 0;
    const frame = (t: number) => {
      const dt = Math.min(48, t - prev) / 1000;
      prev = t;
      const k = Math.min((t - start) / 700, 1); // speed ramps up, then holds
      const speed = 0.6 + k * k * 2.6;
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(6, 34, 26, 0.32)";
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      for (const s of stars) {
        const z0 = s.z;
        s.z += s.z * speed * dt * 2.2;
        const r0 = z0 * z0 * far;
        const r1 = s.z * s.z * far;
        ctx.strokeStyle = s.c;
        ctx.globalAlpha = Math.min(1, 0.25 + s.z);
        ctx.lineWidth = s.wd * (0.6 + s.z * 2.4);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(s.a) * r0, cy + Math.sin(s.a) * r0);
        ctx.lineTo(cx + Math.cos(s.a) * r1, cy + Math.sin(s.a) * r1);
        ctx.stroke();
        if (s.z > 1.15) Object.assign(s, seed(true));
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
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
  // Holo fills the screen with the character (visor.webp is 1456×1080).
  const [view, setView] = useState({ w: 1440, h: 900 });
  useEffect(() => {
    const on = () => setView({ w: window.innerWidth, h: window.innerHeight });
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const visorSize = Math.round(Math.min(view.w * 0.92, view.h * 0.95 * (1456 / 1080)));
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
      transition={{ duration: reduced ? 0.3 : 0.4, ease: EASE_OUT }}
      style={{ background: reduced ? "#ffffff" : "var(--mox-backdrop)" }}
    >
      {!reduced && (
        <>
          <div aria-hidden className="absolute inset-0 bg-white/60" />
          {/* A soft aurora behind Mox that brightens with the visor. */}
          <motion.div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(45% 40% at 50% 46%, rgba(46,230,107,0.45), rgba(25,214,230,0.18) 55%, transparent 75%)",
            }}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: past("glow") ? 1 : 0.35, scale: past("glow") ? 1.1 : 0.9 }}
            transition={{ duration: 0.9, ease: EASE_OUT }}
          />
          <div className="absolute inset-0 grid place-items-center">
            <motion.div
              className="relative will-change-transform"
              style={{ transformOrigin: VISOR_ORIGIN }}
              initial={{ scale: 0.82, y: 40, opacity: 0 }}
              animate={
                past("dolly")
                  ? { scale: 7, y: 0, opacity: 1 }
                  : past("headset")
                    ? { scale: 1, y: [0, 8, 0], opacity: 1 }
                    : { scale: 1, y: 0, opacity: 1 }
              }
              transition={
                past("dolly")
                  ? { duration: 0.75, ease: [0.64, 0, 0.78, 0] }
                  : { duration: 0.6, ease: past("headset") ? "easeInOut" : EASE_OUT }
              }
            >
              <Mox pose="visor" size={visorSize} float={false} shadow={false} priority alt="" />
              {/* The visor lighting up: a light sweep, then a steady glow. */}
              <motion.span
                aria-hidden
                className="pointer-events-none absolute overflow-hidden rounded-[42%] mix-blend-screen"
                style={{ left: "27%", top: "29%", width: "52%", height: "33%" }}
                initial={{ opacity: 0 }}
                animate={{ opacity: past("glow") ? 1 : 0 }}
                transition={{ duration: 0.3 }}
              >
                <motion.span
                  className="absolute inset-y-0 block w-[60%]"
                  style={{
                    background:
                      "linear-gradient(100deg, transparent, rgba(240,255,170,0.95) 45%, rgba(46,230,107,0.6) 65%, transparent)",
                  }}
                  initial={{ x: "-110%" }}
                  animate={past("glow") ? { x: ["-110%", "190%"] } : { x: "-110%" }}
                  transition={{ duration: 0.7, ease: "easeInOut" }}
                />
                <motion.span
                  className="absolute inset-0 block"
                  style={{
                    background:
                      "radial-gradient(closest-side, rgba(200,255,120,0.8), rgba(46,230,107,0.35) 60%, transparent)",
                  }}
                  initial={{ opacity: 0 }}
                  animate={past("glow") ? { opacity: [0, 0.4, 0.75, 0.55, 0.9] } : { opacity: 0 }}
                  transition={{ duration: 0.9, ease: "easeInOut", delay: 0.2 }}
                />
              </motion.span>
              {/* A ring of light leaves the visor just before the fly-in. */}
              <motion.span
                aria-hidden
                className="pointer-events-none absolute rounded-[50%] border-[3px] border-[#C6F24E]"
                style={{
                  left: "27%",
                  top: "29%",
                  width: "52%",
                  height: "33%",
                  boxShadow: "0 0 24px rgba(46,230,107,0.8), inset 0 0 18px rgba(46,230,107,0.6)",
                }}
                initial={{ opacity: 0, scale: 1 }}
                animate={past("glow") ? { opacity: [0, 0.9, 0], scale: [1, 1.9] } : { opacity: 0 }}
                transition={{ duration: 0.9, ease: EASE_OUT, delay: 0.35 }}
              />
            </motion.div>
          </div>
          {past("tunnel") && (
            <motion.div
              className="absolute inset-0"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.32, ease: EASE_OUT }}
              style={{
                background:
                  "radial-gradient(circle at 50% 50%, #c6f24e 0%, #2ee66b 18%, #0f7a52 48%, #062a20 100%)",
              }}
            >
              <Tunnel />
            </motion.div>
          )}
          <motion.div
            aria-hidden
            className="absolute inset-0"
            style={{ background: "radial-gradient(circle, #ffffff 40%, #f4ffe0)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: past("flash") ? 1 : 0 }}
            transition={{ duration: 0.2, ease: "easeIn" }}
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
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.05 }}
          onAnimationComplete={() => setOn(false)}
        />
      )}
    </AnimatePresence>
  );
}
