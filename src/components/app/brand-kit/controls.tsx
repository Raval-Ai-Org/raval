"use client";
// Small form controls for the Brand Kit: all pills, all ds-* surfaces.
import * as React from "react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Check, ChevronDown, Link, Plus, Search, X } from "@/components/icons";
import {
  FONT_CATALOG,
  ensureGoogleFonts,
  fontStack,
  type FontCategory,
} from "@/lib/brand-kit/fonts";
import { dsFocus } from "@/components/app/surface/buttons";

/** A labelled row inside a tile. */
export function Field({
  label,
  hint,
  children,
  aside,
  className,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-foreground">{label}</div>
          {hint && <div className="text-[12px] text-muted-foreground">{hint}</div>}
        </div>
        {aside}
      </div>
      {children}
    </div>
  );
}

/** "Linked to Brand DNA" — when on, the field follows Brand DNA. */
export function LinkedToggle({
  on,
  onChange,
  disabled,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "inline-flex cursor-pointer items-center gap-2 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors",
        on ? "bg-primary/12 text-foreground" : "text-muted-foreground hover:bg-[var(--ds-well-bg)]",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <Link className="h-3.5 w-3.5" />
      <span>Use Brand DNA</span>
      <Switch checked={on} onCheckedChange={onChange} disabled={disabled} className="scale-[0.8]" />
    </label>
  );
}

/** Pill segmented control. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  size = "md",
}: {
  value: T | undefined;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T | undefined) => void;
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  return (
    <div
      className={cn("ds-well inline-flex flex-wrap gap-0.5 p-1", disabled && "opacity-60")}
      role="radiogroup"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(active ? undefined : o.value)}
            className={cn(
              "rounded-full font-medium transition-all duration-200",
              size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3.5 text-[13px]",
              active
                ? "bg-[var(--ds-tile-bg)] text-foreground shadow-sm ring-1 ring-primary/30"
                : "text-muted-foreground hover:text-foreground",
              dsFocus,
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A 0..100 slider between two words. */
export function ToneSlider({
  low,
  high,
  value,
  onChange,
  disabled,
}: {
  low: string;
  high: string;
  value: number | undefined;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const v = value ?? 50;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-[12px] font-medium">
        <span className={cn(v < 45 ? "text-foreground" : "text-muted-foreground")}>{low}</span>
        <span className={cn(v > 55 ? "text-foreground" : "text-muted-foreground")}>{high}</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={v}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`${low} to ${high}`}
        className={cn(
          "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[var(--ds-well-bg-hover)] accent-[hsl(var(--primary))]",
          value == null && "opacity-60",
        )}
        style={{
          background: `linear-gradient(to right, hsl(var(--primary)) ${v}%, var(--ds-well-bg-hover) ${v}%)`,
        }}
      />
    </div>
  );
}

