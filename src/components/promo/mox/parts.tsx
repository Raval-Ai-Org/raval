import type { CSSProperties, ReactNode } from "react";
import { clamp01, easeOutBack, lerp, move, progress } from "@/lib/promo/timeline";
import { mediaFrame, type MoxMediaName } from "@/lib/promo/mox-timeline";

/**
 * Shared pieces of the "Meet Mox" film. Like the first film's parts, every
 * piece is drawn from the time it is given: no timers and no CSS animation,
 * so one time always draws one picture.
 */

/** The Mox palette (mirrors `--mox-*` in styles.css so a theme never changes a frame). */
export const M = {
  ink: "#16191b",
  mute: "#646a70",
  soft: "#b3b8bc",
  line: "#e6e8ea",
  wash: "#f4f5f6",
  white: "#ffffff",
  lime: "#c6f24e",
  green: "#2ee66b",
  teal: "#0e7f6e",
  cyan: "#19d6e6",
  blue: "#1e7bf5",
  yellow: "#f2f23a",
  gradient: "linear-gradient(100deg, #d9f53a 0%, #9cf03f 28%, #3fe46e 58%, #1fd6c4 100%)",
  backdrop:
    "radial-gradient(60% 70% at 0% 100%, #f2f23a 0%, rgba(242,242,58,0) 60%), radial-gradient(55% 65% at 100% 0%, #1e7bf5 0%, rgba(30,123,245,0) 62%), linear-gradient(125deg, #e8f53c 0%, #7fee3c 24%, #2bea4e 42%, #19d6e6 72%, #1e7bf5 100%)",
  /** A soft blob of the same colours that fades to nothing at its edge. */
  blob: "radial-gradient(46% 52% at 26% 62%, #eef53c 0%, rgba(238,245,60,0) 72%), radial-gradient(46% 52% at 76% 36%, #1e7bf5 0%, rgba(30,123,245,0) 72%), radial-gradient(40% 46% at 70% 70%, #19d6e6 0%, rgba(25,214,230,0) 74%), radial-gradient(44% 50% at 48% 48%, #2bea4e 0%, rgba(43,234,78,0.9) 38%, rgba(43,234,78,0) 76%)",
  shadow: "0 40px 90px -36px rgba(16,24,20,0.30), 0 4px 14px rgba(16,24,20,0.06)",
  shadowSoft: "0 18px 40px -20px rgba(16,24,20,0.24), 0 2px 6px rgba(16,24,20,0.05)",
} as const;

export const W = 1920;
export const H = 1080;

export type SceneProps = { lt: number; len: number };

