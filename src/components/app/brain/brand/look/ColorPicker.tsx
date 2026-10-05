"use client";
// ColorPicker — the Brand Kit's own colour picker: a shade square, a colour
// bar, a hex field, pick-from-screen where the browser has it, and one-tap
// swatches from the brand and from the examples a style was learned from.
// PaletteEditor lays a style's five colours out as tiles that open it.
import * as React from "react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Pipette, Plus, X } from "@/components/icons";
import { dsFocus } from "@/components/app/surface/buttons";
import { hexToHsv, hsvToHex, isHex, readableOn, type Hsv } from "@/lib/brand-look/color";
import { normalizeHex, type StylePalette } from "@/lib/brand-look/spec";

export type SwatchGroup = { label: string; colors: string[] };

const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** Report where the pointer is inside the element, 0..1 on each axis, while it's held. */
function dragProps(onMove: (x: number, y: number) => void) {
  const report = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onMove(clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height));
  };
  return {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      report(e);
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) report(e);
    },
  };
}

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };

export function ColorPicker({
  value,
  onChange,
  onClear,
  groups = [],
  label,
  disabled,
  align = "start",
  defaultOpen = false,
  children,
}: {
  value: string | undefined;
  onChange: (hex: string) => void;
  onClear?: () => void;
  groups?: SwatchGroup[];
  label: string;
  disabled?: boolean;
  align?: "start" | "center" | "end";
  defaultOpen?: boolean;
  /** The button that opens the picker. */
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [hsv, setHsv] = React.useState<Hsv>(() => hexToHsv(isHex(value) ? value : "#7c9a2e"));
  const [text, setText] = React.useState(value ?? "");
  const hex = hsvToHex(hsv);

  // Follow outside changes, but keep the colour bar where it is for greys
  // (a grey has no hue of its own, so re-deriving it would make the bar jump).
  React.useEffect(() => {
    setText(value ?? "");
    if (isHex(value) && normalizeHex(value) !== hsvToHex(hsv)) setHsv(hexToHsv(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const set = (next: Hsv) => {
    setHsv(next);
    const out = hsvToHex(next);
    setText(out);
    onChange(out);
  };
  const pick = (raw: string) => {
    if (!isHex(raw)) return;
    const out = normalizeHex(raw);
    setHsv(hexToHsv(out));
    setText(out);
    onChange(out);
  };

  const dropper =
    typeof window !== "undefined"
      ? (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper
      : undefined;
  const shown = groups
    .map((g) => ({
      ...g,
      colors: g.colors.filter(isHex).map(normalizeHex).filter(uniq).slice(0, 8),
    }))
    .filter((g) => g.colors.length);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        {children}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-[264px] rounded-[22px] p-3">
        <div
          role="slider"
          tabIndex={0}
          aria-label={`${label}: shade`}
          aria-valuetext={hex}
          aria-valuenow={Math.round(hsv.v * 100)}
          {...dragProps((x, y) => set({ ...hsv, s: x, v: 1 - y }))}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 0.1 : 0.02;
            const move: Record<string, Partial<Hsv>> = {
              ArrowLeft: { s: clamp(hsv.s - step) },
              ArrowRight: { s: clamp(hsv.s + step) },
              ArrowUp: { v: clamp(hsv.v + step) },
              ArrowDown: { v: clamp(hsv.v - step) },
            };
            if (!move[e.key]) return;
            e.preventDefault();
            set({ ...hsv, ...move[e.key] });
          }}
          className={cn(
            "relative h-[150px] w-full cursor-crosshair touch-none rounded-[16px] ring-1 ring-black/10",
            dsFocus,
          )}
          style={{
            background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))`,
          }}
        >
          <span
            className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35),0_2px_6px_rgba(0,0,0,0.35)]"
            style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }}
          />
        </div>

        <div
          role="slider"
          tabIndex={0}
          aria-label={`${label}: colour`}
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={Math.round(hsv.h)}
          {...dragProps((x) => set({ ...hsv, h: Math.min(359.9, x * 360) }))}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 10 : 2;
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            const h = hsv.h + (e.key === "ArrowLeft" ? -step : step);
            set({ ...hsv, h: Math.max(0, Math.min(359.9, h)) });
          }}
          className={cn(
            "relative mt-3 h-3.5 w-full cursor-pointer touch-none rounded-full ring-1 ring-black/10",
            dsFocus,
          )}
          style={{
            background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
          }}
        >
          <span
            className="pointer-events-none absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35),0_2px_6px_rgba(0,0,0,0.3)]"
            style={{ left: `${(hsv.h / 360) * 100}%`, background: `hsl(${hsv.h} 100% 50%)` }}
          />
        </div>

        <div className="mt-3 flex items-center gap-2">
          <span
            className="h-9 w-9 shrink-0 rounded-[12px] ring-1 ring-black/10"
            style={{ background: hex }}
          />
          <input
            value={text}
            aria-label={`${label}: hex code`}
            spellCheck={false}
            onChange={(e) => {
              setText(e.target.value);
              const t = e.target.value.trim();
              if (/^#?[0-9a-fA-F]{6}$/.test(t)) pick(t);
            }}
            onBlur={() => (isHex(text) ? pick(text) : setText(value ?? hex))}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="ds-well h-9 min-w-0 flex-1 px-3 font-mono text-[13px] uppercase tracking-wide outline-none focus:ring-2 focus:ring-primary/30"
          />
          {dropper && (
            <button
              type="button"
              aria-label="Pick a colour from the screen"
              title="Pick from screen"
              onClick={() => {
                void new dropper()
                  .open()
                  .then((r) => pick(r.sRGBHex))
                  .catch(() => null);
              }}
              className={cn(
                "ds-well grid h-9 w-9 shrink-0 place-items-center text-muted-foreground transition-colors hover:bg-[var(--ds-well-bg-hover)] hover:text-foreground",
                dsFocus,
              )}
            >
              <Pipette className="h-4 w-4" />
            </button>
          )}
        </div>

        {shown.map((g) => (
          <div key={g.label} className="mt-3">
            <div className="ds-label mb-1.5">{g.label}</div>
            <div className="flex flex-wrap gap-1.5">
              {g.colors.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Use ${c}`}
                  title={c.toUpperCase()}
                  onClick={() => pick(c)}
                  className={cn(
                    "h-7 w-7 rounded-full ring-1 ring-black/10 transition-transform hover:scale-110",
                    isHex(value) &&
                      normalizeHex(value) === c &&
                      "ring-2 ring-primary ring-offset-2 ring-offset-popover",
                    dsFocus,
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
        ))}

        {value && onClear && (
          <button
            type="button"
            onClick={() => {
              onClear();
              setOpen(false);
            }}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-full py-2 text-[12.5px] text-muted-foreground transition-colors hover:bg-[var(--ds-well-bg)] hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" /> Remove
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function uniq<T>(value: T, index: number, all: T[]) {
  return all.indexOf(value) === index;
}

const ROLES = [
  ["primary", "Main"],
  ["secondary", "Second"],
  ["accent", "Accent"],
  ["background", "Background"],
  ["text", "Text"],
] as const;

/**
 * A style's colours as tiles. `fallback` is what applies when a colour isn't
 * set here (Brand DNA); those tiles look faded until someone picks their own.
 */
export function PaletteEditor({
  palette,
  fallback = {},
  onChange,
  groups,
  disabled,
}: {
  palette: StylePalette;
  fallback?: StylePalette;
  onChange: (next: StylePalette) => void;
  groups?: SwatchGroup[];
  disabled?: boolean;
}) {
  const extra = palette.extra ?? [];
  // A colour that was just added opens its picker straight away.
  const [fresh, setFresh] = React.useState<number | null>(null);
  const setExtra = (next: string[]) =>
    onChange({ ...palette, extra: next.length ? next.slice(0, 6) : undefined });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        {ROLES.map(([role, label]) => {
          const own = palette[role];
          const shown = own ?? fallback[role];
          return (
            <ColorPicker
              key={role}
              label={label}
              value={shown}
              groups={groups}
              disabled={disabled}
              onChange={(hex) => onChange({ ...palette, [role]: hex })}
              onClear={own ? () => onChange({ ...palette, [role]: undefined }) : undefined}
            >
              <button
                type="button"
                className={cn("group min-w-0 rounded-[18px] text-left", dsFocus)}
                aria-label={`${label} colour${shown ? `, ${shown}` : ", not set"}`}
              >
                <span
                  className={cn(
                    "grid aspect-square w-full place-items-center rounded-[16px] ring-1 ring-[var(--ds-tile-border)] transition-transform duration-200 group-hover:scale-[1.04]",
                    !shown && "border-2 border-dashed border-[var(--ds-tile-border)] ring-0",
                    shown && !own && "opacity-70",
                  )}
                  style={shown ? { background: shown, color: readableOn(shown) } : undefined}
                >
                  {!shown && <Plus className="h-4 w-4 text-muted-foreground" />}
                </span>
                <span className="mt-1.5 block truncate text-[12px] font-medium">{label}</span>
                <span className="block truncate font-mono text-[10.5px] uppercase text-muted-foreground">
                  {shown ?? "—"}
                </span>
              </button>
            </ColorPicker>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {extra.map((c, i) => (
          <ColorPicker
            key={i}
            label={`Extra colour ${i + 1}`}
            value={c}
            defaultOpen={fresh === i}
            groups={groups}
            disabled={disabled}
            onChange={(hex) => setExtra(extra.map((x, j) => (j === i ? hex : x)))}
            onClear={() => setExtra(extra.filter((_, j) => j !== i))}
          >
            <button
              type="button"
              aria-label={`Extra colour ${c}`}
              className={cn(
                "h-8 w-8 rounded-full ring-1 ring-[var(--ds-tile-border)] transition-transform hover:scale-110",
                dsFocus,
              )}
              style={{ background: c }}
            />
          </ColorPicker>
        ))}
        {!disabled && extra.length < 6 && (
          <button
            type="button"
            onClick={() => {
              setFresh(extra.length);
              setExtra([...extra, palette.accent ?? palette.primary ?? "#8a8f98"]);
            }}
            className={cn(
              "inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-[var(--ds-tile-border)] px-3 text-[12px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground",
              dsFocus,
            )}
          >
            <Plus className="h-3.5 w-3.5" /> Add color
          </button>
        )}
      </div>
    </div>
  );
}
