"use client";

// The shape of a post sits on the canvas under the platforms, like a video's
// (VideoCanvasSettings): the size for a picture, an ad or a carousel, the
// number of slides, and what a Story is made of and how many frames. The side
// panel keeps what the piece is about (product, goal, kind) and the fine print.

import { AnimatePresence, motion } from "framer-motion";
import { Minus, Plus } from "@/components/icons";
import { useReducedMotionSafe } from "@/hooks/use-reduced-motion-safe";
import { cn } from "@/lib/utils";
import { recommendedRatio } from "@/lib/studio/aspect";
import { STUDIO_FORMATS } from "@/lib/studio/formats";
import type { StudioControls } from "@/lib/studio/jobs";
import { updateSession, type StudioSession } from "@/lib/studio/session-store";
import { isAiVideo, settleVideoControls } from "@/lib/studio/video/settle";
import { DEFAULT_STUDIO_VIDEO_MODEL } from "@/lib/studio/video/kinds";
import { lengthChoices } from "@/lib/studio/video/lengths";
import { DEFAULT_STORY_FRAMES } from "@/lib/stories/frames";
import { RatioPicker, Segmented } from "./studio-ui";

const MIN_SLIDES = 3;
const MAX_SLIDES = 10;
const MAX_FRAMES = 5;

/** Whether the canvas shows a post's shape for this session. */
export function showsPostCanvas(session: StudioSession): boolean {
  const c = session.controls;
  if (session.type === "story" || session.type === "carousel") return true;
  if (session.type === "image" || session.type === "ad") return true;
  return session.type === "social" && !!c.includeImage;
}

export function PostCanvasSettings({
  session,
  disabled,
}: {
  session: StudioSession;
  disabled?: boolean;
}) {
  const reduce = useReducedMotionSafe();
  if (!showsPostCanvas(session)) return null;
  const c = session.controls;
  const format = STUDIO_FORMATS[session.type];
  const set = (patch: Partial<StudioControls>) =>
    updateSession(session.id, {
      controls: {
        ...c,
        ...patch,
        ...("durationSec" in patch || "storyMode" in patch ? { videoQuote: undefined } : {}),
      },
    });
  const story = session.type === "story";
  const storyVideo = story && c.storyMode === "video";
  const ratios = story ? [] : format.ratios;
  const recommended = ratios.length
    ? session.type === "carousel"
      ? "4:5"
      : recommendedRatio(c.platforms, "image", ratios)
    : undefined;
  const lengths =
    storyVideo && isAiVideo(session.type, c)
      ? (() => {
          const settled = settleVideoControls({
            type: session.type,
            controls: c,
            brief: session.brief,
            template: session.template,
            source: {
              picture: !!session.sourceContentId,
              script: !!session.sourceScript,
              product: !!c.productId,
            },
          });
          return {
            list: lengthChoices(
              settled.videoModelKey ?? DEFAULT_STUDIO_VIDEO_MODEL,
              settled.videoKind ?? "product-motion",
            ),
            value: settled.durationSec,
          };
        })()
      : null;

  return (
    <fieldset
      disabled={disabled}
      className="ds-enter grid grid-cols-1 gap-4 disabled:opacity-60 sm:grid-cols-2"
      data-testid="post-canvas-settings"
    >
      <legend className="sr-only">Size and shape</legend>

      {story ? (
        <div className="min-w-0">
          <p className="mb-2 text-xs font-medium text-foreground">Made of</p>
          <Segmented
            label="Made of"
            value={(storyVideo ? "video" : "frames") as "frames" | "video"}
            onChange={(storyMode) =>
              set({ storyMode, ...(storyMode === "video" ? { includeImage: false } : {}) })
            }
            options={[
              { value: "frames", label: "Designed frames", hint: "Your brand look" },
              { value: "video", label: "AI video", hint: "8s uses credits" },
            ]}
          />
        </div>
      ) : null}

      {ratios.length ? (
        <div className={cn("min-w-0", ratios.length > 3 && "sm:col-span-2")}>
          <p className="mb-2 text-xs font-medium text-foreground">Size</p>
          <RatioPicker
            ratios={ratios}
            value={c.ratio ?? recommended}
            recommended={recommended}
            onChange={(ratio) => set({ ratio })}
          />
        </div>
      ) : null}

      {session.type === "carousel" ? (
        <Stepper
          label="Slides"
          value={c.slideCount ?? 6}
          min={MIN_SLIDES}
          max={MAX_SLIDES}
          unit={(n) => (c.seamless ? "connected slides" : n === 1 ? "slide" : "slides")}
          onChange={(slideCount) => set({ slideCount })}
          reduce={reduce}
        />
      ) : null}

      {story && !storyVideo ? (
        <Stepper
          label="Frames"
          value={Math.min(c.frameCount ?? DEFAULT_STORY_FRAMES, MAX_FRAMES)}
          min={1}
          max={MAX_FRAMES}
          unit={(n) => `${n === 1 ? "frame" : "frames"} · about ${n * 5}s`}
          onChange={(frameCount) => set({ frameCount })}
          reduce={reduce}
        />
      ) : null}

      {lengths ? (
        <div className="min-w-0">
          <p className="mb-2 text-xs font-medium text-foreground">Length</p>
          <Segmented
            label="Length"
            className="max-w-full flex-wrap"
            value={lengths.value ?? lengths.list[0] ?? 8}
            onChange={(durationSec) => set({ durationSec })}
            options={(lengths.list.length ? lengths.list : [8]).map((v) => ({
              value: v,
              label: `${v}s`,
            }))}
          />
        </div>
      ) : null}

      {story ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-2">
          <span
            aria-hidden
            className="inline-block h-4 w-[9px] rounded-[2px] border-[1.5px] border-[var(--mox-green)]"
          />
          Full screen 9:16. Each frame is its own Story, shown one after the other.
        </p>
      ) : null}
    </fieldset>
  );
}

/** A count picked with − and +; the number springs as it changes. */
function Stepper({
  label,
  value,
  min,
  max,
  unit,
  onChange,
  reduce,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: (n: number) => string;
  onChange: (value: number) => void;
  reduce: boolean;
}) {
  const button =
    "grid size-8 place-items-center rounded-full text-foreground transition hover:bg-[var(--ds-card-bg)] disabled:opacity-35 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55";
  return (
    <div className="min-w-0">
      <p className="mb-2 text-xs font-medium text-foreground">{label}</p>
      <div className="inline-flex items-center gap-2 rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-well-bg)] p-1 pr-3.5">
        <button
          type="button"
          aria-label={`Fewer ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
          className={button}
        >
          <Minus className="size-3.5" />
        </button>
        <span className="relative grid h-7 w-6 place-items-center overflow-hidden text-sm font-bold tabular-nums">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={value}
              initial={reduce ? false : { y: 12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={reduce ? undefined : { y: -12, opacity: 0 }}
              transition={{ type: "spring", stiffness: 520, damping: 34 }}
            >
              {value}
            </motion.span>
          </AnimatePresence>
        </span>
        <button
          type="button"
          aria-label={`More ${label.toLowerCase()}`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
          className={button}
        >
          <Plus className="size-3.5" />
        </button>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {unit(value)}
        </span>
      </div>
    </div>
  );
}
