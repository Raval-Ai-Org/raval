"use client";

import { useState } from "react";
import { Loader2, Plus, RefreshCw, Star, Story } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { dsIconBtn } from "@/components/app/surface/buttons";
import { cn } from "@/lib/utils";
import type { MarketingMoment } from "@/lib/studio/moments";
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

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export type ViewProps = {
  byDate: Map<string, CalendarEntry[]>;
  moments: Map<string, MarketingMoment[]>;
  today: string;
  draggingId: string | null;
  busyIds: Set<string>;
  onPickEntry: (id: string) => void;
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
      className="flex items-center gap-1 truncate text-[10px] font-medium text-primary"
      title={moments.map((m) => m.name).join(", ")}
    >
      <Star className="h-2.5 w-2.5 shrink-0" />
      <span className="truncate">{moments[0].name}</span>
    </span>
  );
}

/* ───────────────────────────── month ───────────────────────────── */

export function MonthView({
  grid,
  month,
  selectedDate,
  onPickDate,
  ...p
}: ViewProps & {
  grid: Date[];
  month: number;
  selectedDate: string | null;
  onPickDate: (date: string) => void;
}) {
  const drop = useDayDrop(p.draggingId, p.onDropOnDay);
  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <div className="mb-1 grid grid-cols-7 gap-1 px-1">
        {DOW.map((d) => (
          <div key={d} className="ds-label text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-1">
        {grid.map((d) => {
          const date = fmtYMD(d);
          const items = p.byDate.get(date) ?? [];
          const inMonth = d.getMonth() === month;
          const isToday = date === p.today;
          return (
            <div
              key={date}
              role="button"
              tabIndex={0}
              aria-label={`${d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}, ${items.length} ${items.length === 1 ? "post" : "posts"}`}
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
                "flex min-h-[76px] cursor-pointer flex-col gap-1 overflow-hidden rounded-xl border p-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40",
                inMonth
                  ? "border-[var(--ds-tile-border)] bg-[var(--ds-tile-bg)]"
                  : "border-transparent bg-transparent text-muted-foreground/60",
                "hover:border-foreground/25",
                selectedDate === date && "border-primary/50",
                p.draggingId && "border-dashed",
                drop.over === date && "border-solid border-primary bg-primary/10",
              )}
            >
              <div className="flex items-center justify-between gap-1">
                <span
                  className={cn(
                    "text-[11px] font-semibold tabular-nums",
                    isToday &&
                      "grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground",
                  )}
                >
                  {d.getDate()}
                </span>
                {items.length > 3 && (
                  <span className="text-[10px] font-medium text-muted-foreground">
                    {items.length}
                  </span>
                )}
              </div>
              <MomentLine moments={p.moments.get(date) ?? []} />
              <div className="flex min-h-0 flex-col gap-0.5">
                {items.slice(0, 3).map((e) => {
                  const { color } = channelInfo(e.channel);
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
                        "flex items-center gap-1 rounded-md px-1 py-0.5 text-left text-[10.5px] font-medium text-foreground/90 hover:brightness-110",
                        !isLocked(e.status) && "cursor-grab active:cursor-grabbing",
                        p.draggingId === e.id && "opacity-50",
                        (e.status === "draft" || e.status === "review") && "opacity-80",
                      )}
                      style={{ background: `${color}26` }}
                    >
                      {p.busyIds.has(e.id) ? (
                        <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin" />
                      ) : e.story ? (
                        // The Story ring marks what disappears after a day.
                        <Story
                          aria-label="Story"
                          className="h-2.5 w-2.5 shrink-0"
                          style={{
                            color,
                            opacity: e.status === "draft" || e.status === "review" ? 0.6 : 1,
                          }}
                        />
                      ) : (
                        // A hollow dot is a post nobody has approved yet.
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={
                            e.status === "draft" || e.status === "review"
                              ? { boxShadow: `inset 0 0 0 1px ${color}` }
                              : { background: color }
                          }
                        />
                      )}
                      <span className="truncate">{e.title}</span>
                    </button>
                  );
                })}
                {items.length > 3 && (
                  <span className="px-1 text-[10px] text-muted-foreground">
                    +{items.length - 3} more
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
          const isToday = date === p.today;
          return (
            <div
              key={date}
              {...drop.props(date)}
              className={cn(
                "group flex min-h-[260px] flex-col gap-1.5 rounded-2xl border border-[var(--ds-tile-border)] bg-[var(--ds-tile-bg)] p-2 transition-colors",
                p.draggingId && "border-dashed",
                drop.over === date && "border-solid border-primary bg-primary/10",
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-baseline gap-1.5">
                  <span className="ds-label">{DOW[i]}</span>
                  <span
                    className={cn(
                      "text-[13px] font-semibold tabular-nums",
                      isToday &&
                        "grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground",
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
                  aria-label={`Add a post on ${d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}`}
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
                    "rounded-xl border border-border bg-card p-2 text-left transition-colors hover:border-foreground/25",
                    !isLocked(e.status) && "cursor-grab active:cursor-grabbing",
                    p.draggingId === e.id && "opacity-50",
                  )}
                >
                  <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                    <ChannelIcon channel={e.channel} size={12} />
                    <span className="tabular-nums">{clock(e.time)}</span>
                    {p.busyIds.has(e.id) && <Loader2 className="h-3 w-3 animate-spin" />}
                  </div>
                  <div className="mt-1 line-clamp-3 text-[12px] font-medium leading-snug">
                    {e.title}
                  </div>
                  <StatusChip status={e.status} className="mt-1.5 inline-block" />
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────────────────── list ───────────────────────────── */

export function ListView({
  onRegenerate,
  ...p
}: ViewProps & { onRegenerate: (id: string) => void }) {
  const days = [...p.byDate.entries()];
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 scrollbar-thin sm:p-4">
      {days.map(([date, items]) => {
        const d = parseYMD(date);
        return (
          <section key={date}>
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
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/* ───────────────────────────── day panel ───────────────────────────── */

export function DayPanel({
  date,
  entries,
  moments,
  onPickEntry,
  onAdd,
}: {
  date: string;
  entries: CalendarEntry[];
  moments: MarketingMoment[];
  onPickEntry: (id: string) => void;
  onAdd: (date: string, title?: string) => void;
}) {
  const d = parseYMD(date);
  return (
    <section className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold">
          {d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
        </h3>
        <Button size="sm" variant="outline" onClick={() => onAdd(date)}>
          <Plus /> Add post
        </Button>
      </div>

      {moments.map((m) => (
        <div key={m.id} className="rounded-xl bg-primary/10 p-3">
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

      {entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-4 text-center text-[12px] text-muted-foreground">
          Nothing planned
        </p>
      ) : (
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
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {clock(e.time)} · {e.format}
                  </span>
                </span>
                <StatusChip status={e.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
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
