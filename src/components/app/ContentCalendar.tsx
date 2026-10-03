"use client";

// Content Calendar — plan, review and schedule a brand's posts by date.
//
// Every post is a `content_items` row. Where it sits comes from the model in
// `src/lib/calendar/model.ts`: its real schedule if it has one, otherwise the
// day it was planned for. Moving a post only changes that plan; a post is
// "Scheduled" only after the publishing provider has accepted it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Filter,
  Plus,
  Search,
  Sparkles,
  X,
} from "@/components/icons";
import { AppModalShell } from "@/components/app/AppModalShell";
import { dsGhostBtn, dsIconBtn } from "@/components/app/surface/buttons";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { addAppEventListener, emitAppEvent, removeAppEventListener } from "@/lib/app-events";
import { useServerFn } from "@/lib/use-server-fn";
import { cn } from "@/lib/utils";
import {
  createContentItem,
  deleteContentItem,
  listContentItems,
  regenerateContentItem,
  setContentPlanDate,
  updateContentItem,
  type ContentItem,
} from "@/lib/content.functions";
import { ServerFnError } from "@/lib/rpc-client";
import { cancelScheduled, getSdrStatus, scheduleContentItems } from "@/lib/sdr.functions";
import { momentsBetween, type MarketingMoment } from "@/lib/studio/moments";
import {
  addDays,
  CALENDAR_CHANNELS,
  CALENDAR_STATUSES,
  channelInfo,
  entriesBetween,
  entryFromContent,
  filterEntries,
  fmtYMD,
  groupByDate,
  isFiltering,
  isHM,
  isLocked,
  isYMD,
  localInstant,
  monthGrid,
  NO_FILTER,
  parseYMD,
  startOfMonth,
  STATUS_LABEL,
  toCalendarChannel,
  weekDays,
  type CalendarChannel,
  type CalendarEntry,
  type CalendarFilter,
  type CalendarStatus,
} from "@/lib/calendar/model";
import { EntryEditor, type EntryPatch } from "./calendar/EntryEditor";
import { ExportMenu } from "./calendar/ExportMenu";
import { PlanPanel } from "./calendar/PlanPanel";
import { ChannelIcon } from "./calendar/shared";
import {
  CalendarSkeleton,
  ChannelLanes,
  DayPanel,
  ListView,
  MonthView,
  WeekView,
} from "./calendar/views";

type View = "month" | "week" | "list";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEGACY_KEY = (workspaceId: string) => `content-calendar:${workspaceId}`;
const SAVE_DELAY_MS = 600;

function errorText(e: unknown): string | undefined {
  return e instanceof Error ? e.message : undefined;
}

/** Out of credits is shown by the app's own upgrade notice, not a second toast. */
function isBillingStop(e: unknown): boolean {
  return e instanceof ServerFnError && e.status === 402;
}

