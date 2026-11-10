"use client";

// The pictures Autopilot is read by, shared by Home's Autopilot card and the
// full Autopilot screen (Holo style: more picture, fewer words):
//   FlowRail      plan → write → approve → schedule → post, one bubble a stage
//   UpcomingCards the next few pieces as small cards, their picture if made
//   LinkedPlaces  the places Autopilot works with: Calendar, Campaigns, Inspo, Library
// Everything is drawn from the view object; nothing here starts work.
import type { ComponentType, CSSProperties } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  Image as ImageIcon,
  ListChecks,
  Megaphone,
  Palette,
  Pencil,
  CalendarClock,
} from "@/components/icons";
import { PlatformAppIcon } from "@/components/brand/PlatformAppIcon";
import { Illustration, type IlloKind } from "@/components/app/home/illustrations";
import type { ActionView, AutopilotView } from "@/lib/autopilot/contracts";
import { STATUS_LABEL } from "@/lib/autopilot/state";
import type { PulseCampaign } from "@/lib/pulse/pulse";
import type { PlatformId } from "@/lib/social-platforms";
import { PLATFORMS } from "@/lib/social-platforms";
import { STUDIO_FORMATS, isStudioType } from "@/lib/studio/formats";
import { stageCounts } from "./visuals";

const EASE = [0.22, 1, 0.36, 1] as const;

/* ───────────────────────── the flow ───────────────────────── */

const FLOW: {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
}[] = [
  { id: "plan", label: "Planned", icon: CalendarClock },
  { id: "write", label: "Writing", icon: Pencil },
  { id: "approve", label: "To approve", icon: ListChecks },
  { id: "schedule", label: "Scheduled", icon: Clock },
  { id: "post", label: "Posted", icon: CheckCircle2 },
];

/**
 * Where every piece is: five bubbles on one line, the line filling up to the
 * furthest stage that holds something. "To approve" is the only stage a
 * person can press, and it glows while something waits.
 */
