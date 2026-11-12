"use client";

// StoryboardView — the storyboard a person reads before a long, many-scene
// video is made (src/lib/studio/video/board.ts). Presentational: Studio's
// review and the Creator composer feed it, `/studio-lab?scene=storyboard` and
// `/layout-lab?scene=ugc-storyboard` render it with sample data.
//
// One screen, one action:
// - the stage shows the chosen scene big, with its words on it, and "Play
//   through" steps the scenes at their real length (an animatic);
// - the film strip covers every scene: three key frames are drawn, every other
//   scene shows the key frame it follows from;
// - the script lists every scene: time, camera, action, the exact words said
//   and shown, and the sound.
// Create is the only primary pill; nothing is spent on video until it is pressed.
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Music, Pause } from "lucide-react";
import {
  ArrowRight,
  Camera,
  Clock,
  Mic,
  Pencil,
  Play,
  Sparkles,
  Type,
  Video,
} from "@/components/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { duration, ease } from "@/lib/motion";
import { keyFrameFor, timecode, type Board, type BoardScene } from "@/lib/studio/video/board";

export type BoardFrame = { status: "pending" | "ready" | "failed"; url?: string };

export function StoryboardView({
  board,
  frames,
  ratio = "9 / 16",
  meta = [],
  createLabel,
  onCreate,
  onChange,
  changeLabel = "Change the plan",
  busy = false,
  disabled = false,
  note,
}: {
  board: Board;
  /** Drawn key frames by media slot (`main`, `board:1`…). */
  frames: Record<string, BoardFrame | undefined>;
  /** CSS aspect ratio of the video, e.g. "9 / 16". */
  ratio?: string;
  /** Short facts under the title: kind, model, platform. */
  meta?: string[];
  /** The Create button's words, with the video's price. */
  createLabel: string;
  onCreate: () => void;
  onChange?: () => void;
  changeLabel?: string;
  busy?: boolean;
  disabled?: boolean;
  /** One line beside the button, e.g. what Create will use. */
  note?: string;
}) {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  const total = Math.max(board.seconds, 1);
  const scene = board.scenes[active] ?? board.scenes[0];
  const keyFrames = board.scenes.filter((s) => s.frameSlot).length;
  const drawing = board.scenes.some(
    (s) => s.frameSlot && frames[s.frameSlot]?.status === "pending",
  );
  const shape = useMemo(() => {
    const [w, h] = ratio.split("/").map((n) => Number(n.trim()));
    return w > 0 && h > 0 ? w / h : 9 / 16;
  }, [ratio]);
  const wide = shape >= 1;

  // Play through: each scene for its own length (at least a second), then stop.
  useEffect(() => {
    if (!playing || !scene) return;
    const ms = Math.max(1, scene.end - scene.start) * 1000;
    const t = window.setTimeout(() => {
      if (active >= board.scenes.length - 1) setPlaying(false);
      else setActive(active + 1);
    }, ms);
    return () => window.clearTimeout(t);
  }, [playing, active, scene, board.scenes.length]);

  // While playing, keep the scene being shown in view in the script.
  useEffect(() => {
    if (!playing) return;
    rows.current[active]?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "nearest",
    });
  }, [active, playing, reduce]);

  if (!scene) return null;
  const pick = (index: number) => {
    setPlaying(false);
    setActive(index);
  };

  return (
    <section
      aria-label="Storyboard"
      data-slot="storyboard"
      className="ds-enter mx-auto flex w-full max-w-[1120px] flex-col gap-4"
    >
      <header className="flex flex-col gap-2">
        <span className="ds-label inline-flex items-center gap-1.5">
          <Video className="size-3.5" aria-hidden />
          Storyboard · read it before the video is made
        </span>
        {board.logline ? (
          <h2 className="text-balance text-[20px] font-semibold leading-tight text-foreground sm:text-[22px]">
            {board.logline}
          </h2>
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <MetaPill>
            <Clock className="size-3" aria-hidden />
            {timecode(board.seconds)}
          </MetaPill>
          <MetaPill>
            {board.scenes.length} scene{board.scenes.length === 1 ? "" : "s"}
          </MetaPill>
          <MetaPill>
            {keyFrames} key frame{keyFrames === 1 ? "" : "s"}
          </MetaPill>
          {meta.filter(Boolean).map((m) => (
            <MetaPill key={m}>{m}</MetaPill>
          ))}
        </div>
      </header>

      <div
        className={cn(
          "grid gap-4",
          wide
            ? "lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]"
            : "md:grid-cols-[minmax(0,340px)_minmax(0,1fr)]",
        )}
      >
        {/* Stage: the chosen scene, big. */}
        <div className="flex flex-col gap-3 md:sticky md:top-2 md:self-start">
          <div
            className={cn(
              "relative mx-auto w-full overflow-hidden rounded-[var(--ds-radius-tile)] bg-[var(--ds-well-bg)] ring-1 ring-[var(--ds-tile-border)]",
              !wide && "max-w-[340px]",
            )}
            // Never taller than about half the screen, so the script stays in reach on phones.
            style={{
              aspectRatio: ratio,
              maxWidth: wide ? undefined : `min(340px, ${(52 * shape).toFixed(2)}vh)`,
            }}
          >
            <AnimatePresence initial={false}>
              <motion.div
                key={scene.id}
                className="absolute inset-0"
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.03 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: duration.medium, ease: ease.emphasized }}
              >
                <FrameArt board={board} index={active} frames={frames} large />
              </motion.div>
            </AnimatePresence>
            <span className="absolute left-3 top-3 inline-flex h-7 items-center gap-1 rounded-full bg-background/90 px-2.5 text-[11.5px] font-bold text-foreground shadow-sm">
              Scene {scene.number}
            </span>
            <span className="absolute right-3 top-3 rounded-full bg-background/90 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-foreground shadow-sm">
              {timecode(scene.start)}–{timecode(scene.end)}
            </span>
            {scene.onScreen ? (
              <span className="absolute inset-x-4 bottom-14 rounded-2xl bg-black/55 px-3 py-2 text-center text-[14px] font-semibold leading-snug text-white backdrop-blur-sm">
                {scene.onScreen}
              </span>
            ) : null}
            {scene.words ? (
              <span className="absolute inset-x-4 bottom-3 line-clamp-2 text-center text-[12px] font-medium leading-snug text-white [text-shadow:0_1px_6px_rgb(0_0_0/0.7)]">
                “{scene.words}”
              </span>
            ) : null}
            {/* Playhead across the whole video. */}
            <div className="absolute inset-x-0 bottom-0 h-1 bg-black/20">
              <motion.div
                className="ds-grad-bar h-full"
                initial={false}
                animate={{ width: `${(scene.end / total) * 100}%` }}
                transition={{ duration: duration.medium, ease: ease.standard }}
              />
            </div>
          </div>
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (!playing && active >= board.scenes.length - 1) setActive(0);
                setPlaying((p) => !p);
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--ds-well-bg)] px-4 text-[12.5px] font-semibold text-foreground transition hover:ring-1 hover:ring-[var(--ds-tile-border)]"
            >
              {playing ? (
                <Pause className="size-4" aria-hidden />
              ) : (
                <Play className="size-4" aria-hidden />
              )}
              {playing ? "Pause" : "Play through"}
            </button>
            <button
              type="button"
              onClick={() => pick(Math.min(active + 1, board.scenes.length - 1))}
              disabled={active >= board.scenes.length - 1}
              className="inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[12.5px] font-semibold text-muted-foreground transition hover:text-foreground disabled:opacity-40"
            >
              Next scene
              <ArrowRight className="size-4" aria-hidden />
            </button>
          </div>
        </div>

        {/* The script, scene by scene. */}
        <ol aria-label="Script" className="flex flex-col gap-2">
          {board.scenes.map((s, i) => (
            <li
              key={s.id}
              ref={(el) => {
                rows.current[i] = el;
              }}
            >
              <ScriptRow
                scene={s}
                active={i === active}
                keyFrame={!!s.frameSlot}
                onPick={() => pick(i)}
              />
            </li>
          ))}
        </ol>
      </div>

      {/* Film strip: every scene, sized by its length. */}
      <div
        role="tablist"
        aria-label="Scenes on the timeline"
        className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
      >
        {board.scenes.map((s, i) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={active === i}
            aria-label={`Scene ${s.number}, ${timecode(s.start)} to ${timecode(s.end)}`}
            onClick={() => pick(i)}
            style={{ flexGrow: Math.max(s.end - s.start, 0.5) / total }}
            className={cn(
              "relative h-16 min-w-[56px] basis-0 overflow-hidden rounded-xl ring-1 transition-[box-shadow,opacity] duration-[--motion-duration-medium]",
              active === i
                ? "ring-2 ring-[hsl(var(--primary)/0.7)]"
                : "opacity-80 ring-[var(--ds-tile-border)] hover:opacity-100",
            )}
          >
            <FrameArt board={board} index={i} frames={frames} />
            <span className="absolute bottom-1.5 left-1 rounded-full bg-background/90 px-1.5 text-[10px] font-bold tabular-nums text-foreground">
              {s.number}
            </span>
            {active === i ? (
              <motion.span
                layoutId="storyboard-strip"
                className="ds-grad-bar absolute inset-x-0 bottom-0 h-1"
              />
            ) : null}
          </button>
        ))}
      </div>

      {board.bible.length || board.endCard ? (
        <div className="ds-tile flex flex-col gap-2 p-4">
          <span className="ds-label">Kept the same in every scene</span>
          <div className="flex flex-wrap gap-1.5">
            {board.bible.map((entry) => (
              <span
                key={`${entry.label}-${entry.value}`}
                className="inline-flex max-w-full items-baseline gap-1 rounded-full bg-[var(--ds-well-bg)] px-3 py-1 text-[12px]"
              >
                <span className="font-semibold text-foreground">{entry.label}</span>
                <span className="truncate text-muted-foreground">{entry.value}</span>
              </span>
            ))}
            {board.endCard ? (
              <span className="inline-flex items-baseline gap-1 rounded-full bg-[var(--ds-well-bg)] px-3 py-1 text-[12px]">
                <span className="font-semibold text-foreground">End card</span>
                <span className="text-muted-foreground">
                  {board.endCard.headline}
                  {board.endCard.detail ? ` · ${board.endCard.detail}` : ""}
                </span>
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <footer className="sticky bottom-4 z-20 flex flex-col items-stretch gap-2 rounded-[var(--ds-radius-tile)] bg-[var(--ds-tile-bg)]/95 p-3 shadow-[var(--ds-window-shadow)] ring-1 ring-[var(--ds-tile-border)] backdrop-blur sm:flex-row sm:items-center">
        <p className="min-w-0 flex-1 px-1 text-[12px] text-muted-foreground">
          {drawing
            ? "Drawing the key frames. You can read the script already."
            : (note ?? "Nothing is spent on the video until you press Create.")}
        </p>
        {onChange ? (
          <button
            type="button"
            onClick={onChange}
            disabled={disabled || busy}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full px-4 text-[13px] font-semibold text-foreground ring-1 ring-[var(--ds-tile-border)] transition hover:bg-[var(--ds-well-bg)] disabled:opacity-50"
          >
            <Pencil className="size-4" aria-hidden />
            {changeLabel}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onCreate}
          disabled={disabled || busy}
          className="studio-cta inline-flex h-10 items-center justify-center gap-2 rounded-full px-6 text-[13px] font-semibold disabled:opacity-60"
        >
          <Sparkles className="size-4" aria-hidden />
          {busy ? "Starting…" : createLabel}
        </button>
      </footer>
    </section>
  );
}

function MetaPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--ds-well-bg)] px-2.5 py-1 font-medium">
      {children}
    </span>
  );
}

