"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Loader2, Minus, Plus, Sparkles } from "@/components/icons";
import { dsIconBtn } from "@/components/app/surface/buttons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { planContentCalendar, type ContentItem } from "@/lib/content.functions";
import { ServerFnError } from "@/lib/rpc-client";
import {
  addDays,
  CALENDAR_CHANNELS,
  fmtYMD,
  isYMD,
  type CalendarChannel,
} from "@/lib/calendar/model";
import {
  buildPlanSlots,
  defaultsFor,
  maxPostsPerWeek,
  PLAN_GOALS,
  PLAN_INDUSTRIES,
  PLAN_TOPICS,
  PLAN_WEEK_OPTIONS,
  type PlanGoalId,
  type PlanTopicId,
} from "@/lib/calendar/planner";
import { ChannelIcon } from "./shared";

type Prefs = {
  industry: string;
  goal: PlanGoalId;
  notes: string;
  weeks: number;
  postsPerWeek: number;
  channels: CalendarChannel[];
  weekdays: number[];
  topics: PlanTopicId[];
  keyDates: boolean;
};

const PREFS_KEY = (workspaceId: string) => `calendar:plan:${workspaceId}`;
// Monday first, as the calendar is drawn.
const WEEKDAYS = [
  { id: 1, label: "Mon" },
  { id: 2, label: "Tue" },
  { id: 3, label: "Wed" },
  { id: 4, label: "Thu" },
  { id: 5, label: "Fri" },
  { id: 6, label: "Sat" },
  { id: 0, label: "Sun" },
];

function initialPrefs(): Prefs {
  const base = defaultsFor("auto");
  return {
    industry: "auto",
    goal: "awareness",
    notes: "",
    weeks: 4,
    postsPerWeek: base.postsPerWeek,
    channels: base.channels,
    weekdays: [1, 2, 3, 4, 5],
    topics: base.topics,
    keyDates: true,
  };
}

function loadPrefs(workspaceId: string): Prefs {
  const fallback = initialPrefs();
  try {
    const raw = localStorage.getItem(PREFS_KEY(workspaceId));
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as Partial<Prefs>;
    const channelIds = new Set(CALENDAR_CHANNELS.map((c) => c.id));
    const topicIds = new Set<string>(PLAN_TOPICS.map((t) => t.id));
    const channels = (saved.channels ?? []).filter((c) => channelIds.has(c));
    const topics = (saved.topics ?? []).filter((t) => topicIds.has(t));
    const weeks = PLAN_WEEK_OPTIONS.includes(saved.weeks as never) ? saved.weeks! : fallback.weeks;
    return {
      industry: PLAN_INDUSTRIES.some((i) => i.id === saved.industry) ? saved.industry! : "auto",
      goal: PLAN_GOALS.some((g) => g.id === saved.goal) ? saved.goal! : fallback.goal,
      notes: typeof saved.notes === "string" ? saved.notes.slice(0, 1500) : "",
      weeks,
      postsPerWeek: Math.max(
        1,
        Math.min(maxPostsPerWeek(weeks), Number(saved.postsPerWeek) || fallback.postsPerWeek),
      ),
      channels: channels.length ? channels : fallback.channels,
      weekdays: Array.isArray(saved.weekdays)
        ? saved.weekdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        : fallback.weekdays,
      topics: topics.length ? topics : fallback.topics,
      keyDates: saved.keyDates !== false,
    };
  } catch {
    return fallback;
  }
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="ds-label mb-1.5">{children}</div>;
}

function Chip({
  on,
  onClick,
  children,
  color,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
        on
          ? color
            ? "border-transparent text-white"
            : "border-primary/40 bg-primary/12 text-foreground"
          : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
      style={on && color ? { background: color } : undefined}
    >
      {children}
    </button>
  );
}

