"use client";

// Inspo → Post look: vibe, colours, fonts, pictures and logo, with a live
// post beside it. Writes the one look (`dna.look.visual`).
import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, RotateCcw } from "@/components/icons";
import { Switch } from "@/components/ui/switch";
import { dsFocus, dsGhostBtn } from "@/components/app/surface/buttons";
import { ColorPicker } from "@/components/app/brain/brand/look/ColorPicker";
import { ChipsInput, FontPicker, Segmented } from "@/components/app/brain/brand/look/controls";
import { MoodChips } from "@/components/app/brain/brand/look/look";
import { LOOK_PRESETS } from "@/components/app/brain/brand/look/presets";
import { PostPreview, SlidePreview } from "@/components/app/brain/brand/look/preview";
import type { BrandLook } from "@/lib/brand-look/resolve";
import { paletteFromDnaColors } from "@/lib/brand-look/resolve";
import type { BrandLookSpec, VisualStyle } from "@/lib/brand-look/spec";
import { cn } from "@/lib/utils";
import { Block, EASE, PickTile } from "./parts";
import type { InspoHandlers, InspoView } from "./types";

export const MEDIUMS: Array<{
  value: NonNullable<VisualStyle["medium"]>;
  label: string;
  art: string;
}> = [
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

const ROLES = [
  ["primary", "Main"],
  ["secondary", "Second"],
  ["accent", "Accent"],
  ["background", "Background"],
  ["text", "Text"],
] as const;

/** A short closed drawer for the rarely needed settings. */
export function FineTune({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="rounded-[24px] ring-1 ring-[var(--ds-tile-border)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center justify-between rounded-[24px] px-5 py-3.5 text-[13.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground",
          dsFocus,
        )}
      >
        Fine-tune
        <motion.span
          animate={{ rotate: open ? 45 : 0 }}
          transition={{ duration: 0.25, ease: EASE }}
        >
          <Plus className="h-4 w-4" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="space-y-5 px-5 pb-5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[12px] font-semibold text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

/** The live preview: fades on every change so a person sees it follow. */
export function LivePreview({ stamp, children }: { stamp: string; children: React.ReactNode }) {
  return (
    <aside aria-label="Preview" className="lg:sticky lg:top-2 lg:self-start">
      <motion.div
        key={stamp}
        initial={{ opacity: 0.55, scale: 0.985 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.35, ease: EASE }}
        className="space-y-3 rounded-[28px] bg-[var(--ds-well-bg)] p-3"
      >
        {children}
      </motion.div>
    </aside>
  );
}

export function PostLook({
  view,
  spec,
  resolved,
  handlers,
}: {
  view: InspoView;
  spec: BrandLookSpec;
  resolved: BrandLook;
  handlers: InspoHandlers;
}) {
  const v = spec.visual ?? {};
  const set = (patch: Partial<VisualStyle>) =>
    handlers.saveLook({ ...spec, visual: { ...spec.visual, ...patch } });
  const dna = view.dna;
  const fallback = paletteFromDnaColors(dna.colors);
  const groups = [{ label: "Brand", colors: dna.colors.map((c) => c.hex) }];
  const activePreset = LOOK_PRESETS.find(
    (p) => p.visual.mood === v.mood && p.visual.medium === v.medium,
  )?.id;
  const palette = v.palette ?? {};
  const extra = palette.extra ?? [];
  const stamp = JSON.stringify([v, resolved.visual.palette]);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-4">
        <Block label="Vibe">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {LOOK_PRESETS.map((preset, i) => (
              <PickTile
                key={preset.id}
                index={i}
                on={activePreset === preset.id}
                label={preset.label}
                art={preset.art}
                onClick={() =>
                  // A vibe sets the feel; colours and fonts already chosen stay.
                  handlers.saveLook({
                    ...spec,
                    writing: { ...spec.writing, ...preset.writing },
                    visual: { ...spec.visual, ...preset.visual },
                    video: { ...spec.video, ...preset.video },
                  })
                }
              />
            ))}
          </div>
        </Block>

        <Block
          label="Colours"
          aside={
            v.palette ? (
              <button
                type="button"
                className={cn(dsGhostBtn, "h-8 px-3 text-[12px]")}
                onClick={() => set({ palette: undefined })}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Brand colours
              </button>
            ) : null
          }
        >
          <div className="flex flex-wrap items-center gap-3">
            {ROLES.map(([role, label], i) => {
              const own = palette[role];
              const shown = own ?? fallback[role];
              return (
                <ColorPicker
                  key={role}
                  label={label}
                  value={shown}
                  groups={groups}
                  onChange={(hex) => set({ palette: { ...palette, [role]: hex } })}
                  onClear={
                    own ? () => set({ palette: { ...palette, [role]: undefined } }) : undefined
                  }
                >
                  <motion.button
                    type="button"
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 380, damping: 22, delay: i * 0.04 }}
                    whileHover={{ scale: 1.08 }}
                    whileTap={{ scale: 0.94 }}
                    className={cn("flex flex-col items-center gap-1.5", dsFocus, "rounded-full")}
                    aria-label={`${label} colour${shown ? `, ${shown}` : ", not set"}`}
                  >
                    <span
                      className={cn(
                        "grid h-12 w-12 place-items-center rounded-full ring-1 ring-[var(--ds-tile-border)]",
                        !shown && "border-2 border-dashed border-[var(--ds-tile-border)] ring-0",
                        shown && !own && "opacity-75",
                      )}
                      style={shown ? { background: shown } : undefined}
                    >
                      {!shown && <Plus className="h-4 w-4 text-muted-foreground" />}
                    </span>
                    <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
                  </motion.button>
                </ColorPicker>
              );
            })}
            {extra.map((c, i) => (
              <ColorPicker
                key={`x${i}`}
                label={`Extra colour ${i + 1}`}
                value={c}
                groups={groups}
                onChange={(hex) =>
                  set({ palette: { ...palette, extra: extra.map((x, j) => (j === i ? hex : x)) } })
                }
                onClear={() =>
                  set({
                    palette: {
                      ...palette,
                      extra: extra.filter((_, j) => j !== i).length
                        ? extra.filter((_, j) => j !== i)
                        : undefined,
                    },
                  })
                }
              >
                <button
                  type="button"
                  aria-label={`Extra colour ${c}`}
                  className={cn(
                    "mb-5 h-9 w-9 rounded-full ring-1 ring-[var(--ds-tile-border)] transition-transform hover:scale-110",
                    dsFocus,
                  )}
                  style={{ background: c }}
                />
              </ColorPicker>
            ))}
            {extra.length < 6 && (
              <button
                type="button"
                aria-label="Add a colour"
                onClick={() =>
                  set({
                    palette: {
                      ...palette,
                      extra: [...extra, palette.accent ?? fallback.accent ?? "#8a8f98"],
                    },
                  })
                }
                className={cn(
                  "mb-5 grid h-9 w-9 place-items-center rounded-full border border-dashed border-[var(--ds-tile-border)] text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground",
                  dsFocus,
                )}
              >
                <Plus className="h-4 w-4" />
              </button>
            )}
          </div>
        </Block>

        <Block label="Fonts">
          <div className="grid gap-3 sm:grid-cols-2">
            <Row label="Headlines">
              <FontPicker
                value={v.typography?.heading ?? resolved.visual.typography?.heading}
                onChange={(heading) => set({ typography: { ...v.typography, heading } })}
                sampleText={dna.brandName || "Your headline"}
              />
            </Row>
            <Row label="Text">
              <FontPicker
                value={v.typography?.body ?? resolved.visual.typography?.body}
                onChange={(body) => set({ typography: { ...v.typography, body } })}
              />
            </Row>
          </div>
        </Block>

        <Block label="Pictures">
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-6">
            {MEDIUMS.map((m, i) => (
              <PickTile
                key={m.value}
                index={i}
                on={v.medium === m.value}
                label={m.label}
                art={m.art}
                onClick={() => set({ medium: v.medium === m.value ? undefined : m.value })}
              />
            ))}
          </div>
        </Block>

        <Block
          label="Logo"
          aside={
            <Switch
              checked={v.logo?.use !== false}
              onCheckedChange={(use) => set({ logo: { ...v.logo, use } })}
              aria-label="Put the logo on pictures"
            />
          }
        >
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative grid h-24 w-24 grid-cols-2 gap-1.5 rounded-[18px] bg-[var(--ds-well-bg)] p-2">
              {(["top-left", "top-right", "bottom-left", "bottom-right"] as const).map((corner) => {
                const on = (v.logo?.corner ?? "bottom-right") === corner;
                return (
                  <button
                    key={corner}
                    type="button"
                    aria-label={`Logo ${corner.replace("-", " ")}`}
                    aria-pressed={on}
                    disabled={v.logo?.use === false}
                    onClick={() => set({ logo: { ...v.logo, corner } })}
                    className={cn(
                      "relative rounded-[10px] bg-[var(--ds-tile-bg)] transition-colors hover:bg-primary/20 disabled:opacity-40",
                      dsFocus,
                    )}
                  >
                    {on && (
                      <motion.span
                        layoutId="inspo-logo-corner"
                        className="absolute inset-0 rounded-[10px] bg-primary"
                        transition={{ type: "spring", stiffness: 420, damping: 30 }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
            <Segmented
              value={v.logo?.size}
              disabled={v.logo?.use === false}
              onChange={(size) => set({ logo: { ...v.logo, size } })}
              options={[
                { value: "small", label: "S" },
                { value: "medium", label: "M" },
                { value: "large", label: "L" },
              ]}
            />
          </div>
        </Block>

        <FineTune>
          <Row label="Mood">
            <MoodChips value={v.mood} onChange={(mood) => set({ mood })} />
          </Row>
          <div className="grid gap-4 sm:grid-cols-2">
            <Row label="Space">
              <Segmented
                value={v.whitespace}
                onChange={(whitespace) => set({ whitespace })}
                options={[
                  { value: "minimal", label: "Full" },
                  { value: "balanced", label: "Balanced" },
                  { value: "generous", label: "Airy" },
                ]}
              />
            </Row>
            <Row label="Words on pictures">
              <Segmented
                value={
                  v.textPlacement === "none"
                    ? "none"
                    : v.textOnImage?.maxWords != null
                      ? "few"
                      : undefined
                }
                onChange={(value) =>
                  set(
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
            </Row>
            <Row label="Headline letters">
              <Segmented
                value={v.typography?.casing}
                onChange={(casing) => set({ typography: { ...v.typography, casing } })}
                options={[
                  { value: "as-written", label: "Aa" },
                  { value: "upper", label: "AA" },
                  { value: "lower", label: "aa" },
                ]}
              />
            </Row>
          </div>
          <Row label="Never show">
            <ChipsInput
              values={v.avoid ?? []}
              onChange={(avoid) => set({ avoid })}
              placeholder="e.g. stock handshakes"
              max={12}
            />
          </Row>
          {resolved.customized && (
            <button
              type="button"
              className={cn(dsGhostBtn, "h-9 px-4 text-[13px]")}
              onClick={handlers.resetLook}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Start over
            </button>
          )}
        </FineTune>
      </div>

      <LivePreview stamp={stamp}>
        <PostPreview resolved={resolved} brandName={dna.brandName || null} logoUrl={dna.logoUrl} />
        <div className="grid grid-cols-2 gap-3">
          <SlidePreview resolved={resolved} index={1} />
          <SlidePreview resolved={resolved} index={2} />
        </div>
      </LivePreview>
    </div>
  );
}
