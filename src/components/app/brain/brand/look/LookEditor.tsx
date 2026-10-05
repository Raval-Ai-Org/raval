"use client";
// Look & voice — the one place a brand decides how everything Mellox makes
// should look and sound. Saved on Brand DNA as `dna.look`; whatever is left
// empty follows the brand's own colours, fonts and voice. No model call here.
import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Check, RotateCcw } from "@/components/icons";
import { dsFocus, dsGhostBtn } from "@/components/app/surface/buttons";
import type { BrandDna } from "@/hooks/use-brand-dna";
import { paletteFromDnaColors, resolveLook } from "@/lib/brand-look/resolve";
import {
  parseLook,
  type BrandLookSpec,
  type VideoStyle,
  type VisualStyle,
  type WritingStyle,
} from "@/lib/brand-look/spec";
import { PaletteEditor } from "./ColorPicker";
import { ChipsInput, Field, FontPicker, Segmented, ToneSlider } from "./controls";
import { MoodChips } from "./look";
import { LOOK_PRESETS, type LookPreset } from "./presets";
import {
  PostPreview,
  SlidePreview,
  Swatches,
  VideoPreview,
  paletteList,
  useLookFonts,
} from "./preview";

type Save = (patch: Partial<BrandDna>) => void;

const MEDIUMS: Array<{ value: NonNullable<VisualStyle["medium"]>; label: string; art: string }> = [
  {
    value: "photo",
    label: "Photo",
    art: "radial-gradient(circle at 30% 30%, #fff8 0 18%, transparent 19%), linear-gradient(135deg, #8aa 0%, #345 100%)",
  },
  {
    value: "illustration",
    label: "Drawn",
    art: "radial-gradient(circle at 70% 65%, #ffd166 0 26%, transparent 27%), radial-gradient(circle at 30% 35%, #ef476f 0 20%, transparent 21%), #f4f1de",
  },
  {
    value: "3d",
    label: "3D",
    art: "radial-gradient(circle at 38% 34%, #fff 0 6%, #b9c6ff 22%, #5b6ee1 60%, #2b2f77 100%)",
  },
  {
    value: "flat",
    label: "Flat",
    art: "linear-gradient(90deg, #264653 0 34%, #2a9d8f 34% 67%, #e9c46a 67% 100%)",
  },
  {
    value: "collage",
    label: "Collage",
    art: "linear-gradient(115deg, #f2e9e4 0 40%, transparent 40%), linear-gradient(200deg, #c9ada7 0 45%, #4a4e69 45% 100%)",
  },
  {
    value: "typographic",
    label: "Type only",
    art: "repeating-linear-gradient(180deg, #111 0 5px, transparent 5px 12px), #f6f6f6",
  },
];

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="ds-tile space-y-4 p-4 sm:p-5">
      <header className="flex items-center justify-between gap-3">
        <h4 className="text-[14px] font-semibold tracking-tight text-foreground">{title}</h4>
        {aside}
      </header>
      {children}
    </section>
  );
}

/** The small picture on the Brand overview tile. */
export function LookTilePreview({ dna }: { dna: BrandDna }) {
  const look = React.useMemo(() => resolveLook(dna as never), [dna]);
  useLookFonts(look);
  return (
    <div className="flex h-full items-center gap-3">
      <div className="w-[84px] shrink-0">
        <PostPreview resolved={look} brandName={dna.brandName || null} logoUrl={dna.logoUrl} />
      </div>
      <div className="min-w-0 space-y-2">
        <Swatches colors={paletteList(look)} />
        <div className="truncate text-[12px] text-muted-foreground">
          {look.customized ? (look.visual.mood?.split(",")[0] ?? "Your look") : "Pick your look"}
        </div>
      </div>
    </div>
  );
}

