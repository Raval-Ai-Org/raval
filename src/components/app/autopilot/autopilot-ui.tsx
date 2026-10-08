"use client";
// Small shared pieces for the Autopilot surface and the Agency HQ view.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ActionStatus, ActionView, OpportunityKind } from "@/lib/autopilot/contracts";
import { STATUS_LABEL, statusTone, type StatusTone } from "@/lib/autopilot/state";
import { PLATFORMS, type PlatformId } from "@/lib/social-platforms";
import { STUDIO_FORMATS, isStudioType } from "@/lib/studio/formats";

const TONE: Record<StatusTone, { dot: string; text: string; pulse?: boolean }> = {
  neutral: { dot: "bg-muted-foreground/50", text: "text-muted-foreground" },
  active: { dot: "bg-primary", text: "text-foreground", pulse: true },
  attention: { dot: "bg-warning", text: "text-foreground" },
  good: { dot: "bg-success", text: "text-foreground" },
  bad: { dot: "bg-destructive", text: "text-destructive" },
};

export function Dot({ tone, pulse }: { tone: StatusTone; pulse?: boolean }) {
  const t = TONE[tone];
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      {(pulse ?? t.pulse) && (
        <span
          className={cn(
            "absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 motion-reduce:hidden",
            t.dot,
          )}
        />
      )}
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", t.dot)} />
    </span>
  );
}

export function StatusPill({ status, label }: { status: ActionStatus; label?: string }) {
  const tone = statusTone(status);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--ds-well-bg)] px-2.5 py-1 text-[11.5px] font-medium",
        TONE[tone].text,
      )}
    >
      <Dot tone={tone} pulse={status === "generating"} />
      {label ?? STATUS_LABEL[status]}
    </span>
  );
}

export function platformLabel(platform: string | null | undefined): string {
  if (!platform) return "";
  return PLATFORMS[platform as PlatformId]?.label ?? platform;
}

export function pieceLabel(action: Pick<ActionView, "contentType" | "platform">): string {
  const noun = isStudioType(action.contentType) ? STUDIO_FORMATS[action.contentType].label : "Post";
  const where = platformLabel(action.platform);
  return where ? `${where} · ${noun}` : noun;
}

export const KIND_LABEL: Record<OpportunityKind, string> = {
  trend: "Market trend",
  competitor: "Competitor move",
  news: "In the news",
  customer: "Customer signal",
  performance: "Your results",
  visibility: "AI visibility",
};

/** "Tue 7 Oct, 09:00" in the viewer's own time zone. */
export function whenLabel(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function dayLabel(iso: string | null): string {
  if (!iso) return "No date";
  const date = new Date(iso);
  const today = new Date();
  const days = Math.round(
    (new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
      86_400_000,
  );
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

/** A chip the person can switch on or off. */
export function Chip({
  active,
  onClick,
  children,
  disabled,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-45",
        active
          ? "border-primary/40 bg-primary/12 text-foreground"
          : "border-border/70 bg-card/60 text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** One thing Autopilot does, with the switch that turns it on or off. */
export function SwitchRow({
  on,
  onChange,
  label,
  detail,
  note,
  disabled,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
  detail?: ReactNode;
  /** A second line that only matters while it is on. */
  note?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className={cn(
          "relative mt-0.5 h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50",
          on ? "bg-primary" : "bg-[var(--ds-well-bg-hover)] ring-1 ring-inset ring-border/70",
        )}
      >
        <span
          className={cn(
            "absolute left-[3px] top-[3px] h-4 w-4 rounded-full shadow-sm transition-transform duration-200",
            on ? "translate-x-4 bg-primary-foreground" : "bg-foreground/60",
          )}
        />
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium">{label}</p>
        {detail && <p className="text-[12.5px] leading-snug text-muted-foreground">{detail}</p>}
        {on && note && <p className="mt-1 text-[12.5px] leading-snug text-warning">{note}</p>}
      </div>
    </div>
  );
}

/** One line of an action list: when, what, where it stands. */
export function ActionLine({
  action,
  right,
  showTime = true,
}: {
  action: ActionView;
  right?: ReactNode;
  showTime?: boolean;
}) {
  return (
    <li className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium">{action.title || pieceLabel(action)}</p>
        <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
          {pieceLabel(action)}
          {showTime && action.plannedFor ? ` · ${whenLabel(action.plannedFor)}` : ""}
          {action.error && (action.status === "failed" || action.status === "skipped")
            ? ` · ${action.error}`
            : ""}
        </p>
      </div>
      {right ?? <StatusPill status={action.status} />}
    </li>
  );
}
