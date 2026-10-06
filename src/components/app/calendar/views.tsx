"use client";

import { useState } from "react";
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  RefreshCw,
  Star,
  Story,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { dsIconBtn } from "@/components/app/surface/buttons";
import { cn } from "@/lib/utils";
import type { MarketingMoment } from "@/lib/studio/moments";
import type { PlannedSlot } from "@/lib/calendar/autopilot";
import {
  CALENDAR_CHANNELS,
  channelInfo,
  fmtYMD,
  isLocked,
  parseYMD,
  type CalendarChannel,
  type CalendarEntry,
} from "@/lib/calendar/model";
import { ChannelBadge, ChannelIcon, clock, StatusChip } from "./shared";
import { ScoreChip } from "@/components/app/audience/audience-ui";
import { useAudienceScores } from "@/components/app/audience/hooks";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const NO_SLOTS: PlannedSlot[] = [];
const SLOT_STATE: Record<PlannedSlot["state"], string> = {
  proposed: "Waiting for your OK",
  planned: "Planned",
  writing: "Being written",
};

export type ViewProps = {
  byDate: Map<string, CalendarEntry[]>;
  /** Pieces Autopilot has planned but not written yet. Read-only. */
  planned: Map<string, PlannedSlot[]>;
  /** Posts on the calendar that Autopilot made. */
  autopilotIds: Set<string>;
  moments: Map<string, MarketingMoment[]>;
  today: string;
  draggingId: string | null;
  busyIds: Set<string>;
  onPickEntry: (id: string) => void;
  onPickPlanned: (slot: PlannedSlot) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDropOnDay: (date: string) => void;
};

function dragProps(e: CalendarEntry, p: Pick<ViewProps, "onDragStart" | "onDragEnd">) {
  // A post that is scheduled or already out keeps its day.
  if (isLocked(e.status)) return { draggable: false };
  return {
    draggable: true,
    onDragStart: (ev: React.DragEvent) => {
      ev.stopPropagation();
      ev.dataTransfer.effectAllowed = "move";
      ev.dataTransfer.setData("text/plain", e.id);
      p.onDragStart(e.id);
    },
    onDragEnd: () => p.onDragEnd(),
  };
}

/** Shared drop-target behaviour for a day cell or column. */
function useDayDrop(draggingId: string | null, onDropOnDay: (date: string) => void) {
  const [over, setOver] = useState<string | null>(null);
  return {
    over: draggingId ? over : null,
    props: (date: string) => ({
      onDragOver: (ev: React.DragEvent) => {
        if (!draggingId) return;
        ev.preventDefault();
        setOver(date);
      },
      onDragLeave: () => setOver((cur) => (cur === date ? null : cur)),
      onDrop: (ev: React.DragEvent) => {
        if (!draggingId) return;
        ev.preventDefault();
        setOver(null);
        onDropOnDay(date);
      },
    }),
  };
}

function MomentLine({ moments }: { moments: MarketingMoment[] }) {
  if (!moments.length) return null;
  return (
    <span
      className="flex min-w-0 items-center gap-1 truncate text-[10px] font-medium text-primary"
      title={moments.map((m) => m.name).join(", ")}
    >
      <Star className="h-2.5 w-2.5 shrink-0" />
      <span className="truncate">{moments[0].name}</span>
    </span>
  );
}

/** The small mark that says "Autopilot made this". */
function AutopilotMark({ className }: { className?: string }) {
  return (
    <Bot
      aria-label="Autopilot"
      className={cn("h-3 w-3 shrink-0 text-muted-foreground", className)}
      strokeWidth={2.2}
    />
  );
}

const longDay = (d: Date) =>
  d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

/* ───────────────────────────── month ───────────────────────────── */

const MONTH_CHIPS = 3;

