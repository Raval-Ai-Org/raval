import { motion } from "framer-motion";
import { TILE_BY_ID } from "@/lib/studio";
import { TINT_HEX } from "@/components/app/StudioRail";
import {
  PHASE_ORDER,
  phaseIndex,
  type GenJob,
  type GenPhase,
} from "@/lib/generation-queue";

// Phase labels are 1:1 with real generation events fired by the producer.
// The row never advances past `job.phase` — it only animates within it.
const PHASE_LABELS: Record<GenPhase, string> = {
  "brand-dna": "Reading brand DNA",
  research: "Researching angle",
  drafting: "Drafting copy",
  polishing: "Polishing voice",
  ready: "Almost ready",
};

export function GenerationQueueRow({ job }: { job: GenJob }) {
  const tile = TILE_BY_ID[job.canvas];
  const color = TINT_HEX[tile.tint] ?? "#3b82f6";
  const idx = phaseIndex(job.phase);
  const total = PHASE_ORDER.length;
  const progress = ((idx + 1) / total) * 100;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.97, transition: { duration: 0.22 } }}
      transition={{ type: "spring", stiffness: 320, damping: 24 }}
    >
      <div
        className="group relative flex w-full items-stretch gap-3 overflow-hidden rounded-3xl border border-border/60 bg-card p-2.5 text-left"
        style={{ boxShadow: `0 2px 14px -6px ${color}33` }}
      >
        {/* Soft breathing aura behind the row */}
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-3xl"
          style={{ background: `radial-gradient(120% 80% at 0% 50%, ${color}1f, transparent 70%)` }}
          animate={{ opacity: [0.55, 0.95, 0.55] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
        />
        {/* NotebookLM-style traveling shimmer band */}
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-1/2"
          style={{
            background: `linear-gradient(110deg, transparent 0%, ${color}28 50%, transparent 100%)`,
            mixBlendMode: "screen",
          }}
          initial={{ x: "-120%" }}
          animate={{ x: "220%" }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Animated thumbnail — NotebookLM-style breathing orb + wave bars */}
        <div
          className="relative h-[60px] w-[60px] shrink-0 overflow-hidden rounded-2xl"
          style={{
            background: `linear-gradient(135deg, ${color}30, ${color}08)`,
            boxShadow: `inset 0 0 0 1px ${color}26`,
          }}
        >
          {/* Pulsing halo rings */}
          {[0, 0.6, 1.2].map((delay) => (
            <motion.span
              key={delay}
              aria-hidden
              className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ boxShadow: `0 0 0 1px ${color}55` }}
              initial={{ scale: 0.6, opacity: 0.6 }}
              animate={{ scale: 2.4, opacity: 0 }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut", delay }}
            />
          ))}
          {/* Center breathing orb */}
          <motion.span
            aria-hidden
            className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              background: `radial-gradient(circle, ${color}, ${color}66 60%, transparent 80%)`,
              boxShadow: `0 0 12px ${color}aa`,
            }}
            animate={{ scale: [1, 1.25, 1] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>

        {/* Content */}
        <div className="relative flex min-w-0 flex-1 flex-col justify-between py-0.5 pr-1">
          <div>
            <div className="flex items-center gap-1.5">
              <span
                className="grid h-4 w-4 place-items-center rounded-full"
                style={{ background: `${color}26` }}
              >
                <tile.icon className="h-2 w-2" strokeWidth={2.5} style={{ color }} />
              </span>
              <span className="truncate text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color }}>
                {tile.label}
              </span>
            </div>
            {/* Shimmering "title is being written" skeleton lines */}
            <div className="mt-1.5 space-y-1.5">
              <ShimmerBar width="92%" color={color} delay={0} />
              <ShimmerBar width="68%" color={color} delay={0.18} />
            </div>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            {/* Phase label crossfade */}
            <motion.span
              key={job.phase}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="flex items-center gap-1.5 truncate text-[10.5px] text-muted-foreground"
            >
              <DotTrail color={color} />
              {PHASE_LABELS[job.phase]}
            </motion.span>
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide"
              style={{
                color,
                background: `${color}18`,
                boxShadow: `inset 0 0 0 1px ${color}33`,
              }}
            >
              {Math.round(progress)}%
            </span>
          </div>
        </div>
      </div>
    </motion.li>
  );
}

function ShimmerBar({ width, color, delay }: { width: string; color: string; delay: number }) {
  return (
    <div
      className="relative h-1.5 overflow-hidden rounded-full"
      style={{ width, background: `${color}1a` }}
    >
      <motion.span
        aria-hidden
        className="absolute inset-y-0 w-1/2 rounded-full"
        style={{
          background: `linear-gradient(90deg, transparent, ${color}cc, transparent)`,
        }}
        initial={{ x: "-110%" }}
        animate={{ x: "220%" }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut", delay }}
      />
    </div>
  );
}

function DotTrail({ color }: { color: string }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1 w-1 rounded-full"
          style={{ background: color }}
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -1.5, 0] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut", delay: i * 0.16 }}
        />
      ))}
    </span>
  );
}