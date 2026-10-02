"use client";
// Quick choices shared by the "new style" screen and the style editor: how
// closely to copy the examples, a one-tap mood, and the colours the picker
// offers as shortcuts.
import { cn } from "@/lib/utils";
import { dsFocus } from "@/components/app/surface/buttons";
import type { BrandKitOverview } from "@/lib/brand-kit/contracts";
import { clusterColors } from "@/lib/brand-kit/merge";
import type { StyleReference, StyleSpec } from "@/lib/brand-kit/spec";
import type { SwatchGroup } from "./ColorPicker";
import { Segmented } from "./controls";

/** Shortcut colours for the picker: the style's examples first, then the brand. */
export function swatchGroups(data: BrandKitOverview, spec?: StyleSpec): SwatchGroup[] {
  const ids = new Set((spec?.references ?? []).map((r) => r.assetId));
  const lists = data.assets
    .filter((a) => (ids.size ? ids.has(a.id) : a.kind === "inspiration_image"))
    .map((a) => a.analysis?.colors ?? [])
    .filter((l) => l.length);
  return [
    { label: "From your examples", colors: clusterColors(lists).slice(0, 8) },
    { label: "Brand", colors: data.dna.colors.map((c) => c.hex) },
  ];
}

type Strength = StyleReference["strength"];

/** One setting for every example: how closely new images copy them. */
export function MatchControl({
  references,
  onChange,
  disabled,
}: {
  references: StyleReference[];
  onChange: (next: StyleReference[]) => void;
  disabled?: boolean;
}) {
  const first = references[0]?.strength ?? "close";
  const value = references.every((r) => r.strength === first) ? first : undefined;
  return (
    <Segmented<Strength>
      value={value}
      disabled={disabled || !references.length}
      onChange={(s) => s && onChange(references.map((r) => ({ ...r, strength: s })))}
      options={[
        { value: "loose", label: "A little" },
        { value: "close", label: "Closely" },
        { value: "exact", label: "Exactly" },
      ]}
    />
  );
}

export const MOODS: Array<{ label: string; value: string }> = [
  { label: "Clean", value: "clean and minimal, calm, lots of breathing room" },
  { label: "Bold", value: "bold and energetic, high contrast, confident" },
  { label: "Warm", value: "warm and friendly, soft, human" },
  { label: "Premium", value: "premium and refined, understated, elegant" },
  { label: "Playful", value: "playful and colourful, fun, lively" },
  { label: "Dark", value: "dark and moody, dramatic, cinematic" },
];

export function MoodChips({
  value,
  onChange,
  disabled,
}: {
  value: string | undefined;
  onChange: (mood: string | undefined) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {MOODS.map((m) => {
        const on = value === m.value;
        return (
          <button
            key={m.label}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onChange(on ? undefined : m.value)}
            className={cn(
              "h-9 rounded-full px-4 text-[13px] font-medium transition-all",
              on
                ? "bg-primary/15 text-foreground ring-1 ring-primary/40"
                : "ds-well text-muted-foreground hover:text-foreground",
              dsFocus,
            )}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
