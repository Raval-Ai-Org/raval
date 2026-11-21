"use client";

// Home → Animate (Holo's "Turn images into videos"): a page on the canvas in
// Autopilot's three steps. Picture: the first frame (and, for the
// picture-led styles, an optional end frame) from the Library or this device.
// Motion: what should move and how. Shape: the aspect ratio and length, with
// a summary of the video. "Open in
// Studio" opens the video draft with the picture kept exact (`animateOpen`,
// src/lib/studio/repurpose.ts); nothing is made or charged until the person
// presses Generate there, with the price on it.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AppModalShell } from "@/components/app/AppModalShell";
import { PlanLock } from "@/components/app/billing/billing-ui";
import { openFeatureUpgrade } from "@/components/app/FeatureGate";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Plus,
  Sparkles,
  Upload,
  X,
} from "@/components/icons";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { authedFetch } from "@/lib/authed-fetch";
import {
  addAppEventListener,
  emitAppEvent,
  removeAppEventListener,
  type AppEvent,
} from "@/lib/app-events";
import { toast } from "@/lib/toast";
import type { PlanId } from "@/lib/billing/catalog";
import { isStudioType, type StudioType } from "@/lib/studio/formats";
import {
  animateOpen,
  animateStyles,
  pictureVideoSeconds,
  type RepurposeTarget,
} from "@/lib/studio/repurpose";
import { openComposer } from "@/lib/studio/session-store";
import { videoRatioForImage } from "@/lib/studio/video-ad";
import { acceptsEndFrame } from "@/lib/studio/video/end-frame";
import { DEFAULT_STUDIO_VIDEO_MODEL } from "@/lib/studio/video/kinds";
import { lengthChoices, snapLength } from "@/lib/studio/video/lengths";
import { cn } from "@/lib/utils";
import { MAX_PHOTO_BYTES, PHOTO_TYPES, uploadStudioMedia } from "./media-upload";
import { useOpenCreate } from "./use-open-create";
import { AnimatePresence, motion } from "framer-motion";
import { BackPill, GradProgress, StepPills } from "@/components/app/surface/MoxParts";
import { MoxFace, type MoxMood } from "@/components/brand/mox/MoxFace";
import { useReducedMotionSafe } from "@/hooks/use-reduced-motion-safe";

type AnimateStep = "picture" | "motion" | "shape";
const STEPS: { id: AnimateStep; label: string }[] = [
  { id: "picture", label: "Picture" },
  { id: "motion", label: "Motion" },
  { id: "shape", label: "Shape" },
];
const SAY: Record<AnimateStep, { mood: MoxMood; line: string; bold: string }> = {
  picture: { mood: "happy", line: "Which picture should", bold: "come to life?" },
  motion: { mood: "excited", line: "How should it", bold: "move?" },
  shape: { mood: "thinking", line: "Last thing:", bold: "shape and length." },
};
const EASE = [0.22, 1, 0.36, 1] as const;

export type AnimatePicture = {
  assetId: string;
  url: string;
  title: string | null;
  postId: string | null;
  type: StudioType | null;
};

export type AnimateRatio = "9:16" | "1:1" | "16:9";
export type AnimateSlot = "start" | "end";

/** Everything the person has chosen so far. */
export type AnimateDraft = {
  chosen: AnimatePicture | null;
  /** The optional closing still (only for styles that take one). */
  end: AnimatePicture | null;
  style: RepurposeTarget | null;
  note: string;
  /** null follows the first frame's shape. */
  ratio: AnimateRatio | null;
  /** null follows the style's own length. */
  seconds: number | null;
};

export const EMPTY_ANIMATE_DRAFT: AnimateDraft = {
  chosen: null,
  end: null,
  style: null,
  note: "",
  ratio: null,
  seconds: null,
};

const STYLES = animateStyles();
const RATIOS: AnimateRatio[] = ["9:16", "1:1", "16:9"];
const rise = (i: number) => ({ ["--i" as string]: i }) as CSSProperties;

