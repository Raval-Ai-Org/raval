"use client";

// Content Calendar — plan, review and schedule a brand's posts by date.
//
// Every post is a `content_items` row. Where it sits comes from the model in
// `src/lib/calendar/model.ts`: its real schedule if it has one, otherwise the
// day it was planned for. Moving a post only changes that plan; a post is
// "Scheduled" only after the publishing provider has accepted it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "@/lib/toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarDays,
  ChevronDown,
  Filter,
  Plus,
  Sparkles,
  X,
} from "@/components/icons";
import { AppModalShell } from "@/components/app/AppModalShell";
import { dsIconBtn } from "@/components/app/surface/buttons";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { addAppEventListener, emitAppEvent, removeAppEventListener } from "@/lib/app-events";
import { useNavigate } from "@/lib/navigation";
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
  toCalendarChannel,
  weekDays,
  type CalendarChannel,
  type CalendarEntry,
  type CalendarFilter,
} from "@/lib/calendar/model";
import {
  autopilotItemIds,
  autopilotSignature,
  plannedSlots,
  slotsByDate,
  type PlannedSlot,
} from "@/lib/calendar/autopilot";
import type { ActionView } from "@/lib/autopilot/contracts";
import { autopilotKeys, useAutopilotActions } from "./autopilot/hooks";
import type { Section } from "./autopilot/AutopilotScreen";
import { AutopilotOrb } from "./autopilot/composer/AutopilotDeck";
import { autopilotPath } from "./autopilot/composer/useComposerAutopilot";
import { AutopilotRail } from "./calendar/AutopilotRail";
import { CalendarToolbar } from "./calendar/CalendarToolbar";
import { useCalendarAutopilot } from "./calendar/use-calendar-autopilot";
import { EntryEditor, type EntryPatch } from "./calendar/EntryEditor";
import { ExportMenu } from "./calendar/ExportMenu";
import { NotionConnection } from "./connectors/NotionConnection";
import { PlanPanel } from "./calendar/PlanPanel";
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

const NO_IDS: Set<string> = new Set();