/** Editable list of short chips. */
export function ChipsInput({
  values,
  onChange,
  placeholder,
  max = 12,
  prefix,
  disabled,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  max?: number;
  prefix?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = React.useState("");
  const add = () => {
    const parts = draft
      .split(",")
      .map((s) => s.trim().replace(prefix ? new RegExp(`^\\${prefix}`) : /^$/, ""))
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...values];
    for (const p of parts) if (!next.some((x) => x.toLowerCase() === p.toLowerCase())) next.push(p);
    onChange(next.slice(0, max));
    setDraft("");
  };
  return (
    <div className="ds-well flex min-h-10 flex-wrap items-center gap-1.5 p-1.5">
      {values.map((v) => (
        <span
          key={v}
          className="inline-flex items-center gap-1 rounded-full bg-[var(--ds-tile-bg)] py-1 pl-2.5 pr-1 text-[12.5px] ring-1 ring-[var(--ds-tile-border)]"
        >
          {prefix}
          {v}
          {!disabled && (
            <button
              type="button"
              aria-label={`Remove ${v}`}
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="grid h-5 w-5 place-items-center rounded-full text-muted-foreground hover:bg-[var(--ds-well-bg-hover)] hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
      {!disabled && values.length < max && (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            } else if (e.key === "Backspace" && !draft && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={add}
          placeholder={values.length ? "Add more" : placeholder}
          className="min-w-[120px] flex-1 bg-transparent px-2 text-[13px] outline-none placeholder:text-muted-foreground/70"
        />
      )}
    </div>
  );
}

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

/** A colour well: swatch (native picker) plus a hex field. */
export function ColorField({
  label,
  value,
  onChange,
  onClear,
  disabled,
}: {
  label: string;
  value: string | undefined;
  onChange: (hex: string) => void;
  onClear?: () => void;
  disabled?: boolean;
}) {
  const [text, setText] = React.useState(value ?? "");
  React.useEffect(() => setText(value ?? ""), [value]);
  return (
    <div className="group flex items-center gap-3">
      <label
        className={cn(
          "relative h-11 w-11 shrink-0 cursor-pointer overflow-hidden rounded-[14px] ring-1 ring-[var(--ds-tile-border)] transition-transform hover:scale-[1.04]",
          !value &&
            "bg-[repeating-conic-gradient(var(--ds-well-bg-hover)_0_25%,transparent_0_50%)] [background-size:10px_10px]",
          disabled && "pointer-events-none",
        )}
        style={value ? { background: value } : undefined}
      >
        <input
          type="color"
          value={value ?? "#888888"}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label={`${label} colour`}
        />
      </label>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-muted-foreground">{label}</div>
        <input
          value={text}
          disabled={disabled}
          placeholder="—"
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const t = text.trim();
            if (!t && onClear) onClear();
            else if (HEX_RE.test(t))
              onChange(t.startsWith("#") ? t.toLowerCase() : `#${t.toLowerCase()}`);
            else setText(value ?? "");
          }}
          className="w-full bg-transparent font-mono text-[13px] uppercase tracking-wide text-foreground outline-none"
        />
      </div>
      {value && onClear && !disabled && (
        <button
          type="button"
          onClick={onClear}
          aria-label={`Clear ${label}`}
          className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground opacity-0 transition-opacity hover:bg-[var(--ds-well-bg)] group-hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

const CATEGORIES: Array<{ value: FontCategory | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "sans", label: "Sans" },
  { value: "serif", label: "Serif" },
  { value: "display", label: "Display" },
  { value: "handwriting", label: "Script" },
  { value: "mono", label: "Mono" },
];

/** Searchable Google Fonts picker with live previews, plus the kit's uploaded fonts. */
export function FontPicker({
  value,
  onChange,
  uploaded = [],
  placeholder = "Choose a font",
  disabled,
  sampleText = "The quick brown fox",
}: {
  value: string | undefined;
  onChange: (family: string | undefined, fileId?: string) => void;
  uploaded?: Array<{ id: string; family: string }>;
  placeholder?: string;
  disabled?: boolean;
  sampleText?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [cat, setCat] = React.useState<FontCategory | "all">("all");
  const list = React.useMemo(() => {
    const term = q.trim().toLowerCase();
    return FONT_CATALOG.filter(
      (f) =>
        (cat === "all" || f.category === cat) && (!term || f.family.toLowerCase().includes(term)),
    ).slice(0, 60);
  }, [q, cat]);
  React.useEffect(() => {
    if (open) ensureGoogleFonts(list.map((f) => f.family));
  }, [open, list]);
  React.useEffect(() => {
    if (value) ensureGoogleFonts([value]);
  }, [value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            "ds-well flex h-12 w-full items-center justify-between gap-3 px-4 text-left transition-colors hover:bg-[var(--ds-well-bg-hover)]",
            dsFocus,
            disabled && "opacity-60",
          )}
        >
          <span className="truncate text-[17px]" style={{ fontFamily: fontStack(value) }}>
            {value ?? <span className="text-[13px] text-muted-foreground">{placeholder}</span>}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(360px,90vw)] rounded-[20px] p-2">
        <div className="ds-well mb-2 flex items-center gap-2 px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search fonts"
            className="h-9 flex-1 bg-transparent text-[13px] outline-none"
          />
        </div>
        <div className="mb-2 flex flex-wrap gap-1">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setCat(c.value)}
              className={cn(
                "h-7 rounded-full px-2.5 text-[12px] font-medium transition-colors",
                cat === c.value
                  ? "bg-primary/15 text-foreground"
                  : "text-muted-foreground hover:bg-[var(--ds-well-bg)]",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="max-h-[300px] overflow-y-auto pr-1 scrollbar-thin">
          {uploaded.length > 0 && (
            <>
              <div className="ds-label px-2 pb-1 pt-2">Your fonts</div>
              {uploaded.map((u) => (
                <FontRow
                  key={u.id}
                  family={u.family}
                  active={value === u.family}
                  sample={sampleText}
                  onPick={() => {
                    onChange(u.family, u.id);
                    setOpen(false);
                  }}
                />
              ))}
              <div className="ds-label px-2 pb-1 pt-3">Google Fonts</div>
            </>
          )}
          {list.map((f) => (
            <FontRow
              key={f.family}
              family={f.family}
              active={value === f.family}
              sample={sampleText}
              onPick={() => {
                onChange(f.family);
                setOpen(false);
              }}
            />
          ))}
          {!list.length && (
            <div className="px-3 py-6 text-center text-[13px] text-muted-foreground">
              No fonts match.
            </div>
          )}
        </div>
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange(undefined);
              setOpen(false);
            }}
            className="mt-1 w-full rounded-full py-2 text-[12.5px] text-muted-foreground hover:bg-[var(--ds-well-bg)]"
          >
            Clear
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function FontRow({
  family,
  active,
  sample,
  onPick,
}: {
  family: string;
  active: boolean;
  sample: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        "flex w-full items-center gap-3 rounded-[14px] px-3 py-2 text-left transition-colors",
        active ? "bg-primary/12" : "hover:bg-[var(--ds-well-bg)]",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[11.5px] text-muted-foreground">{family}</div>
        <div
          className="truncate text-[17px] leading-tight"
          style={{ fontFamily: fontStack(family) }}
        >
          {sample}
        </div>
      </div>
      {active && <Check className="h-4 w-4 text-primary" />}
    </button>
  );
}

/** A dashed drop zone that takes files by click or drag. */
export function DropZone({
  accept,
  multiple = true,
  onFiles,
  busy,
  title,
  hint,
  icon: Icon = Plus,
  className,
  compact,
}: {
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  busy?: boolean;
  title: string;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
  compact?: boolean;
}) {
  const [over, setOver] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !busy && input.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !busy) {
          e.preventDefault();
          input.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (busy) return;
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}
      className={cn(
        "group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[20px] border-2 border-dashed text-center transition-all duration-200",
        compact ? "min-h-[120px] p-4" : "min-h-[168px] p-6",
        over
          ? "scale-[1.01] border-primary bg-primary/[0.06]"
          : "border-[var(--ds-tile-border)] hover:border-primary/50 hover:bg-[var(--ds-well-bg)]",
        busy && "pointer-events-none opacity-70",
        dsFocus,
        className,
      )}
    >
      <span
        className={cn(
          "grid h-11 w-11 place-items-center rounded-full bg-primary/12 text-primary transition-transform duration-300",
          over ? "scale-110" : "group-hover:scale-105",
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="text-[13.5px] font-medium">{busy ? "Uploading…" : title}</div>
      {hint && <div className="max-w-[320px] text-[12px] text-muted-foreground">{hint}</div>}
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}
