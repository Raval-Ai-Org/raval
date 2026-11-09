"use client";

// Home → Animate (Holo's "Turn images into videos"): two steps on the canvas.
// 1. Source: pick a picture from the Library. 2. Motion: say what should
// move, or pick one of the picture videos ("Bring it to life", "Animate the
// product"…). "Open in Studio" opens the video draft with the picture kept
// exact (`animateOpen`, src/lib/studio/repurpose.ts); nothing is made or
// charged until the person presses Generate there, with the price on it.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { AppModalShell } from "@/components/app/AppModalShell";
import { PlanLock } from "@/components/app/billing/billing-ui";
import { openFeatureUpgrade } from "@/components/app/FeatureGate";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Upload,
} from "@/components/icons";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { authedFetch } from "@/lib/authed-fetch";
import { addAppEventListener, emitAppEvent, removeAppEventListener } from "@/lib/app-events";
import { toast } from "@/lib/toast";
import type { PlanId } from "@/lib/billing/catalog";
import { isStudioType, type StudioType } from "@/lib/studio/formats";
import { animateOpen, animateStyles, type RepurposeTarget } from "@/lib/studio/repurpose";
import { openComposer } from "@/lib/studio/session-store";
import { cn } from "@/lib/utils";
import { MAX_PHOTO_BYTES, PHOTO_TYPES, uploadStudioMedia } from "./media-upload";
import { useOpenCreate } from "./use-open-create";

export type AnimatePicture = {
  assetId: string;
  url: string;
  title: string | null;
  postId: string | null;
  type: StudioType | null;
};

type Step = "source" | "motion";

const STYLES = animateStyles();
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