/** A scene's picture: its own key frame, or the key frame it follows from, softened. */
function FrameArt({
  board,
  index,
  frames,
  large = false,
}: {
  board: Board;
  index: number;
  frames: Record<string, BoardFrame | undefined>;
  large?: boolean;
}) {
  const { slot, own } = keyFrameFor(board, index);
  const frame = slot ? frames[slot] : undefined;
  const scene = board.scenes[index];
  if (frame?.status === "pending") return <Skeleton className="absolute inset-0 rounded-none" />;
  if (frame?.status === "ready" && frame.url) {
    return (
      <>
        <img
          src={frame.url}
          alt={large && scene ? `Scene ${scene.number}: ${scene.action}` : ""}
          className={cn("absolute inset-0 object-cover", !own && "scale-105 saturate-[0.7]")}
          style={{ width: "100%", height: "100%" }}
          loading="lazy"
        />
        {!own && large ? (
          <span className="absolute left-1/2 top-12 -translate-x-1/2 whitespace-nowrap rounded-full bg-background/85 px-2.5 py-0.5 text-[10.5px] font-semibold text-muted-foreground">
            Continues the key frame before
          </span>
        ) : null}
      </>
    );
  }
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-[var(--ds-well-bg)] p-3 text-center text-[11px] text-muted-foreground">
      <Camera className={large ? "size-6 opacity-60" : "size-4 opacity-50"} aria-hidden />
      {large ? (frame?.status === "failed" ? "Frame unavailable" : scene?.camera || "Scene") : null}
    </div>
  );
}

