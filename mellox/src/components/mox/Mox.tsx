import type { CSSProperties } from "react";
import type { MoxPose } from "@/lib/platform";
import "./mox.css";

// Natural sizes of the cut-outs in /public/mox/cut (so the browser can reserve space before they load).
const SIZE: Record<MoxPose, [number, number]> = {
  wave: [560, 850],
  stand: [452, 732],
  face: [420, 468],
  visor: [520, 503],
  shop: [168, 215],
  chat: [214, 205],
  search: [139, 218],
  calendar: [168, 166],
  relax: [168, 198],
  jump: [149, 206],
  thumbs: [136, 213],
  think: [123, 211],
  suit: [139, 211],
  coffee: [146, 210],
  write: [150, 209],
};

const ALT: Record<MoxPose, string> = {
  wave: "Mox waving hello",
  stand: "Mox standing",
  face: "Mox smiling",
  visor: "Mox wearing a visor",
  shop: "Mox carrying shopping bags",
  chat: "Mox chatting",
  search: "Mox looking through a magnifying glass",
  calendar: "Mox with a calendar",
  relax: "Mox relaxing on a beanbag",
  jump: "Mox jumping for joy",
  thumbs: "Mox giving a thumbs up",
  think: "Mox thinking",
  suit: "Mox in a suit with a briefcase",
  coffee: "Mox with a coffee",
  write: "Mox writing in a notebook",
};

/**
 * Mox, the Mellox 3D character, as a transparent cut-out. Height is set by `height` (px); width follows.
 * `float` makes it bob gently (off for reduced motion and touch-first devices, see mox.css).
 */
export default function Mox({
  pose,
  height = 200,
  float = false,
  decorative = false,
  className = "",
  style,
}: {
  pose: MoxPose;
  height?: number;
  float?: boolean;
  /** true when the nearby text already says what Mox is doing */
  decorative?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const [w, h] = SIZE[pose];
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/mox/cut/${pose}.webp`}
      alt={decorative ? "" : ALT[pose]}
      aria-hidden={decorative || undefined}
      width={w}
      height={h}
      loading="lazy"
      decoding="async"
      draggable={false}
      className={`mox${float ? " mox-float" : ""} ${className}`.trim()}
      style={{ height, width: "auto", ...style }}
    />
  );
}
