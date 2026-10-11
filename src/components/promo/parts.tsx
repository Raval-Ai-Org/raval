import type { CSSProperties, ReactNode } from "react";
import { clamp01, easeOutBack, lerp, move, progress } from "@/lib/promo/timeline";

/**
 * Shared pieces of the product film. Every piece is drawn from the time it is
 * given: no timers, no CSS animation, so one time always draws one picture.
 */

/** The film's own light palette, so the app theme never changes a frame. */
export const C = {
  bg: "#FAFAF8",
  ink: "#0B0C0E",
  mute: "#5C6068",
  soft: "#A3A6AD",
  line: "#E7E8EB",
  wash: "#F2F3F1",
  card: "#FFFFFF",
  lime: "#D4E85C",
  moss: "#2F6600",
  mossWash: "#EDF5D8",
  amber: "#B45309",
  amberWash: "#FDF1DC",
  shadow: "0 30px 70px -28px rgba(15,20,30,0.22), 0 2px 8px rgba(15,20,30,0.05)",
  shadowSoft: "0 14px 34px -18px rgba(15,20,30,0.18), 0 1px 3px rgba(15,20,30,0.05)",
} as const;

export const MARK_SRC = "/assets/Dark-Logo.svg";
/** Width over height of the mark's artwork. */
const MARK_RATIO = 360 / 195;

export function Mark({ width, style }: { width: number; style?: CSSProperties }) {
  return (
    <img
      src={MARK_SRC}
      alt=""
      draggable={false}
      style={{ width, height: width / MARK_RATIO, display: "block", ...style }}
    />
  );
}

export function Lockup({ size, style }: { size: number; style?: CSSProperties }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: size * 0.34, ...style }}>
      <Mark width={size * 1.5} />
      <span
        style={{
          fontFamily: "var(--font-brand)",
          fontSize: size * 0.72,
          lineHeight: 1,
          color: C.ink,
          whiteSpace: "nowrap",
        }}
      >
        Mellox<span style={{ marginLeft: "0.28em", color: C.moss }}>AI</span>
      </span>
    </div>
  );
}

/** A scene's envelope: it clears in at the start and softens out at the end. */
export function SceneFrame({
  lt,
  len,
  hold = false,
  children,
}: {
  lt: number;
  len: number;
  /** The last scene stays on screen instead of fading out. */
  hold?: boolean;
  children: ReactNode;
}) {
  const enter = move(lt, 0, 0.4);
  const leave = hold ? 0 : progress(lt, len - 0.3, 0.3);
  const blur = (1 - enter) * 16 + leave * 14;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        opacity: enter * (1 - leave),
        filter: blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : undefined,
        transform: `scale(${(lerp(1.03, 1, enter) + leave * 0.03).toFixed(4)})`,
      }}
    >
      {children}
    </div>
  );
}

export type Word = { text: string; at: number };

/** A headline that arrives a word at a time: grey first, then ink. */
export function Words({
  lt,
  words,
  size,
  style,
  weight = 600,
}: {
  lt: number;
  words: Word[];
  size: number;
  weight?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        fontSize: size,
        fontWeight: weight,
        letterSpacing: "-0.028em",
        lineHeight: 1.12,
        color: C.ink,
        ...style,
      }}
    >
      {words.map((word, index) => {
        const arrive = move(lt, word.at, 0.38);
        const settle = progress(lt, word.at + 0.22, 0.3);
        const blur = (1 - arrive) * 10;
        return (
          <span
            key={`${word.text}-${index}`}
            style={{
              display: "inline-block",
              whiteSpace: "pre",
              opacity: arrive,
              transform: `translateY(${((1 - arrive) * size * 0.28).toFixed(2)}px)`,
              filter: blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : undefined,
              color: mixInk(settle),
            }}
          >
            {word.text + (index < words.length - 1 ? " " : "")}
          </span>
        );
      })}
    </div>
  );
}

/** Grey to ink. */
function mixInk(p: number): string {
  const x = clamp01(p);
  const channel = (from: number, to: number) => Math.round(lerp(from, to, x));
  return `rgb(${channel(163, 11)}, ${channel(166, 12)}, ${channel(173, 14)})`;
}

/** Turn a sentence into words that arrive `gap` seconds apart from `start`. */
export function sentence(text: string, start: number, gap = 0.13): Word[] {
  return text.split(" ").map((word, index) => ({ text: word, at: start + index * gap }));
}

export function Card({ style, children }: { style?: CSSProperties; children?: ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        background: C.card,
        border: `1px solid ${C.line}`,
        borderRadius: 22,
        boxShadow: C.shadow,
        overflow: "hidden",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** The green "done" pill that pops in next to a title. */
export function Badge({
  lt,
  at,
  label,
  size = 30,
  style,
}: {
  lt: number;
  at: number;
  label: string;
  size?: number;
  style?: CSSProperties;
}) {
  const pop = easeOutBack(progress(lt, at, 0.45));
  const shown = progress(lt, at, 0.15);
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size * 0.36,
        padding: `${size * 0.36}px ${size * 0.7}px`,
        borderRadius: 999,
        background: C.mossWash,
        border: `1px solid #CFE3A6`,
        color: C.moss,
        fontSize: size,
        fontWeight: 600,
        lineHeight: 1,
        whiteSpace: "nowrap",
        opacity: shown,
        transform: `scale(${lerp(0.6, 1, pop).toFixed(4)})`,
        ...style,
      }}
    >
      {label}
      <Glyph name="check" size={size * 0.9} color={C.moss} stroke={2.6} />
    </div>
  );
}