export function MonthView({
  grid,
  month,
  selectedDate,
  onPickDate,
  onAdd,
  ...p
}: ViewProps & {
  grid: Date[];
  month: number;
  selectedDate: string | null;
  onPickDate: (date: string) => void;
  onAdd: (date: string) => void;
}) {
  const drop = useDayDrop(p.draggingId, p.onDropOnDay);
  // A sixth week that belongs wholly to next month only makes every day smaller.
  const days = grid[35].getMonth() === month ? grid : grid.slice(0, 35);
  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-2">
      <div className="mb-1.5 grid grid-cols-7 gap-1.5">
        {DOW.map((d) => (
          <div key={d} className="ds-label px-2">
            {d}
          </div>
        ))}
      </div>
      <div
        className="grid min-h-0 flex-1 grid-cols-7 gap-1.5"
        style={{ gridTemplateRows: `repeat(${days.length / 7}, minmax(0, 1fr))` }}
      >
        {days.map((d) => {
          const date = fmtYMD(d);
          const items = p.byDate.get(date) ?? [];
          const slots = p.planned.get(date) ?? NO_SLOTS;
          const total = items.length + slots.length;
          const shownItems = items.slice(0, MONTH_CHIPS);
          const shownSlots = slots.slice(0, MONTH_CHIPS - shownItems.length);
          const more = total - shownItems.length - shownSlots.length;
          const inMonth = d.getMonth() === month;
          const isToday = date === p.today;
          return (
            <div
              key={date}
              role="button"
              tabIndex={0}
              aria-label={`${longDay(d)}, ${total} ${total === 1 ? "post" : "posts"}`}
              onClick={() => onPickDate(date)}
              onKeyDown={(ev) => {
                if (ev.target !== ev.currentTarget) return;
                if (ev.key === "Enter" || ev.key === " ") {
                  ev.preventDefault();
                  onPickDate(date);
                }
              }}
              {...drop.props(date)}
              className={cn(
                "group @container relative flex min-h-[72px] min-w-0 cursor-pointer flex-col gap-1 overflow-hidden rounded-2xl border p-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40",
                inMonth
                  ? "border-[var(--ds-tile-border)] bg-[var(--ds-tile-bg)] hover:border-foreground/20"
                  : "border-transparent text-muted-foreground/60 hover:bg-[var(--ds-well-bg)]",
                selectedDate === date && "border-primary/60 hover:border-primary/60",
                p.draggingId && "border-dashed",
                drop.over === date && "border-solid border-primary bg-primary/10",
              )}
            >
              <div className="flex h-5 shrink-0 items-center gap-1">
                <span
                  className={cn(
                    "grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1 text-[11px] font-semibold tabular-nums",
                    isToday && "bg-primary text-primary-foreground",
                  )}
                >
                  {d.getDate()}
                </span>
                <MomentLine moments={p.moments.get(date) ?? []} />
                <button
                  type="button"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onAdd(date);
                  }}
                  className="absolute right-1 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-card text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                  aria-label={`Add a post on ${longDay(d)}`}
                  title="Add a post"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
              <div className="flex min-h-0 flex-col gap-0.5">
                {shownItems.map((e) => {
                  const { color } = channelInfo(e.channel);
                  const open = e.status === "draft" || e.status === "review";
                  return (
                    <button
                      key={e.id}
                      type="button"
                      {...dragProps(e, p)}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        p.onPickEntry(e.id);
                      }}
                      title={`${clock(e.time)} · ${e.title}`}
                      className={cn(
                        "flex h-[19px] shrink-0 items-center gap-1 rounded-md px-1 text-left text-[10.5px] font-medium text-foreground/90 transition hover:brightness-110",
                        !isLocked(e.status) && "cursor-grab active:cursor-grabbing",
                        p.draggingId === e.id && "opacity-50",
                      )}
                      // Not approved yet: an outline. Approved or out: filled.
                      style={
                        open
                          ? { boxShadow: `inset 0 0 0 1px ${color}66` }
                          : { background: `${color}2e` }
                      }
                    >
                      {p.busyIds.has(e.id) ? (
                        <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin" />
                      ) : e.story ? (
                        // The Story ring marks what disappears after a day.
                        <Story
                          aria-label="Story"
                          className="h-2.5 w-2.5 shrink-0"
                          style={{ color }}
                        />
                      ) : (
                        <span className="grid shrink-0 place-items-center">
                          <ChannelIcon channel={e.channel} size={10} />
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate">{e.title}</span>
                      {e.status === "failed" ? (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive"
                          aria-label="Failed"
                        />
                      ) : p.autopilotIds.has(e.id) ? (
                        <AutopilotMark className="hidden h-2.5 w-2.5 @[112px]:block" />
                      ) : null}
                    </button>
                  );
                })}
                {shownSlots.map((slot) => (
                  <button
                    key={slot.id}
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      p.onPickPlanned(slot);
                    }}
                    title={`Autopilot · ${SLOT_STATE[slot.state]} · ${clock(slot.time)} · ${slot.title}`}
                    className="flex h-[19px] shrink-0 items-center gap-1 rounded-md border border-dashed border-foreground/25 px-1 text-left text-[10.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {slot.state === "writing" ? (
                      <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin" />
                    ) : (
                      <AutopilotMark className="h-2.5 w-2.5" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{slot.title}</span>
                  </button>
                ))}
                {more > 0 && (
                  <span className="px-1 text-[10px] font-medium text-muted-foreground">
                    +{more} more
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────────────────── week ───────────────────────────── */

export function WeekView({
  days,
  onAdd,
  ...p
}: ViewProps & { days: Date[]; onAdd: (date: string) => void }) {
  const drop = useDayDrop(p.draggingId, p.onDropOnDay);
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3 scrollbar-thin">
      <div className="grid min-h-full min-w-[860px] grid-cols-7 gap-1.5">
        {days.map((d, i) => {
          const date = fmtYMD(d);
          const items = p.byDate.get(date) ?? [];
          const slots = p.planned.get(date) ?? NO_SLOTS;
          const isToday = date === p.today;
          return (
            <div
              key={date}
              {...drop.props(date)}
              className={cn(
                "group flex min-h-[260px] min-w-0 flex-col gap-1.5 rounded-2xl border border-[var(--ds-tile-border)] bg-[var(--ds-tile-bg)] p-2 transition-colors",
                p.draggingId && "border-dashed",
                drop.over === date && "border-solid border-primary bg-primary/10",
              )}
            >
              <div className="flex h-6 items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="ds-label">{DOW[i]}</span>
                  <span
                    className={cn(
                      "grid h-6 min-w-6 place-items-center rounded-full text-[13px] font-semibold tabular-nums",
                      isToday && "bg-primary text-primary-foreground",
                    )}
                  >
                    {d.getDate()}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onAdd(date)}
                  className={cn(
                    dsIconBtn,
                    "h-6 w-6 opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
                  )}
                  aria-label={`Add a post on ${longDay(d)}`}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              <MomentLine moments={p.moments.get(date) ?? []} />
              {items.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  {...dragProps(e, p)}
                  onClick={() => p.onPickEntry(e.id)}
                  className={cn(
                    "min-w-0 rounded-xl border border-border bg-card p-2 text-left transition-colors hover:border-foreground/25",
                    !isLocked(e.status) && "cursor-grab active:cursor-grabbing",
                    p.draggingId === e.id && "opacity-50",
                  )}
                >
                  <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                    <ChannelIcon channel={e.channel} size={12} />
                    <span className="whitespace-nowrap tabular-nums">{clock(e.time)}</span>
                    {p.busyIds.has(e.id) && <Loader2 className="h-3 w-3 animate-spin" />}
                    {p.autopilotIds.has(e.id) && <AutopilotMark className="ml-auto" />}
                  </div>
                  <div className="mt-1 line-clamp-3 text-[12px] font-medium leading-snug">
                    {e.title}
                  </div>
                  <StatusChip status={e.status} className="mt-1.5 inline-block" />
                </button>
              ))}
              {slots.map((slot) => (
                <button
                  key={slot.id}
                  type="button"
                  onClick={() => p.onPickPlanned(slot)}
                  className="min-w-0 rounded-xl border border-dashed border-foreground/25 p-2 text-left text-muted-foreground transition-colors hover:text-foreground"
                >
                  <div className="flex items-center gap-1.5 text-[10.5px]">
                    <ChannelIcon channel={slot.channel} size={12} />
                    <span className="whitespace-nowrap tabular-nums">{clock(slot.time)}</span>
                    {slot.state === "writing" ? (
                      <Loader2 className="ml-auto h-3 w-3 animate-spin" />
                    ) : (
                      <AutopilotMark className="ml-auto" />
                    )}
                  </div>
                  <div className="mt-1 line-clamp-3 text-[12px] font-medium leading-snug">
                    {slot.title}
                  </div>
                  <div className="mt-1.5 text-[10.5px] font-medium">{SLOT_STATE[slot.state]}</div>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A piece Autopilot has planned, as a row in a list. */
function PlannedRow({ slot, onPick }: { slot: PlannedSlot; onPick: (slot: PlannedSlot) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(slot)}
      className="flex w-full items-center gap-2.5 rounded-[var(--ds-radius-tile)] border border-dashed border-foreground/20 p-2.5 text-left transition-colors hover:border-foreground/35"
    >
      <ChannelBadge channel={slot.channel} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium">{slot.title}</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {clock(slot.time)} · {slot.format}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-[var(--ds-well-bg)] px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground">
        {slot.state === "writing" ? (
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
        ) : (
          <AutopilotMark className="h-2.5 w-2.5" />
        )}
        {SLOT_STATE[slot.state]}
      </span>
    </button>
  );
}

/* ───────────────────────────── list ───────────────────────────── */

export function ListView({
  onRegenerate,
  ...p
}: ViewProps & { onRegenerate: (id: string) => void }) {
  const dates = [...new Set([...p.byDate.keys(), ...p.planned.keys()])].sort();
  // Audience scores that still match each saved post (none when Audience is off).
  const workspaceId = useOptionalWorkspaceId();
  const { data: scores } = useAudienceScores(
    workspaceId,
    [...p.byDate.values()]
      .flatMap((items) => items.map((e) => e.id))
      .filter((id) => UUID_RE.test(id)),
  );
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 scrollbar-thin sm:p-4">
      {dates.map((date) => {
        const d = parseYMD(date);
        const items = p.byDate.get(date) ?? [];
        const slots = p.planned.get(date) ?? NO_SLOTS;
        return (
          <div key={date}>
            <div className="mb-1.5 flex items-center gap-2 px-1">
              <h3 className={cn("text-[12.5px] font-semibold", date === p.today && "text-primary")}>
                {d.toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                })}
              </h3>
              <MomentLine moments={p.moments.get(date) ?? []} />
            </div>
            <ul className="space-y-1.5">
              {items.map((e) => (
                <li key={e.id} className="relative">
                  <button
                    type="button"
                    {...dragProps(e, p)}
                    onClick={() => p.onPickEntry(e.id)}
                    className="ds-tile ds-tile-hover flex w-full items-center gap-3 p-2.5 pr-12 text-left"
                  >
                    <ChannelBadge channel={e.channel} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{e.title}</span>
                      <span className="block truncate text-[11.5px] text-muted-foreground">
                        {clock(e.time)} · {channelInfo(e.channel).label} · {e.format}
                        {e.topic ? ` · ${e.topic}` : ""}
                      </span>
                    </span>
                    {p.autopilotIds.has(e.id) && <AutopilotMark />}
                    {scores?.[e.id] ? <ScoreChip overall={scores[e.id].overall} /> : null}
                    <StatusChip status={e.status} />
                  </button>
                  {!isLocked(e.status) && (
                    <button
                      type="button"
                      onClick={() => onRegenerate(e.id)}
                      disabled={p.busyIds.has(e.id)}
                      className={cn(dsIconBtn, "absolute right-2 top-1/2 -translate-y-1/2")}
                      aria-label="Rewrite"
                      title="Rewrite"
                    >
                      {p.busyIds.has(e.id) ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                    </button>
                  )}
                </li>
              ))}
              {slots.map((slot) => (
                <li key={slot.id}>
                  <PlannedRow slot={slot} onPick={p.onPickPlanned} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/* ───────────────────────────── day panel ───────────────────────────── */

export function DayPanel({
  date,
  today,
  entries,
  planned,
  autopilotIds,
  moments,
  onPickEntry,
  onPickPlanned,
  onStep,
  onAdd,
}: {
  date: string;
  today: string;
  entries: CalendarEntry[];
  planned: PlannedSlot[];
  autopilotIds: Set<string>;
  moments: MarketingMoment[];
  onPickEntry: (id: string) => void;
  onPickPlanned: (slot: PlannedSlot) => void;
  onStep: (dir: 1 | -1) => void;
  onAdd: (date: string, title?: string) => void;
}) {
  const d = parseYMD(date);
  const total = entries.length + planned.length;
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold tracking-[-0.01em]">
            {date === today ? "Today" : d.toLocaleDateString(undefined, { weekday: "long" })}
          </h3>
          <div className="truncate text-[11.5px] text-muted-foreground">
            {d.toLocaleDateString(undefined, { month: "long", day: "numeric" })} ·{" "}
            {total ? `${total} ${total === 1 ? "post" : "posts"}` : "Nothing planned"}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onStep(-1)}
          className={dsIconBtn}
          aria-label="Previous day"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => onStep(1)} className={dsIconBtn} aria-label="Next day">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {moments.map((m) => (
        <div key={m.id} className="rounded-2xl bg-primary/10 p-3">
          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold">
            <Star className="h-3.5 w-3.5 text-primary" /> {m.name}
          </div>
          <p className="mt-1 text-[11.5px] text-muted-foreground">{m.angle}</p>
          <button
            type="button"
            onClick={() => onAdd(date, m.name)}
            className="mt-2 text-[11.5px] font-medium text-primary hover:underline"
          >
            Add a post for this
          </button>
        </div>
      ))}

      {total > 0 && (
        <ul className="space-y-1.5">
          {entries.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => onPickEntry(e.id)}
                className="ds-tile ds-tile-hover flex w-full items-center gap-2.5 p-2.5 text-left"
              >
                <ChannelBadge channel={e.channel} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium">{e.title}</span>
                  <span className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                    {clock(e.time)} · {e.format}
                    {autopilotIds.has(e.id) && <AutopilotMark className="h-2.5 w-2.5" />}
                  </span>
                </span>
                <StatusChip status={e.status} />
              </button>
            </li>
          ))}
          {planned.map((slot) => (
            <li key={slot.id}>
              <PlannedRow slot={slot} onPick={onPickPlanned} />
            </li>
          ))}
        </ul>
      )}

      <Button variant="outline" onClick={() => onAdd(date)} className="w-full">
        <Plus /> Add a post
      </Button>
    </div>
  );
}

/* ───────────────────────── channel drop lanes ───────────────────────── */

/** Shown while a post is being dragged: drop on a channel to move it there. */
export function ChannelLanes({ onDropChannel }: { onDropChannel: (ch: CalendarChannel) => void }) {
  const [over, setOver] = useState<CalendarChannel | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-primary/5 px-3 py-2">
      <span className="ds-label">Move to</span>
      {CALENDAR_CHANNELS.map((c) => (
        <span
          key={c.id}
          onDragOver={(ev) => {
            ev.preventDefault();
            setOver(c.id);
          }}
          onDragLeave={() => setOver((cur) => (cur === c.id ? null : cur))}
          onDrop={(ev) => {
            ev.preventDefault();
            setOver(null);
            onDropChannel(c.id);
          }}
          className={cn(
            "flex items-center gap-1 rounded-full border border-dashed border-foreground/30 px-2 py-0.5 text-[11px] font-medium transition",
            over === c.id && "border-solid text-white",
          )}
          style={over === c.id ? { background: c.color, borderColor: c.color } : undefined}
        >
          <ChannelIcon channel={c.id} size={12} brand={over !== c.id} />
          {c.label}
        </span>
      ))}
    </div>
  );
}

/* ───────────────────────────── loading ───────────────────────────── */

/** Shaped like the view it stands in for, so the layout does not jump. */
export function CalendarSkeleton({ view }: { view: "month" | "week" | "list" }) {
  if (view === "list") {
    return (
      <div className="flex-1 space-y-2 overflow-hidden p-4" role="status" aria-label="Loading">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl border border-border p-3">
            <div className="size-9 shrink-0 animate-pulse rounded-lg bg-surface-2" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3.5 w-1/3 animate-pulse rounded bg-surface-2" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-surface-2" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  const rows = view === "week" ? 1 : 5;
  return (
    <div className="flex min-h-0 flex-1 flex-col p-3" role="status" aria-label="Loading">
      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-4 animate-pulse rounded bg-surface-2" />
        ))}
      </div>
      <div
        className="mt-1.5 grid min-h-0 flex-1 grid-cols-7 gap-1.5"
        style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: rows * 7 }).map((_, i) => (
          <div key={i} className="animate-pulse rounded-lg bg-surface-2" />
        ))}
      </div>
    </div>
  );
}