/** The picture's shape as a Studio ratio, measured once it loads. */
function ratioOf(img: HTMLImageElement | null): string | undefined {
  if (!img?.naturalWidth || !img.naturalHeight) return undefined;
  const r = img.naturalWidth / img.naturalHeight;
  if (r > 1.25) return "16:9";
  if (r > 0.9) return "1:1";
  if (r > 0.72) return "4:5";
  return "9:16";
}

/** The lengths a style offers on the default video option, whole clips only. */
export function animateLengths(style: RepurposeTarget | null): number[] {
  const kind = style?.videoKind;
  if (!kind || kind === "motion-post") return [];
  return lengthChoices(DEFAULT_STUDIO_VIDEO_MODEL, kind);
}

/** The length shown as picked: the person's, else the style's own, snapped to whole clips. */
export function animateSeconds(draft: AnimateDraft): number | null {
  const kind = draft.style?.videoKind;
  if (!kind || kind === "motion-post") return null;
  return snapLength(draft.seconds ?? pictureVideoSeconds(kind), DEFAULT_STUDIO_VIDEO_MODEL, kind);
}

const LABEL = "text-[13px] font-semibold text-foreground/80";

/** One frame tile: the chosen picture, or an empty slot to fill. */
function FrameTile({
  label,
  picture,
  active,
  optional,
  disabledNote,
  onSelect,
  onClear,
  onMeasured,
  ratio,
}: {
  label: string;
  picture: AnimatePicture | null;
  active: boolean;
  optional?: boolean;
  /** Why this slot can't take a picture for the picked style. */
  disabledNote?: string;
  onSelect: () => void;
  onClear?: () => void;
  onMeasured?: (img: HTMLImageElement) => void;
  ratio: AnimateRatio;
}) {
  const disabled = !!disabledNote;
  const shape =
    ratio === "16:9" ? "aspect-[16/10]" : ratio === "1:1" ? "aspect-square" : "aspect-[4/5]";
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
      <div className="relative w-full max-w-[170px]">
        <button
          type="button"
          onClick={onSelect}
          disabled={disabled}
          aria-pressed={active}
          aria-label={
            picture
              ? `${label}: ${picture.title ?? "picture"}. Pick another below`
              : `Choose the ${label.toLowerCase()}`
          }
          className={cn(
            "group relative grid w-full place-items-center overflow-hidden rounded-[18px] transition-[box-shadow,transform,background-color] duration-200 ease-out focus-visible:outline-none",
            shape,
            picture
              ? "bg-[var(--ds-well-bg)]"
              : "border-2 border-dashed border-[var(--ds-card-border)] bg-[var(--ds-card-bg)]/70",
            active && !disabled
              ? "shadow-[0_0_0_2px_var(--mox-green),0_16px_36px_-18px_rgb(0_0_0/0.4)]"
              : "shadow-[var(--ds-card-shadow)]",
            !disabled && "hover:-translate-y-0.5 focus-visible:shadow-[0_0_0_2px_var(--mox-green)]",
            disabled && "cursor-not-allowed opacity-55",
          )}
        >
          {picture ? (
            <img
              key={picture.assetId}
              src={picture.url}
              alt=""
              onLoad={(e) => onMeasured?.(e.currentTarget)}
              className="animate-frame-in h-full w-full object-cover"
            />
          ) : (
            <span className="flex flex-col items-center gap-1.5 px-3 text-center text-muted-foreground transition group-hover:text-foreground">
              <span className="grid size-9 place-items-center rounded-full bg-[var(--ds-well-bg)] transition group-hover:scale-110">
                {optional ? <Plus className="size-4" /> : <ImagePlus className="size-4" />}
              </span>
              <span className="text-[11.5px] font-semibold leading-tight">
                {disabled ? disabledNote : optional ? "Add an end frame" : "Pick a picture"}
              </span>
            </span>
          )}
        </button>
        {picture && onClear ? (
          <button
            type="button"
            onClick={onClear}
            aria-label={`Remove the ${label.toLowerCase()}`}
            className="absolute -right-2 -top-2 grid size-7 place-items-center rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] text-muted-foreground shadow-[var(--ds-card-shadow)] transition hover:scale-110 hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>
      <span
        className={cn(
          "text-[11.5px] font-semibold transition-colors",
          active && !disabled ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        {optional ? <span className="font-medium text-muted-foreground"> · optional</span> : null}
      </span>
    </div>
  );
}

/** A pill segmented control on the canvas (Holo's aspect ratio and length). */
function CanvasSegment<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: { value: T; label: React.ReactNode }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex w-full rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-well-bg)] p-1"
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold transition-all duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55",
              on
                ? "bg-[var(--ds-card-bg)] text-foreground shadow-[0_2px_8px_-2px_rgb(15_23_20/0.18)]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function RatioGlyph({ ratio }: { ratio: AnimateRatio }) {
  const [w, h] = ratio === "9:16" ? [8, 13] : ratio === "1:1" ? [11, 11] : [14, 8];
  return (
    <span aria-hidden className="grid size-4 place-items-center">
      <span
        className="rounded-[2px] border-[1.5px] border-current"
        style={{ width: w, height: h }}
      />
    </span>
  );
}

