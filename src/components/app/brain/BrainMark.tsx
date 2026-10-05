"use client";
// BrainMark — the four brains' marks (the Mellox Micro 5 glyphs: asterisk, at,
// percent, hash) drawn as grids of cells, so each cell can move: they arrive
// one by one, and ripple softly while a brain has something new.
// Reduced motion draws them still.
import { motion } from "framer-motion";
import { BRAINS, BRAIN_META, type BrainId } from "@/lib/brain/brain";
import { useReducedMotionSafe } from "@/hooks/use-reduced-motion-safe";
import { cn } from "@/lib/utils";

type Glyph = { cols: number; rows: number; cells: Array<[number, number]> };

const rowsToCells = (rows: number[][]): Array<[number, number]> =>
  rows.flatMap((cols, y) => cols.map((x) => [x, y] as [number, number]));

/** Cell maps traced from the brand kit SVGs (Mellox Ai Brand kit/Micro 5 svg). */
const GLYPHS: Record<BrainId, Glyph> = {
  // Asterisk
  brand: { cols: 3, rows: 3, cells: rowsToCells([[0, 2], [1], [0, 2]]) },
  // At
  audience: {
    cols: 6,
    rows: 7,
    cells: rowsToCells([
      [0, 1, 2, 3, 4, 5],
      [0, 5],
      [0, 2, 3, 4],
      [0, 2, 4],
      [0, 2, 3, 4, 5],
      [0],
      [0, 1, 2, 3],
    ]),
  },
  // Percent
  competitors: {
    cols: 5,
    rows: 5,
    cells: rowsToCells([[0, 4], [3], [2], [1], [0, 4]]),
  },
  // Hash
  market: {
    cols: 5,
    rows: 5,
    cells: rowsToCells([
      [2, 4],
      [0, 1, 2, 3, 4],
      [1, 3],
      [0, 1, 2, 3, 4],
      [0, 2],
    ]),
  },
};

export function BrainMark({
  brain,
  size = 24,
  active = false,
  muted = false,
  delay = 0,
  className,
  color,
}: {
  brain: BrainId;
  size?: number;
  /** Something new here: the cells ripple. */
  active?: boolean;
  /** Nothing in this brain yet: drawn faint. */
  muted?: boolean;
  /** Seconds before the cells start arriving. */
  delay?: number;
  className?: string;
  /** Override the brain's own colour (e.g. `currentColor`). */
  color?: string;
}) {
  const reduce = useReducedMotionSafe();
  const g = GLYPHS[brain];
  const side = Math.max(g.cols, g.rows);
  const ox = (side - g.cols) / 2;
  const oy = (side - g.rows) / 2;
  const fill = color ?? BRAIN_META[brain].color;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${side} ${side}`}
      aria-hidden
      className={cn("shrink-0 transition-opacity duration-300", muted && "opacity-35", className)}
      shapeRendering="crispEdges"
    >
      {g.cells.map(([x, y], i) => {
        const cx = ox + x + 0.5;
        const cy = oy + y + 0.5;
        if (reduce) {
          return <rect key={i} x={ox + x} y={oy + y} width={1.02} height={1.02} fill={fill} />;
        }
        return (
          <motion.rect
            key={i}
            x={ox + x}
            y={oy + y}
            width={1.02}
            height={1.02}
            fill={fill}
            style={{ transformOrigin: `${cx}px ${cy}px`, transformBox: "view-box" as never }}
            initial={{ opacity: 0, scale: 0 }}
            animate={
              active ? { opacity: [1, 0.45, 1], scale: [1, 0.72, 1] } : { opacity: 1, scale: 1 }
            }
            transition={
              active
                ? {
                    duration: 1.6,
                    repeat: Infinity,
                    repeatDelay: 1.2,
                    delay: delay + (x + y) * 0.07,
                    ease: "easeInOut",
                  }
                : { duration: 0.32, delay: delay + (x + y) * 0.035, ease: [0.16, 1, 0.3, 1] }
            }
          />
        );
      })}
    </svg>
  );
}

/**
 * The Brain itself: the four marks in a 2×2. Used as the section's icon in the
 * sidebar, the window header and the Coach pill. `news` lights up the marks
 * that have something new.
 */
export function BrainIcon({
  className,
  size,
  news,
}: {
  className?: string;
  size?: number;
  /** strokeWidth is accepted (and ignored) so this fits anywhere an icon does. */
  strokeWidth?: number;
  news?: Partial<Record<BrainId, number>>;
}) {
  const px = size ?? 18;
  const cell = Math.floor((px - 2) / 2);
  return (
    <span
      aria-hidden
      className={cn("inline-grid shrink-0 grid-cols-2 place-items-center gap-[2px]", className)}
      style={size ? { width: px, height: px } : undefined}
    >
      {BRAINS.map((brain, i) => (
        <BrainMark
          key={brain}
          brain={brain}
          size={size ? cell : 8}
          delay={i * 0.06}
          active={!!news?.[brain]}
        />
      ))}
    </span>
  );
}
