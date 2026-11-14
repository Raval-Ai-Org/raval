"use client";

// Inspo → Video look: the brand face, the video styles and creator formats it
// likes, hook words, pace, captions, shots, transitions, sound and motion
// (`dna.look.video`). Chips write the look's plain-word fields, so Studio's
// video prompts and the creator studio read them the same way.
import * as React from "react";
import { motion } from "framer-motion";
import { dsFocus } from "@/components/app/surface/buttons";
import { VideoPreview } from "@/components/app/brain/brand/look/preview";
import type { BrandLook } from "@/lib/brand-look/resolve";
import type { BrandLookSpec, VideoStyle } from "@/lib/brand-look/spec";
import { CreatorFace } from "@/components/app/ugc/CreatorPortrait";
import { HookTextSample } from "@/components/app/ugc/HookTextSample";
import { Plus, User } from "@/components/icons";
import { emitAppEvent } from "@/lib/app-events";
import type { InspoCard } from "@/lib/inspo/board";
import { VIDEO_KINDS } from "@/lib/studio/video/kinds";
import { creatorsInOrder, stockCreator } from "@/lib/ugc/creators";
import { UGC_FORMATS, UGC_FORMAT_GROUPS } from "@/lib/ugc/formats/formats";
import { HOOK_TEXT_PRESETS } from "@/lib/ugc/hook-text";
import { cn } from "@/lib/utils";
import { Block, EASE } from "./parts";
import { LivePreview } from "./PostLook";
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

        <Block label="Video styles you like">
          <p className="mb-2.5 text-xs text-muted-foreground">
            Up to {MAX_KINDS}. Every video plan Mox writes keeps these in mind.
          </p>
          <ChipList
            options={VIDEO_KINDS.filter((k) => k.id !== "motion-graphics").map((k) => ({
              value: k.id,
              label: k.label,
              hint: k.hint,
            }))}
            selected={vid.kinds ?? []}
            max={MAX_KINDS}
            onChange={(kinds) => set({ kinds: kinds.length ? kinds : undefined })}
          />
        </Block>

        <Block label="Creator video formats">
          <p className="mb-2.5 text-xs text-muted-foreground">
            Up to {MAX_FORMATS}. They come first under &ldquo;For your brand&rdquo; in the creator
            studio.
          </p>
          <div className="space-y-3">
            {UGC_FORMAT_GROUPS.map((g) => (
              <div key={g.id}>
                <div className="mb-1.5 text-[11.5px] font-semibold text-muted-foreground">
                  {g.label}
                </div>
                <ChipList
                  options={UGC_FORMATS.filter((f) => f.group === g.id).map((f) => ({
                    value: f.id,
                    label: f.label,
                    hint: f.hint,
                  }))}
                  selected={vid.formats ?? []}
                  max={MAX_FORMATS}
                  onChange={(formats) => set({ formats: formats.length ? formats : undefined })}
                />
              </div>
            ))}
          </div>
        </Block>

        <Block label="Hook words">
          <div className="mb-3">
            <Pill
              on={hookOn}
              onClick={() => set({ hookText: { ...vid.hookText, on: hookOn ? false : undefined } })}
            >
              {hookOn ? "On" : "Off"} · Words over the first seconds
            </Pill>
          </div>
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

        <Block label="Pace">
          <div className="grid grid-cols-3 gap-2.5">
            {PACES.map((p) => {
              const on = vid.pacing === p.value;
              return (
                <button
                  key={p.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set({ pacing: on ? undefined : p.value })}
                  className={cn(
                    "flex flex-col items-center gap-3 rounded-[20px] bg-[var(--ds-well-bg)] px-3 py-4 ring-1 transition-all hover:-translate-y-0.5",
                    on ? "ring-2 ring-primary" : "ring-transparent hover:ring-primary/30",
                    dsFocus,
                  )}
                >
                  {/* Bars that move at the chosen pace. */}
                  <span className="flex h-8 items-end gap-1" aria-hidden>
                    {[0, 1, 2, 3, 4].map((i) => (
                      <motion.span
                        key={i}
                        className={cn("w-1.5 rounded-full", on ? "bg-primary" : "bg-foreground/30")}
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
                  <span className="text-[13px] font-semibold">{p.label}</span>
                </button>
              );
            })}
          </div>
        </Block>

        <Block label="Captions">
          <div className="flex flex-wrap items-center gap-5">
            {/* Tap where captions go on a phone. */}
            <div className="relative flex h-[188px] w-[106px] flex-col justify-between rounded-[22px] bg-foreground/90 p-2 ring-4 ring-[var(--ds-well-bg-hover)]">
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
                      "relative h-12 rounded-[12px] transition-colors hover:bg-white/10",
                      dsFocus,
                    )}
                  >
                    {on && (
                      <motion.span
                        layoutId="inspo-caption-pos"
                        transition={{ type: "spring", stiffness: 420, damping: 32 }}
                        className="absolute inset-x-2 top-1/2 h-3 -translate-y-1/2 rounded-full bg-primary"
                      />
                    )}
                  </button>
                );
              })}
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <Pill
                on={captionsOff}
                onClick={() => set({ captions: { ...vid.captions, show: captionsOff } })}
              >
                No captions
              </Pill>
              {!captionsOff && (
                <>
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
                </>
              )}
            </div>
          </div>
        </Block>

        <Block label="Shots">
          <TextChips options={SHOTS} value={vid.shots} onChange={(shots) => set({ shots })} />
        </Block>

        <Block label="Transitions">
          <TextChips
            options={TRANSITIONS}
            value={vid.transitions}
            onChange={(transitions) => set({ transitions })}
          />
        </Block>

        <Block label="Opening and ending">
          <div className="space-y-2.5">
            <TextChips options={OPENINGS} value={vid.intro} onChange={(intro) => set({ intro })} />
            <TextChips options={ENDINGS} value={vid.outro} onChange={(outro) => set({ outro })} />
          </div>
        </Block>

        <Block label="Sound">
          <div className="space-y-2.5">
            <TextChips options={MUSIC} value={vid.music} onChange={(music) => set({ music })} />
            <div className="flex flex-wrap gap-2">
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
          </div>
        </Block>

        <Block label="Motion">
          <motion.textarea
            layout
            className={cn(dsFocus, "ds-well w-full resize-none px-4 py-3 text-[13.5px]")}
            rows={3}
            maxLength={600}
            placeholder="Slow push-ins, soft cuts, warm music…"
            value={vid.notes ?? ""}
            onChange={(e) => set({ notes: e.target.value || undefined })}
            transition={{ ease: EASE }}
          />
        </Block>
      </div>

      <LivePreview stamp={JSON.stringify(vid)}>
        <VideoPreview resolved={resolved} />
      </LivePreview>
    </div>
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

/** Pick several ids, up to `max`. */
function ChipList({
  options,
  selected,
  max,
  onChange,
}: {
  options: { value: string; label: string; hint?: string }[];
  selected: readonly string[];
  max: number;
  onChange: (next: string[]) => void;
}) {
  const full = selected.length >= max;
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <Pill
            key={o.value}
            on={on}
            title={o.hint}
            disabled={!on && full}
            onClick={() =>
              onChange(on ? selected.filter((v) => v !== o.value) : [...selected, o.value])
            }
          >
            {o.label}
          </Pill>
        );
      })}
    </div>
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