export function ContentCalendar({ workspaceId }: { workspaceId: string | null }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
  // Until someone picks a tab, the side panel shows what is most useful.
  const [rail, setRail] = useState<"plan" | "day" | null>(null);
  const [showSheet, setShowSheet] = useState(false);
  const [manualPlan, setManualPlan] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false);
  const [isCompact, setIsCompact] = useState(false);
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
    // A link with ?calendar=1 opens it. This component loads lazily, so it reads
    // the link itself rather than relying on an event sent before it was mounted.
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("calendar") === "1") {
        setOpen(true);
        url.searchParams.delete("calendar");
        window.history.replaceState({}, "", url.pathname + url.search + url.hash);
      }
    } catch {
      /* no window or bad URL: stay closed */
    }
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
    // Approving or moving a post changes what Autopilot does next.
    void queryClient.invalidateQueries({ queryKey: autopilotKeys.all(workspaceId) });
  }, [queryClient, workspaceId]);

  /* ───────────────────────── autopilot ───────────────────────── */

  const autopilot = useCalendarAutopilot(workspaceId, open);
  const apActions = useAutopilotActions(workspaceId ?? "");
  const apView = autopilot.view;
  const autopilotIds = useMemo(() => (apView ? autopilotItemIds(apView) : NO_IDS), [apView]);

  // Autopilot wrote, scheduled or sent something: read the posts again.
  const signature = apView ? autopilotSignature(apView) : "";
  const lastSignature = useRef("");
  useEffect(() => {
    if (!open) {
      lastSignature.current = "";
      return;
    }
    if (lastSignature.current && signature && lastSignature.current !== signature) {
      void load(true);
    }
    lastSignature.current = signature;
  }, [open, signature, load]);

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
    // Below this the side panel has no room and opens over the calendar instead.
    const compact = window.matchMedia("(max-width: 1023px)");
    const apply = () => {
      setIsNarrow(mq.matches);
      setIsCompact(compact.matches);
    };
    apply();
    mq.addEventListener("change", apply);
    compact.addEventListener("change", apply);
    return () => {
      mq.removeEventListener("change", apply);
      compact.removeEventListener("change", apply);
    };
  }, []);
  const activeView: View = isNarrow ? "list" : view;

  /* ───────────────────────── what is on screen ───────────────────────── */

  const range = useMemo(() => {
    if (activeView === "week") {
      const days = weekDays(anchor);
      const from = days[0];
      const to = days[6];
      const short = (d: Date) =>
        d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      return {
        from: fmtYMD(from),
        to: fmtYMD(to),
        // "Oct 5 – 11, 2026", or "Sep 28 – Oct 4, 2026" across two months.
        label: `${short(from)} – ${
          from.getMonth() === to.getMonth() ? to.getDate() : short(to)
        }, ${to.getFullYear()}`,
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
  const reviewCount = inRange.filter((e) => e.status === "review").length;

  // What Autopilot has planned but not written yet. A status filter is about
  // posts that exist, so it hides these.
  const slots = useMemo(() => {
    if (!apView || filter.status !== "all") return [];
    const q = filter.query.trim().toLowerCase();
    return plannedSlots(apView).filter(
      (slot) =>
        (filter.channel === "all" || slot.channel === filter.channel) &&
        (filter.format !== "stories" || slot.format === "Story") &&
        (filter.format !== "posts" || slot.format !== "Story") &&
        (!q || slot.title.toLowerCase().includes(q)),
    );
  }, [apView, filter]);
  const plannedByDate = useMemo(() => slotsByDate(slots), [slots]);
  const slotsInRange = useMemo(
    () => slots.filter((slot) => slot.date >= range.from && slot.date <= range.to),
    [slots, range.from, range.to],
  );
  const slotsInRangeByDate = useMemo(() => slotsByDate(slotsInRange), [slotsInRange]);

  const activeRail: "plan" | "day" =
    rail ?? (apView ? "plan" : loading || entries.length ? "day" : "plan");

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
    if (isCompact) setShowSheet(true);
  };

  const stepDay = (dir: 1 | -1) => {
    const next = addDays(parseYMD(selectedDate ?? today), dir);
    setSelectedDate(fmtYMD(next));
    if (next.getMonth() !== anchor.getMonth() || next.getFullYear() !== anchor.getFullYear()) {
      setAnchor(next);
    }
  };

  const openPlan = () => {
    setRail("plan");
    if (isCompact) setShowSheet(true);
  };

  /** Autopilot has its own screen; the calendar steps aside for it. */
  const openAutopilot = (section: Section) => {
    if (!workspaceId) return;
    setShowSheet(false);
    setOpen(false);
    navigate({ to: autopilotPath(workspaceId, section) });
  };

  /** Open a post from the side panel (which, on a small screen, is in the way). */
  const openEntry = (id: string) => {
    setShowSheet(false);
    setSelectedId(id);
  };

  const showAction = (action: ActionView) => {
    const id = action.contentItemIds.find((itemId) => entries.some((e) => e.id === itemId));
    if (id) {
      openEntry(id);
      return;
    }
    if (!action.plannedFor) return;
    const at = new Date(action.plannedFor);
    if (Number.isNaN(at.getTime())) return;
    setAnchor(at);
    setSelectedDate(fmtYMD(at));
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
    autopilotIds,
    onPickEntry: setSelectedId,
    onPickPlanned: (slot: PlannedSlot) => pickDate(slot.date),
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
        setShowSheet(false);
        announce();
      }}
    />
  ) : null;

  const day = selectedDate ?? today;
  const railBody =
    activeRail === "day" ? (
      <DayPanel
        date={day}
        today={today}
        entries={byDate.get(day) ?? []}
        planned={plannedByDate.get(day) ?? []}
        autopilotIds={autopilotIds}
        moments={momentsBetween(day, day)}
        onPickEntry={openEntry}
        onPickPlanned={() => setRail("plan")}
        onStep={stepDay}
        onAdd={(date, title) => void createPost(date, title)}
      />
    ) : apView ? (
      <>
        <AutopilotRail
          view={apView}
          busy={apActions.approvePlan.isPending || apActions.pause.isPending}
          onApprovePlan={() => apActions.approvePlan.mutate()}
          onPause={(paused) => apActions.pause.mutate(paused)}
          onOpen={openAutopilot}
          onPickAction={showAction}
        />
        <div className="border-t border-border">
          <button
            type="button"
            aria-expanded={manualPlan}
            onClick={() => setManualPlan((v) => !v)}
            className="flex w-full items-center justify-between gap-2 px-4 py-3 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
          >
            Add extra posts yourself
            <ChevronDown
              className={cn("h-4 w-4 transition-transform", manualPlan && "rotate-180")}
            />
          </button>
          {manualPlan && planPanel}
        </div>
      </>
    ) : (
      <>
        {planPanel}
        {autopilot.available && (
          <div className="border-t border-border p-4">
            <button
              type="button"
              onClick={() => openAutopilot("home")}
              className="ds-tile ds-tile-hover flex w-full items-center gap-3 p-3 text-left"
            >
              <AutopilotOrb state="off" size={32} />
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-semibold">Autopilot</span>
                <span className="block truncate text-[11.5px] text-muted-foreground">
                  Plans and writes every week for you
                </span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </div>
        )}
      </>
    );
  const planLabel = apView ? "Autopilot" : "Plan";
  const railTabs = (
    <Tabs value={activeRail} onValueChange={(v) => setRail(v as "plan" | "day")}>
      <TabsList className="h-8 w-full">
        <TabsTrigger value="day" className="flex-1 text-[12px]">
          Day
        </TabsTrigger>
        <TabsTrigger value="plan" className="flex-1 gap-1.5 text-[12px]">
          {planLabel}
          {apView && apView.approvals.length + (apView.proposed.length ? 1 : 0) > 0 && (
            <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-label="Needs you" />
          )}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );

  const nothingAtAll = entries.length === 0 && slots.length === 0;
  const nothingInRange = inRange.length === 0 && slotsInRange.length === 0;
  const summary = [
    `${inRange.length} ${inRange.length === 1 ? "post" : "posts"}`,
    scheduledCount ? `${scheduledCount} scheduled` : "",
    reviewCount ? `${reviewCount} to review` : "",
    apView ? (apView.program?.status === "paused" ? "Autopilot paused" : "Autopilot on") : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <AppModalShell
      open={open}
      onOpenChange={setOpen}
      size="2xl"
      Icon={CalendarDays}
      title="Content Calendar"
      description={loading || (!inRange.length && !apView) ? undefined : summary}
      headerAccessory={
        workspaceId ? (
          <>
            <NotionConnection
              workspaceId={workspaceId}
              compact
              contentIds={inRange.map((entry) => entry.id)}
            />
            <ExportMenu
              shown={inRange}
              all={entries}
              shownLabel={range.label}
              shownSlug={range.slug}
            />
            <Button
              size="sm"
              onClick={openPlan}
              className="max-sm:px-2.5 lg:hidden"
              aria-label={planLabel}
            >
              <Sparkles /> <span className="hidden sm:inline">{planLabel}</span>
            </Button>
          </>
        ) : undefined
      }
      bodyClassName="flex flex-col"
    >
      {!workspaceId ? (
        <EmptyState icon={CalendarDays} title="Open a brand to see its calendar" />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* LEFT — the calendar */}
          <div className="relative flex min-h-0 min-w-0 flex-col overflow-hidden lg:border-r lg:border-border">
            <CalendarToolbar
              label={range.label}
              view={activeView}
              showViews={!isNarrow}
              filter={filter}
              onStep={step}
              onToday={() => {
                setAnchor(new Date());
                setSelectedDate(today);
              }}
              onView={setView}
              onFilter={setFilter}
              onNewPost={() => void createPost(selectedDate ?? undefined)}
            />

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
            ) : nothingAtAll ? (
              <div className="grid flex-1 place-items-center">
                <EmptyState
                  icon={CalendarDays}
                  title="Your calendar is empty"
                  action={
                    <Button onClick={openPlan}>
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
                planned={plannedByDate}
                grid={grid}
                month={anchor.getMonth()}
                selectedDate={selectedDate ?? today}
                onPickDate={pickDate}
                onAdd={(date) => void createPost(date)}
              />
            ) : activeView === "week" ? (
              <WeekView
                {...viewProps}
                byDate={byDate}
                planned={plannedByDate}
                days={weekDays(anchor)}
                onAdd={(date) => void createPost(date)}
              />
            ) : nothingInRange ? (
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
                planned={slotsInRangeByDate}
                onRegenerate={(id) => void regenerate(id)}
              />
            )}

            {/* Smaller screens: the side panel slides up over the calendar. */}
            <AnimatePresence>
              {showSheet && isCompact && (
                <motion.div
                  key="sheet-backdrop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowSheet(false)}
                  className="absolute inset-0 z-30 bg-background/60 backdrop-blur-[2px]"
                  aria-hidden
                />
              )}
              {showSheet && isCompact && (
                <motion.div
                  key="sheet"
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 24 }}
                  transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute inset-y-0 right-0 z-30 flex w-full flex-col overflow-y-auto bg-card sm:w-[340px] sm:border-l sm:border-border"
                >
                  <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-card px-4 py-2">
                    <div className="min-w-0 flex-1">{railTabs}</div>
                    <button
                      type="button"
                      onClick={() => setShowSheet(false)}
                      className={dsIconBtn}
                      aria-label="Close"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  {railBody}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* RIGHT — the day that was picked, or the plan (Autopilot's, when it is on) */}
          <div className="hidden min-h-0 min-w-0 flex-col overflow-y-auto scrollbar-thin lg:flex">
            <div className="sticky top-0 z-10 border-b border-border bg-background/90 px-4 py-2 backdrop-blur">
              {railTabs}
            </div>
            {!isCompact && railBody}
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