function ScriptRow({
  scene,
  active,
  keyFrame,
  onPick,
}: {
  scene: BoardScene;
  active: boolean;
  keyFrame: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-current={active ? "step" : undefined}
      className={cn(
        "ds-tile flex w-full gap-3 p-3 text-left transition-[box-shadow,background] duration-[--motion-duration-medium]",
        active ? "ring-2 ring-[hsl(var(--primary)/0.55)]" : "hover:bg-[var(--ds-well-bg)]",
      )}
    >
      <span
        className={cn(
          "mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[11.5px] font-bold tabular-nums",
          active ? "ds-grad-bar text-[var(--mox-ink)]" : "bg-[var(--ds-well-bg)] text-foreground",
        )}
      >
        {scene.number}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span className="normal-case tabular-nums tracking-normal">
            {timecode(scene.start)}–{timecode(scene.end)}
          </span>
          {scene.camera ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <Camera className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{scene.camera}</span>
            </span>
          ) : null}
          {keyFrame ? (
            <span className="rounded-full bg-[var(--ds-well-bg)] px-2 py-0.5 normal-case tracking-normal">
              Key frame
            </span>
          ) : null}
        </span>
        {scene.action ? (
          <span className="text-[13px] leading-snug text-foreground">{scene.action}</span>
        ) : null}
        {scene.words ? (
          <Line icon={<Mic className="size-3.5" aria-hidden />} label="Said">
            “{scene.words}”
          </Line>
        ) : null}
        {scene.onScreen ? (
          <Line icon={<Type className="size-3.5" aria-hidden />} label="On screen">
            {scene.onScreen}
          </Line>
        ) : null}
        {scene.sound ? (
          <Line icon={<Music className="size-3.5" aria-hidden />} label="Sound">
            {scene.sound}
          </Line>
        ) : null}
      </span>
    </button>
  );
}

function Line({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <span className="flex items-start gap-1.5 rounded-xl bg-[var(--ds-well-bg)] px-2.5 py-1.5 text-[12px] leading-snug">
      <span className="mt-px shrink-0 text-muted-foreground" title={label}>
        {icon}
      </span>
      <span className="sr-only">{label}: </span>
      <span className="text-foreground">{children}</span>
    </span>
  );
}
