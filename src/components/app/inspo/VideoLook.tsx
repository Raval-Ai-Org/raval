"use client";

// Inspo → Video look: the brand face, the video styles and creator formats it
// likes, hook words, pace, captions, shots, transitions, sound and motion
// (`dna.look.video`). Chips write the look's plain-word fields, so Studio's
// video prompts and the creator studio read them the same way.
import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Switch } from "@/components/ui/switch";
import { dsFocus } from "@/components/app/surface/buttons";
import { VideoPreview } from "@/components/app/brain/brand/look/preview";
import type { BrandLook } from "@/lib/brand-look/resolve";
import type { BrandLookSpec, VideoStyle } from "@/lib/brand-look/spec";
import { CreatorFace } from "@/components/app/ugc/CreatorPortrait";
import { HookTextSample } from "@/components/app/ugc/HookTextSample";
import { Check, Play, Plus, User } from "@/components/icons";
import { emitAppEvent } from "@/lib/app-events";
import type { InspoCard } from "@/lib/inspo/board";
import { RETIRED_VIDEO_KINDS, VIDEO_KINDS } from "@/lib/studio/video/kinds";
import { creatorsInOrder, stockCreator } from "@/lib/ugc/creators";
import { UGC_FORMATS, UGC_FORMAT_GROUPS } from "@/lib/ugc/formats/formats";
import { HOOK_TEXT_PRESETS } from "@/lib/ugc/hook-text";
import { cn } from "@/lib/utils";
import { Block, EASE } from "./parts";
import { FineTune, LivePreview, Row } from "./PostLook";
import type { InspoHandlers } from "./types";

const PACES: Array<{ value: NonNullable<VideoStyle["pacing"]>; label: string; beat: number }> = [
  { value: "slow", label: "Slow", beat: 1.6 },
  { value: "steady", label: "Steady", beat: 0.9 },
  { value: "fast", label: "Fast", beat: 0.4 },
];

const POSITIONS = [
  { value: "top", label: "Top" },
  { value: "center", label: "Middle" },
  { value: "bottom", label: "Bottom" },
] as const;

/** Chips that write the look's plain-word fields (shots, transitions, music…). */
const SHOTS = [
  "Handheld phone",
  "Close-up details",
  "Wide establishing",
  "Top-down",
  "Slow motion",
  "Over the shoulder",
];
const TRANSITIONS = [
  "Hard cuts",
  "Jump cuts",
  "Whip pans",
  "Match cuts",
  "Soft dissolves",
  "Zoom punches",
];
const MUSIC = [
  "Upbeat pop",
  "Lo-fi chill",
  "Cinematic",
  "Acoustic",
  "Electronic",
  "Trending audio feel",
];
const OPENINGS = ["Hook in the first second", "Product first", "Face to camera", "Logo sting"];
const ENDINGS = [
  "Logo end card",
  "Call to action card",
  "Loop back to the start",
  "Product hero shot",
];
const CAPTION_STYLES = ["Bold pop-up words", "Clean subtitles", "Word by word", "Boxed captions"];
const VOICEOVER: Array<{ value: VideoStyle["voiceover"]; label: string }> = [
  { value: undefined, label: "Voiceover: Auto" },
  { value: "on", label: "Always a voiceover" },
  { value: "off", label: "No voiceover" },
];
const MAX_KINDS = 4;
const MAX_FORMATS = 6;

