"use client";

/**
 * The Mellox sky: the public site's hero backdrop, for dark panels inside the
 * app (the sign-in showcase, the foot of the workspace list).
 *
 * A near-black sky with a lime aurora rising from the bottom, purple / blue /
 * orange at the edges, fine rays and a few stars. It fills its parent, which
 * must be positioned, clip its overflow and sit on `AURORA.sky`.
 *
 * It is laid out once, from fixed numbers, so the server and the browser draw
 * the same sky. Only transform and opacity move; blurs are still.
 */

import { motion } from "framer-motion";

/** The public site's palette. Dark in both app themes. */
export const AURORA = {
  sky: "#030405",
  lime: "#cbe960",
  /** Text and icons that sit on lime. */
  onLime: "#11170a",
  purple: "#b489d1",
  blue: "#0756e7",
  orange: "#fe7032",
} as const;

const { lime: LIME, purple: PURPLE, blue: BLUE, orange: ORANGE } = AURORA;

const r2 = (n: number) => Math.round(n * 100) / 100;
/** A fixed 0–1 number per (i, salt): the classic integer hash, so every engine agrees. */
const noise = (i: number, salt: number) => {
  let h = Math.imul(i + 1, 374761393) ^ Math.imul(salt + 1, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Orange at the far left, blue at the far right, purple between: as on the site's hero. */
const tipColor = (t: number) => (t < 0.2 ? ORANGE : t > 0.8 ? BLUE : PURPLE);

const STREAKS = Array.from({ length: 22 }, (_, i) => {
  const t = (i + noise(i, 1)) / 22;
  const wave = 0.5 + 0.28 * Math.sin(t * 9 + 0.8) + 0.16 * Math.sin(t * 21 + 2.1);
  return {
    left: r2(t * 100),
    width: r2(6 + noise(i, 2) * 16),
    height: r2((30 + 44 * wave) * (0.78 + 0.22 * noise(i, 3))),
    blur: r2(5 + noise(i, 4) * 9),
    opacity: r2((0.28 + 0.5 * wave) * (0.55 + 0.45 * noise(i, 5))),
    tip: tipColor(t),
    seconds: r2(6 + noise(i, 6) * 8),
    sway: r2((noise(i, 7) - 0.5) * 22),
  };
});

const STARS = Array.from({ length: 46 }, (_, i) => ({
  x: r2(noise(i, 11) * 100),
  y: r2(noise(i, 12) * 62),
  size: r2(1 + noise(i, 13) * 1.4),
  opacity: r2(0.25 + noise(i, 14) * 0.6),
  twinkle: i % 3 === 0,
  seconds: r2(2 + noise(i, 15) * 4),
}));

const CURTAINS = [
  { left: -6, width: 44, height: 62, seconds: 17 },
  { left: 28, width: 40, height: 70, seconds: 21 },
  { left: 60, width: 46, height: 58, seconds: 19 },
];

const TINTS = [
  {
    background: `radial-gradient(75% 55% at 50% 100%, ${LIME}4d, transparent 70%), radial-gradient(45% 40% at 18% 96%, ${LIME}33, transparent 70%), radial-gradient(45% 40% at 82% 96%, ${LIME}33, transparent 70%)`,
    from: 0.65,
    seconds: 12,
  },
  {
    background: `radial-gradient(55% 40% at 38% 66%, ${PURPLE}66, transparent 70%)`,
    from: 0.1,
    seconds: 14,
  },
  {
    background: `radial-gradient(50% 40% at 80% 70%, ${BLUE}73, transparent 70%)`,
    from: 0.1,
    seconds: 17,
  },
  {
    background: `radial-gradient(45% 36% at 12% 78%, ${ORANGE}61, transparent 70%)`,
    from: 0.1,
    seconds: 19,
  },
];

const loop = (seconds: number) => ({
  duration: seconds,
  repeat: Infinity,
  repeatType: "mirror" as const,
  ease: "easeInOut" as const,
});

export function MelloxAurora({ reduce }: { reduce: boolean }) {
  return (
    <>
      {/* slate sky */}
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(90% 50% at 50% 0%, rgba(57,68,74,0.28), transparent 75%)",
        }}
      />

      {STARS.map((s, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.size,
            height: s.size,
            background: s.opacity > 0.7 ? LIME : "#fff",
            opacity: s.opacity,
          }}
          {...(reduce || !s.twinkle
            ? {}
            : { animate: { opacity: [0.15, s.opacity] }, transition: loop(s.seconds) })}
        />
      ))}

      {/* colour layers that cross-fade, so the sky keeps shifting hue */}
      {TINTS.map((tint, i) => (
        <motion.div
          key={i}
          className="absolute inset-0 mix-blend-screen"
          style={{ background: tint.background }}
          {...(reduce
            ? {}
            : { animate: { opacity: [tint.from, 1] }, transition: loop(tint.seconds) })}
        />
      ))}

      {/* big soft curtains */}
      {CURTAINS.map((c, i) => (
        <motion.span
          key={i}
          className="absolute bottom-0 origin-bottom mix-blend-screen"
          style={{
            left: `${c.left}%`,
            width: `${c.width}%`,
            height: `${c.height}%`,
            borderRadius: "50% 50% 0 0 / 30% 30% 0 0",
            background: `linear-gradient(to top, ${LIME}66 0%, ${LIME}33 40%, ${PURPLE}1f 75%, transparent 100%)`,
            filter: "blur(46px)",
          }}
          {...(reduce
            ? {}
            : {
                animate: { x: ["-4%", "5%"], skewX: [-7, 8], scaleY: [0.92, 1.06] },
                transition: loop(c.seconds),
              })}
        />
      ))}

      {/* fine rays */}
      <div className="absolute inset-x-0 bottom-0 h-[92%] mix-blend-screen">
        {STREAKS.map((s, i) => (
          <motion.span
            key={i}
            className="absolute bottom-0 origin-bottom"
            style={{
              left: `${s.left}%`,
              width: s.width,
              height: `${s.height}%`,
              borderRadius: "999px 999px 0 0",
              background: `linear-gradient(to top, #e4f4a8 0%, ${LIME} 26%, color-mix(in srgb, ${LIME} 48%, ${s.tip}) 58%, color-mix(in srgb, ${s.tip} 42%, transparent) 80%, transparent 100%)`,
              filter: `blur(${s.blur}px)`,
              opacity: s.opacity,
            }}
            {...(reduce
              ? {}
              : {
                  animate: {
                    x: [-s.sway, s.sway],
                    scaleY: [0.88, 1.06],
                    opacity: [s.opacity * 0.5, s.opacity],
                  },
                  transition: loop(s.seconds),
                })}
          />
        ))}
      </div>

      {/* floor glow where the light pools */}
      <motion.div
        className="absolute inset-x-0 bottom-0 h-[38%] origin-bottom mix-blend-screen"
        style={{
          background: `radial-gradient(50% 70% at 50% 100%, rgba(255,255,255,0.26), ${LIME}33 40%, transparent 75%), radial-gradient(40% 60% at 12% 100%, ${ORANGE}4d, transparent 75%), radial-gradient(40% 60% at 88% 100%, ${BLUE}59, transparent 75%)`,
          filter: "blur(16px)",
        }}
        {...(reduce
          ? {}
          : { animate: { opacity: [0.7, 1], scaleY: [0.92, 1.08] }, transition: loop(8) })}
      />

      {/* shading: darkens the sky and the edges so what sits on top stays readable */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(125% 85% at 50% 48%, transparent 38%, rgba(1,2,3,0.85) 100%), linear-gradient(180deg, rgba(2,3,4,0.6) 0%, rgba(2,3,4,0.34) 42%, rgba(2,3,4,0.08) 78%, transparent 100%)",
        }}
      />
    </>
  );
}
