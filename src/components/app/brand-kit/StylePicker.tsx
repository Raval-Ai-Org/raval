"use client";
// StylePicker — the "Style: Bold launch ▾" pill used wherever Mellox creates:
// Studio, chat, UGC and the calendar. The value is a style id, "none" for
// Brand DNA only, or null for the workspace default. The server re-checks the
// id against the workspace; this is only the choice.
import * as React from "react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BrandKit, Brain, Check, ChevronDown, Plus, Settings2, Star } from "@/components/icons";
import { emitAppEvent } from "@/lib/app-events";
import { ensureGoogleFonts, fontStack } from "@/lib/brand-kit/fonts";
import type { StyleOption } from "@/lib/brand-kit/contracts";
import type { StyleFormat } from "@/lib/brand-kit/spec";
import { rememberStyle, rememberedStyle } from "@/lib/studio/session-store";
import { useStyleOptions } from "./hooks";
import { Swatches } from "./preview";
import { dsFocus } from "@/components/app/surface/buttons";

export type StyleChoiceValue = string | null | undefined;

function appliesTo(option: StyleOption, format?: StyleFormat) {
  return !format || !option.appliesTo.length || option.appliesTo.includes(format);
}

export function StylePicker({
  workspaceId,
  value,
  onChange,
  format,
  disabled,
  size = "md",
  align = "start",
  className,
}: {
  workspaceId: string | null;
  value: StyleChoiceValue;
  onChange: (next: string | null) => void;
  format?: StyleFormat;
  disabled?: boolean;
  size?: "sm" | "md";
  align?: "start" | "end";
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const query = useStyleOptions(workspaceId);
  const options = React.useMemo(() => query.data?.options ?? [], [query.data]);
  const defaultId = query.data?.defaultStyleId ?? null;
  const byId = new Map(options.map((o) => [o.id, o]));
  const defaultOption = defaultId ? byId.get(defaultId) : undefined;

  // What actually applies right now.
  const chosen = value && value !== "none" ? byId.get(value) : undefined;
  const effective =
    value === "none"
      ? null
      : (chosen ?? (defaultOption && appliesTo(defaultOption, format) ? defaultOption : null));

  React.useEffect(() => {
    if (open) ensureGoogleFonts(options.flatMap((o) => [o.headingFont]));
  }, [open, options]);

  const label = value === "none" ? "Brand DNA only" : effective ? effective.name : "Brand DNA only";
  const pick = (next: string | null) => {
    onChange(next);
    setOpen(false);
  };

  if (!workspaceId) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={`Style: ${label}`}
          className={cn(
            "group inline-flex max-w-full items-center gap-2 rounded-full border border-border/70 bg-card/80 font-medium text-foreground/90 transition-all hover:border-primary/40 hover:bg-secondary",
            size === "sm" ? "h-8 pl-2 pr-2.5 text-[12px]" : "h-9 pl-2.5 pr-3 text-[13px]",
            disabled && "opacity-60",
            dsFocus,
            className,
          )}
        >
          {effective?.swatches.length ? (
            <Swatches colors={effective.swatches} size={size === "sm" ? 14 : 16} />
          ) : (
            <BrandKit className={cn("text-primary", size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4")} />
          )}
          <span className="text-muted-foreground">Style</span>
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-[min(340px,92vw)] rounded-[22px] p-2">
        <div className="max-h-[360px] overflow-y-auto scrollbar-thin">
          {defaultOption && (
            <Row
              active={value == null}
              onClick={() => pick(null)}
              title={`Default · ${defaultOption.name}`}
              hint={
                appliesTo(defaultOption, format)
                  ? "Used when you don't pick one"
                  : "Not set for this format"
              }
              option={defaultOption}
              icon={<Star className="h-3.5 w-3.5 text-primary" />}
            />
          )}
          {options
            .filter((o) => o.id !== defaultId || value === o.id)
            .map((o) => (
              <Row
                key={o.id}
                active={value === o.id}
                onClick={() => pick(o.id)}
                title={o.name}
                hint={o.headingFont ?? undefined}
                option={o}
              />
            ))}
          <Row
            active={value === "none" || (value == null && !defaultOption)}
            onClick={() => pick("none")}
            title="Brand DNA only"
            hint="No style, just your brand basics"
            icon={<Brain className="h-4 w-4 text-muted-foreground" />}
          />
          {query.isLoading && (
            <div className="px-3 py-3 text-[12.5px] text-muted-foreground">Loading styles…</div>
          )}
        </div>
        <div className="mt-1 flex gap-1 border-t border-border/60 pt-2">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              emitAppEvent("open:brand-kit", { create: true });
            }}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-[12.5px] font-medium text-foreground transition-colors hover:bg-[var(--ds-well-bg)]"
          >
            <Plus className="h-3.5 w-3.5" /> New style
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              emitAppEvent(
                "open:brand-kit",
                value && value !== "none" ? { styleId: value } : undefined,
              );
            }}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-[var(--ds-well-bg)] hover:text-foreground"
          >
            <Settings2 className="h-3.5 w-3.5" /> Manage
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Row({
  active,
  onClick,
  title,
  hint,
  option,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  hint?: string;
  option?: StyleOption;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left transition-colors",
        active ? "bg-primary/12" : "hover:bg-[var(--ds-well-bg)]",
      )}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[12px] bg-[var(--ds-well-bg)]">
        {option?.swatches.length ? (
          <Swatches colors={option.swatches.slice(0, 3)} size={13} />
        ) : (
          icon
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 truncate text-[13.5px] font-medium">
          {icon && option ? icon : null}
          <span
            className="truncate"
            style={option?.headingFont ? { fontFamily: fontStack(option.headingFont) } : undefined}
          >
            {title}
          </span>
        </span>
        {hint && <span className="block truncate text-[11.5px] text-muted-foreground">{hint}</span>}
      </span>
      {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
    </button>
  );
}

/**
 * The style last picked in this workspace (shared with Studio, per browser).
 * undefined/null = the workspace default.
 */
export function useRememberedStyle(workspaceId: string | null) {
  const [value, setValue] = React.useState<string | null | undefined>(undefined);
  React.useEffect(() => {
    setValue(workspaceId ? rememberedStyle(workspaceId) : undefined);
  }, [workspaceId]);
  const set = React.useCallback(
    (next: string | null) => {
      setValue(next);
      if (workspaceId) rememberStyle(workspaceId, next);
    },
    [workspaceId],
  );
  return [value, set] as const;
}
