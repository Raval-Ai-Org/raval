"use client";

// SurfaceLayout — the one structure every large Mellox popup uses (AI
// Visibility, Analytics, Brand DNA, Library, Backlinks, Competitors, Settings):
// a quiet navigation rail on the left and a scrolling page on the right, in the
// manner of Gemini's and ChatGPT's settings. On phones the rail becomes a row
// of pills above the page.
//
// The layout owns scrolling, so nothing has to be sticky with negative
// offsets: the rail never moves, the page scrolls under its own header.
// Visual values come from the `ds-*` tokens in src/styles.css; see
// docs/design-system.md.

import { useId, type ComponentType, type ReactNode } from "react";
import { LayoutGroup, motion } from "framer-motion";
import { cn } from "@/lib/utils";

export type SurfaceNavItem<T extends string> = {
  id: T;
  label: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  /** A small count shown after the label (hidden when 0 or undefined). */
  count?: number;
  /** Draw the count as a lime "new" badge rather than a quiet number. */
  highlight?: boolean;
};

export function SurfaceLayout<T extends string>({
  items,
  value,
  onChange,
  railTop,
  railBottom,
  children,
  label,
}: {
  items: SurfaceNavItem<T>[];
  value: T | null;
  onChange: (id: T) => void;
  /** Above the navigation (desktop only), e.g. the primary action. */
  railTop?: ReactNode;
  /** Pinned to the bottom of the rail (desktop only). */
  railBottom?: ReactNode;
  children: ReactNode;
  label: string;
}) {
  // One animated highlight per rail, so two open surfaces never share it.
  const group = useId();
  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <nav
        aria-label={label}
        className="shrink-0 border-b border-border/60 md:flex md:w-[216px] md:flex-col md:border-b-0 md:border-r md:bg-surface-2/40 md:px-3 md:py-4"
      >
        {railTop && <div className="mb-4 hidden px-1 md:block">{railTop}</div>}
        <LayoutGroup id={group}>
          <ul
            className="flex gap-1 overflow-x-auto px-3 py-2 [scrollbar-width:none] md:flex-col md:overflow-visible md:p-0 [&::-webkit-scrollbar]:hidden"
            role="list"
          >
            {items.map((item) => {
              const active = item.id === value;
              const Icon = item.icon;
              return (
                <li key={item.id} className="shrink-0">
                  <button
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => onChange(item.id)}
                    className={cn(
                      "group relative flex h-9 w-full items-center gap-2.5 whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                      active
                        ? "text-foreground"
                        : "text-muted-foreground hover:bg-[var(--ds-well-bg)] hover:text-foreground",
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="rail-active"
                        aria-hidden
                        transition={{ type: "spring", stiffness: 420, damping: 36 }}
                        className="absolute inset-0 rounded-full bg-primary/12 ring-1 ring-primary/15"
                      />
                    )}
                    <Icon
                      className={cn(
                        "relative h-[18px] w-[18px] shrink-0",
                        active
                          ? "text-primary"
                          : "text-muted-foreground group-hover:text-foreground",
                      )}
                      strokeWidth={active ? 2.2 : 1.9}
                    />
                    <span className="relative min-w-0 flex-1 truncate text-left">{item.label}</span>
                    {!!item.count && (
                      <span
                        className={cn(
                          "relative min-w-[20px] rounded-full px-1.5 text-center text-[11px] font-semibold tabular-nums leading-5",
                          item.highlight
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {item.count > 99 ? "99+" : item.count}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </LayoutGroup>
        {railBottom && <div className="mt-auto hidden px-1 pt-4 md:block">{railBottom}</div>}
      </nav>
      <div className="relative min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin">
        {children}
      </div>
    </div>
  );
}

/**
 * A page inside a SurfaceLayout: one clear title, optional actions on the
 * right, then the content. `width` keeps reading pages from stretching.
 */
export function SurfacePage({
  title,
  subtitle,
  actions,
  children,
  width = "wide",
  className,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  width?: "narrow" | "wide";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 pb-10 pt-5 sm:px-7 sm:pt-6",
        width === "narrow" ? "max-w-[760px]" : "max-w-[1100px]",
        className,
      )}
    >
      {(title || actions) && (
        <header className="mb-5 flex min-h-9 flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {title && <h3 className="ds-page-title truncate">{title}</h3>}
            {subtitle && (
              <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{subtitle}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </div>
  );
}

/** The basic surface of these pages. `interactive` for tiles that open something. */
export function Tile({
  children,
  className,
  interactive,
  as: Tag = "div",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
  as?: "div" | "section" | "li" | "article";
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={cn("ds-tile p-4 sm:p-5", interactive && "ds-tile-hover", className)} {...rest}>
      {children}
    </Tag>
  );
}

/** Small uppercase label above a group of tiles. */
export function GroupLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2.5 mt-7 flex items-center justify-between gap-3 first:mt-0">
      <h4 className="ds-label">{children}</h4>
      {action}
    </div>
  );
}

const TONE_TEXT = {
  default: "text-foreground",
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
} as const;
const TONE_ICON = {
  default: "bg-foreground/[0.06] text-foreground/80",
  primary: "bg-primary/12 text-primary",
  success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning",
  destructive: "bg-destructive/12 text-destructive",
} as const;

/** A big number with a short label — the visual unit of every overview. */
export function Stat({
  label,
  value,
  icon: Icon,
  tone = "default",
  hint,
  onClick,
}: {
  label: string;
  value: ReactNode;
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
  tone?: keyof typeof TONE_TEXT;
  hint?: ReactNode;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2">
        {Icon && (
          <span
            className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full", TONE_ICON[tone])}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
          </span>
        )}
        <span className="truncate text-[12.5px] font-medium text-muted-foreground">{label}</span>
      </div>
      <div
        className={cn(
          "mt-2.5 text-[26px] font-semibold leading-none tabular-nums",
          TONE_TEXT[tone],
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1.5 truncate text-[12px] text-muted-foreground">{hint}</div>}
    </>
  );
  const cls = "ds-tile flex min-w-0 flex-col justify-start p-4 text-left";
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        cls,
        "ds-tile-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
      )}
    >
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}