/** Presentational: `AnimateFlow` wires it, `/home-lab?scene=animate` shows it. */
export function AnimateFlowView({
  pictures,
  error,
  draft,
  autoRatio,
  lock,
  onDraft,
  onRetry,
  onSeeLibrary,
  onOpenStudio,
  onMeasured,
  onUpload,
  uploading = false,
}: {
  /** null while loading. */
  pictures: AnimatePicture[] | null;
  error: string | null;
  draft: AnimateDraft;
  /** The first frame's own shape as a video ratio, once measured. */
  autoRatio: AnimateRatio;
  /** The plan video needs, when this one can't make videos yet. */
  lock: PlanId | null;
  onDraft: (patch: Partial<AnimateDraft>) => void;
  onRetry: () => void;
  onSeeLibrary: () => void;
  onOpenStudio: () => void;
  onMeasured?: (img: HTMLImageElement) => void;
  /** A new picture from this device, for the slot being filled. */
  onUpload?: (file: File, slot: AnimateSlot) => void;
  uploading?: AnimateSlot | false;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [slot, setSlot] = useState<AnimateSlot>("start");
  const [over, setOver] = useState(false);
  const [step, setStep] = useState<AnimateStep>("picture");
  const [dir, setDir] = useState(1);
  const reduce = useReducedMotionSafe();
  const at = STEPS.findIndex((x) => x.id === step);
  const goTo = (next: AnimateStep) => {
    setDir(STEPS.findIndex((x) => x.id === next) >= at ? 1 : -1);
    setStep(next);
  };
  const stepOk =
    step === "picture" ? !!draft.chosen && !uploading : step === "motion" ? !!draft.style : true;
  const endAllowed = acceptsEndFrame(draft.style?.videoKind);
  const lengths = animateLengths(draft.style);
  const seconds = animateSeconds(draft);
  const ratio = draft.ratio ?? autoRatio;
  const filling: AnimateSlot = endAllowed ? slot : "start";

  // A style that ends on its own frees the end slot.
  useEffect(() => {
    if (!endAllowed) setSlot("start");
  }, [endAllowed]);

  const pickFile = (to: AnimateSlot) => {
    setSlot(to);
    file.current?.click();
  };
  const take = (files: FileList | null | undefined) => {
    const f = Array.from(files ?? []).find((x) => PHOTO_TYPES.includes(x.type));
    if (f) onUpload?.(f, filling);
  };
  const pick = (p: AnimatePicture) => {
    if (filling === "end") {
      // The same picture at both ends is just the default return.
      onDraft({ end: draft.chosen?.assetId === p.assetId ? null : p });
      setSlot("start");
      return;
    }
    onDraft({ chosen: p, ...(draft.end?.assetId === p.assetId ? { end: null } : {}) });
  };
  const scroll = (by: number) =>
    strip.current?.scrollBy({ left: by * (strip.current.clientWidth * 0.8), behavior: "smooth" });

  return (
    <div
      className="relative mx-auto flex min-h-full w-full max-w-[640px] flex-col"
      onDragOver={(e) => {
        if (!onUpload) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setOver(false);
      }}
      onDrop={(e) => {
        if (!onUpload) return;
        e.preventDefault();
        setOver(false);
        take(e.dataTransfer.files);
      }}
    >
      <input
        ref={file}
        type="file"
        accept={PHOTO_TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
      {over ? (
        <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-[24px] border-2 border-dashed border-[var(--mox-green)] bg-[var(--ds-card-bg)]/70 backdrop-blur-sm">
          <p className="flex items-center gap-2 text-[13px] font-semibold">
            <Upload className="size-4" /> Drop to use as the{" "}
            {filling === "end" ? "end frame" : "first frame"}
          </p>
        </div>
      ) : null}

      <div className="flex flex-col items-center gap-2.5">
        <StepPills
          steps={STEPS}
          current={step}
          onPick={(id) => goTo(id as AnimateStep)}
          className="max-w-full overflow-x-auto"
        />
        <GradProgress
          value={(at + 1) / STEPS.length}
          className="w-full max-w-[240px]"
          label="Animate progress"
        />
      </div>
      <div className="mb-5 mt-6 flex items-center gap-3">
        <span className="mox-float shrink-0">
          <MoxFace mood={SAY[step].mood} size={48} track />
        </span>
        <h3 className="text-[22px] font-bold leading-tight tracking-[-0.025em] sm:text-[26px]">
          {SAY[step].line} <span className="ds-grad-text">{SAY[step].bold}</span>
        </h3>
      </div>

      <AnimatePresence mode="wait" initial={false} custom={dir}>
        <motion.div
          key={step}
          initial={reduce ? { opacity: 0 } : { opacity: 0, x: 24 * dir }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, x: -24 * dir }}
          transition={{ duration: 0.28, ease: EASE }}
          className="space-y-6 pb-4"
        >
          {step === "picture" && (
            /* Frames: Holo's "Choose first and last frames". */
            <section aria-labelledby="animate-frames" className="ds-card p-4 sm:p-5">
              <div className="mb-4 flex items-baseline justify-between gap-3">
                <h2 id="animate-frames" className={LABEL}>
                  Choose your frames
                </h2>
                <span className="truncate text-[11.5px] text-muted-foreground">
                  {endAllowed
                    ? filling === "end"
                      ? "Now pick the end frame below"
                      : "Tap a frame, then pick a picture"
                    : "This style ends on its own"}
                </span>
              </div>
              <div className="flex items-center justify-center gap-3 sm:gap-5">
                <FrameTile
                  label="First frame"
                  picture={uploading === "start" ? null : draft.chosen}
                  active={filling === "start"}
                  onSelect={() =>
                    draft.chosen || !onUpload ? setSlot("start") : pickFile("start")
                  }
                  onMeasured={onMeasured}
                  ratio={ratio}
                />
                <span
                  aria-hidden
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--ds-well-bg)] text-muted-foreground"
                >
                  <ArrowRight className="size-4" />
                </span>
                <FrameTile
                  label="End frame"
                  optional
                  picture={endAllowed && uploading !== "end" ? draft.end : null}
                  active={filling === "end"}
                  disabledNote={endAllowed ? undefined : "Ends on its own"}
                  onSelect={() => setSlot("end")}
                  onClear={() => onDraft({ end: null })}
                  ratio={ratio}
                />
              </div>
              {uploading ? (
                <p className="mt-3 flex items-center justify-center gap-2 text-[12px] font-semibold text-muted-foreground">
                  <span className="size-2 animate-pulse rounded-full [background:var(--mox-gradient)]" />
                  Uploading…
                </p>
              ) : null}

              <div className="mt-5 flex items-center justify-between gap-2">
                <p className="text-[12px] font-semibold text-muted-foreground">From your library</p>
                {pictures?.length ? (
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => scroll(-1)}
                      aria-label="Earlier pictures"
                      className="grid size-8 place-items-center rounded-full text-muted-foreground transition hover:bg-[var(--ds-well-bg)] hover:text-foreground"
                    >
                      <ChevronLeft className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => scroll(1)}
                      aria-label="More pictures"
                      className="grid size-8 place-items-center rounded-full text-muted-foreground transition hover:bg-[var(--ds-well-bg)] hover:text-foreground"
                    >
                      <ChevronRight className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={onSeeLibrary}
                      className="ml-1 rounded-full px-2.5 py-1 text-[12px] font-semibold text-muted-foreground transition hover:bg-[var(--ds-well-bg)] hover:text-foreground"
                    >
                      See all
                    </button>
                  </div>
                ) : null}
              </div>
              {error ? (
                <ErrorState
                  title="Couldn't load your pictures"
                  description={error}
                  onRetry={onRetry}
                />
              ) : pictures === null ? (
                <div className="mt-2 flex gap-2.5 overflow-hidden p-1.5">
                  {Array.from({ length: 6 }, (_, i) => (
                    <Skeleton key={i} className="h-[92px] w-[74px] shrink-0 rounded-xl" />
                  ))}
                </div>
              ) : pictures.length === 0 && !onUpload ? (
                <EmptyState
                  icon={Sparkles}
                  title="No pictures in your Library yet"
                  description="Make a post first, then bring it to life here."
                  action={
                    <button
                      type="button"
                      onClick={() => emitAppEvent("open:create-launcher")}
                      className="studio-cta inline-flex h-9 items-center rounded-full px-4 text-[13px] font-bold"
                    >
                      Make a post
                    </button>
                  }
                />
              ) : (
                // Padding inside the scroller so a picked tile's ring is never cut off.
                <div
                  ref={strip}
                  role="listbox"
                  aria-label={`Your pictures, for the ${filling === "end" ? "end" : "first"} frame`}
                  className="-mx-1.5 mt-1 flex snap-x scroll-px-1.5 gap-2.5 overflow-x-auto scroll-smooth p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  {onUpload ? (
                    <button
                      type="button"
                      onClick={() => pickFile(filling)}
                      className="ds-rise grid h-[92px] w-[74px] shrink-0 snap-start place-items-center rounded-xl border-2 border-dashed border-[var(--ds-card-border)] text-muted-foreground transition hover:-translate-y-0.5 hover:border-[var(--mox-green)] hover:text-foreground"
                    >
                      <span className="flex flex-col items-center gap-1 text-[11px] font-semibold">
                        <Upload className="size-4" />
                        Upload
                      </span>
                    </button>
                  ) : null}
                  {pictures.map((p, i) => {
                    const isStart = draft.chosen?.assetId === p.assetId;
                    const isEnd = endAllowed && draft.end?.assetId === p.assetId;
                    return (
                      <button
                        key={p.assetId}
                        type="button"
                        role="option"
                        aria-selected={filling === "end" ? isEnd : isStart}
                        aria-label={p.title ?? `Picture ${i + 1}`}
                        onClick={() => pick(p)}
                        style={rise(i + 1)}
                        className={cn(
                          "ds-rise relative h-[92px] w-[74px] shrink-0 snap-start overflow-hidden rounded-xl bg-[var(--ds-well-bg)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_var(--mox-green)]",
                          isStart || isEnd
                            ? "shadow-[0_0_0_2px_var(--ds-card-bg),0_0_0_4px_var(--mox-green)]"
                            : "shadow-[0_0_0_1px_var(--ds-card-border)]",
                        )}
                      >
                        <img
                          src={p.url}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                        {isStart || isEnd ? (
                          <span className="absolute bottom-1 left-1 rounded-full bg-black/65 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-white backdrop-blur">
                            {isStart ? "First" : "End"}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                  {pictures.length === 0 ? (
                    <p className="self-center px-2 text-[12px] text-muted-foreground">
                      No pictures yet. Upload one, or make a post first.
                    </p>
                  ) : null}
                </div>
              )}
            </section>
          )}

          {step === "motion" && (
            <>
              <section aria-labelledby="animate-idea-label">
                <label id="animate-idea-label" htmlFor="animate-note" className={LABEL}>
                  Explain your idea
                </label>
                <textarea
                  id="animate-note"
                  value={draft.note}
                  onChange={(e) => onDraft({ note: e.target.value })}
                  rows={3}
                  maxLength={600}
                  placeholder="e.g. A slow splash around the can, gentle ripples in the pool, a warm lens flare from the sun."
                  className="ds-card mt-2 w-full resize-none p-3.5 text-[13.5px] leading-relaxed transition-shadow placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                />
              </section>

              <section aria-labelledby="animate-style-label">
                <p id="animate-style-label" className={cn(LABEL, "mb-2")}>
                  How it moves
                </p>
                <div
                  role="radiogroup"
                  aria-labelledby="animate-style-label"
                  className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:grid-cols-3"
                >
                  {STYLES.map((s, i) => {
                    const on = draft.style?.videoKind === s.videoKind;
                    return (
                      <button
                        key={s.videoKind}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => onDraft({ style: s, seconds: null })}
                        style={rise(i)}
                        className={cn(
                          "ds-card ds-card-hover ds-rise p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                          on &&
                            "!border-[var(--mox-green)] bg-[color-mix(in_srgb,var(--mox-lime)_14%,var(--ds-card-bg))] shadow-[0_0_0_1px_var(--mox-green)]",
                        )}
                      >
                        <span className="block text-[13px] font-bold tracking-[-0.01em]">
                          {s.label}
                        </span>
                        <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
                          {s.hint}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            </>
          )}

          {step === "shape" && (
            <>
              {/* What will be made, at a glance: the picture, its motion, its shape. */}
              <section aria-label="Your video" className="ds-card flex items-center gap-4 p-3.5">
                {draft.chosen ? (
                  <span className="relative h-[92px] w-[74px] shrink-0 overflow-hidden rounded-xl bg-[var(--ds-well-bg)] shadow-[var(--ds-card-shadow)]">
                    <img
                      src={draft.chosen.url}
                      alt=""
                      className="animate-frame-in h-full w-full object-cover"
                    />
                    <span aria-hidden className="ds-sheen absolute inset-0" />
                  </span>
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="ds-label">Your video</p>
                  <p className="mt-1 truncate text-[15px] font-bold tracking-[-0.01em]">
                    {draft.style?.label ?? "Pick a motion"}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">
                    {draft.note.trim() || draft.style?.hint || "Mox moves it in your look."}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-[var(--ds-well-bg)] px-2.5 py-0.5 text-[11.5px] font-semibold">
                      {ratio}
                    </span>
                    {seconds ? (
                      <span className="rounded-full bg-[var(--ds-well-bg)] px-2.5 py-0.5 text-[11.5px] font-semibold">
                        {seconds}s
                      </span>
                    ) : null}
                    {draft.end && endAllowed ? (
                      <span className="rounded-full bg-[var(--ds-well-bg)] px-2.5 py-0.5 text-[11.5px] font-semibold">
                        Ends on your frame
                      </span>
                    ) : null}
                  </div>
                </div>
              </section>
              {/* Holo: the shape and length sit on the canvas, not in a menu. */}
              <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <p className={cn(LABEL, "mb-2")}>
                    Aspect ratio
                    {draft.ratio === null ? (
                      <span className="font-medium text-muted-foreground">
                        {" "}
                        · follows the picture
                      </span>
                    ) : null}
                  </p>
                  <CanvasSegment
                    label="Aspect ratio"
                    value={ratio}
                    onChange={(r) => onDraft({ ratio: r })}
                    options={RATIOS.map((r) => ({
                      value: r,
                      label: (
                        <>
                          <RatioGlyph ratio={r} />
                          {r}
                        </>
                      ),
                    }))}
                  />
                </div>
                <div>
                  <p className={cn(LABEL, "mb-2")}>Video length</p>
                  {lengths.length ? (
                    <CanvasSegment
                      label="Video length"
                      value={seconds}
                      onChange={(v) => onDraft({ seconds: v })}
                      options={lengths.map((v) => ({ value: v, label: `${v}s` }))}
                    />
                  ) : (
                    <p className="flex min-h-11 items-center rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-well-bg)] px-4 text-[12.5px] text-muted-foreground">
                      Set by your picture, no AI clips
                    </p>
                  )}
                </div>
              </section>
            </>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Holo's pill, bottom right, floating over the canvas as it scrolls. */}
      <div className="pointer-events-none sticky bottom-0 z-[5] -mx-1 mt-auto flex items-end justify-end bg-gradient-to-t from-[var(--ds-canvas-bg,transparent)] via-[color-mix(in_srgb,var(--ds-canvas-bg,white)_70%,transparent)] to-transparent px-1 pb-1 pt-6">
        <span className="pointer-events-auto mr-auto self-end">
          {at > 0 ? <BackPill onClick={() => goTo(STEPS[at - 1].id)} /> : null}
        </span>
        <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)]/85 p-1.5 pl-4 shadow-[0_18px_40px_-20px_rgb(0_0_0/0.35)] backdrop-blur-xl">
          <p className="hidden text-[11.5px] text-muted-foreground sm:block">
            {step === "shape"
              ? "Nothing is made yet · price in Studio"
              : `Step ${at + 1} of ${STEPS.length}`}
          </p>
          {step !== "shape" ? (
            <button
              type="button"
              disabled={!stepOk}
              onClick={() => goTo(STEPS[at + 1].id)}
              className="studio-cta inline-flex h-11 items-center gap-1.5 rounded-full px-5 text-[13.5px] font-bold transition-transform active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
              <ArrowRight className="size-4" />
            </button>
          ) : (
            <button
              type="button"
              disabled={!draft.chosen || !draft.style || !!uploading}
              onClick={onOpenStudio}
              className="studio-cta inline-flex h-11 items-center gap-1.5 rounded-full px-5 text-[13.5px] font-bold transition-transform active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {lock ? <PlanLock plan={lock} /> : null}
              Open in Studio
              <ArrowRight className="size-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

type ApiAsset = {
  id: string;
  type: string;
  name: string;
  url: string | null;
  thumbnailUrl?: string | null;
  postId?: string | null;
  metadata?: Record<string, unknown>;
};

const MAX_PICTURES = 40;

export function AnimateFlow() {
  const workspaceId = useOptionalWorkspaceId();
  const create = useOpenCreate();
  const lock = create.lockFor("video");
  const [open, setOpen] = useState(false);
  const [fromCreate, setFromCreate] = useState(false);
  const [pictures, setPictures] = useState<AnimatePicture[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<AnimateDraft>({
    ...EMPTY_ANIMATE_DRAFT,
    style: STYLES[0] ?? null,
  });
  const [measured, setMeasured] = useState<string | undefined>(undefined);
  const [uploading, setUploading] = useState<AnimateSlot | false>(false);
  /** Each open starts again at the first step. */
  const [run, setRun] = useState(0);
  const patch = useCallback((p: Partial<AnimateDraft>) => {
    if ("chosen" in p) setMeasured(undefined);
    setDraft((d) => ({ ...d, ...p }));
  }, []);
  const autoRatio = useMemo(() => videoRatioForImage(measured), [measured]);

  /** A picture from this device goes into the Library first (free), then fills its slot. */
  const upload = async (f: File, slot: AnimateSlot) => {
    if (!workspaceId || uploading) return;
    if (f.size > MAX_PHOTO_BYTES) {
      toast.error(`${f.name}: choose a photo under 100 MB.`);
      return;
    }
    setUploading(slot);
    try {
      const done = await uploadStudioMedia(workspaceId, f, "photo");
      const picture: AnimatePicture = {
        assetId: done.id,
        url: done.url ?? URL.createObjectURL(f),
        title: f.name.replace(/\.[a-z0-9]+$/i, ""),
        postId: null,
        type: null,
      };
      setPictures((list) => [picture, ...(list ?? [])]);
      patch(slot === "end" ? { end: picture } : { chosen: picture });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not upload the photo.");
    } finally {
      setUploading(false);
    }
  };

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setError(null);
    setPictures(null);
    try {
      const res = await authedFetch(
        `/api/assets/library?workspaceId=${encodeURIComponent(workspaceId)}`,
        { cache: "no-store" },
      );
      const body = (await res.json().catch(() => ({}))) as { assets?: ApiAsset[]; error?: string };
      if (!res.ok) throw new Error(body.error || "Please try again.");
      const list = (body.assets ?? [])
        .filter((a) => a.type === "image" && (a.thumbnailUrl || a.url))
        .slice(0, MAX_PICTURES)
        .map((a) => {
          const t = a.metadata?.studio_type;
          return {
            assetId: a.id,
            url: (a.thumbnailUrl || a.url) as string,
            title: a.name || null,
            postId: a.postId ?? null,
            type: isStudioType(t) ? t : null,
          };
        });
      setPictures(list);
      setDraft((d) => (d.chosen ? d : { ...d, chosen: list[0] ?? null }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    }
  }, [workspaceId]);

  useEffect(() => {
    const onOpen = (event: AppEvent<"open:animate">) => {
      setFromCreate(!!event.detail?.fromCreate);
      setDraft({ ...EMPTY_ANIMATE_DRAFT, style: STYLES[0] ?? null });
      setMeasured(undefined);
      setRun((n) => n + 1);
      setOpen(true);
      void load();
    };
    addAppEventListener("open:animate", onOpen);
    return () => removeAppEventListener("open:animate", onOpen);
  }, [load]);

  const openStudio = () => {
    if (!draft.chosen || !draft.style) return;
    if (lock) {
      setOpen(false);
      openFeatureUpgrade("ugc");
      return;
    }
    const opts = animateOpen({
      picture: { ...draft.chosen, ratio: measured },
      target: draft.style,
      note: draft.note,
      endFrame: draft.end,
      ratio: draft.ratio ?? undefined,
      durationSec: animateSeconds(draft) ?? undefined,
    });
    if (openComposer(opts)) setOpen(false);
  };

  return (
    <AppModalShell
      navId="home"
      open={open}
      onOpenChange={setOpen}
      size="xl"
      Icon={Sparkles}
      title="Post to video ad"
      // Opened from Create: Back is one step out, to the list it came from.
      onBack={
        fromCreate
          ? () => {
              setOpen(false);
              emitAppEvent("open:create-launcher", { back: "animate" });
            }
          : undefined
      }
      srDescription="Choose the first frame and an optional end frame, say what moves, then the shape and length."
      bodyClassName="px-4 pb-4 pt-3 sm:px-6 sm:pb-5"
    >
      <AnimateFlowView
        key={run}
        pictures={pictures}
        error={error}
        draft={draft}
        autoRatio={autoRatio}
        lock={lock}
        onDraft={patch}
        onRetry={() => void load()}
        onSeeLibrary={() => {
          setOpen(false);
          emitAppEvent("open:library");
        }}
        onOpenStudio={openStudio}
        onMeasured={(img) => setMeasured(ratioOf(img))}
        onUpload={(f, slot) => void upload(f, slot)}
        uploading={uploading}
      />
    </AppModalShell>
  );
}