function StepPills({ step, onSource }: { step: Step; onSource: () => void }) {
  const pill =
    "inline-flex h-9 items-center rounded-full px-4 text-[13px] font-semibold transition";
  return (
    <div
      role="list"
      aria-label="Steps"
      className="mx-auto flex w-fit items-center gap-1 rounded-full bg-[var(--ds-well-bg)] p-1"
    >
      <button
        role="listitem"
        type="button"
        onClick={onSource}
        aria-current={step === "source" ? "step" : undefined}
        className={cn(
          pill,
          step === "source"
            ? "bg-[var(--ds-card-bg)] text-foreground shadow-[var(--ds-card-shadow)]"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        1. Source
      </button>
      <span
        role="listitem"
        aria-current={step === "motion" ? "step" : undefined}
        className={cn(
          pill,
          step === "motion"
            ? "bg-[var(--ds-card-bg)] text-foreground shadow-[var(--ds-card-shadow)]"
            : "text-muted-foreground",
        )}
      >
        2. Motion
      </span>
    </div>
  );
}

/** Presentational: `AnimateFlow` wires it, `/home-lab?scene=animate` shows it. */
export function AnimateFlowView({
  step,
  pictures,
  error,
  chosen,
  style,
  note,
  lock,
  onStep,
  onPick,
  onStyle,
  onNote,
  onRetry,
  onSeeLibrary,
  onOpenStudio,
  onMeasured,
  onUpload,
  uploading = false,
}: {
  step: Step;
  /** null while loading. */
  pictures: AnimatePicture[] | null;
  error: string | null;
  chosen: AnimatePicture | null;
  style: RepurposeTarget | null;
  note: string;
  /** The plan video needs, when this one can't make videos yet. */
  lock: PlanId | null;
  onStep: (step: Step) => void;
  onPick: (picture: AnimatePicture) => void;
  onStyle: (style: RepurposeTarget) => void;
  onNote: (note: string) => void;
  onRetry: () => void;
  onSeeLibrary: () => void;
  onOpenStudio: () => void;
  onMeasured?: (img: HTMLImageElement) => void;
  /** A new picture from this device (Holo's "Upload or pick your visual"). */
  onUpload?: (file: File) => void;
  uploading?: boolean;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const pickFile = () => file.current?.click();
  const take = (files: FileList | null | undefined) => {
    const f = Array.from(files ?? []).find((x) => PHOTO_TYPES.includes(x.type));
    if (f) onUpload?.(f);
  };
  const scroll = (by: number) =>
    strip.current?.scrollBy({ left: by * (strip.current.clientWidth * 0.8), behavior: "smooth" });

  return (
    <div className="relative flex min-h-full flex-col">
      <StepPills step={step} onSource={() => onStep("source")} />

      {step === "source" ? (
        <div className="ds-enter mx-auto mt-6 w-full max-w-[560px] flex-1">
          <div className="ds-card p-4">
            <p className="mb-3 text-[13px] font-semibold text-foreground/80">
              Upload or pick your visual
            </p>
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
            {/* The chosen picture, big; also where a picture is dropped. */}
            <div
              onDragOver={(e) => {
                if (!onUpload) return;
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                if (!onUpload) return;
                e.preventDefault();
                setOver(false);
                take(e.dataTransfer.files);
              }}
              className={cn(
                "relative grid h-[220px] place-items-center rounded-[18px] bg-[var(--ds-well-bg)] transition sm:h-[240px]",
                over && "outline-dashed outline-2 outline-offset-[-6px] outline-[var(--mox-green)]",
              )}
            >
              {uploading ? (
                <p className="flex items-center gap-2 text-[12.5px] font-semibold text-muted-foreground">
                  <span className="size-2 animate-pulse rounded-full [background:var(--mox-gradient)]" />
                  Uploading…
                </p>
              ) : chosen ? (
                <img
                  key={chosen.assetId}
                  src={chosen.url}
                  alt={chosen.title ?? "Chosen picture"}
                  onLoad={(e) => onMeasured?.(e.currentTarget)}
                  className="ds-enter max-h-[200px] max-w-[85%] rounded-xl object-contain shadow-[0_18px_40px_-18px_rgb(0_0_0/0.45)] ring-2 ring-[var(--mox-green)] sm:max-h-[220px]"
                />
              ) : onUpload ? (
                <button
                  type="button"
                  onClick={pickFile}
                  className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-[18px] text-center text-muted-foreground transition hover:text-foreground"
                >
                  <span className="grid size-11 place-items-center rounded-full bg-[var(--ds-card-bg)] shadow-[var(--ds-card-shadow)]">
                    <Upload className="size-5" />
                  </span>
                  <span className="text-[13px] font-semibold">
                    Drop a picture or click to upload
                  </span>
                  <span className="text-[11px]">JPG, PNG or WebP · up to 100 MB</span>
                </button>
              ) : (
                <p className="px-6 text-center text-[12.5px] text-muted-foreground">
                  Choose one of your pictures below.
                </p>
              )}
              {onUpload && chosen && !uploading ? (
                <button
                  type="button"
                  onClick={pickFile}
                  className="absolute bottom-2.5 right-2.5 inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] px-3 text-[12px] font-semibold shadow-[var(--ds-card-shadow)] transition hover:-translate-y-px"
                >
                  <Upload className="size-3.5" />
                  Upload
                </button>
              ) : null}
            </div>

            <p className="mb-2 mt-4 text-center text-[12.5px] font-semibold text-muted-foreground">
              Or pick from library
            </p>
            {error ? (
              <ErrorState
                title="Couldn't load your pictures"
                description={error}
                onRetry={onRetry}
              />
            ) : pictures === null ? (
              <div className="flex gap-2 overflow-hidden">
                {Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} className="h-[92px] w-[74px] shrink-0 rounded-xl" />
                ))}
              </div>
            ) : pictures.length === 0 ? (
              <EmptyState
                icon={Sparkles}
                title="No pictures in your Library yet"
                description={
                  onUpload
                    ? "Upload one above, or make a post first."
                    : "Make a post first, then bring it to life here."
                }
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
              <>
                <div
                  ref={strip}
                  role="listbox"
                  aria-label="Your pictures"
                  className="flex snap-x gap-2 overflow-x-auto scroll-smooth pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  {pictures.map((p, i) => {
                    const on = chosen?.assetId === p.assetId;
                    return (
                      <button
                        key={p.assetId}
                        type="button"
                        role="option"
                        aria-selected={on}
                        aria-label={p.title ?? `Picture ${i + 1}`}
                        onClick={() => onPick(p)}
                        style={rise(i)}
                        className={cn(
                          "ds-rise relative h-[92px] w-[74px] shrink-0 snap-start overflow-hidden rounded-xl bg-[var(--ds-well-bg)] transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                          on
                            ? "ring-2 ring-[var(--mox-green)] ring-offset-2 ring-offset-[var(--ds-card-bg)]"
                            : "ring-1 ring-[var(--ds-card-border)]",
                        )}
                      >
                        <img
                          src={p.url}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => scroll(-1)}
                      aria-label="Earlier pictures"
                      className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-[var(--ds-well-bg)] hover:text-foreground"
                    >
                      <ChevronLeft className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => scroll(1)}
                      aria-label="More pictures"
                      className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-[var(--ds-well-bg)] hover:text-foreground"
                    >
                      <ChevronRight className="size-4" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={onSeeLibrary}
                    className="rounded-full px-2.5 py-1 text-[12px] font-semibold text-muted-foreground hover:bg-[var(--ds-well-bg)] hover:text-foreground"
                  >
                    See more
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="ds-enter mx-auto mt-6 grid w-full max-w-[880px] flex-1 grid-cols-1 gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div className="grid place-items-start justify-center md:justify-start">
            {chosen && (
              <img
                src={chosen.url}
                alt={chosen.title ?? "Chosen picture"}
                className="max-h-[52dvh] w-auto max-w-full rounded-[18px] object-contain shadow-[0_24px_50px_-24px_rgb(0_0_0/0.5)]"
              />
            )}
          </div>
          <div className="min-w-0">
            <label htmlFor="animate-note" className="text-[13px] font-semibold text-foreground/80">
              Explain your idea
            </label>
            <textarea
              id="animate-note"
              value={note}
              onChange={(e) => onNote(e.target.value)}
              rows={4}
              maxLength={600}
              placeholder="e.g. A slow splash around the can, gentle ripples in the pool, a warm lens flare from the sun."
              className="ds-card mt-1.5 w-full resize-none p-3.5 text-[13.5px] leading-relaxed placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            />
            <p className="mb-2 mt-4 text-[13px] font-semibold text-foreground/80">
              Or use one of these angles
            </p>
            <div
              role="radiogroup"
              aria-label="How it moves"
              className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2"
            >
              {STYLES.map((s, i) => {
                const on = style?.videoKind === s.videoKind;
                return (
                  <button
                    key={s.videoKind}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => onStyle(s)}
                    style={rise(i)}
                    className={cn(
                      "ds-card ds-card-hover ds-rise p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                      on &&
                        "!border-[var(--mox-green)] bg-[color-mix(in_srgb,var(--mox-lime)_14%,var(--ds-card-bg))] shadow-[0_0_0_1px_var(--mox-green)]",
                    )}
                  >
                    <span className="block text-[13.5px] font-bold tracking-[-0.01em]">
                      {s.label}
                    </span>
                    <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
                      {s.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Holo's pill, bottom right. It sits under the content, never on it. */}
      <div className="mt-6 flex flex-col items-end gap-1.5 pb-1">
        {step === "source" ? (
          <button
            type="button"
            disabled={!chosen}
            onClick={() => onStep("motion")}
            className="studio-cta inline-flex h-11 items-center gap-1.5 rounded-full px-5 text-[13.5px] font-bold disabled:cursor-not-allowed disabled:opacity-50"
          >
            Continue
            <ArrowRight className="size-4" />
          </button>
        ) : (
          <button
            type="button"
            disabled={!chosen || !style}
            onClick={onOpenStudio}
            className="studio-cta inline-flex h-11 items-center gap-1.5 rounded-full px-5 text-[13.5px] font-bold disabled:cursor-not-allowed disabled:opacity-50"
          >
            {lock ? <PlanLock plan={lock} /> : null}
            Open in Studio
            <ArrowRight className="size-4" />
          </button>
        )}
        {step === "motion" && (
          <p className="text-right text-[11.5px] text-muted-foreground">
            Nothing is made yet. You see the price in Studio.
          </p>
        )}
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
  const [step, setStep] = useState<Step>("source");
  const [pictures, setPictures] = useState<AnimatePicture[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<AnimatePicture | null>(null);
  const [style, setStyle] = useState<RepurposeTarget | null>(STYLES[0] ?? null);
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const ratio = useRef<string | undefined>(undefined);

  /** A picture from this device goes into the Library first (free), then is chosen. */
  const upload = async (f: File) => {
    if (!workspaceId || uploading) return;
    if (f.size > MAX_PHOTO_BYTES) {
      toast.error(`${f.name}: choose a photo under 100 MB.`);
      return;
    }
    setUploading(true);
    try {
      const done = await uploadStudioMedia(workspaceId, f, "photo");
      const picture: AnimatePicture = {
        assetId: done.id,
        url: done.url ?? URL.createObjectURL(f),
        title: f.name.replace(/\.[a-z0-9]+$/i, ""),
        postId: null,
        type: null,
      };
      ratio.current = undefined;
      setPictures((list) => [picture, ...(list ?? [])]);
      setChosen(picture);
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
      setChosen((c) => c ?? list[0] ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    }
  }, [workspaceId]);

  useEffect(() => {
    const onOpen = () => {
      setStep("source");
      setNote("");
      setStyle(STYLES[0] ?? null);
      setChosen(null);
      ratio.current = undefined;
      setOpen(true);
      void load();
    };
    addAppEventListener("open:animate", onOpen);
    return () => removeAppEventListener("open:animate", onOpen);
  }, [load]);

  const openStudio = () => {
    if (!chosen || !style) return;
    if (lock) {
      setOpen(false);
      openFeatureUpgrade("ugc");
      return;
    }
    const opts = animateOpen({
      picture: { ...chosen, ratio: ratio.current },
      target: style,
      note,
    });
    if (openComposer(opts)) setOpen(false);
  };

  return (
    <AppModalShell
      navId="home"
      open={open}
      onOpenChange={setOpen}
      size="lg"
      Icon={Sparkles}
      title="Animate"
      srDescription="Pick a picture from your library, then choose how it moves."
      headerAccessory={
        step === "motion" ? (
          <button
            type="button"
            onClick={() => setStep("source")}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] px-3.5 text-[13px] font-semibold shadow-[var(--ds-card-shadow)] transition hover:-translate-x-0.5 lg:min-h-9"
          >
            <ArrowLeft className="size-4" />
            Back
          </button>
        ) : null
      }
      bodyClassName="px-4 pb-4 pt-2 sm:px-6 sm:pb-5"
    >
      <AnimateFlowView
        step={step}
        pictures={pictures}
        error={error}
        chosen={chosen}
        style={style}
        note={note}
        lock={lock}
        onStep={(s) => (s === "motion" && !chosen ? undefined : setStep(s))}
        onPick={(p) => {
          ratio.current = undefined;
          setChosen(p);
        }}
        onStyle={setStyle}
        onNote={setNote}
        onRetry={() => void load()}
        onSeeLibrary={() => {
          setOpen(false);
          emitAppEvent("open:library");
        }}
        onOpenStudio={openStudio}
        onMeasured={(img) => {
          ratio.current = ratioOf(img);
        }}
        onUpload={(f) => void upload(f)}
        uploading={uploading}
      />
    </AppModalShell>
  );
}
