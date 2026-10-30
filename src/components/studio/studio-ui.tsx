"use client";

// Small, shared building blocks for Studio surfaces. Everything reads from the
// design tokens: neutral surfaces, one lime accent, no per-type rainbow.
import type * as React from "react";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Clapperboard } from "lucide-react";
import {
  Check,
  FileText,
  Image as ImageIcon,
  Layers,
  Megaphone,
  MessageSquare,
  Story,
  Video,
  type LucideIcon,
} from "@/components/icons";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { duration, ease, spring } from "@/lib/motion";
import {
  PlatformAppIcon,
  platformAppIconLabel,
  platformGlow,
  type PlatformAppIconId,
} from "@/components/brand/PlatformAppIcon";
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
  story: Story,
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
        `studio-glyph studio-tone-${type} grid shrink-0 place-items-center rounded-lg`,
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
              "min-h-11 min-w-11 rounded-md px-3 text-xs font-medium transition-colors duration-[--motion-duration-fast] lg:min-h-8 lg:min-w-0",
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

/**
 * A short list of choices that each need a word of explanation: cards with an
 * icon, a name and the hint on show (a `Segmented` hides its hints).
 */
export function OptionCards<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T | undefined;
  options: { value: T; label: string; hint?: string; icon?: LucideIcon }[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("grid grid-cols-1 gap-2 min-[420px]:grid-cols-2", className)}
    >
      {options.map((o) => {
        const selected = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex min-h-11 items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors duration-[--motion-duration-fast]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 disabled:opacity-50",
              selected
                ? "border-primary-border bg-primary-surface"
                : "border-border bg-surface-2 hover:border-border-strong",
            )}
          >
            {Icon ? (
              <span
                className={cn(
                  "mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg",
                  selected
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface-3 text-muted-foreground",
                )}
              >
                <Icon className="size-3.5" />
              </span>
            ) : null}
            <span className="min-w-0">
              <span className="block text-xs font-medium text-foreground">{o.label}</span>
              {o.hint ? (
                <span className="block text-[11px] leading-snug text-muted-foreground">
                  {o.hint}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A switch with a name and a one-line hint, for a single yes/no choice. */
export function SwitchRow({
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
      <span className="min-w-0">
        <span className="block text-xs font-medium text-foreground">{label}</span>
        {hint ? <span className="block text-[11px] text-muted-foreground">{hint}</span> : null}
      </span>
      <Switch
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </label>
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
        "inline-flex min-h-11! items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors duration-[--motion-duration-fast] lg:min-h-8!",
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
  maxSelections,
}: {
  platforms: PlatformId[];
  value: PlatformId[];
  onChange: (next: PlatformId[]) => void;
  multi: boolean;
  maxSelections?: number;
}) {
  return (
    <PlatformLogoGrid
      platforms={platforms}
      isSelected={(id) => value.includes(id)}
      isDisabled={(id) =>
        !value.includes(id) && maxSelections !== undefined && value.length >= maxSelections
      }
      multi={multi}
      onToggle={(id) => {
        const selected = value.includes(id);
        if (!multi) return onChange([id]);
        if (selected && value.length === 1) return; // keep at least one
        onChange(selected ? value.filter((p) => p !== id) : [...value, id]);
      }}
    />
  );
}

/**
 * Channels as their app icons: a person finds Instagram by its logo, not by
 * reading a row of names. The name is the button's label and tooltip. Picked
 * icons are full colour with a lime ring and a check; the rest are softened
 * until hovered.
 */
export function PlatformLogoGrid<T extends PlatformAppIconId>({
  platforms,
  isSelected,
  isDisabled,
  onToggle,
  multi = true,
  size = 44,
  note,
  className,
}: {
  platforms: readonly T[];
  isSelected: (id: T) => boolean;
  isDisabled?: (id: T) => boolean;
  onToggle: (id: T) => void;
  multi?: boolean;
  size?: number;
  /** A small line under an icon, such as "not connected". */
  note?: (id: T) => string | null | undefined;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <div role={multi ? "group" : "radiogroup"} className={cn("flex flex-wrap gap-2.5", className)}>
      {platforms.map((id, i) => {
        const selected = isSelected(id);
        const disabled = isDisabled?.(id) ?? false;
        const name = platformAppIconLabel(id);
        const sub = note?.(id);
        return (
          <motion.button
            key={id}
            type="button"
            role={multi ? undefined : "radio"}
            aria-pressed={multi ? selected : undefined}
            aria-checked={multi ? undefined : selected}
            aria-label={sub ? `${name}, ${sub}` : name}
            title={sub ? `${name} · ${sub}` : name}
            disabled={disabled}
            onClick={() => onToggle(id)}
            initial={reduce ? false : { opacity: 0, y: 6, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ ...spring.control, delay: reduce ? 0 : i * 0.035 }}
            whileHover={reduce || disabled ? undefined : { y: -2 }}
            whileTap={reduce || disabled ? undefined : { scale: 0.92 }}
            className={cn(
              "group relative flex flex-col items-center gap-1 rounded-[18px] p-1 outline-none",
              "focus-visible:ring-2 focus-visible:ring-ring/55",
              "disabled:cursor-not-allowed",
            )}
          >
            <span className="relative">
              {/* The platform's own colour glows softly behind a picked icon. */}
              <motion.span
                aria-hidden
                initial={false}
                animate={selected ? { opacity: 0.55, scale: 1 } : { opacity: 0, scale: 0.7 }}
                transition={spring.surface}
                className="pointer-events-none absolute inset-1 rounded-full blur-[10px]"
                style={{ background: platformGlow(id) }}
              />
              <motion.span
                className="relative block"
                initial={false}
                animate={selected ? { scale: 1 } : { scale: disabled ? 0.9 : 0.94 }}
                transition={spring.control}
              >
                <PlatformAppIcon
                  platform={id}
                  size={size}
                  className={cn(
                    "transition-[filter,opacity,box-shadow] duration-[--motion-duration-fast]",
                    // Unpicked icons keep their real colours; only a disabled one fades.
                    disabled && "opacity-35 grayscale",
                    !selected &&
                      !disabled &&
                      "group-hover:shadow-[0_2px_4px_rgb(0_0_0/0.14),0_10px_22px_-6px_rgb(0_0_0/0.35)]",
                  )}
                />
              </motion.span>
              {/* Ring sits outside the tile so the logo itself is never covered. */}
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute -inset-[3px] rounded-[calc(var(--r)+3px)] ring-2 transition-[box-shadow,opacity] duration-[--motion-duration-fast]",
                  selected ? "ring-primary opacity-100" : "ring-transparent opacity-0",
                )}
                style={{ ["--r" as string]: `${Math.round(size * 0.26)}px` }}
              />
              <motion.span
                aria-hidden
                initial={false}
                animate={selected ? { scale: 1, opacity: 1 } : { scale: 0.4, opacity: 0 }}
                transition={spring.control}
                className="absolute -right-1.5 -top-1.5 grid size-[18px] place-items-center rounded-full bg-primary text-primary-foreground shadow-sm ring-2 ring-surface-2"
              >
                <Check className="size-2.5" />
              </motion.span>
            </span>
            {sub ? (
              <span className="max-w-[4.5rem] truncate text-[10px] leading-none text-muted-foreground">
                {sub}
              </span>
            ) : null}
          </motion.button>
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

/** Seconds since `startedAt`, ticking once a second. */
export function useElapsed(startedAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${m}:${String(seconds % 60).padStart(2, "0")}`;
}

/** A check mark that draws itself — the one completion gesture Studio uses. */
export function DrawCheck({
  className,
  delay = 0,
  strokeWidth = 2.5,
}: {
  className?: string;
  delay?: number;
  strokeWidth?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={cn("size-4", className)}>
      <motion.path
        d="M5 12.5l4.2 4.2L19 7"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ delay, duration: duration.xslow, ease: ease.emphasized }}
      />
    </svg>
  );
}

const BURST_TONES = [
  "var(--primary)",
  "var(--tone-carousel)",
  "var(--tone-image)",
  "var(--tone-video)",
  "var(--tone-script)",
  "var(--tone-article)",
];

/** A small, once-only burst of brand colour for a real moment of completion. */
export function Burst({ count = 14, radius = 36 }: { count?: number; radius?: number }) {
  const reduce = useReducedMotion();
  if (reduce) return null;
  return (
    <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 z-20">
      {Array.from({ length: count }).map((_, i) => {
        const angle = (i / count) * Math.PI * 2 + (i % 2 ? 0.22 : 0);
        const r = radius * (i % 3 === 0 ? 1.2 : i % 3 === 1 ? 0.8 : 1);
        return (
          <motion.span
            key={i}
            className={cn(
              "absolute block rounded-full",
              i % 4 === 0 ? "-ml-px -mt-1 h-2 w-0.5" : "-ml-[3px] -mt-[3px] size-1.5",
            )}
            style={{
              background: `hsl(${BURST_TONES[i % BURST_TONES.length]})`,
              rotate: `${(angle * 180) / Math.PI + 90}deg`,
            }}
            initial={{ x: 0, y: 0, scale: 0.3, opacity: 1 }}
            animate={{
              x: Math.cos(angle) * r,
              y: Math.sin(angle) * r,
              scale: [0.3, 1.15, 0],
              opacity: [1, 1, 0],
            }}
            transition={{ duration: 0.95, ease: ease.emphasized, delay: 0.08 }}
          />
        );
      })}
    </span>
  );
}

/** Overlapping platform marks — compact "where this goes". */
export function PlatformStack({
  platforms,
  size = 20,
  max = 4,
  className,
}: {
  platforms: PlatformId[];
  size?: number;
  max?: number;
  className?: string;
}) {
  const shown = platforms.slice(0, max);
  return (
    <span className={cn("inline-flex items-center", className)}>
      {shown.map((p, i) => (
        <span
          key={p}
          title={PLATFORMS[p].label}
          className="relative shrink-0 rounded-[30%] ring-2 ring-surface-2"
          style={{ marginLeft: i ? -size * 0.22 : 0, zIndex: max - i }}
        >
          <PlatformAppIcon platform={p} size={size} className="shadow-none" />
        </span>
      ))}
      {platforms.length > max ? (
        <span className="ml-1 text-[11px] tabular-nums text-muted-foreground">
          +{platforms.length - max}
        </span>
      ) : null}
    </span>
  );
}
