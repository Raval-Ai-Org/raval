"use client";

// Small shared pieces of the Campaigns screen: the kind marks, the phase rail,
// the state pill, channel marks and the format label. Lime is the only accent;
// depth comes from the ds-* tokens.
import type { ComponentType } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  CalendarDays,
  Camera,
  Download,
  Flag,
  Gift,
  Handshake,
  Heart,
  Image as ImageIcon,
  Layers,
  Lightbulb,
  MapPin,
  Megaphone,
  Rocket,
  Smile,
  Snowflake,
  Sparkles,
  Star,
  Story,
  Tag,
  Trophy,
  Type,
  Users,
  Video,
} from "@/components/icons";
import { PlatformAppIcon } from "@/components/brand/PlatformAppIcon";
import type { PlatformId } from "@/lib/campaigns/contracts";
import type { CampaignFormat, CampaignPhase, PieceState } from "@/lib/campaigns/contracts";
import { STATE_LABELS } from "@/lib/campaigns/progress";
import { duration, ease } from "@/lib/motion";
import { cn } from "@/lib/utils";

type Icon = ComponentType<{ className?: string; strokeWidth?: number }>;

const KIND_ICONS: Record<string, Icon> = {
  Rocket,
  CalendarDays,
  Snowflake,
  Tag,
  Sparkles,
  Lightbulb,
  Smile,
  Camera,
  Star,
  Gift,
  Download,
  Handshake,
  Trophy,
  MapPin,
  Users,
  Heart,
};

export function kindIcon(name: string | undefined): Icon {
  return (name && KIND_ICONS[name]) || Megaphone;
}

/** A channel is shown by its app icon, never by its name. */
export function ChannelMark({
  platform,
  size = 16,
  className,
}: {
  platform: PlatformId;
  size?: number;
  className?: string;
}) {
  return <PlatformAppIcon platform={platform} size={size} className={className} label />;
}

const FORMAT_META: Record<CampaignFormat, { label: string; icon: Icon }> = {
  social: { label: "Post", icon: Type },
  image: { label: "Picture", icon: ImageIcon },
  carousel: { label: "Carousel", icon: Layers },
  video: { label: "Video", icon: Video },
  story: { label: "Story", icon: Story },
};

export function FormatChip({ format, className }: { format: CampaignFormat; className?: string }) {
  const { label, icon: Glyph } = FORMAT_META[format];
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full bg-[var(--ds-well-bg)] px-2 text-[11px] font-medium text-foreground/75",
        className,
      )}
    >
      <Glyph className="h-3 w-3" aria-hidden />
      {label}
    </span>
  );
}

const STATE_TONE: Record<PieceState, string> = {
  idea: "bg-[var(--ds-well-bg)] text-muted-foreground",
  planned: "bg-[var(--ds-well-bg)] text-foreground/70",
  making: "bg-primary/12 text-primary",
  waiting: "bg-primary text-primary-foreground shadow-[0_6px_16px_-8px_hsl(var(--primary)/0.8)]",
  scheduled: "bg-primary/15 text-foreground",
  out: "bg-foreground text-background",
  missed: "bg-[var(--ds-well-bg)] text-muted-foreground line-through",
  failed: "bg-destructive/12 text-destructive",
  cancelled: "bg-[var(--ds-well-bg)] text-muted-foreground/70",
};

export function StatePill({ state, className }: { state: PieceState; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-full px-2 text-[10.5px] font-semibold",
        STATE_TONE[state],
        className,
      )}
    >
      {state === "making" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {STATE_LABELS[state]}
    </span>
  );
}

export const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  ready: "Ready to start",
  running: "Running",
  paused: "Paused",
  done: "Finished",
  ended: "Ended",
};

export function StatusPill({ status }: { status: string }) {
  const live = status === "running";
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold",
        live
          ? "bg-primary/15 text-foreground ring-1 ring-primary/30"
          : status === "ready"
            ? "bg-foreground text-background"
            : "bg-[var(--ds-well-bg)] text-muted-foreground",
      )}
    >
      {live && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
        </span>
      )}
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

/**
 * The campaign's phases as one rail, filled up to today. Each phase is a
 * segment sized by its days; the current one glows.
 */
export function PhaseRail({
  phases,
  today,
  compact = false,
}: {
  phases: readonly CampaignPhase[];
  today: string;
  compact?: boolean;
}) {
  const reduce = useReducedMotion();
  if (!phases.length) return null;
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  const start = day(phases[0].startsOn);
  const end = day(phases[phases.length - 1].endsOn) + 1;
  const span = Math.max(1, end - start);
  const now = Math.max(0, Math.min(1, (day(today) + 0.5 - start) / span));
  return (
    <div className="min-w-0">
      <div className="relative flex h-2 w-full gap-[3px] overflow-hidden rounded-full">
        {phases.map((p) => {
          const width = ((day(p.endsOn) + 1 - day(p.startsOn)) / span) * 100;
          const current = p.startsOn <= today && today <= p.endsOn;
          return (
            <span
              key={p.id}
              className={cn(
                "h-full rounded-full bg-[var(--ds-well-bg)]",
                current && "ring-1 ring-primary/40",
              )}
              style={{ width: `${width}%` }}
            />
          );
        })}
        <motion.span
          aria-hidden
          className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,hsl(var(--primary)/0.55),hsl(var(--primary)))] shadow-[0_0_12px_hsl(var(--primary)/0.6)]"
          initial={reduce ? false : { width: 0 }}
          animate={{ width: `${now * 100}%` }}
          transition={{ duration: duration.xslow * 2, ease: ease.emphasized }}
        />
      </div>
      {!compact && (
        <div className="mt-2 flex w-full gap-[3px]">
          {phases.map((p) => {
            const width = ((day(p.endsOn) + 1 - day(p.startsOn)) / span) * 100;
            const current = p.startsOn <= today && today <= p.endsOn;
            return (
              <span
                key={p.id}
                className={cn(
                  "min-w-0 truncate text-[10.5px] font-medium",
                  current ? "text-foreground" : "text-muted-foreground",
                )}
                style={{ width: `${width}%` }}
                title={p.label}
              >
                {p.label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** "Mon 4 Nov" from YYYY-MM-DD, without time zone surprises. */
export function shortDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function countdown(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days > 1) return `In ${days} days`;
  if (days === -1) return "Yesterday";
  return `${-days} days ago`;
}

export { Flag };