/** Fills the stage and centres what is inside. */
export function Center({ style, children }: { style?: CSSProperties; children?: ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Something that rises in softly at `at` (and can leave at `out`). */
export function Rise({
  lt,
  at,
  out,
  dur = 0.5,
  y = 40,
  pop = false,
  style,
  children,
}: {
  lt: number;
  at: number;
  out?: number;
  dur?: number;
  y?: number;
  /** Overshoot a little, for chips and tiles. */
  pop?: boolean;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const enter = move(lt, at, dur);
  const leave = out === undefined ? 0 : progress(lt, out, 0.3);
  const scale = pop ? lerp(0.6, 1, easeOutBack(progress(lt, at, dur))) : 1;
  const blur = (1 - enter) * 12 + leave * 10;
  return (
    <div
      style={{
        opacity: enter * (1 - leave),
        transform: `translateY(${((1 - enter) * y - leave * y * 0.5).toFixed(2)}px) scale(${scale.toFixed(4)})`,
        filter: blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Words filled with the Mox gradient. */
export function GradientText({
  children,
  style,
  fill = M.backdrop,
}: {
  children: ReactNode;
  style?: CSSProperties;
  fill?: string;
}) {
  return (
    <span
      style={{
        backgroundImage: fill,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
        WebkitTextFillColor: "transparent",
        display: "inline-block",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/**
 * The Mox gradient as a soft blob seen through vertical glass bars (each bar
 * shows the blob shifted and stretched a little), the film's signature backdrop.
 */
export function GlassBars({
  lt,
  cx = W / 2,
  cy = H / 2,
  w,
  h,
  bars = 9,
  spread = 1,
  opacity = 1,
}: {
  lt: number;
  cx?: number;
  cy?: number;
  w: number;
  h: number;
  bars?: number;
  /** 0 = one smooth blob, 1 = fully broken into bars. */
  spread?: number;
  opacity?: number;
}) {
  if (opacity <= 0.001 || w <= 1 || h <= 1) return null;
  const barW = w / bars;
  const tall = h * 1.7;
  return (
    <div
      style={{
        position: "absolute",
        left: cx - w / 2,
        top: cy - tall / 2,
        width: w,
        height: tall,
        opacity,
      }}
    >
      {Array.from({ length: bars }, (_, i) => {
        const shift = Math.sin(i * 1.7 + lt * 0.7) * h * 0.16 * spread;
        const stretch = 1 + Math.cos(i * 2.3 + lt * 0.45) * 0.3 * spread;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: i * barW,
              top: 0,
              width: barW + 0.5,
              height: tall,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: -i * barW,
                top: (tall - h) / 2 + shift,
                width: w,
                height: h,
                backgroundImage: M.blob,
                transform: `scaleY(${stretch.toFixed(4)})`,
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                backgroundImage:
                  "linear-gradient(90deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 22%, rgba(255,255,255,0) 82%, rgba(255,255,255,0.3) 100%)",
                opacity: spread * 0.8,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

/** Typed text with a caret. */
export function Typed({
  text,
  p,
  caret = true,
  color = M.ink,
}: {
  text: string;
  p: number;
  caret?: boolean;
  color?: string;
}) {
  const shown = text.slice(0, Math.round(text.length * clamp01(p)));
  return (
    <span style={{ whiteSpace: "pre" }}>
      {shown}
      {caret ? (
        <span
          style={{
            display: "inline-block",
            width: "0.06em",
            height: "0.95em",
            marginLeft: "0.05em",
            verticalAlign: "-0.1em",
            background: color,
            opacity: p >= 1 ? 0 : 1,
          }}
        />
      ) : null}
    </span>
  );
}

/** A headline whose words arrive one after another. */
export function Line({
  lt,
  at,
  text,
  size,
  gap = 0.11,
  weight = 600,
  color = M.ink,
  out,
  style,
}: {
  lt: number;
  at: number;
  text: string;
  size: number;
  gap?: number;
  weight?: number;
  color?: string;
  out?: number;
  style?: CSSProperties;
}) {
  const leave = out === undefined ? 0 : progress(lt, out, 0.3);
  return (
    <div
      style={{
        fontSize: size,
        fontWeight: weight,
        letterSpacing: "-0.03em",
        lineHeight: 1.08,
        color,
        whiteSpace: "nowrap",
        opacity: 1 - leave,
        filter: leave > 0.01 ? `blur(${(leave * 10).toFixed(2)}px)` : undefined,
        ...style,
      }}
    >
      {text.split(" ").map((word, index, all) => {
        const arrive = move(lt, at + index * gap, 0.4);
        const blur = (1 - arrive) * 10;
        return (
          <span
            key={`${word}-${index}`}
            style={{
              display: "inline-block",
              whiteSpace: "pre",
              opacity: arrive,
              transform: `translateY(${((1 - arrive) * size * 0.3).toFixed(2)}px)`,
              filter: blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : undefined,
            }}
          >
            {word + (index < all.length - 1 ? " " : "")}
          </span>
        );
      })}
    </div>
  );
}

/** A rounded picture. Never drawn larger than its source (callers size it). */
export function Pic({
  src,
  w,
  h,
  radius = 28,
  fit = "cover",
  style,
}: {
  src: string;
  w: number;
  h: number;
  radius?: number;
  fit?: "cover" | "contain";
  style?: CSSProperties;
}) {
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      style={{
        width: w,
        height: h,
        objectFit: fit,
        borderRadius: radius,
        display: "block",
        boxShadow: M.shadowSoft,
        background: M.wash,
        ...style,
      }}
    />
  );
}

/** Footage drawn as the still for `seconds`; `still` shows until footage exists. */
export function Seq({
  name,
  seconds,
  loop,
  still,
  w,
  h,
  radius = 0,
  style,
}: {
  name: MoxMediaName;
  seconds: number;
  loop?: boolean;
  still: string;
  w: number;
  h: number;
  radius?: number;
  style?: CSSProperties;
}) {
  const src = mediaFrame(name, seconds, { loop }) ?? still;
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      style={{
        width: w,
        height: h,
        objectFit: "cover",
        borderRadius: radius,
        display: "block",
        background: M.wash,
        ...style,
      }}
    />
  );
}

/**
 * The left-hand word list as a wheel: the list scrolls so the word being said
 * sits on the centre line, dark, a touch bigger, with a gradient dot; the
 * others fade away above and below.
 */
export function WordList({
  items,
  active,
  position,
  pulse = 1,
  size = 96,
  x,
  lt,
  at,
}: {
  items: string[];
  /** Index of the dark word. */
  active: number;
  /** Where the wheel is, in rows (moves smoothly from one word to the next). */
  position: number;
  /** 0 to 1 as the dark word lands (it pops a little). */
  pulse?: number;
  size?: number;
  x: number;
  lt: number;
  at: number;
}) {
  const row = size * 1.42;
  const fade = "linear-gradient(180deg, transparent 6%, #000 30%, #000 70%, transparent 94%)";
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: 0,
        width: 860,
        height: H,
        overflow: "hidden",
        WebkitMaskImage: fade,
        maskImage: fade,
      }}
    >
      {items.map((item, index) => {
        const on = index === active;
        const away = Math.abs(index - position);
        const enter = move(lt, at + index * 0.07, 0.45);
        const scale = on ? lerp(0.86, 1.14, pulse) : 0.86;
        return (
          <div
            key={item}
            style={{
              position: "absolute",
              left: 0,
              top: H / 2 - row / 2 + (index - position) * row,
              height: row,
              display: "flex",
              alignItems: "center",
              fontSize: size,
              fontWeight: 600,
              letterSpacing: "-0.035em",
              color: on ? M.ink : M.soft,
              opacity: enter * clamp01(1.25 - away * 0.36),
              transform: `translateX(${((1 - enter) * -40).toFixed(2)}px) scale(${scale.toFixed(4)})`,
              transformOrigin: "0% 50%",
            }}
          >
            <span
              style={{
                width: size * 0.3,
                height: size * 0.3,
                marginRight: size * 0.24,
                borderRadius: "50%",
                backgroundImage: M.backdrop,
                opacity: on ? clamp01(pulse) : 0,
                transform: `scale(${(on ? pulse : 0).toFixed(3)})`,
                flexShrink: 0,
              }}
            />
            {item}
          </div>
        );
      })}
    </div>
  );
}

/** A white card sitting on a gradient glow. */
export function GlowCard({
  cx,
  cy,
  w,
  h,
  lt,
  radius = 44,
  children,
}: {
  cx: number;
  cy: number;
  w: number;
  h: number;
  lt: number;
  radius?: number;
  children?: ReactNode;
}) {
  return (
    <>
      <GlassBars lt={lt} cx={cx} cy={cy} w={w * 1.55} h={h * 1.25} bars={7} spread={0.5} />
      <div
        style={{
          position: "absolute",
          left: cx - w / 2,
          top: cy - h / 2,
          width: w,
          height: h,
          borderRadius: radius,
          background: M.white,
          boxShadow: M.shadow,
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </>
  );
}

/** A small pill. */
export function Pill({
  children,
  size = 30,
  tone = "white",
  style,
}: {
  children: ReactNode;
  size?: number;
  tone?: "white" | "ink" | "mox";
  style?: CSSProperties;
}) {
  const tones = {
    white: { background: M.white, color: M.ink, border: `1.5px solid ${M.line}` },
    ink: { background: M.ink, color: M.white, border: `1.5px solid ${M.ink}` },
    mox: { backgroundImage: M.gradient, color: M.ink, border: "1.5px solid rgba(22,25,27,0.06)" },
  }[tone];
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size * 0.4,
        padding: `${size * 0.42}px ${size * 0.8}px`,
        borderRadius: 999,
        fontSize: size,
        fontWeight: 600,
        lineHeight: 1,
        whiteSpace: "nowrap",
        boxShadow: M.shadowSoft,
        ...tones,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

const ICONS = {
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  arrow: ["M5 12h14", "M13 6l6 6-6 6"],
  heart: ["M12 20s-7-4.4-7-9.6A4.1 4.1 0 0112 7.6a4.1 4.1 0 017 2.8C19 15.6 12 20 12 20z"],
  send: ["M21 3L10 14", "M21 3l-7 18-4-7-7-4 18-7z"],
  play: ["M8 5v14l11-7L8 5z"],
  eye: ["M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z", "M12 15a3 3 0 100-6 3 3 0 000 6z"],
  up: ["M12 19V5", "M6 11l6-6 6 6"],
} as const;

export function Icon({
  name,
  size = 24,
  color = "currentColor",
  stroke = 2.2,
  fill = "none",
}: {
  name: keyof typeof ICONS;
  size?: number;
  color?: string;
  stroke?: number;
  fill?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={fill}
      stroke={color}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block", flexShrink: 0 }}
      aria-hidden="true"
    >
      {ICONS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export const MOX_MARK_SRC = "/assets/Light-Logo-Green.svg";
const MARK_RATIO = 360 / 195;

/** The Mellox lockup: the mark and the word. */
export function MoxLockup({ size, style }: { size: number; style?: CSSProperties }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: size * 0.3, ...style }}>
      <img
        src={MOX_MARK_SRC}
        alt=""
        draggable={false}
        style={{ width: size * 1.5, height: (size * 1.5) / MARK_RATIO, display: "block" }}
      />
      <span
        style={{
          fontFamily: "var(--font-brand)",
          fontSize: size * 0.74,
          fontWeight: 600,
          lineHeight: 1,
          color: M.ink,
          whiteSpace: "nowrap",
        }}
      >
        Mellox
      </span>
    </div>
  );
}

/** Thousands with thin spaces, the way the big counter reads. */
export function spaced(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