export function VideoLook({
  spec,
  resolved,
  handlers,
  people = [],
  canEdit = true,
}: {
  spec: BrandLookSpec;
  resolved: BrandLook;
  handlers: InspoHandlers;
  /** The brand's own people (Inspo → Media, Person), offered as the brand face. */
  people?: InspoCard[];
  canEdit?: boolean;
}) {
  const vid = spec.video ?? {};
  const set = (patch: Partial<VideoStyle>) =>
    handlers.saveLook({ ...spec, video: { ...spec.video, ...patch } });
  const captionsOff = vid.captions?.show === false;
  const position = vid.captions?.position ?? "bottom";
  const palette = resolved.visual.palette;
  const hookOn = vid.hookText?.on !== false;

  const [group, setGroup] = React.useState<string>(UGC_FORMAT_GROUPS[0]?.id ?? "");
  const kinds = vid.kinds ?? [];
  const formats = vid.formats ?? [];
  const toggleKind = (id: string) => {
    const next = kinds.includes(id)
      ? kinds.filter((k) => k !== id)
      : [...kinds, id].slice(-MAX_KINDS);
    set({ kinds: next.length ? next : undefined });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="min-w-0 space-y-4">
        <BrandFace
          creator={vid.creator}
          people={people}
          canEdit={canEdit}
          onPick={(creator) => set({ creator })}
          onUpload={(files) => handlers.upload(files, "person")}
          onMore={() => emitAppEvent("open:ugc-studio", undefined)}
          onRemove={() => set({ creator: undefined })}
        />

        <Block
          label="Video styles"
          aside={
            <span className="text-[11.5px] font-medium text-muted-foreground">
              {kinds.length ? `${kinds.length} of ${MAX_KINDS}` : `Up to ${MAX_KINDS}`}
            </span>
          }
        >
          <p className="mb-3 text-xs text-muted-foreground">
            Every video plan Mox writes leans on these. None picked: Mox chooses per video.
          </p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
            {VIDEO_KINDS.filter(
              (k) => k.id !== "motion-graphics" && !RETIRED_VIDEO_KINDS.includes(k.id),
            ).map((k, i) => (
              <KindCard
                key={k.id}
                id={k.id}
                label={k.label}
                hint={k.hint}
                index={i}
                order={kinds.indexOf(k.id) + 1}
                onClick={() => toggleKind(k.id)}
              />
            ))}
          </div>
        </Block>

        <Block
          label="Creator video formats"
          aside={
            <span className="text-[11.5px] font-medium text-muted-foreground">
              {formats.length ? `${formats.length} of ${MAX_FORMATS}` : `Up to ${MAX_FORMATS}`}
            </span>
          }
        >
          <p className="mb-3 text-xs text-muted-foreground">
            They come first under &ldquo;For your brand&rdquo; in the creator studio.
          </p>
          <div className="mb-3 flex gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none]">
            {UGC_FORMAT_GROUPS.map((g) => {
              const on = g.id === group;
              const picked = UGC_FORMATS.filter(
                (f) => f.group === g.id && formats.includes(f.id),
              ).length;
              return (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setGroup(g.id)}
                  className={cn(
                    "relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-semibold transition-colors",
                    on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                    dsFocus,
                  )}
                >
                  {on && (
                    <motion.span
                      layoutId="inspo-ugc-group"
                      className="absolute inset-0 rounded-full bg-[var(--ds-well-bg)] ring-1 ring-primary/30"
                      transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    />
                  )}
                  <span className="relative">{g.label}</span>
                  {picked > 0 && (
                    <span className="relative grid size-[18px] place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                      {picked}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={group}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.22, ease: EASE }}
              className="grid grid-cols-1 gap-2 sm:grid-cols-2"
            >
              {UGC_FORMATS.filter((f) => f.group === group).map((f) => {
                const on = formats.includes(f.id);
                const full = !on && formats.length >= MAX_FORMATS;
                return (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={on}
                    disabled={full}
                    onClick={() => {
                      const next = on ? formats.filter((x) => x !== f.id) : [...formats, f.id];
                      set({ formats: next.length ? next : undefined });
                    }}
                    className={cn(
                      "flex items-start gap-2.5 rounded-[16px] bg-[var(--ds-well-bg)] px-3 py-2.5 text-left ring-1 transition-all disabled:opacity-45",
                      on ? "ring-2 ring-primary" : "ring-transparent hover:ring-primary/30",
                      dsFocus,
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full ring-1 transition-colors",
                        on
                          ? "bg-primary text-primary-foreground ring-primary"
                          : "ring-foreground/20",
                      )}
                    >
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-semibold">{f.label}</span>
                      {f.hint && (
                        <span className="block text-[11px] leading-snug text-muted-foreground">
                          {f.hint}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </motion.div>
          </AnimatePresence>
        </Block>

        <Block
          label="Hook words"
          aside={
            <Switch
              checked={hookOn}
              onCheckedChange={(on) =>
                set({ hookText: { ...vid.hookText, on: on ? undefined : false } })
              }
              aria-label="Words over the first seconds"
            />
          }
        >
          <p className="mb-3 text-xs text-muted-foreground">
            Big words over the first seconds, so people stop scrolling.
          </p>
          {hookOn && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {HOOK_TEXT_PRESETS.map((p) => {
                const on = vid.hookText?.preset === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={on}
                    title={p.hint}
                    onClick={() =>
                      set({ hookText: { ...vid.hookText, preset: on ? undefined : p.id } })
                    }
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-[16px] bg-[var(--ds-well-bg)] p-2 ring-1 transition-all hover:-translate-y-0.5",
                      on ? "ring-2 ring-primary" : "ring-transparent hover:ring-primary/30",
                      dsFocus,
                    )}
                  >
                    <span className="grid h-14 w-full place-items-center overflow-hidden rounded-[10px] bg-foreground/85">
                      <HookTextSample
                        preset={p.id}
                        text="Wait for it"
                        size="sm"
                        accent={palette.accent ?? palette.primary ?? undefined}
                      />
                    </span>
                    <span className="text-[11.5px] font-semibold">{p.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </Block>

        <div className="grid gap-4 md:grid-cols-2">
          <Block label="Pace and voice">
            <div className="grid grid-cols-3 gap-2">
              {PACES.map((p) => {
                const on = vid.pacing === p.value;
                return (
                  <button
                    key={p.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set({ pacing: on ? undefined : p.value })}
                    className={cn(
                      "flex flex-col items-center gap-2.5 rounded-[18px] bg-[var(--ds-well-bg)] px-2 py-3.5 ring-1 transition-all hover:-translate-y-0.5",
                      on ? "ring-2 ring-primary" : "ring-transparent hover:ring-primary/30",
                      dsFocus,
                    )}
                  >
                    {/* Bars that move at the chosen pace. */}
                    <span className="flex h-8 items-end gap-1" aria-hidden>
                      {[0, 1, 2, 3, 4].map((i) => (
                        <motion.span
                          key={i}
                          className={cn(
                            "w-1.5 rounded-full",
                            on ? "bg-primary" : "bg-foreground/30",
                          )}
                          animate={{ height: ["30%", "100%", "45%", "80%", "30%"] }}
                          transition={{
                            duration: p.beat * 2,
                            repeat: Infinity,
                            delay: i * p.beat * 0.2,
                            ease: "easeInOut",
                          }}
                        />
                      ))}
                    </span>
                    <span className="text-[12.5px] font-semibold">{p.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {VOICEOVER.map((o) => (
                <Pill
                  key={o.label}
                  on={vid.voiceover === o.value}
                  onClick={() => set({ voiceover: o.value })}
                >
                  {o.label}
                </Pill>
              ))}
            </div>
          </Block>

          <Block
            label="Captions"
            aside={
              <Switch
                checked={!captionsOff}
                onCheckedChange={(show) => set({ captions: { ...vid.captions, show } })}
                aria-label="Captions on videos"
              />
            }
          >
            <div className="flex items-start gap-4">
              {/* Tap where captions go on a phone. */}
              <div
                className={cn(
                  "relative flex h-[150px] w-[84px] shrink-0 flex-col justify-between rounded-[20px] bg-foreground/90 p-1.5 ring-4 ring-[var(--ds-well-bg-hover)] transition-opacity",
                  captionsOff && "opacity-40",
                )}
              >
                {POSITIONS.map((p) => {
                  const on = !captionsOff && position === p.value;
                  return (
                    <button
                      key={p.value}
                      type="button"
                      aria-label={`Captions ${p.label.toLowerCase()}`}
                      aria-pressed={on}
                      onClick={() =>
                        set({ captions: { ...vid.captions, show: true, position: p.value } })
                      }
                      className={cn(
                        "relative h-10 rounded-[10px] transition-colors hover:bg-white/10",
                        dsFocus,
                      )}
                    >
                      {on && (
                        <motion.span
                          layoutId="inspo-caption-pos"
                          transition={{ type: "spring", stiffness: 420, damping: 32 }}
                          className="absolute inset-x-1.5 top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-primary"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
              {!captionsOff ? (
                <div className="min-w-0 flex-1 space-y-3">
                  <TextChips
                    options={CAPTION_STYLES}
                    value={vid.captions?.style}
                    single
                    onChange={(style) => set({ captions: { ...vid.captions, style } })}
                  />
                  <Swatches
                    label="Highlight"
                    colours={[
                      palette.primary,
                      palette.secondary,
                      palette.accent,
                      "#ffe14d",
                      "#ffffff",
                    ]}
                    value={vid.captions?.highlight}
                    onChange={(highlight) => set({ captions: { ...vid.captions, highlight } })}
                  />
                </div>
              ) : (
                <p className="pt-2 text-xs text-muted-foreground">No captions on your videos.</p>
              )}
            </div>
          </Block>
        </div>

        <FineTune>
          <Row label="Shots">
            <TextChips options={SHOTS} value={vid.shots} onChange={(shots) => set({ shots })} />
          </Row>
          <Row label="Transitions">
            <TextChips
              options={TRANSITIONS}
              value={vid.transitions}
              onChange={(transitions) => set({ transitions })}
            />
          </Row>
          <Row label="Opening">
            <TextChips options={OPENINGS} value={vid.intro} onChange={(intro) => set({ intro })} />
          </Row>
          <Row label="Ending">
            <TextChips options={ENDINGS} value={vid.outro} onChange={(outro) => set({ outro })} />
          </Row>
          <Row label="Music">
            <TextChips options={MUSIC} value={vid.music} onChange={(music) => set({ music })} />
          </Row>
          <Row label="Anything else">
            <NotesBox
              value={vid.notes ?? ""}
              onSave={(notes) => set({ notes: notes || undefined })}
            />
          </Row>
        </FineTune>
      </div>

      <LivePreview stamp={JSON.stringify(vid)}>
        <VideoPreview resolved={resolved} />
      </LivePreview>
    </div>
  );
}

/** A real Mellox post or reel per video style, moving the way the style moves. */
const KIND_ART: Record<string, { poster: string; video?: string; move: keyof typeof MOVES }> = {
  "living-picture": { poster: "/Home/wall/burger-1.webp", move: "zoom" },
  "product-motion": { poster: "/Home/wall/sunscreen-5.webp", move: "pop" },
  "motion-post": { poster: "/Home/wall/reel-4.webp", video: "/Home/wall/reel-4.mp4", move: "zoom" },
  "product-showcase": { poster: "/Home/wall/burger-2.webp", move: "pan" },
  "brand-story": { poster: "/Home/wall/milk-4.webp", move: "pan" },
  "how-it-works": { poster: "/Home/wall/wallet-3.webp", move: "tilt" },
  "mood-broll": { poster: "/Home/wall/build-3.webp", move: "pan" },
  "product-demo": { poster: "/Home/wall/wallet-1.webp", move: "tilt" },
  "broll-hook": { poster: "/Home/wall/reel-2.webp", video: "/Home/wall/reel-2.mp4", move: "zoom" },
  "offer-teaser": { poster: "/Home/wall/reel-1.webp", video: "/Home/wall/reel-1.mp4", move: "pop" },
};

const MOVES = {
  zoom: { scale: [1, 1.12] },
  pan: { scale: [1.12, 1.12], x: ["-4%", "4%"] },
  tilt: { scale: [1.1, 1.1], y: ["4%", "-4%"] },
  pop: { scale: [1, 1.08, 1.02], rotate: [0, -2, 0] },
};

function KindCard({
  id,
  label,
  hint,
  index,
  order,
  onClick,
}: {
  id: string;
  label: string;
  hint?: string;
  index: number;
  order: number;
  onClick: () => void;
}) {
  const reduce = useReducedMotion();
  const [hover, setHover] = React.useState(false);
  const video = React.useRef<HTMLVideoElement>(null);
  const art = KIND_ART[id];
  const on = order > 0;
  React.useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (hover && !reduce) void v.play().catch(() => {});
    else v.pause();
  }, [hover, reduce]);
  return (
    <motion.button
      type="button"
      aria-pressed={on}
      title={hint}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index, 10) * 0.035, ease: EASE }}
      whileTap={{ scale: 0.97 }}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-[20px] bg-[var(--ds-tile-bg)] text-left ring-1 transition-shadow",
        on
          ? "ring-2 ring-primary shadow-[0_12px_30px_-16px_hsl(var(--primary)/0.9)]"
          : "ring-[var(--ds-tile-border)] hover:ring-primary/40",
        dsFocus,
      )}
    >
      <span className="relative block aspect-[9/14] w-full overflow-hidden bg-foreground/90">
        {art && (
          <motion.span
            className="absolute inset-0"
            animate={hover && !reduce ? MOVES[art.move] : { scale: 1, x: 0, y: 0, rotate: 0 }}
            transition={
              hover && !reduce
                ? { duration: 2.4, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" }
                : { duration: 0.4 }
            }
          >
            <img src={art.poster} alt="" loading="lazy" className="size-full object-cover" />
            {art.video && (
              <video
                ref={video}
                src={art.video}
                muted
                loop
                playsInline
                preload="none"
                className={cn(
                  "absolute inset-0 size-full object-cover transition-opacity duration-300",
                  hover ? "opacity-100" : "opacity-0",
                )}
              />
            )}
          </motion.span>
        )}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" />
        <span className="absolute bottom-2 left-2.5 right-2.5 text-[12.5px] font-semibold leading-tight text-white">
          {label}
        </span>
        <span className="absolute left-2 top-2 grid size-6 place-items-center rounded-full bg-black/40 text-white backdrop-blur">
          <Play className="h-3 w-3" />
        </span>
        <AnimatePresence>
          {on && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={{ type: "spring", stiffness: 460, damping: 22 }}
              className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground shadow"
            >
              {order}
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </motion.button>
  );
}

/** A free-text note saved when the person stops typing, not on every key. */
function NotesBox({ value, onSave }: { value: string; onSave: (value: string) => void }) {
  const [text, setText] = React.useState(value);
  const saved = React.useRef(value);
  const save = React.useRef(onSave);
  save.current = onSave;
  React.useEffect(() => {
    if (value !== saved.current) {
      saved.current = value;
      setText(value);
    }
  }, [value]);
  React.useEffect(() => {
    if (text === saved.current) return;
    const t = setTimeout(() => {
      saved.current = text;
      save.current(text);
    }, 700);
    return () => clearTimeout(t);
  }, [text]);
  return (
    <textarea
      className={cn(dsFocus, "ds-well w-full resize-none px-4 py-3 text-[13.5px]")}
      rows={3}
      maxLength={600}
      placeholder="Slow push-ins, soft cuts, warm music…"
      value={text}
      onChange={(e) => setText(e.target.value)}
    />
  );
}

/** The one creator every Creator video uses: a ready-made creator or one of the brand's people. */
function BrandFace({
  creator,
  people,
  canEdit,
  onPick,
  onUpload,
  onMore,
  onRemove,
}: {
  creator: VideoStyle["creator"];
  people: InspoCard[];
  canEdit: boolean;
  onPick: (creator: NonNullable<VideoStyle["creator"]>) => void;
  onUpload: (files: File[]) => void;
  onMore: () => void;
  onRemove: () => void;
}) {
  const file = React.useRef<HTMLInputElement>(null);
  const stock = stockCreator(creator?.id);
  const own = people.find((p) => p.assetId === creator?.personAssetId);
  const name = stock?.name ?? creator?.name ?? (creator?.personAssetId ? "Your person" : null);
  const ready = creatorsInOrder().slice(0, 11);
  const tile = (on: boolean) =>
    cn(
      "relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-[var(--ds-well-bg)] ring-1 transition-all hover:-translate-y-0.5 disabled:opacity-50",
      on ? "ring-2 ring-primary" : "ring-transparent hover:ring-primary/30",
      dsFocus,
    );
  return (
    <Block label="Brand face">
      <div className="flex items-center gap-3">
        <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-[var(--ds-well-bg)]">
          {stock ? (
            <CreatorFace creator={stock} />
          ) : own?.thumbUrl ? (
            <img src={own.thumbUrl} alt="" className="size-full object-cover" />
          ) : (
            <User className="size-5 text-muted-foreground" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-semibold">{name ?? "No brand face yet"}</p>
          <p className="text-xs text-muted-foreground">
            {name
              ? "Every creator video uses this person, so your brand has one face."
              : "Pick one creator for all your creator videos, or add your own person."}
          </p>
        </div>
        {name ? (
          <button
            type="button"
            disabled={!canEdit}
            onClick={onRemove}
            className={cn(
              "h-9 shrink-0 rounded-full px-3 text-[13px] text-muted-foreground hover:text-foreground",
              dsFocus,
            )}
          >
            Remove
          </button>
        ) : null}
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => file.current?.click()}
          className={cn(tile(false), "flex flex-col gap-0.5 border border-dashed border-border")}
          aria-label="Add your own person"
        >
          <Plus className="size-4 text-muted-foreground" />
          <span className="text-[10px] font-semibold text-muted-foreground">Your own</span>
        </button>
        <input
          ref={file}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            if (files.length) onUpload(files);
            e.target.value = "";
          }}
        />
        {people
          .filter((p) => p.kind === "image")
          .map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={!canEdit}
              aria-pressed={creator?.personAssetId === p.assetId}
              aria-label={`Use ${p.label || "this person"}`}
              title={p.label || "Your person"}
              onClick={() =>
                onPick({ personAssetId: p.assetId, name: (p.label || "Your person").slice(0, 60) })
              }
              className={tile(creator?.personAssetId === p.assetId)}
            >
              {p.thumbUrl ? (
                <img src={p.thumbUrl} alt="" className="size-full object-cover" />
              ) : (
                <User className="size-5 text-muted-foreground" />
              )}
            </button>
          ))}
        {ready.map((c) => (
          <button
            key={c.id}
            type="button"
            disabled={!canEdit}
            aria-pressed={creator?.id === c.id}
            aria-label={`Use ${c.name}`}
            title={`${c.name}: ${c.tagline}`}
            onClick={() => onPick({ id: c.id, name: c.name })}
            className={tile(creator?.id === c.id)}
          >
            <CreatorFace creator={c} />
          </button>
        ))}
        <button
          type="button"
          onClick={onMore}
          className={cn(tile(false), "text-[11px] font-semibold text-muted-foreground")}
        >
          More…
        </button>
      </div>
      <p className="mt-1.5 text-[11.5px] text-muted-foreground">
        Your own person is saved as an Inspo &ldquo;Person&rdquo; photo. Only use people who agreed
        to be in your videos.
      </p>
    </Block>
  );
}

function Pill({
  on,
  onClick,
  children,
  title,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "h-8 rounded-full px-3.5 text-[12.5px] font-semibold transition-all disabled:opacity-40",
        on
          ? "bg-primary/15 text-foreground ring-1 ring-primary/40"
          : "ds-well text-muted-foreground hover:text-foreground",
        dsFocus,
      )}
    >
      {children}
    </button>
  );
}

/**
 * Chips that write one plain-word field ("Hard cuts, Whip pans"). Words a
 * person typed there before are kept; a chip only adds or removes itself.
 * `single` keeps at most one of the chips (other typed words stay).
 */
function TextChips({
  options,
  value,
  onChange,
  single,
}: {
  options: readonly string[];
  value: string | undefined;
  onChange: (next: string | undefined) => void;
  single?: boolean;
}) {
  const parts = (value ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const has = (o: string) => parts.some((p) => same(p, o));
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <Pill
          key={o}
          on={has(o)}
          onClick={() => {
            const next = has(o)
              ? parts.filter((p) => !same(p, o))
              : single
                ? [...parts.filter((p) => !options.some((x) => same(x, p))), o]
                : [...parts, o];
            onChange(next.length ? next.join(", ").slice(0, 160) : undefined);
          }}
        >
          {o}
        </Pill>
      ))}
    </div>
  );
}

function Swatches({
  label,
  colours,
  value,
  onChange,
}: {
  label: string;
  colours: (string | null | undefined)[];
  value: string | undefined;
  onChange: (next: string | undefined) => void;
}) {
  const list = [...new Set(colours.filter((c): c is string => !!c).map((c) => c.toLowerCase()))];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[12px] font-semibold text-muted-foreground">{label}</span>
      {list.map((c) => {
        const on = value?.toLowerCase() === c;
        return (
          <button
            key={c}
            type="button"
            aria-label={`${label} ${c}`}
            aria-pressed={on}
            onClick={() => onChange(on ? undefined : c)}
            className={cn(
              "size-7 rounded-full ring-1 ring-border transition-transform hover:scale-110",
              on && "ring-2 ring-foreground ring-offset-2",
              dsFocus,
            )}
            style={{ background: c }}
          />
        );
      })}
    </div>
  );
}