export function ContentCalendar({ workspaceId }: { workspaceId: string | null }) {
  const listItems = useServerFn(listContentItems);
  const createItem = useServerFn(createContentItem);
  const updateItem = useServerFn(updateContentItem);
  const deleteItem = useServerFn(deleteContentItem);
  const regenerateItem = useServerFn(regenerateContentItem);
  const setPlanDate = useServerFn(setContentPlanDate);

  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [view, setView] = useState<View>("month");
  const [filter, setFilter] = useState<CalendarFilter>(NO_FILTER);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [rail, setRail] = useState<"plan" | "day">("plan");
  const [showPlanSheet, setShowPlanSheet] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false);
  const [publishPlatforms, setPublishPlatforms] = useState<Set<string>>(new Set());

  // Text edits wait here until they are saved; a reload must not undo them.
  const pending = useRef(new Map<string, EntryPatch>());
  const saving = useRef(new Map<string, EntryPatch>());
  const timers = useRef(new Map<string, number>());
  const skipReload = useRef(false);

  /* ───────────────────────── loading ───────────────────────── */

  const load = useCallback(
    async (quiet = false) => {
      if (!workspaceId) return;
      if (!quiet) setLoading(true);
      try {
        const items = await listItems({ data: { workspaceId, limit: 500 } });
        setEntries(
          items.map((item) => {
            const entry = entryFromContent(item);
            const unsaved = { ...saving.current.get(entry.id), ...pending.current.get(entry.id) };
            return Object.keys(unsaved).length ? { ...entry, ...unsaved } : entry;
          }),
        );
        setLoadError(false);
      } catch {
        if (!quiet) setLoadError(true);
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [workspaceId, listItems],
  );

  useEffect(() => {
    const onOpen = () => setOpen(true);
    addAppEventListener("open:content-calendar", onOpen);
    return () => removeAppEventListener("open:content-calendar", onOpen);
  }, []);

  useEffect(() => {
    if (!open || !workspaceId) return;
    void load();
    void getSdrStatus(workspaceId)
      .then((status) => setPublishPlatforms(new Set(status.canPublish ? status.platforms : [])))
      .catch(() => setPublishPlatforms(new Set()));
  }, [open, workspaceId, load]);

  // Another surface (or a realtime change) touched content: refresh quietly.
  useEffect(() => {
    if (!open) return;
    let timer = 0;
    const onChanged = () => {
      if (skipReload.current) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(true), 500);
    };
    addAppEventListener("content:changed", onChanged);
    return () => {
      window.clearTimeout(timer);
      removeAppEventListener("content:changed", onChanged);
    };
  }, [open, load]);

  /** Tell the rest of the app content changed, without reloading ourselves. */
  const announce = useCallback(() => {
    skipReload.current = true;
    try {
      emitAppEvent("content:changed");
    } finally {
      skipReload.current = false;
    }
  }, []);

  // Posts an older version of the calendar kept only in this browser: save
  // them to the workspace once, then forget the local copy.
  const migrated = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !workspaceId || migrated.current === workspaceId) return;
    migrated.current = workspaceId;
    let legacy: Record<string, unknown>[] = [];
    try {
      const parsed = JSON.parse(localStorage.getItem(LEGACY_KEY(workspaceId)) ?? "[]");
      if (Array.isArray(parsed)) legacy = parsed.filter((e) => e && !UUID_RE.test(String(e.id)));
    } catch {}
    if (!legacy.length) return;
    void (async () => {
      const left: Record<string, unknown>[] = [];
      for (const old of legacy) {
        try {
          const channel = toCalendarChannel(String(old.channel ?? ""));
          await createItem({
            data: {
              workspaceId,
              agent: "spark",
              kind: channel === "blog" ? "blog" : channel === "email" ? "email" : "post",
              channel,
              title: String(old.title ?? "Untitled post").slice(0, 280),
              body:
                [old.hook, old.caption]
                  .filter((part) => typeof part === "string" && part)
                  .join("\n\n") || null,
              hashtags: Array.isArray(old.hashtags) ? old.hashtags.map(String).slice(0, 30) : [],
              status: "draft",
              meta: {
                source: "calendar",
                ...(isYMD(old.date) ? { calendar_date: old.date } : {}),
                ...(isHM(old.time) ? { calendar_time: old.time } : {}),
              },
            },
          });
        } catch {
          left.push(old);
        }
      }
      try {
        if (left.length) localStorage.setItem(LEGACY_KEY(workspaceId), JSON.stringify(left));
        else localStorage.removeItem(LEGACY_KEY(workspaceId));
      } catch {}
      if (left.length < legacy.length) void load(true);
    })();
  }, [open, workspaceId, createItem, load]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const apply = () => setIsNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  const activeView: View = isNarrow ? "list" : view;

  /* ───────────────────────── what is on screen ───────────────────────── */

  const range = useMemo(() => {
    if (activeView === "week") {
      const days = weekDays(anchor);
      const from = days[0];
      const to = days[6];
      const sameMonth = from.getMonth() === to.getMonth();
      return {
        from: fmtYMD(from),
        to: fmtYMD(to),
        label: `${from.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${to.toLocaleDateString(
          undefined,
          sameMonth
            ? { day: "numeric", year: "numeric" }
            : { month: "short", day: "numeric", year: "numeric" },
        )}`,
        slug: `week-${fmtYMD(from)}`,
      };
    }
    const first = startOfMonth(anchor);
    const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    return {
      from: fmtYMD(first),
      to: fmtYMD(last),
      label: first.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
      slug: fmtYMD(first).slice(0, 7),
    };
  }, [anchor, activeView]);

  const grid = useMemo(() => monthGrid(anchor), [anchor]);
  const filtered = useMemo(() => filterEntries(entries, filter), [entries, filter]);
  const byDate = useMemo(() => groupByDate(filtered), [filtered]);
  const inRange = useMemo(
    () => entriesBetween(filtered, range.from, range.to),
    [filtered, range.from, range.to],
  );
  const inRangeByDate = useMemo(() => groupByDate(inRange), [inRange]);
  const today = fmtYMD(new Date());

  const moments = useMemo(() => {
    // The month grid also shows the ends of the neighbouring months.
    const from = activeView === "month" ? fmtYMD(grid[0]) : range.from;
    const to = activeView === "month" ? fmtYMD(grid[41]) : range.to;
    const map = new Map<string, MarketingMoment[]>();
    for (const m of momentsBetween(from, to)) map.set(m.date, [...(map.get(m.date) ?? []), m]);
    return map;
  }, [activeView, grid, range.from, range.to]);

  const selected = selectedId ? (entries.find((e) => e.id === selectedId) ?? null) : null;
  const scheduledCount = inRange.filter((e) => e.status === "scheduled").length;

  const step = (dir: 1 | -1) =>
    setAnchor((d) =>
      activeView === "week"
        ? addDays(d, dir * 7)
        : new Date(d.getFullYear(), d.getMonth() + dir, 1),
    );

  /* ───────────────────────── saving ───────────────────────── */

  const patchEntry = (id: string, patch: Partial<CalendarEntry>) =>
    setEntries((list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  const replaceEntry = (item: ContentItem) => {
    const next = entryFromContent(item);
    setEntries((list) =>
      list.some((e) => e.id === next.id)
        ? list.map((e) => (e.id === next.id ? next : e))
        : [...list, next],
    );
    return next;
  };

  const setBusy = (id: string, on: boolean) =>
    setBusyIds((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  /** Send a post's waiting text edits now. Resolves once they are stored. */
  const flush = useCallback(
    async (id: string) => {
      window.clearTimeout(timers.current.get(id));
      timers.current.delete(id);
      const patch = pending.current.get(id);
      if (!patch) return;
      pending.current.delete(id);
      saving.current.set(id, { ...saving.current.get(id), ...patch });
      try {
        await updateItem({
          data: {
            id,
            patch: {
              ...("title" in patch ? { title: patch.title?.trim() || "Untitled post" } : {}),
              ...("caption" in patch ? { body: patch.caption || null } : {}),
              ...("hashtags" in patch ? { hashtags: patch.hashtags } : {}),
              ...("channel" in patch ? { channel: patch.channel } : {}),
            },
          },
        });
      } catch (e) {
        toast.error("Couldn't save your changes", { description: errorText(e) });
      } finally {
        saving.current.delete(id);
      }
    },
    [updateItem],
  );

  const editEntry = (id: string, patch: EntryPatch) => {
    const current = entries.find((e) => e.id === id);
    if (!current || isLocked(current.status)) return;
    // Changing an approved post sends it back to draft (the server does the same).
    patchEntry(id, { ...patch, ...(current.status === "approved" ? { status: "draft" } : {}) });
    pending.current.set(id, { ...pending.current.get(id), ...patch });
    window.clearTimeout(timers.current.get(id));
    timers.current.set(
      id,
      window.setTimeout(() => void flush(id), SAVE_DELAY_MS),
    );
  };

  // Nothing typed may be lost when the calendar closes or unmounts.
  const flushAll = useCallback(() => {
    for (const id of [...pending.current.keys()]) void flush(id);
  }, [flush]);
  useEffect(() => flushAll, [flushAll]);
  useEffect(() => {
    if (!open) flushAll();
  }, [open, flushAll]);

  const closeEditor = () => {
    if (selectedId) void flush(selectedId);
    setSelectedId(null);
  };

  /* ───────────────────────── actions ───────────────────────── */

  const createPost = async (date?: string, title?: string) => {
    if (!workspaceId) return;
    const day = date ?? (today >= range.from && today <= range.to ? today : range.from);
    const channel: CalendarChannel = filter.channel === "all" ? "instagram" : filter.channel;
    try {
      const created = await createItem({
        data: {
          workspaceId,
          agent: "spark",
          kind: channel === "blog" ? "blog" : channel === "email" ? "email" : "post",
          channel,
          title: title ?? "Untitled post",
          body: null,
          status: "draft",
          meta: { source: "calendar", calendar_date: day, calendar_time: "09:00" },
        },
      });
      setSelectedId(replaceEntry(created).id);
      announce();
    } catch (e) {
      toast.error("Couldn't add the post", { description: errorText(e) });
    }
  };

  const moveEntry = async (id: string, date: string, time?: string) => {
    const current = entries.find((e) => e.id === id);
    if (!current || !isYMD(date)) return;
    if (isLocked(current.status)) {
      toast("Cancel the schedule to move this post");
      return;
    }
    const nextTime = time ?? current.time;
    if (current.date === date && current.time === nextTime) return;
    patchEntry(id, { date, time: nextTime });
    try {
      await setPlanDate({ data: { id, date, time: nextTime } });
      announce();
    } catch (e) {
      patchEntry(id, { date: current.date, time: current.time });
      toast.error("Couldn't move the post", { description: errorText(e) });
    }
  };

  const setStatus = async (id: string, status: "approved" | "draft") => {
    const current = entries.find((e) => e.id === id);
    if (!current) return;
    setBusy(id, true);
    try {
      await flush(id);
      // A post waiting for review, or one that failed, is approved directly.
      replaceEntry(await updateItem({ data: { id, patch: { status } } }));
      announce();
      if (status === "approved") toast.success("Approved");
    } catch (e) {
      toast.error(status === "approved" ? "Couldn't approve" : "Couldn't change the post", {
        description: errorText(e),
      });
    } finally {
      setBusy(id, false);
    }
  };

  const schedule = async (id: string) => {
    const current = entries.find((e) => e.id === id);
    if (!current || !workspaceId) return;
    const at = localInstant(current.date, current.time);
    if (new Date(at).getTime() < Date.now() + 2 * 60_000) {
      toast.error("Pick a date and time in the future");
      return;
    }
    setBusy(id, true);
    try {
      await flush(id);
      const res = await scheduleContentItems(
        workspaceId,
        [{ contentItemId: id, scheduledAt: at }],
        { type: "all" },
      );
      const outcome = res.results?.[0];
      if (!outcome || outcome.status === "skipped" || outcome.status === "failed") {
        toast.error("Couldn't schedule this post", {
          description: outcome?.reason ?? "Check that the account is connected.",
        });
      } else {
        toast.success("Scheduled", {
          description: parseYMD(current.date).toLocaleDateString(undefined, {
            weekday: "long",
            month: "short",
            day: "numeric",
          }),
        });
      }
      announce();
      await load(true);
    } catch (e) {
      toast.error("Couldn't schedule this post", { description: errorText(e) });
    } finally {
      setBusy(id, false);
    }
  };

  const cancelSchedule = async (id: string) => {
    if (!workspaceId) return;
    setBusy(id, true);
    try {
      await cancelScheduled(workspaceId, id);
      toast.success("Schedule cancelled");
      announce();
      await load(true);
    } catch (e) {
      toast.error("Couldn't cancel", { description: errorText(e) });
    } finally {
      setBusy(id, false);
    }
  };

  const regenerate = async (id: string) => {
    setBusy(id, true);
    try {
      await flush(id);
      replaceEntry(await regenerateItem({ data: { id } }));
      announce();
      toast.success("Rewritten");
    } catch (e) {
      if (!isBillingStop(e)) toast.error("Couldn't rewrite", { description: errorText(e) });
    } finally {
      setBusy(id, false);
    }
  };

  const duplicate = async (id: string) => {
    const current = entries.find((e) => e.id === id);
    if (!current || !workspaceId) return;
    try {
      await flush(id);
      const created = await createItem({
        data: {
          workspaceId,
          agent: "spark",
          kind:
            current.channel === "blog" ? "blog" : current.channel === "email" ? "email" : "post",
          channel: current.channel,
          title: current.title.slice(0, 280),
          body: current.caption || null,
          hashtags: current.hashtags.slice(0, 30),
          status: "draft",
          meta: {
            source: "calendar",
            calendar_date: current.date,
            calendar_time: current.time,
            format: current.format,
            ...(current.topic ? { pillar: current.topic } : {}),
          },
        },
      });
      setSelectedId(replaceEntry(created).id);
      announce();
      toast.success("Copy added");
    } catch (e) {
      toast.error("Couldn't duplicate", { description: errorText(e) });
    }
  };

  const remove = async (id: string) => {
    const current = entries.find((e) => e.id === id);
    if (!current) return;
    window.clearTimeout(timers.current.get(id));
    pending.current.delete(id);
    setSelectedId(null);
    setEntries((list) => list.filter((e) => e.id !== id));
    try {
      await deleteItem({ data: { id } });
      announce();
    } catch (e) {
      setEntries((list) => (list.some((x) => x.id === id) ? list : [...list, current]));
      toast.error("Couldn't delete the post", { description: errorText(e) });
    }
  };

  const pickDate = (date: string) => {
    setSelectedDate(date);
    setRail("day");
  };

  const canSchedule = (entry: CalendarEntry) =>
    channelInfo(entry.channel).social &&
    publishPlatforms.has(entry.channel === "x" ? "twitter" : entry.channel);

  const viewProps = {
    moments,
    today,
    draggingId,
    busyIds,
    onPickEntry: setSelectedId,
    onDragStart: setDraggingId,
    onDragEnd: () => setDraggingId(null),
    onDropOnDay: (date: string) => {
      if (draggingId) void moveEntry(draggingId, date);
      setDraggingId(null);
    },
  };

  const planPanel = workspaceId ? (
    <PlanPanel
      workspaceId={workspaceId}
      suggestedStart={range.from}
      onPlanned={(items, startDate) => {
        setEntries((list) => {
          const ids = new Set(items.map((i) => i.id));
          return [...list.filter((e) => !ids.has(e.id)), ...items.map(entryFromContent)];
        });
        setAnchor(parseYMD(startDate));
        setFilter(NO_FILTER);
        setShowPlanSheet(false);
        announce();
      }}
    />
  ) : null;

  return (
    <AppModalShell
      open={open}
      onOpenChange={setOpen}
      size="2xl"
      Icon={CalendarDays}
      title="Content Calendar"
      description={
        loading || !inRange.length
          ? undefined
          : `${inRange.length} ${inRange.length === 1 ? "post" : "posts"}${
              scheduledCount ? ` · ${scheduledCount} scheduled` : ""
            }`
      }
      headerAccessory={
        workspaceId ? (
          <>
            <ExportMenu
              shown={inRange}
              all={entries}
              shownLabel={range.label}
              shownSlug={range.slug}
            />
            <Button size="sm" onClick={() => setShowPlanSheet(true)} className="lg:hidden">
              <Sparkles /> Plan
            </Button>
          </>
        ) : undefined
      }
      bodyClassName="flex flex-col"
    >
      {!workspaceId ? (
        <EmptyState icon={CalendarDays} title="Open a brand to see its calendar" />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[1fr_320px]">
          {/* LEFT — the calendar */}
          <div className="relative flex min-h-0 min-w-0 flex-col overflow-hidden lg:border-r lg:border-border">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 sm:px-4">
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => step(-1)}
                  className={dsIconBtn}
                  aria-label={activeView === "week" ? "Previous week" : "Previous month"}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div
                  className="min-w-[128px] text-center text-[13px] font-semibold"
                  aria-live="polite"
                >
                  {range.label}
                </div>
                <button
                  type="button"
                  onClick={() => step(1)}
                  className={dsIconBtn}
                  aria-label={activeView === "week" ? "Next week" : "Next month"}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setAnchor(new Date())}
                  className={cn(dsGhostBtn, "ml-1 h-8 px-3 text-[12px]")}
                >
                  Today
                </button>
              </div>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                <label className="relative">
                  <span className="sr-only">Search posts</span>
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={filter.query}
                    onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
                    placeholder="Search"
                    className="h-8 w-28 rounded-full border border-border bg-[var(--ds-well-bg)] pl-8 pr-3 text-[12.5px] outline-none transition-[width] focus:w-44 focus:border-primary"
                  />
                </label>
                <Select
                  value={filter.channel}
                  onValueChange={(v) =>
                    setFilter((f) => ({ ...f, channel: v as CalendarFilter["channel"] }))
                  }
                >
                  <SelectTrigger
                    className="h-8 w-auto gap-1.5 rounded-full px-3 text-[12px]"
                    aria-label="Channel"
                  >
                    <Filter className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All channels</SelectItem>
                    {CALENDAR_CHANNELS.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        <span className="flex items-center gap-2">
                          <ChannelIcon channel={c.id} size={14} />
                          {c.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={filter.format ?? "all"}
                  onValueChange={(v) =>
                    setFilter((f) => ({ ...f, format: v as CalendarFilter["format"] }))
                  }
                >
                  <SelectTrigger
                    className="h-8 w-auto gap-1.5 rounded-full px-3 text-[12px]"
                    aria-label="Posts or Stories"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Posts and Stories</SelectItem>
                    <SelectItem value="posts">Posts only</SelectItem>
                    <SelectItem value="stories">Stories only</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={filter.status}
                  onValueChange={(v) =>
                    setFilter((f) => ({ ...f, status: v as CalendarStatus | "all" }))
                  }
                >
                  <SelectTrigger
                    className="h-8 w-auto gap-1.5 rounded-full px-3 text-[12px]"
                    aria-label="Status"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any status</SelectItem>
                    {CALENDAR_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!isNarrow && (
                  <Tabs value={view} onValueChange={(v) => setView(v as View)}>
                    <TabsList className="h-8">
                      <TabsTrigger value="month" className="px-2.5 text-[12px]">
                        Month
                      </TabsTrigger>
                      <TabsTrigger value="week" className="px-2.5 text-[12px]">
                        Week
                      </TabsTrigger>
                      <TabsTrigger value="list" className="px-2.5 text-[12px]">
                        List
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                )}
                <button
                  type="button"
                  onClick={() => void createPost()}
                  className={cn(dsGhostBtn, "h-8 px-3 text-[12px]")}
                >
                  <Plus className="h-3.5 w-3.5" /> New post
                </button>
              </div>
            </div>

            {draggingId && (
              <ChannelLanes
                onDropChannel={(channel) => {
                  editEntry(draggingId, { channel });
                  setDraggingId(null);
                }}
              />
            )}

            {loading ? (
              <CalendarSkeleton view={activeView} />
            ) : loadError ? (
              <div className="grid flex-1 place-items-center">
                <ErrorState title="Couldn't load your calendar" onRetry={() => void load()} />
              </div>
            ) : entries.length === 0 ? (
              <div className="grid flex-1 place-items-center">
                <EmptyState
                  icon={CalendarDays}
                  title="Your calendar is empty"
                  action={
                    <Button onClick={() => setShowPlanSheet(true)} className="lg:hidden">
                      <Sparkles /> Plan my posts
                    </Button>
                  }
                  secondaryAction={
                    <Button variant="outline" onClick={() => void createPost()}>
                      <Plus /> New post
                    </Button>
                  }
                />
              </div>
            ) : activeView === "month" ? (
              <MonthView
                {...viewProps}
                byDate={byDate}
                grid={grid}
                month={anchor.getMonth()}
                selectedDate={selectedDate}
                onPickDate={pickDate}
              />
            ) : activeView === "week" ? (
              <WeekView
                {...viewProps}
                byDate={byDate}
                days={weekDays(anchor)}
                onAdd={(date) => void createPost(date)}
              />
            ) : inRange.length === 0 ? (
              <div className="grid flex-1 place-items-center">
                <EmptyState
                  icon={isFiltering(filter) ? Filter : CalendarDays}
                  title={isFiltering(filter) ? "No posts match" : `Nothing in ${range.label}`}
                  action={
                    isFiltering(filter) ? (
                      <Button variant="outline" onClick={() => setFilter(NO_FILTER)}>
                        Clear filters
                      </Button>
                    ) : undefined
                  }
                />
              </div>
            ) : (
              <ListView
                {...viewProps}
                byDate={inRangeByDate}
                onRegenerate={(id) => void regenerate(id)}
              />
            )}

            {/* Small screens: the planner slides up over the calendar. */}
            <AnimatePresence>
              {showPlanSheet && (
                <motion.div
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute inset-0 z-30 flex flex-col overflow-y-auto bg-card lg:hidden"
                >
                  <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-4 py-2">
                    <span className="text-[13px] font-semibold">Plan my posts</span>
                    <button
                      type="button"
                      onClick={() => setShowPlanSheet(false)}
                      className={dsIconBtn}
                      aria-label="Close"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  {planPanel}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* RIGHT — plan with Mellox, or the day that was picked */}
          <div className="hidden min-h-0 flex-col overflow-y-auto scrollbar-thin lg:flex">
            <div className="sticky top-0 z-10 border-b border-border bg-background/90 px-4 py-2 backdrop-blur">
              <Tabs value={rail} onValueChange={(v) => setRail(v as "plan" | "day")}>
                <TabsList className="h-8 w-full">
                  <TabsTrigger value="plan" className="flex-1 text-[12px]">
                    Plan posts
                  </TabsTrigger>
                  <TabsTrigger value="day" className="flex-1 text-[12px]">
                    Day
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            {rail === "plan" ? (
              planPanel
            ) : (
              <DayPanel
                date={selectedDate ?? today}
                entries={byDate.get(selectedDate ?? today) ?? []}
                moments={momentsBetween(selectedDate ?? today, selectedDate ?? today)}
                onPickEntry={setSelectedId}
                onAdd={(date, title) => void createPost(date, title)}
              />
            )}
          </div>
        </div>
      )}

      <AnimatePresence>
        {selected && workspaceId && (
          <EntryEditor
            key={selected.id}
            workspaceId={workspaceId}
            entry={selected}
            busy={busyIds.has(selected.id)}
            canSchedule={canSchedule(selected)}
            onChange={(patch) => editEntry(selected.id, patch)}
            onMove={(date, time) => void moveEntry(selected.id, date, time)}
            onPicture={(url) => {
              patchEntry(selected.id, { images: [url] });
              announce();
            }}
            onApprove={() => void setStatus(selected.id, "approved")}
            onBackToDraft={() => void setStatus(selected.id, "draft")}
            onSchedule={() => void schedule(selected.id)}
            onCancelSchedule={() => void cancelSchedule(selected.id)}
            onRegenerate={() => void regenerate(selected.id)}
            onDuplicate={() => void duplicate(selected.id)}
            onDelete={() => void remove(selected.id)}
            onClose={closeEditor}
          />
        )}
      </AnimatePresence>
    </AppModalShell>
  );
}