export function FlowRail({
  view,
  onApprove,
  size = "md",
}: {
  view: AutopilotView;
  onApprove?: () => void;
  size?: "sm" | "md";
}) {
  const reduce = useReducedMotion();
  const counts = stageCounts(view);
  const last = counts.reduce((at, n, i) => (n ? i : at), -1);
  const fill = last <= 0 ? 0 : last / (FLOW.length - 1);
  const bubble = size === "sm" ? "size-9" : "size-11";
  return (
    <div className="relative" data-size={size}>
      {/* The track sits behind the bubbles, from the first centre to the last. */}
      <div
        aria-hidden
        className={cn(
          "absolute left-[10%] right-[10%] h-[3px] rounded-full bg-foreground/[0.07]",
          size === "sm" ? "top-[17px]" : "top-[21px]",
        )}
      >
        <motion.div
          className="ap-flow-fill h-full rounded-full"
          initial={reduce ? false : { width: 0 }}
          animate={{ width: `${fill * 100}%` }}
          transition={{ duration: 0.9, delay: 0.15, ease: EASE }}
        />
      </div>
      <ol className="relative grid grid-cols-5" aria-label="Where your posts are">
        {FLOW.map((stage, i) => {
          const count = counts[i];
          const Icon = stage.icon;
          const waits = stage.id === "approve" && count > 0;
          const live = stage.id === "write" && count > 0;
          const lit = count > 0;
          const body = (
            <>
              <motion.span
                initial={reduce ? false : { scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 420, damping: 24, delay: 0.08 * i }}
                className={cn(
                  "ap-flow-node relative grid place-items-center rounded-full",
                  bubble,
                  waits
                    ? "bg-[var(--mox-yellow)] text-[var(--mox-ink)]"
                    : lit
                      ? "ap-flow-node--lit text-[var(--mox-ink)]"
                      : "bg-[var(--ds-card-bg)] text-muted-foreground/60 ring-1 ring-[var(--ds-card-border)]",
                )}
                data-live={live ? "" : undefined}
                data-waits={waits ? "" : undefined}
              >
                <Icon className={size === "sm" ? "size-4" : "size-[18px]"} strokeWidth={2.1} />
                {count > 0 && (
                  <span className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-foreground px-1 text-[10.5px] font-bold tabular-nums text-background">
                    {count}
                  </span>
                )}
              </motion.span>
              <span
                className={cn(
                  "mt-1.5 block truncate text-center text-[11px] font-semibold",
                  waits ? "text-foreground" : lit ? "text-foreground/80" : "text-muted-foreground",
                )}
              >
                {stage.label}
              </span>
            </>
          );
          return (
            <li
              key={stage.id}
              className="flex min-w-0 flex-col items-center"
              aria-label={`${stage.label}: ${count}`}
            >
              {waits && onApprove ? (
                <button
                  type="button"
                  onClick={onApprove}
                  aria-label={`${count} to approve. Review them.`}
                  className="flex min-w-0 flex-col items-center rounded-2xl px-1 transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {body}
                </button>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ───────────────────────── coming up ───────────────────────── */

const ILLO_FOR: Record<string, IlloKind> = {
  social: "post",
  image: "poster",
  carousel: "carousel",
  video: "video",
  article: "article",
  story: "story",
};

function dayTime(iso: string | null): string {
  if (!iso) return "Soon";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Soon";
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const days = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - start) / 86_400_000,
  );
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days < 0) return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
}

/** The pieces that come next, in time order: waiting ones first, then the rest. */
export function comingUp(view: AutopilotView, limit = 3): ActionView[] {
  const pieces = [...view.approvals, ...view.upcoming].filter((a) => a.kind === "content");
  const seen = new Set<string>();
  return pieces
    .filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
    .sort((a, b) => (a.plannedFor ?? "~").localeCompare(b.plannedFor ?? "~"))
    .slice(0, limit);
}

function PieceCard({
  action,
  index,
  onOpen,
}: {
  action: ActionView;
  index: number;
  onOpen?: () => void;
}) {
  const reduce = useReducedMotion();
  const waits = action.status === "needs_approval" || action.status === "proposed";
  const writing = action.status === "generating";
  const platform = action.platform as PlatformId | null;
  const type = action.contentType ?? "social";
  const media = action.preview?.frames?.[0] ?? action.preview?.mediaUrl ?? null;
  const format = isStudioType(type) ? STUDIO_FORMATS[type].label : "Post";
  const Tag = onOpen ? "button" : "div";
  return (
    <motion.li
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.12 + index * 0.07, ease: EASE }}
      className="min-w-0"
    >
      <Tag
        {...(onOpen ? { type: "button" as const, onClick: onOpen } : {})}
        title={action.title}
        className={cn(
          "group/piece relative flex w-full min-w-0 items-center gap-2.5 rounded-[18px] border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] p-2 text-left shadow-[var(--ds-card-shadow)] transition-all",
          onOpen &&
            "hover:-translate-y-0.5 hover:shadow-[var(--ds-card-shadow-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        )}
      >
        <span
          className={cn(
            "relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-[13px] bg-[var(--ds-well-bg)]",
            writing && "ap-shimmer-tile",
          )}
        >
          {media ? (
            <img src={media} alt="" loading="lazy" className="size-full object-cover" />
          ) : (
            <Illustration kind={ILLO_FOR[type] ?? "post"} className="size-12" />
          )}
          {platform && PLATFORMS[platform] && (
            <span className="absolute bottom-0.5 right-0.5">
              <PlatformAppIcon platform={platform} size={16} />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold leading-tight">
            {action.preview?.title || action.title}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
            {dayTime(action.plannedFor)} · {format}
          </span>
          <span
            className={cn(
              "mt-1 inline-flex h-[18px] items-center gap-1 rounded-full px-1.5 text-[10px] font-bold",
              waits
                ? "bg-[var(--mox-yellow)] text-[var(--mox-ink)]"
                : writing
                  ? "ds-grad-pill"
                  : "bg-[var(--ds-well-bg)] text-foreground/65",
            )}
          >
            {writing && <span className="ap-live-dot" aria-hidden />}
            {waits ? "Needs your OK" : writing ? "Mox is making it" : STATUS_LABEL[action.status]}
          </span>
        </span>
      </Tag>
    </motion.li>
  );
}

export function UpcomingCards({
  view,
  limit = 3,
  onOpen,
  className,
}: {
  view: AutopilotView;
  limit?: number;
  /** A piece was pressed: waiting ones go to approvals, the rest to the calendar. */
  onOpen?: (action: ActionView) => void;
  className?: string;
}) {
  const pieces = comingUp(view, limit);
  if (!pieces.length) return null;
  return (
    <ul
      aria-label="Coming up"
      className={cn("grid grid-cols-1 gap-2 @lg:grid-cols-2 @3xl:grid-cols-3", className)}
    >
      {pieces.map((a, i) => (
        <PieceCard key={a.id} action={a} index={i} onOpen={onOpen ? () => onOpen(a) : undefined} />
      ))}
    </ul>
  );
}

/** While the first plan is written: three cards being drawn. */
export function UpcomingPlaceholder({ className }: { className?: string }) {
  return (
    <ul
      aria-hidden
      className={cn("grid grid-cols-1 gap-2 @lg:grid-cols-2 @3xl:grid-cols-3", className)}
    >
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className={cn(
            "flex items-center gap-2.5 rounded-[18px] border border-dashed border-[var(--ds-card-border)] p-2",
            i > 0 && "hidden @lg:flex",
            i > 1 && "@lg:hidden @3xl:flex",
          )}
        >
          <span className="ap-shimmer-tile size-12 shrink-0 rounded-[13px] bg-[var(--ds-well-bg)]" />
          <span className="flex-1 space-y-1.5">
            <span className="ap-shimmer-tile block h-2.5 w-4/5 rounded-full bg-[var(--ds-well-bg)]" />
            <span className="ap-shimmer-tile block h-2 w-1/2 rounded-full bg-[var(--ds-well-bg)]" />
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ───────────────────────── works with ───────────────────────── */

export type LinkedPlace = "calendar" | "campaigns" | "style" | "library";

type PlaceChip = {
  id: LinkedPlace;
  label: string;
  value: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  tint: string;
  /** Says what Autopilot does with it, for the title and screen readers. */
  why: string;
};

export function linkedPlaces(view: AutopilotView, campaigns: PulseCampaign[] = []): PlaceChip[] {
  const planned = view.upcoming.length + view.approvals.length;
  const running = campaigns.length;
  const look = view.readiness.find((r) => r.id === "style");
  const made = view.finished.length;
  return [
    {
      id: "calendar",
      label: "Calendar",
      value: planned ? `${planned} planned` : "Shared",
      icon: CalendarDays,
      tint: "hsl(195 95% 55% / 0.16)",
      why: "Autopilot's posts sit on your content calendar, and it never takes a day you filled.",
    },
    {
      id: "campaigns",
      label: "Campaigns",
      value: running ? (running === 1 ? campaigns[0].name : `${running} running`) : "None running",
      icon: Megaphone,
      tint: "hsl(28 95% 60% / 0.16)",
      why: "Autopilot plans around your running campaigns and leaves their days to them.",
    },
    {
      id: "style",
      label: "Inspo",
      value: look && !look.ok ? "Set your look" : "Your look",
      icon: Palette,
      tint: "hsl(285 85% 65% / 0.16)",
      why: "Every piece is made in the look you set in Inspo.",
    },
    {
      id: "library",
      label: "Library",
      value: made ? `${made} made` : "Saves here",
      icon: ImageIcon,
      tint: "hsl(150 90% 50% / 0.16)",
      why: "Everything Autopilot makes is saved in your Library.",
    },
  ];
}

/** Four small tiles: what Autopilot shares with the rest of Mellox. */
export function LinkedPlaces({
  view,
  campaigns,
  onOpen,
  className,
  dense = false,
}: {
  view: AutopilotView;
  campaigns?: PulseCampaign[];
  onOpen: (place: LinkedPlace) => void;
  className?: string;
  dense?: boolean;
}) {
  const reduce = useReducedMotion();
  const chips = linkedPlaces(view, campaigns);
  return (
    <ul
      aria-label="Works with"
      className={cn("grid grid-cols-2 gap-2 @2xl:grid-cols-4", className)}
    >
      {chips.map((c, i) => {
        const Icon = c.icon;
        return (
          <motion.li
            key={c.id}
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.2 + i * 0.05, ease: EASE }}
            className="min-w-0"
          >
            <button
              type="button"
              onClick={() => onOpen(c.id)}
              title={c.why}
              aria-label={`${c.label}: ${c.value}. ${c.why}`}
              className={cn(
                "group/place flex w-full min-w-0 items-center gap-2 rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] text-left transition-all hover:-translate-y-0.5 hover:shadow-[var(--ds-card-shadow-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                dense ? "h-9 pl-1 pr-3" : "h-11 pl-1.5 pr-3.5",
              )}
            >
              <span
                className={cn(
                  "grid shrink-0 place-items-center rounded-full text-foreground/80 transition-transform group-hover/place:scale-110",
                  dense ? "size-7" : "size-8",
                )}
                style={{ background: c.tint } as CSSProperties}
              >
                <Icon className="size-[15px]" strokeWidth={2.1} />
              </span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[12px] font-semibold">{c.label}</span>
                {!dense && (
                  <span className="block truncate text-[10.5px] text-muted-foreground">
                    {c.value}
                  </span>
                )}
              </span>
            </button>
          </motion.li>
        );
      })}
    </ul>
  );
}
