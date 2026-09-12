"use client";

// Small, shared building blocks for Studio surfaces. Everything reads from the
// design tokens: neutral surfaces, one lime accent, no per-type rainbow.
import type * as React from "react";
import { Clapperboard } from "lucide-react";
import {
  Check,
  FileText,
  Image as ImageIcon,
  Layers,
  Megaphone,
  MessageSquare,
  Video,
  type LucideIcon,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import { PLATFORMS, type PlatformId } from "@/lib/social-platforms";
import { RATIOS, type AspectRatio } from "@/lib/studio/aspect";
import type { StudioType } from "@/lib/studio/formats";

export const TYPE_ICON: Record<StudioType, LucideIcon> = {
  social: MessageSquare,
  carousel: Layers,
  image: ImageIcon,
  ad: Megaphone,
  video: Video,
  script: Clapperboard as unknown as LucideIcon,
  article: FileText,
};

export function TypeGlyph({
  type,
  className,
  size = "md",
}: {
  type: StudioType;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const Icon = TYPE_ICON[type];
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-lg bg-surface-2 text-foreground/80 ring-1 ring-border",
        size === "sm"
          ? "size-6 [&_svg]:size-3.5"
          : size === "lg"
            ? "size-10 [&_svg]:size-5"
            : "size-8 [&_svg]:size-4",
        className,
      )}
    >
      <Icon />
    </span>
  );
}

export function FieldLabel({
  children,
  hint,
  htmlFor,
}: {
  children: React.ReactNode;
  hint?: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <label htmlFor={htmlFor} className="text-xs font-medium text-foreground">
        {children}
      </label>
      {hint ? <span className="truncate text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T | undefined;
  options: { value: T; label: React.ReactNode; hint?: string }[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex rounded-lg bg-surface-2 p-0.5 ring-1 ring-border", className)}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            title={o.hint}
            onClick={() => onChange(o.value)}
            className={cn(
              "min-h-8 rounded-md px-3 text-xs font-medium transition-colors duration-[--motion-duration-fast]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55",
              selected
                ? "bg-surface-3 text-foreground shadow-1"
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

export function ChipButton({
  selected,
  onClick,
  children,
  className,
  disabled,
  title,
}: {
  selected?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors duration-[--motion-duration-fast]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 disabled:opacity-50",
        selected
          ? "border-primary-border bg-primary-surface text-foreground"
          : "border-border bg-surface-3 text-muted-foreground hover:border-border-strong hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function PlatformPicker({
  platforms,
  value,
  onChange,
  multi,
}: {
  platforms: PlatformId[];
  value: PlatformId[];
  onChange: (next: PlatformId[]) => void;
  multi: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {platforms.map((id) => {
        const spec = PLATFORMS[id];
        const Icon = spec.icon;
        const selected = value.includes(id);
        return (
          <ChipButton
            key={id}
            selected={selected}
            onClick={() => {
              if (!multi) return onChange([id]);
              if (selected && value.length === 1) return; // keep at least one
              onChange(selected ? value.filter((p) => p !== id) : [...value, id]);
            }}
          >
            <Icon className="size-3.5" />
            {spec.label}
            {selected && multi ? <Check className="size-3 text-primary" /> : null}
          </ChipButton>
        );
      })}
    </div>
  );
}

export function RatioPicker({
  ratios,
  value,
  onChange,
  recommended,
}: {
  ratios: AspectRatio[];
  value: AspectRatio | undefined;
  onChange: (ratio: AspectRatio) => void;
  recommended?: AspectRatio;
}) {
  return (
    <div role="radiogroup" aria-label="Size" className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
      {ratios.map((r) => {
        const meta = RATIOS[r];
        const selected = value === r;
        const scale = 20 / Math.max(meta.w, meta.h);
        return (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(r)}
            className={cn(
              "flex min-h-14 items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors duration-[--motion-duration-fast]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55",
              selected
                ? "border-primary-border bg-primary-surface"
                : "border-border bg-surface-3 hover:border-border-strong",
            )}
          >
            <span className="grid size-6 shrink-0 place-items-center" aria-hidden>
              <span
                className={cn(
                  "rounded-[3px] border-[1.5px]",
                  selected ? "border-primary" : "border-muted-foreground/60",
                )}
                style={{ width: meta.w * scale, height: meta.h * scale }}
              />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-medium text-foreground">
                {meta.label} <span className="text-muted-foreground">{r}</span>
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {recommended === r ? "Recommended" : meta.use}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A box locked to an aspect ratio that never grows taller than `maxHeight`. */
export function RatioFrame({
  ratio,
  children,
  className,
  maxHeight = 560,
}: {
  ratio: AspectRatio;
  children?: React.ReactNode;
  className?: string;
  maxHeight?: number;
}) {
  const meta = RATIOS[ratio];
  return (
    <div className="mx-auto w-full" style={{ maxWidth: Math.round((maxHeight * meta.w) / meta.h) }}>
      <div
        className={cn("relative w-full overflow-hidden", className)}
        style={{ aspectRatio: `${meta.w} / ${meta.h}` }}
      >
        {children}
      </div>
    </div>
  );
}

/** Slow lime shimmer used for anything being generated. */
export function Weave({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("studio-weave pointer-events-none absolute inset-0", className)}
    />
  );
}