export function LookEditor({ dna, save }: { dna: BrandDna; save: Save }) {
  const spec = React.useMemo(() => parseLook(dna.look), [dna.look]);
  const look = React.useMemo(() => resolveLook(dna as never), [dna]);
  useLookFonts(look);

  const write = React.useCallback(
    (next: BrandLookSpec) => {
      // Empty sections are dropped so "nothing set" stays nothing.
      const tidy = (o: object | undefined) =>
        o &&
        Object.values(o).some(
          (v) => v !== undefined && v !== "" && !(Array.isArray(v) && !v.length),
        )
          ? o
          : undefined;
      save({
        look: {
          v: 1,
          writing: tidy(next.writing) as WritingStyle | undefined,
          visual: tidy(next.visual) as VisualStyle | undefined,
          video: tidy(next.video) as VideoStyle | undefined,
        },
      });
    },
    [save],
  );
  const setWriting = (patch: Partial<WritingStyle>) =>
    write({ ...spec, writing: { ...spec.writing, ...patch } });
  const setVisual = (patch: Partial<VisualStyle>) =>
    write({ ...spec, visual: { ...spec.visual, ...patch } });
  const setVideo = (patch: Partial<VideoStyle>) =>
    write({ ...spec, video: { ...spec.video, ...patch } });

  const applyPreset = (preset: LookPreset) =>
    write({
      ...spec,
      // A starter sets the feel; colours and fonts already chosen stay.
      writing: { ...spec.writing, ...preset.writing },
      visual: { ...spec.visual, ...preset.visual },
      video: { ...spec.video, ...preset.video },
    });
  const activePreset = LOOK_PRESETS.find(
    (p) => p.visual.mood === spec.visual?.mood && p.visual.medium === spec.visual?.medium,
  )?.id;

  const w = spec.writing ?? {};
  const v = spec.visual ?? {};
  const vid = spec.video ?? {};
  const tone = w.tone ?? {};
  const dnaPalette = paletteFromDnaColors(dna.colors);
  const swatchGroups = [{ label: "Brand", colors: dna.colors.map((c) => c.hex) }];

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_260px]">
      <div className="min-w-0 space-y-4">
        <Section title="Start from a look">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {LOOK_PRESETS.map((preset, i) => {
              const on = activePreset === preset.id;
              return (
                <motion.button
                  key={preset.id}
                  type="button"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: i * 0.03, ease: [0.16, 1, 0.3, 1] }}
                  whileHover={{ y: -2 }}
                  aria-pressed={on}
                  onClick={() => applyPreset(preset)}
                  className={cn(
                    "group relative overflow-hidden rounded-[18px] text-left ring-1 transition-shadow",
                    on
                      ? "ring-2 ring-primary"
                      : "ring-[var(--ds-tile-border)] hover:ring-primary/40",
                    dsFocus,
                  )}
                >
                  <span
                    className="block h-16 w-full"
                    style={{ background: preset.art }}
                    aria-hidden
                  />
                  <span className="flex items-center justify-between gap-2 px-3 py-2 text-[13px] font-medium">
                    {preset.label}
                    {on && <Check className="h-3.5 w-3.5 text-primary" />}
                  </span>
                </motion.button>
              );
            })}
          </div>
        </Section>

        <Section
          title="Colours"
          aside={
            v.palette ? (
              <button
                type="button"
                className={cn(dsGhostBtn, "h-8 px-3 text-[12px]")}
                onClick={() => setVisual({ palette: undefined })}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Use brand colours
              </button>
            ) : null
          }
        >
          <PaletteEditor
            palette={v.palette ?? {}}
            fallback={dnaPalette}
            groups={swatchGroups}
            onChange={(palette) => setVisual({ palette })}
          />
        </Section>

        <Section title="Fonts">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Headlines">
              <FontPicker
                value={v.typography?.heading ?? look.visual.typography?.heading}
                onChange={(heading) => setVisual({ typography: { ...v.typography, heading } })}
                sampleText={dna.brandName || "Your headline"}
              />
            </Field>
            <Field label="Text">
              <FontPicker
                value={v.typography?.body ?? look.visual.typography?.body}
                onChange={(body) => setVisual({ typography: { ...v.typography, body } })}
              />
            </Field>
          </div>
          <Field label="Headline letters">
            <Segmented
              value={v.typography?.casing}
              onChange={(casing) => setVisual({ typography: { ...v.typography, casing } })}
              options={[
                { value: "as-written", label: "As written" },
                { value: "upper", label: "ALL CAPS" },
                { value: "lower", label: "lowercase" },
              ]}
            />
          </Field>
        </Section>

        <Section title="Pictures">
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-6">
            {MEDIUMS.map((m) => {
              const on = v.medium === m.value;
              return (
                <button
                  key={m.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setVisual({ medium: on ? undefined : m.value })}
                  className={cn(
                    "overflow-hidden rounded-[14px] text-center ring-1 transition-all hover:-translate-y-0.5",
                    on ? "ring-2 ring-primary" : "ring-[var(--ds-tile-border)]",
                    dsFocus,
                  )}
                >
                  <span
                    className="block aspect-square w-full"
                    style={{ background: m.art }}
                    aria-hidden
                  />
                  <span className="block px-1 py-1.5 text-[11.5px] font-medium">{m.label}</span>
                </button>
              );
            })}
          </div>
          <Field label="Mood">
            <MoodChips value={v.mood} onChange={(mood) => setVisual({ mood })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Space">
              <Segmented
                value={v.whitespace}
                onChange={(whitespace) => setVisual({ whitespace })}
                options={[
                  { value: "minimal", label: "Full" },
                  { value: "balanced", label: "Balanced" },
                  { value: "generous", label: "Airy" },
                ]}
              />
            </Field>
            <Field label="Words on pictures">
              <Segmented
                value={
                  v.textPlacement === "none"
                    ? "none"
                    : v.textOnImage?.maxWords != null
                      ? "few"
                      : undefined
                }
                onChange={(value) =>
                  setVisual(
                    value === "none"
                      ? { textPlacement: "none", textOnImage: undefined }
                      : value === "few"
                        ? {
                            textPlacement: undefined,
                            textOnImage: { ...v.textOnImage, maxWords: 6 },
                          }
                        : { textPlacement: undefined, textOnImage: undefined },
                  )
                }
                options={[
                  { value: "none", label: "None" },
                  { value: "few", label: "A few" },
                ]}
              />
            </Field>
          </div>
          <Field label="Never show">
            <ChipsInput
              values={v.avoid ?? []}
              onChange={(avoid) => setVisual({ avoid })}
              placeholder="e.g. stock handshakes"
              max={12}
            />
          </Field>
        </Section>

        <Section
          title="Logo"
          aside={
            <Switch
              checked={v.logo?.use !== false}
              onCheckedChange={(use) => setVisual({ logo: { ...v.logo, use } })}
              aria-label="Put the logo on pictures"
            />
          }
        >
          <div className="flex flex-wrap items-center gap-4">
            <div className="grid h-20 w-20 grid-cols-2 gap-1 rounded-[14px] bg-[var(--ds-well-bg)] p-1.5">
              {(["top-left", "top-right", "bottom-left", "bottom-right"] as const).map((corner) => {
                const on = (v.logo?.corner ?? "bottom-right") === corner;
                return (
                  <button
                    key={corner}
                    type="button"
                    aria-label={`Logo ${corner.replace("-", " ")}`}
                    aria-pressed={on}
                    disabled={v.logo?.use === false}
                    onClick={() => setVisual({ logo: { ...v.logo, corner } })}
                    className={cn(
                      "rounded-[9px] transition-colors disabled:opacity-40",
                      on ? "bg-primary" : "bg-[var(--ds-tile-bg)] hover:bg-primary/25",
                      dsFocus,
                    )}
                  />
                );
              })}
            </div>
            <Segmented
              value={v.logo?.size}
              disabled={v.logo?.use === false}
              onChange={(size) => setVisual({ logo: { ...v.logo, size } })}
              options={[
                { value: "small", label: "Small" },
                { value: "medium", label: "Medium" },
                { value: "large", label: "Large" },
              ]}
            />
          </div>
        </Section>

        <Section title="Writing">
          <div className="grid gap-5 sm:grid-cols-2">
            <ToneSlider
              low="Formal"
              high="Casual"
              value={tone.casual}
              onChange={(casual) => setWriting({ tone: { ...tone, casual } })}
            />
            <ToneSlider
              low="Serious"
              high="Playful"
              value={tone.playful}
              onChange={(playful) => setWriting({ tone: { ...tone, playful } })}
            />
            <ToneSlider
              low="Short"
              high="Detailed"
              value={tone.detailed}
              onChange={(detailed) => setWriting({ tone: { ...tone, detailed } })}
            />
            <ToneSlider
              low="Quiet"
              high="Bold"
              value={tone.bold}
              onChange={(bold) => setWriting({ tone: { ...tone, bold } })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Emoji">
              <Segmented
                value={w.emoji}
                onChange={(emoji) => setWriting({ emoji })}
                options={[
                  { value: "none", label: "None" },
                  { value: "light", label: "A few" },
                  { value: "heavy", label: "Lots" },
                ]}
              />
            </Field>
            <Field label="Speak as">
              <Segmented
                value={w.person}
                onChange={(person) => setWriting({ person })}
                options={[
                  { value: "we", label: "We" },
                  { value: "i", label: "I" },
                  { value: "you", label: "You" },
                ]}
              />
            </Field>
            <Field label="Hashtags per post">
              <Segmented
                value={
                  w.hashtags?.count == null ? undefined : String(Math.min(w.hashtags.count, 5))
                }
                onChange={(count) =>
                  setWriting({
                    hashtags: { ...w.hashtags, count: count == null ? undefined : Number(count) },
                  })
                }
                options={[
                  { value: "0", label: "0" },
                  { value: "3", label: "3" },
                  { value: "5", label: "5" },
                ]}
              />
            </Field>
            <Field label="Always include">
              <ChipsInput
                values={w.hashtags?.always ?? []}
                onChange={(always) => setWriting({ hashtags: { ...w.hashtags, always } })}
                placeholder="yourbrand"
                prefix="#"
                max={6}
              />
            </Field>
          </div>
          <Field label="Words to avoid">
            <ChipsInput
              values={w.bannedWords ?? []}
              onChange={(bannedWords) => setWriting({ bannedWords })}
              placeholder="e.g. synergy, revolutionary"
              max={30}
            />
          </Field>
          <Field label="Favourite phrases">
            <ChipsInput
              values={w.signaturePhrases ?? []}
              onChange={(signaturePhrases) => setWriting({ signaturePhrases })}
              placeholder="A line you always say"
              max={8}
            />
          </Field>
        </Section>

        <Section title="Video">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Pace">
              <Segmented
                value={vid.pacing}
                onChange={(pacing) => setVideo({ pacing })}
                options={[
                  { value: "slow", label: "Slow" },
                  { value: "steady", label: "Steady" },
                  { value: "fast", label: "Fast" },
                ]}
              />
            </Field>
            <Field label="Captions">
              <Segmented
                value={vid.captions?.show === false ? "off" : (vid.captions?.position ?? undefined)}
                onChange={(value) =>
                  setVideo({
                    captions:
                      value === "off"
                        ? { ...vid.captions, show: false }
                        : { ...vid.captions, show: value ? true : undefined, position: value },
                  })
                }
                options={[
                  { value: "top", label: "Top" },
                  { value: "center", label: "Middle" },
                  { value: "bottom", label: "Bottom" },
                  { value: "off", label: "Off" },
                ]}
              />
            </Field>
          </div>
        </Section>

        {look.customized && (
          <button
            type="button"
            className={cn(dsGhostBtn, "h-9 px-4 text-[13px]")}
            onClick={() => save({ look: undefined })}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset to plain brand
          </button>
        )}
      </div>

      {/* Live: the same resolver the server uses decides what these show. */}
      <aside className="hidden xl:block" aria-label="Preview">
        <div className="sticky top-2 space-y-3">
          <PostPreview resolved={look} brandName={dna.brandName || null} logoUrl={dna.logoUrl} />
          <div className="grid grid-cols-2 gap-3">
            <SlidePreview resolved={look} index={2} />
            <VideoPreview resolved={look} />
          </div>
        </div>
      </aside>
    </div>
  );
}