export function PlanPanel({
  workspaceId,
  suggestedStart,
  onPlanned,
}: {
  workspaceId: string;
  /** First day of the dates on screen; the plan starts there if it is still ahead. */
  suggestedStart: string;
  onPlanned: (items: ContentItem[], startDate: string) => void;
}) {
  const [prefs, setPrefs] = useState<Prefs>(initialPrefs);
  const [startDate, setStartDate] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => setPrefs(loadPrefs(workspaceId)), [workspaceId]);

  // Never start a plan in the past: tomorrow, or the visible month if it is later.
  useEffect(() => {
    const tomorrow = fmtYMD(addDays(new Date(), 1));
    setStartDate(suggestedStart > tomorrow ? suggestedStart : tomorrow);
  }, [suggestedStart]);

  const update = (patch: Partial<Prefs>) =>
    setPrefs((current) => {
      const next = { ...current, ...patch };
      next.postsPerWeek = Math.max(1, Math.min(maxPostsPerWeek(next.weeks), next.postsPerWeek));
      try {
        localStorage.setItem(PREFS_KEY(workspaceId), JSON.stringify(next));
      } catch {}
      return next;
    });

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((x) => x !== value) : [...list, value];

  const slots = useMemo(
    () =>
      isYMD(startDate)
        ? buildPlanSlots({
            startDate,
            weeks: prefs.weeks,
            postsPerWeek: prefs.postsPerWeek,
            channels: prefs.channels,
            weekdays: prefs.weekdays,
            topics: prefs.topics,
            industry: prefs.industry,
            keyDates: prefs.keyDates,
          })
        : [],
    [startDate, prefs],
  );
  const keyDateCount = slots.filter((s) => s.moment).length;
  const ready = slots.length > 0 && prefs.channels.length > 0 && prefs.topics.length > 0;

  const plan = async () => {
    if (!ready || loading) return;
    setLoading(true);
    try {
      const result = await planContentCalendar({
        data: {
          workspaceId,
          startDate,
          weeks: prefs.weeks,
          postsPerWeek: prefs.postsPerWeek,
          channels: prefs.channels,
          weekdays: prefs.weekdays,
          topics: prefs.topics,
          goal: prefs.goal,
          industry: prefs.industry,
          keyDates: prefs.keyDates,
          notes: prefs.notes.trim() || undefined,
        },
      });
      onPlanned(result.items, startDate);
      if (result.items.length < result.requested) {
        toast.success(`Added ${result.items.length} of ${result.requested} posts`, {
          description: "Some could not be written. Plan again to fill the gaps.",
        });
      } else {
        toast.success(`Added ${result.items.length} posts to your calendar`);
      }
    } catch (e) {
      // Out of credits is shown by the app's own upgrade notice.
      if (!(e instanceof ServerFnError && e.status === 402)) {
        toast.error("Couldn't plan your posts", {
          description: e instanceof Error ? e.message : undefined,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <div>
        <Label>How long</Label>
        <div className="flex gap-1 rounded-full bg-[var(--ds-well-bg)] p-1">
          {PLAN_WEEK_OPTIONS.map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={prefs.weeks === w}
              onClick={() => update({ weeks: w })}
              className={cn(
                "h-7 flex-1 rounded-full text-[12px] font-medium transition-colors",
                prefs.weeks === w
                  ? "bg-background text-foreground shadow-sm dark:bg-white/[0.12]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {w} {w === 1 ? "week" : "weeks"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-[12.5px] font-medium">Posts each week</span>
        <div className="flex items-center gap-1 rounded-full bg-[var(--ds-well-bg)] p-1">
          <button
            type="button"
            onClick={() => update({ postsPerWeek: prefs.postsPerWeek - 1 })}
            disabled={prefs.postsPerWeek <= 1}
            className={cn(dsIconBtn, "h-7 w-7")}
            aria-label="Fewer posts each week"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span
            className="w-6 text-center text-[13px] font-semibold tabular-nums"
            aria-live="polite"
          >
            {prefs.postsPerWeek}
          </span>
          <button
            type="button"
            onClick={() => update({ postsPerWeek: prefs.postsPerWeek + 1 })}
            disabled={prefs.postsPerWeek >= maxPostsPerWeek(prefs.weeks)}
            className={cn(dsIconBtn, "h-7 w-7")}
            aria-label="More posts each week"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div>
        <Label>Where</Label>
        <div className="flex flex-wrap gap-1.5">
          {CALENDAR_CHANNELS.map((c) => {
            const on = prefs.channels.includes(c.id);
            return (
              <Chip
                key={c.id}
                on={on}
                color={c.color}
                onClick={() => update({ channels: toggle(prefs.channels, c.id) })}
              >
                <ChannelIcon channel={c.id} size={12} brand={!on} />
                {c.label}
              </Chip>
            );
          })}
        </div>
      </div>

      <div>
        <Label>Anything to include? (optional)</Label>
        <textarea
          rows={2}
          maxLength={1500}
          value={prefs.notes}
          onChange={(e) => update({ notes: e.target.value })}
          placeholder="e.g. Autumn sale starts 15 October"
          className="w-full resize-none rounded-2xl border border-border bg-[var(--ds-well-bg)] px-3 py-2 text-[12.5px] outline-none focus:border-primary"
        />
      </div>

      <div>
        <button
          type="button"
          aria-expanded={showMore}
          onClick={() => setShowMore((v) => !v)}
          className="flex w-full items-center justify-between gap-2 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
        >
          More options
          <ChevronDown className={cn("h-4 w-4 transition-transform", showMore && "rotate-180")} />
        </button>

        {showMore && (
          <div className="mt-3 space-y-3.5">
            <div>
              <Label>Start</Label>
              <Input
                type="date"
                value={startDate}
                min={fmtYMD(new Date())}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-9 text-[12px]"
              />
            </div>

            <div>
              <Label>Days</Label>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((d) => (
                  <Chip
                    key={d.id}
                    on={prefs.weekdays.includes(d.id)}
                    onClick={() => update({ weekdays: toggle(prefs.weekdays, d.id) })}
                  >
                    {d.label}
                  </Chip>
                ))}
              </div>
            </div>

            <div>
              <Label>Topics</Label>
              <div className="flex flex-wrap gap-1.5">
                {PLAN_TOPICS.map((t) => (
                  <Chip
                    key={t.id}
                    on={prefs.topics.includes(t.id)}
                    onClick={() => update({ topics: toggle(prefs.topics, t.id) })}
                  >
                    {t.label}
                  </Chip>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="min-w-0">
                <Label>Goal</Label>
                <Select
                  value={prefs.goal}
                  onValueChange={(goal) => update({ goal: goal as PlanGoalId })}
                >
                  <SelectTrigger className="h-9 w-full text-[12px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLAN_GOALS.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-0">
                <Label>Business</Label>
                <Select
                  value={prefs.industry}
                  onValueChange={(industry) => update({ industry, ...defaultsFor(industry) })}
                >
                  <SelectTrigger className="h-9 w-full text-[12px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLAN_INDUSTRIES.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <label className="flex items-center justify-between gap-3 text-[12.5px]">
              <span>
                Holidays and key dates
                {prefs.keyDates && keyDateCount > 0 && (
                  <span className="ml-1 text-muted-foreground">· {keyDateCount}</span>
                )}
              </span>
              <Switch
                checked={prefs.keyDates}
                onCheckedChange={(keyDates) => update({ keyDates })}
              />
            </label>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Button onClick={plan} disabled={!ready || loading} className="w-full gap-1.5">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {loading
            ? "Writing your posts…"
            : slots.length
              ? `Plan ${slots.length} ${slots.length === 1 ? "post" : "posts"}`
              : "Plan my posts"}
        </Button>
        <p className="text-center text-[11px] text-muted-foreground">
          {!prefs.channels.length
            ? "Pick at least one channel"
            : !prefs.topics.length
              ? "Pick at least one topic"
              : !slots.length
                ? "Pick at least one day"
                : "They arrive as drafts. Nothing goes out until you approve it."}
        </p>
      </div>
    </div>
  );
}