/** A small status chip that is always shown (inside cards). */
export function Chip({
  label,
  tone = "moss",
  size = 18,
  style,
}: {
  label: string;
  tone?: "moss" | "plain" | "amber";
  size?: number;
  style?: CSSProperties;
}) {
  const tones = {
    moss: { background: C.mossWash, color: C.moss, border: "#CFE3A6" },
    plain: { background: C.wash, color: C.mute, border: C.line },
    amber: { background: C.amberWash, color: C.amber, border: "#F3DDB4" },
  }[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: `${size * 0.28}px ${size * 0.6}px`,
        borderRadius: 999,
        background: tones.background,
        color: tones.color,
        border: `1px solid ${tones.border}`,
        fontSize: size,
        fontWeight: 600,
        lineHeight: 1,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {label}
    </span>
  );
}

/** Placeholder lines of text, drawn in as `p` goes from 0 to 1. */
export function Lines({
  widths,
  p = 1,
  height = 12,
  gap = 12,
  color = C.line,
}: {
  widths: number[];
  p?: number;
  height?: number;
  gap?: number;
  color?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap }}>
      {widths.map((width, index) => {
        const drawn = clamp01(p * widths.length - index);
        return (
          <div
            key={index}
            style={{
              width: `${width * drawn}%`,
              height,
              borderRadius: height,
              background: color,
            }}
          />
        );
      })}
    </div>
  );
}

export type GlyphName =
  | "check"
  | "arrowRight"
  | "arrowUp"
  | "brand"
  | "audience"
  | "rivals"
  | "market"
  | "brain"
  | "studio"
  | "visibility"
  | "chat"
  | "autopilot"
  | "calendar"
  | "pr"
  | "link"
  | "spark";

const GLYPHS: Record<GlyphName, string[]> = {
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  arrowRight: ["M5 12h14", "M13 6l6 6-6 6"],
  arrowUp: ["M12 19V5", "M6 11l6-6 6 6"],
  brand: ["M12 3l2.6 5.6L20.5 9.5l-4.3 4.1 1 6-5.2-2.9-5.2 2.9 1-6L3.5 9.5l5.9-.9L12 3z"],
  audience: [
    "M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7z",
    "M2.5 20c.5-3.6 3.1-5.5 6.5-5.5s6 1.9 6.5 5.5",
    "M16 4.3a3.5 3.5 0 010 6.4",
    "M18 14.8c2 .7 3.2 2.4 3.5 5.2",
  ],
  rivals: ["M12 21a9 9 0 100-18 9 9 0 000 18z", "M12 16a4 4 0 100-8 4 4 0 000 8z", "M12 12h.01"],
  market: ["M3 17l5.5-5.5 4 4L21 7", "M15 7h6v6"],
  brain: [
    "M9.5 4a3 3 0 00-3 3 3 3 0 00-2 5.2A3 3 0 006 17.5 3 3 0 009.5 20a2.5 2.5 0 002.5-2.5V6.5A2.5 2.5 0 009.5 4z",
    "M14.5 4a3 3 0 013 3 3 3 0 012 5.2 3 3 0 01-1.5 5.3 3 3 0 01-3.5 2.5 2.5 2.5 0 01-2.5-2.5V6.5A2.5 2.5 0 0114.5 4z",
  ],
  studio: ["M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19l-4 1z", "M14 7l3 3"],
  visibility: [
    "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z",
    "M12 15a3 3 0 100-6 3 3 0 000 6z",
  ],
  chat: ["M4 5h16v11H9l-5 4V5z"],
  autopilot: ["M13 2L4 14h7l-1 8 9-12h-7l1-8z"],
  calendar: ["M4 6h16v14H4V6z", "M4 10h16", "M8 3v4", "M16 3v4"],
  pr: [
    "M6 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5z",
    "M6 20a2.5 2.5 0 100-5 2.5 2.5 0 000 5z",
    "M18 20a2.5 2.5 0 100-5 2.5 2.5 0 000 5z",
    "M6 9v6",
    "M11 6h4a3 3 0 013 3v6",
  ],
  link: [
    "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1",
    "M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1",
  ],
  spark: [
    "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z",
    "M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z",
  ],
};

/** Line drawings for the film. Simple on purpose: they are read at a glance. */
export function Glyph({
  name,
  size = 24,
  color = "currentColor",
  stroke = 1.9,
}: {
  name: GlyphName;
  size?: number;
  color?: string;
  stroke?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block", flexShrink: 0 }}
      aria-hidden="true"
    >
      {GLYPHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** A rounded tile holding one drawing. */
export function Tile({
  children,
  size,
  background = C.card,
  style,
}: {
  children: ReactNode;
  size: number;
  background?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background,
        border: `1px solid ${C.line}`,
        boxShadow: C.shadowSoft,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** The pointer that clicks the approve button. */
export function Pointer({ x, y, press }: { x: number; y: number; press: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={54}
      height={54}
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: `scale(${(1 - press * 0.14).toFixed(4)})`,
        transformOrigin: "20% 10%",
        filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.25))",
      }}
      aria-hidden="true"
    >
      <path
        d="M5 3l14 7.5-6 1.6 3.4 6.3-2.6 1.4-3.4-6.3L6 18 5 3z"
        fill={C.ink}
        stroke="#fff"
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Text with a typing caret, for inputs. */
export function Typing({ text, full, lt }: { text: string; full: boolean; lt: number }) {
  const caret = full ? Math.floor(lt * 2.4) % 2 === 0 : true;
  return (
    <span style={{ whiteSpace: "pre-wrap" }}>
      {text}
      <span
        style={{
          display: "inline-block",
          width: "0.06em",
          height: "1.05em",
          marginLeft: "0.06em",
          verticalAlign: "-0.16em",
          background: C.ink,
          opacity: caret ? 1 : 0,
        }}
      />
    </span>
  );
}
