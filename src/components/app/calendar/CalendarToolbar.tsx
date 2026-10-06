"use client";

// The calendar's one toolbar row: where you are, how you look at it, and what
// is shown. Filters live in a single menu so the row never wraps into itself.

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Filter, Plus, Search, X } from "@/components/icons";
import { dsGhostBtn, dsIconBtn } from "@/components/app/surface/buttons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  CALENDAR_CHANNELS,
  CALENDAR_STATUSES,
  NO_FILTER,
  STATUS_LABEL,
  type CalendarFilter,
} from "@/lib/calendar/model";
import { ChannelIcon } from "./shared";

export type CalendarViewId = "month" | "week" | "list";

function Option({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
        on
          ? "border-primary/40 bg-primary/12 text-foreground"
          : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function FilterMenu({
  filter,
  onChange,
}: {
  filter: CalendarFilter;
  onChange: (next: CalendarFilter) => void;
}) {
  const format = filter.format ?? "all";
  const count =
    (filter.channel !== "all" ? 1 : 0) +
    (filter.status !== "all" ? 1 : 0) +
    (format !== "all" ? 1 : 0);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            dsGhostBtn,
            "h-8 shrink-0 px-2.5 text-[12px] @3xl:px-3",
            count > 0 && "border-primary/40 bg-primary/10 text-foreground",
          )}
          aria-label={count ? `Filter, ${count} on` : "Filter"}
        >
          <Filter className="h-3.5 w-3.5" />
          <span className="hidden @3xl:inline">Filter</span>
          {count > 0 && (
            <span className="grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold tabular-nums text-primary-foreground">
              {count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[19rem] space-y-3.5 p-3.5">
        <div>
          <div className="ds-label mb-1.5">Channel</div>
          <div className="flex flex-wrap gap-1.5">
            <Option
              on={filter.channel === "all"}
              onClick={() => onChange({ ...filter, channel: "all" })}
            >
              All
            </Option>
            {CALENDAR_CHANNELS.map((c) => (
              <Option
                key={c.id}
                on={filter.channel === c.id}
                onClick={() =>
                  onChange({ ...filter, channel: filter.channel === c.id ? "all" : c.id })
                }
              >
                <ChannelIcon channel={c.id} size={12} />
                {c.label}
              </Option>
            ))}
          </div>
        </div>
        <div>
          <div className="ds-label mb-1.5">Status</div>
          <div className="flex flex-wrap gap-1.5">
            <Option
              on={filter.status === "all"}
              onClick={() => onChange({ ...filter, status: "all" })}
            >
              Any
            </Option>
            {CALENDAR_STATUSES.map((s) => (
              <Option
                key={s}
                on={filter.status === s}
                onClick={() => onChange({ ...filter, status: filter.status === s ? "all" : s })}
              >
                {STATUS_LABEL[s]}
              </Option>
            ))}
          </div>
        </div>
        <div>
          <div className="ds-label mb-1.5">Show</div>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["all", "Everything"],
                ["posts", "Posts"],
                ["stories", "Stories"],
              ] as const
            ).map(([id, label]) => (
              <Option
                key={id}
                on={format === id}
                onClick={() => onChange({ ...filter, format: id })}
              >
                {label}
              </Option>
            ))}
          </div>
        </div>
        {count > 0 && (
          <button
            type="button"
            onClick={() => onChange({ ...NO_FILTER, query: filter.query })}
            className="text-[12px] font-medium text-primary hover:underline"
          >
            Clear filters
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const shown = open || value !== "";
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  if (!shown) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={dsIconBtn}
        aria-label="Search posts"
        title="Search"
      >
        <Search className="h-4 w-4" />
      </button>
    );
  }
  return (
    <label className="relative min-w-0 max-w-44 flex-1">
      <span className="sr-only">Search posts</span>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          onChange("");
          setOpen(false);
        }}
        placeholder="Search posts"
        className="h-8 w-full rounded-full border border-border bg-[var(--ds-well-bg)] pl-8 pr-7 text-[12.5px] outline-none focus:border-primary"
      />
      {value !== "" && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange("");
            setOpen(false);
          }}
          className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </label>
  );
}

export function CalendarToolbar({
  label,
  view,
  showViews,
  filter,
  onStep,
  onToday,
  onView,
  onFilter,
  onNewPost,
}: {
  label: string;
  view: CalendarViewId;
  /** False on small screens, where the calendar is always a list. */
  showViews: boolean;
  filter: CalendarFilter;
  onStep: (dir: 1 | -1) => void;
  onToday: () => void;
  onView: (view: CalendarViewId) => void;
  onFilter: (next: CalendarFilter) => void;
  onNewPost: () => void;
}) {
  const unit = view === "week" ? "week" : "month";
  return (
    <div className="@container border-b border-border">
      <div className="flex items-center gap-1.5 px-3 py-2 sm:px-4">
        <div
          className="shrink-0 whitespace-nowrap text-[15px] font-semibold tracking-[-0.01em]"
          role="heading"
          aria-level={2}
          aria-live="polite"
        >
          {label}
        </div>
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => onStep(-1)}
            className={dsIconBtn}
            aria-label={`Previous ${unit}`}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onStep(1)}
            className={dsIconBtn}
            aria-label={`Next ${unit}`}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={onToday}
          className={cn(dsGhostBtn, "hidden h-8 shrink-0 px-3 text-[12px] @md:inline-flex")}
        >
          Today
        </button>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
          <SearchBox value={filter.query} onChange={(query) => onFilter({ ...filter, query })} />
          <FilterMenu filter={filter} onChange={onFilter} />
          {showViews && (
            <Tabs value={view} onValueChange={(v) => onView(v as CalendarViewId)}>
              <TabsList className="h-8">
                {(["month", "week", "list"] as const).map((id) => (
                  <TabsTrigger key={id} value={id} className="px-2.5 text-[12px] capitalize">
                    {id}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
          <button
            type="button"
            onClick={onNewPost}
            className={cn(dsGhostBtn, "h-8 shrink-0 px-2.5 text-[12px] @3xl:px-3")}
            aria-label="New post"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden @3xl:inline">New post</span>
          </button>
        </div>
      </div>
    </div>
  );
}
