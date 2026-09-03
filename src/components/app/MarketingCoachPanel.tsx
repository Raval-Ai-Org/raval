"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useServerFn } from "@/lib/use-server-fn";
import {
  ChevronDown,
  Sparkles,
  Target,
  TrendingUp,
  AlertTriangle,
  Swords,
  Lightbulb,
  CalendarRange,
  RefreshCw,
  ArrowUpRight,
  Loader2,
  Trophy,
  CheckSquare,
  RotateCcw,
  Download,
  FileText,
  FileType2,
  StickyNote,
  X,
} from "@/components/ui/gemini-icons";
import { NotesTabBody } from "./NotesPanel";
import { cn } from "@/lib/utils";
import {
  getCoachBriefing,
  type CoachBriefing,
  type CoachInsight,
  type CoachAction,
} from "@/lib/coach.functions";
import { exportBriefingPDF, exportBriefingDoc } from "@/lib/coach-export";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/* -------------------- Checklist state -------------------- */

type ChecklistPriority = "today" | "week";
interface ChecklistTask {
  id: string;
  title: string;
  detail?: string;
  priority: ChecklistPriority;
  source: "focus" | "risk" | "play" | "week";
  action?: CoachAction;
}

const CHECKLIST_PREFIX = "coach:checklist:v1:";
const checklistKey = (wsId: string) => `${CHECKLIST_PREFIX}${wsId}`;

function readChecklistState(wsId: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(checklistKey(wsId));
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeChecklistState(wsId: string, state: Record<string, boolean>) {
  try {
    localStorage.setItem(checklistKey(wsId), JSON.stringify(state));
  } catch {}
}

function hashId(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return `t_${(h >>> 0).toString(36)}`;
}

function buildChecklist(b: CoachBriefing): ChecklistTask[] {
  const tasks: ChecklistTask[] = [];
  if (b.focus?.title) {
    tasks.push({
      id: hashId("focus:" + b.focus.title),
      title: b.focus.title,
      detail: b.focus.why,
      priority: "today",
      source: "focus",
      action: b.focus.action,
    });
  }
  for (const r of b.risks || []) {
    tasks.push({
      id: hashId("risk:" + r.title),
      title: r.title,
      detail: r.detail,
      priority: "today",
      source: "risk",
      action: r.action,
    });
  }
  for (const p of b.plays || []) {
    tasks.push({
      id: hashId("play:" + p.title),
      title: p.title,
      detail: p.detail,
      priority: "week",
      source: "play",
      action: p.action,
    });
  }
  (b.weekPlan || []).forEach((step, i) => {
    tasks.push({
      id: hashId(`week:${i}:${step}`),
      title: step,
      priority: "week",
      source: "week",
    });
  });
  return tasks;
}

interface Props {
  workspaceId: string | null | undefined;
  brandContext?: string;
  leading?: React.ReactNode;
}

const CACHE_PREFIX = "coach:briefing:v1:";
const CACHE_TTL_MS = 1000 * 60 * 60 * 12; // 12h — refreshes ~twice/day

function cacheKey(wsId: string) {
  return `${CACHE_PREFIX}${wsId}`;
}

function readCache(wsId: string): CoachBriefing | null {
  try {
    const raw = localStorage.getItem(cacheKey(wsId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CoachBriefing;
    if (!parsed.generatedAt) return null;
    if (Date.now() - new Date(parsed.generatedAt).getTime() > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(wsId: string, b: CoachBriefing) {
  try {
    localStorage.setItem(cacheKey(wsId), JSON.stringify(b));
  } catch {}
}

function fireChat(prompt: string) {
  window.dispatchEvent(new CustomEvent("chat:prefill", { detail: prompt }));
  window.dispatchEvent(new CustomEvent("chat:focus"));
}

export function MarketingCoachPanel({ workspaceId, brandContext, leading }: Props) {
  const [open, setOpen] = useState(false);
  const [briefing, setBriefing] = useState<CoachBriefing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<
    "today" | "checklist" | "competitors" | "market" | "plays" | "week" | "notes"
  >("today");
  const fetchBriefing = useServerFn(getCoachBriefing);

  const load = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!workspaceId) return;
      if (!opts?.force) {
        const cached = readCache(workspaceId);
        if (cached) {
          setBriefing(cached);
          return;
        }
      }
      setLoading(true);
      setError(null);
      try {
        const b = await fetchBriefing({
          data: { workspaceId, brandContext, force: opts?.force },
        });
        setBriefing(b);
        writeCache(workspaceId, b);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load briefing");
      } finally {
        setLoading(false);
      }
    },
    [workspaceId, brandContext, fetchBriefing],
  );

  // Load cached briefing immediately; fetch fresh when panel first opens.
  useEffect(() => {
    if (!workspaceId) return;
    const cached = readCache(workspaceId);
    if (cached) setBriefing(cached);
  }, [workspaceId]);

  useEffect(() => {
    if (open && !briefing && !loading) void load();
  }, [open, briefing, loading, load]);

  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener("open:marketing-coach", h);
    return () => window.removeEventListener("open:marketing-coach", h);
  }, []);

  const generatedLabel = useMemo(() => {
    if (!briefing?.generatedAt) return null;
    const diff = Date.now() - new Date(briefing.generatedAt).getTime();
    const mins = Math.round(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  }, [briefing?.generatedAt]);

  const focusLabel = briefing?.focus?.title;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 280, damping: 30 }}
      className={cn(
        "w-full overflow-hidden rounded-2xl border border-border/70 bg-card/95 backdrop-blur-xl",
        "shadow-[0_1px_2px_rgba(0,0,0,0.05),0_20px_48px_-24px_rgba(0,0,0,0.45)]",
      )}
    >
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="expanded"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="max-h-[58vh] overflow-auto scrollbar-thin px-3 pb-3 pt-3">
              {loading && !briefing && <SkeletonBrief />}
              {error && !loading && (
                <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive"
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-semibold text-destructive">
                        Couldn't refresh your briefing
                      </div>
                      <div className="mt-0.5 text-[11.5px] leading-snug text-destructive/85">
                        {error}
                      </div>
                      <div className="mt-1 text-[11px] leading-snug text-destructive/70">
                        Tip: check your connection, then retry. If this keeps happening, ask Ravi in
                        chat and I'll run the scan manually.
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void load({ force: true })}
                          className="inline-flex items-center gap-1 rounded-md bg-destructive px-2 py-1 text-[11px] font-semibold text-destructive-foreground hover:opacity-90"
                        >
                          <RefreshCw className="h-3 w-3" aria-hidden="true" /> Retry scan
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            fireChat(
                              "My marketing briefing failed to load — can you run a fresh scan and summarize what you find?",
                            )
                          }
                          className="text-[11px] font-medium text-destructive/85 underline underline-offset-2 hover:text-destructive"
                        >
                          Ask Ravi instead
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {briefing && (
                <>
                  <CoachBody
                    workspaceId={workspaceId ?? null}
                    briefing={briefing}
                    tab={tab}
                    onTab={setTab}
                    loading={loading}
                    onRefresh={() => void load({ force: true })}
                    generatedLabel={generatedLabel}
                  />
                  <CoachWalkthrough onJumpTab={setTab} />
                </>
              )}
            </div>
            <div className="h-px bg-border/60" />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center gap-1.5 px-2 py-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-secondary/60"
        >
          {leading ?? (
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-gradient-to-br from-emerald-500/20 via-sky-500/15 to-indigo-500/20 text-emerald-500">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
          )}
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="shrink-0 text-[12px] font-semibold tracking-tight text-foreground">
              Marketing Coach
            </span>
            <span className="truncate text-[11px] text-muted-foreground">
              {open
                ? "· Tap to hide"
                : focusLabel
                  ? `· Today: ${focusLabel}`
                  : "· Daily brief & next plays"}
            </span>
          </span>
          {loading && !open && (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
          )}
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
              open ? "rotate-180" : "-rotate-90",
            )}
          />
        </button>
      </div>
    </motion.div>
  );
}

/* -------------------- Tabs (a11y) ------------------------- */

type CoachTabId = "today" | "checklist" | "competitors" | "market" | "plays" | "week" | "notes";

interface CoachTabDef {
  id: CoachTabId;
  label: string;
  icon: typeof Target;
  count?: number;
}

const tabDomId = (id: CoachTabId) => `coach-tab-${id}`;
const panelDomId = (id: CoachTabId) => `coach-panel-${id}`;

function CoachTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: CoachTabDef[];
  value: CoachTabId;
  onChange: (id: CoachTabId) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);

  const focusTab = (id: CoachTabId) => {
    const el = listRef.current?.querySelector<HTMLButtonElement>(`[data-tab-id="${id}"]`);
    el?.focus();
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const currentIdx = tabs.findIndex((t) => t.id === value);
    if (currentIdx < 0) return;
    let nextIdx: number | null = null;
    switch (e.key) {
      case "ArrowRight":
        nextIdx = (currentIdx + 1) % tabs.length;
        break;
      case "ArrowLeft":
        nextIdx = (currentIdx - 1 + tabs.length) % tabs.length;
        break;
      case "Home":
        nextIdx = 0;
        break;
      case "End":
        nextIdx = tabs.length - 1;
        break;
      default:
        return;
    }
    if (nextIdx === null) return;
    e.preventDefault();
    const next = tabs[nextIdx].id;
    onChange(next);
    // wait a tick so the new tab renders with tabIndex=0 before focusing
    requestAnimationFrame(() => focusTab(next));
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Marketing Coach sections"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className="-mx-3 flex gap-1 overflow-x-auto scrollbar-none px-3 pb-1 [scroll-padding-inline:0.75rem] sm:mx-0 sm:px-0 [-webkit-overflow-scrolling:touch] snap-x snap-mandatory"
      style={{ scrollSnapType: "x proximity" }}
    >
      {tabs.map((t) => {
        const active = value === t.id;
        const Icon = t.icon;
        const countLabel =
          typeof t.count === "number" && t.count > 0
            ? `, ${t.count} ${t.count === 1 ? "item" : "items"}`
            : "";
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={tabDomId(t.id)}
            data-tab-id={t.id}
            aria-selected={active}
            aria-controls={panelDomId(t.id)}
            aria-label={`${t.label}${countLabel}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn(
              "group inline-flex shrink-0 snap-start items-center gap-1.5 rounded-full px-3 py-2 text-[12px] font-medium transition-all sm:py-1.5 sm:text-[11.5px]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              active
                ? "bg-foreground text-background shadow-sm"
                : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
            )}
          >
            <Icon
              aria-hidden="true"
              className={cn("h-3.5 w-3.5", active ? "" : "opacity-70 group-hover:opacity-100")}
            />
            <span>{t.label}</span>
            {typeof t.count === "number" && t.count > 0 && (
              <span
                aria-hidden="true"
                className={cn(
                  "ml-0.5 rounded-full px-1.5 text-[9.5px] font-semibold tabular-nums",
                  active
                    ? "bg-background/20 text-background"
                    : "bg-foreground/10 text-foreground/80",
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------- Body -------------------------- */

function TabPanel({
  id,
  active,
  children,
}: {
  id: CoachTabId;
  active: boolean;
  children: React.ReactNode;
}) {
  if (!active) return null;
  return (
    <div
      role="tabpanel"
      id={panelDomId(id)}
      aria-labelledby={tabDomId(id)}
      tabIndex={0}
      className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-lg"
    >
      {children}
    </div>
  );
}

function CoachBody({
  workspaceId,
  briefing,
  tab,
  onTab,
  loading,
  onRefresh,
  generatedLabel,
}: {
  workspaceId: string | null;
  briefing: CoachBriefing;
  tab: "today" | "checklist" | "competitors" | "market" | "plays" | "week" | "notes";
  onTab: (t: "today" | "checklist" | "competitors" | "market" | "plays" | "week" | "notes") => void;
  loading: boolean;
  onRefresh: () => void;
  generatedLabel: string | null;
}) {
  const checklistTasks = useMemo(() => buildChecklist(briefing), [briefing]);
  const [done, setDone] = useState<Record<string, boolean>>(() =>
    workspaceId ? readChecklistState(workspaceId) : {},
  );
  useEffect(() => {
    if (workspaceId) setDone(readChecklistState(workspaceId));
  }, [workspaceId]);
  const openCount = checklistTasks.filter((t) => !done[t.id]).length;

  const tabs: { id: typeof tab; label: string; icon: typeof Target; count?: number }[] = [
    { id: "today", label: "Today", icon: Target },
    { id: "checklist", label: "Checklist", icon: CheckSquare, count: openCount },
    { id: "competitors", label: "Competitors", icon: Swords, count: briefing.competitors.length },
    { id: "market", label: "Market", icon: TrendingUp, count: briefing.market.length },
    { id: "plays", label: "Plays", icon: Lightbulb, count: briefing.plays.length },
    { id: "week", label: "This week", icon: CalendarRange },
    { id: "notes", label: "Notes", icon: StickyNote },
  ];

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {briefing.greeting}
            </div>
            {(generatedLabel || loading) && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-secondary/60 px-1.5 py-[1px] text-[10px] font-medium text-muted-foreground"
                aria-live="polite"
                title={
                  briefing.generatedAt ? new Date(briefing.generatedAt).toLocaleString() : undefined
                }
              >
                <span
                  className={cn(
                    "inline-block h-1.5 w-1.5 rounded-full",
                    loading ? "animate-pulse bg-amber-500" : "bg-emerald-500",
                  )}
                />
                {loading ? "Researching…" : `Updated ${generatedLabel}`}
              </span>
            )}
          </div>
          <div className="mt-1 text-[13.5px] font-semibold leading-snug tracking-[-0.005em] text-foreground sm:text-[14px]">
            {briefing.headline}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
          {loading && (
            <span
              role="status"
              aria-live="polite"
              className="hidden items-center gap-1 rounded-full bg-secondary/60 px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground sm:inline-flex"
            >
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              Refreshing…
            </span>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            aria-label={loading ? "Refreshing briefing" : "Refresh briefing"}
            aria-busy={loading}
            title={loading ? "Refreshing briefing…" : "Refresh briefing"}
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:cursor-wait disabled:opacity-60 disabled:hover:bg-transparent sm:h-7 sm:w-7"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </button>
          <ExportMenu briefing={briefing} disabled={loading} />
        </div>
      </div>

      {/* Tabs — segmented control with roving-tabindex keyboard nav */}
      <CoachTabs tabs={tabs} value={tab} onChange={onTab} />

      {/* Panels */}
      <TabPanel id="today" active={tab === "today"}>
        <div className="space-y-2">
          <FocusCard briefing={briefing} sources={briefing.sources} />
          {briefing.wins.length > 0 && (
            <Section
              title="Working well"
              icon={Trophy}
              tint="emerald"
              items={briefing.wins}
              sources={briefing.sources}
            />
          )}
          {briefing.risks.length > 0 && (
            <Section
              title="Watch outs"
              icon={AlertTriangle}
              tint="amber"
              items={briefing.risks}
              sources={briefing.sources}
            />
          )}
          {briefing.wins.length === 0 && briefing.risks.length === 0 && (
            <EmptyState
              icon={Sparkles}
              title="You're all clear for today"
              body="No new wins or watch-outs since your last scan. Ship the focus above, then check the Checklist or ask Ravi for a fresh sweep."
              action={{
                label: "Run a fresh scan",
                prompt: "Scan my brand, competitors and market and tell me what's changed today.",
                icon: RefreshCw,
              }}
            />
          )}
        </div>
      </TabPanel>

      <TabPanel id="checklist" active={tab === "checklist"}>
        <ChecklistPanel
          tasks={checklistTasks}
          done={done}
          onToggle={(id) => {
            const next = { ...done, [id]: !done[id] };
            setDone(next);
            if (workspaceId) writeChecklistState(workspaceId, next);
          }}
          onReset={() => {
            setDone({});
            if (workspaceId) writeChecklistState(workspaceId, {});
          }}
        />
      </TabPanel>

      <TabPanel id="competitors" active={tab === "competitors"}>
        <SectionOrEmpty
          items={briefing.competitors}
          sources={briefing.sources}
          icon={Swords}
          tint="rose"
          emptyTitle="No competitor moves yet"
          empty="Add 3–5 competitors in Brand DNA and I'll track their launches, positioning shifts and content weekly."
          emptyAction={{
            label: "Add competitors",
            prompt: "Help me list my top 5 competitors and what they're doing this month",
            intent: "brand-dna",
          }}
          emptyHint="Not sure who to add? Ask: “Who are my top competitors?”"
        />
      </TabPanel>

      <TabPanel id="market" active={tab === "market"}>
        <SectionOrEmpty
          items={briefing.market}
          sources={briefing.sources}
          icon={TrendingUp}
          tint="sky"
          emptyTitle="No market signals yet"
          empty="Tell me your category and audience once — I'll monitor trends, search demand and cultural shifts every week."
          emptyAction={{
            label: "Scan my market",
            prompt: "What are the biggest marketing trends in my category this week?",
            intent: "market",
          }}
          emptyHint="Trends refresh automatically after your first scan."
        />
      </TabPanel>

      <TabPanel id="plays" active={tab === "plays"}>
        <SectionOrEmpty
          items={briefing.plays}
          sources={briefing.sources}
          icon={Lightbulb}
          tint="violet"
          emptyTitle="No plays queued up"
          empty="Once I have a scan I'll suggest 3 experiments a week tailored to your funnel and channels — copy, campaigns and quick wins."
          emptyAction={{
            label: "Suggest experiments",
            prompt: "Suggest 3 marketing experiments I could run this week",
            intent: "ideate",
          }}
          emptyHint="Each play comes with a hypothesis, effort estimate and success metric."
        />
      </TabPanel>

      <TabPanel id="week" active={tab === "week"}>
        <div className="rounded-xl border border-border/70 bg-secondary/30 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <CalendarRange className="h-3 w-3" aria-hidden="true" /> Strategy this week
          </div>
          {briefing.weekPlan.length === 0 ? (
            <EmptyState
              icon={CalendarRange}
              title="No weekly plan yet"
              body="Run a scan and I'll draft a 5-step plan for the week — sequenced by impact, ready to schedule."
              action={{
                label: "Draft this week's plan",
                prompt: "Draft a 5-step marketing plan for me this week, ordered by impact.",
                icon: Sparkles,
              }}
              tone="soft"
            />
          ) : (
            <ol className="space-y-1.5">
              {briefing.weekPlan.map((step, i) => (
                <li key={i} className="flex gap-2 text-[12px] leading-snug text-foreground">
                  <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-foreground/10 text-[9.5px] font-semibold text-foreground">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          )}
          {briefing.weekPlan.length > 0 && (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => fireChat("Turn this week's plan into a scheduled content calendar")}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground/80 hover:text-foreground"
              >
                Schedule this week <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </TabPanel>

      {workspaceId && (
        <TabPanel id="notes" active={tab === "notes"}>
          <NotesTabBody workspaceId={workspaceId} />
        </TabPanel>
      )}

      {briefing.sources && briefing.sources.length > 0 && (
        <SourcesPanel sources={briefing.sources} />
      )}

      {generatedLabel && (
        <div className="pt-1 text-right text-[10px] text-muted-foreground/80">
          Updated {generatedLabel} · Grounded in your site + live web research
        </div>
      )}
    </div>
  );
}

/* ---------------------- Sources helpers ------------------- */

type SourceEntry = { label: string; url: string };

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function findSourceIndex(sources: SourceEntry[] | undefined, s: string | undefined): number {
  if (!sources || !s) return -1;
  const host = hostOf(s);
  return sources.findIndex((src) => src.url === s || src.label === s || hostOf(src.url) === host);
}

function CitationChip({ sources, source }: { sources?: SourceEntry[]; source?: string }) {
  if (!source) return null;
  const idx = findSourceIndex(sources, source);
  const url = idx >= 0 ? sources![idx].url : /^https?:\/\//.test(source) ? source : null;
  if (!url) return null;
  const host = hostOf(url);
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      title={host}
      aria-label={`Open source ${idx >= 0 ? idx + 1 : ""} · ${host}`}
      className="ml-1 inline-flex items-center gap-1 rounded-full border border-border/60 bg-secondary/60 px-1.5 py-[1px] align-middle text-[9.5px] font-semibold text-foreground/80 no-underline transition hover:border-foreground/40 hover:text-foreground"
    >
      {idx >= 0 && <span>[{idx + 1}]</span>}
      <span className="max-w-[80px] truncate">{host}</span>
      <ArrowUpRight className="h-2.5 w-2.5" />
    </a>
  );
}

function SourcesPanel({ sources }: { sources: SourceEntry[] }) {
  return (
    <section
      id="coach-sources"
      aria-label="Sources"
      className="rounded-xl border border-border/70 bg-card p-3"
    >
      <div className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <FileText className="h-3 w-3" /> Sources
        <span className="ml-auto text-[10px] font-medium normal-case tracking-normal text-muted-foreground/80">
          {sources.length} cited · verify every claim
        </span>
      </div>
      <ol className="space-y-1.5">
        {sources.map((s, i) => {
          const host = hostOf(s.url);
          return (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full bg-secondary text-[9.5px] font-semibold text-foreground/80">
                {i + 1}
              </span>
              <img
                src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`}
                alt=""
                aria-hidden
                loading="lazy"
                className="mt-[3px] h-3.5 w-3.5 shrink-0 rounded-sm"
              />
              <div className="min-w-0 flex-1">
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="block truncate text-[11.5px] font-medium text-foreground hover:underline"
                >
                  {s.label}
                </a>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="block truncate text-[10.5px] text-muted-foreground hover:text-foreground"
                >
                  {host}
                </a>
              </div>
              <ArrowUpRight className="mt-1 h-3 w-3 shrink-0 text-muted-foreground/70" />
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ---------------------- Focus card ------------------------ */

function FocusCard({ briefing, sources }: { briefing: CoachBriefing; sources?: SourceEntry[] }) {
  const { focus } = briefing;
  return (
    <div className="rounded-xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/8 via-transparent to-sky-500/8 p-3 sm:p-3.5">
      <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-emerald-500">
        <Target className="h-3 w-3 shrink-0" /> Today's focus
      </div>
      <div className="text-[13.5px] font-semibold leading-snug text-foreground break-words">
        {focus.title}
        <CitationChip sources={sources} source={(focus as { source?: string }).source} />
      </div>
      <div className="mt-1 text-[12px] leading-snug text-muted-foreground sm:text-[11.5px]">
        {focus.why}
      </div>
      {focus.action && (
        <button
          type="button"
          onClick={() => fireChat(focus.action.prompt)}
          className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-[11.5px] font-semibold text-background transition hover:opacity-90 sm:w-auto sm:py-1 sm:text-[11px]"
        >
          <span className="truncate">{focus.action.label}</span>
          <ArrowUpRight className="h-3 w-3 shrink-0" />
        </button>
      )}
    </div>
  );
}

/* ---------------------- Sections -------------------------- */

const tintMap = {
  emerald: "text-emerald-500",
  amber: "text-amber-500",
  rose: "text-rose-500",
  sky: "text-sky-500",
  violet: "text-violet-500",
} as const;

function Section({
  title,
  icon: Icon,
  tint,
  items,
  sources,
}: {
  title: string;
  icon: typeof Target;
  tint: keyof typeof tintMap;
  items: CoachInsight[];
  sources?: SourceEntry[];
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-card p-3">
      <div
        className={cn(
          "mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em]",
          tintMap[tint],
        )}
      >
        <Icon className="h-3 w-3" /> {title}
      </div>
      <ul className="space-y-2">
        {items.map((it, i) => (
          <InsightRow key={i} insight={it} sources={sources} />
        ))}
      </ul>
    </div>
  );
}

function SectionOrEmpty({
  items,
  icon,
  tint,
  empty,
  emptyTitle,
  emptyAction,
  emptyHint,
  sources,
}: {
  items: CoachInsight[];
  icon: typeof Target;
  tint: keyof typeof tintMap;
  empty: string;
  emptyTitle?: string;
  emptyAction?: { label: string; prompt: string; intent: string };
  emptyHint?: string;
  sources?: SourceEntry[];
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={icon}
        title={emptyTitle ?? "Nothing here yet"}
        body={empty}
        hint={emptyHint}
        action={
          emptyAction
            ? { label: emptyAction.label, prompt: emptyAction.prompt, icon: Sparkles }
            : undefined
        }
        tone="soft"
      />
    );
  }
  return <Section title="Signals" icon={icon} tint={tint} items={items} sources={sources} />;
}

/* ---------------------- Empty state ------------------------ */

/* ---------------------- First-time walkthrough ------------------------ */

const WALKTHROUGH_KEY = "coach:walkthrough:v1";

const WALKTHROUGH_STEPS: {
  title: string;
  body: string;
  tab?: "today" | "checklist" | "competitors" | "market" | "plays" | "week" | "notes";
}[] = [
  {
    title: "Meet Ravi, your marketing coach",
    body: "Every morning I scan your brand, competitors and market — then pull the signals that matter into one place.",
    tab: "today",
  },
  {
    title: "Start with Today's focus",
    body: "The Today tab shows one thing to ship, plus what's working and what to watch. Click any action to send it to chat.",
    tab: "today",
  },
  {
    title: "Work the Checklist",
    body: "I turn signals into a prioritized list for today and this week. Check items off as you ship — priorities re-rank automatically.",
    tab: "checklist",
  },
  {
    title: "Track rivals and trends",
    body: "Competitors, Market and Plays surface fresh moves and experiment ideas. Notes is your private scratchpad — nothing leaves the workspace.",
    tab: "competitors",
  },
  {
    title: "Refresh or export anytime",
    body: "Use the refresh button for a fresh scan, or export the briefing as PDF or Word to share with your team.",
  },
];

function CoachWalkthrough({
  onJumpTab,
}: {
  onJumpTab: (
    t: "today" | "checklist" | "competitors" | "market" | "plays" | "week" | "notes",
  ) => void;
}) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof window === "undefined") return;
    try {
      if (!window.localStorage.getItem(WALKTHROUGH_KEY)) {
        // small delay so the panel animates open first
        const t = window.setTimeout(() => setVisible(true), 350);
        return () => window.clearTimeout(t);
      }
    } catch {}
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    try {
      window.localStorage.setItem(WALKTHROUGH_KEY, "1");
    } catch {}
  }, []);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, dismiss]);

  if (!mounted || !visible) return null;
  const current = WALKTHROUGH_STEPS[step];
  const isLast = step === WALKTHROUGH_STEPS.length - 1;

  const node = (
    <AnimatePresence>
      <motion.div
        key="coach-walkthrough"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-end justify-center bg-background/50 p-3 sm:items-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="coach-walkthrough-title"
        onClick={dismiss}
      >
        <motion.div
          initial={{ y: 16, opacity: 0, scale: 0.98 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 8, opacity: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 28 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-sm rounded-2xl border border-border bg-card p-4 shadow-[0_24px_60px_-16px_rgba(0,0,0,0.55)]"
        >
          <div className="flex items-start gap-2.5">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-foreground/5 text-foreground">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div
                  id="coach-walkthrough-title"
                  className="text-[13px] font-semibold leading-snug text-foreground"
                >
                  {current.title}
                </div>
                <button
                  type="button"
                  onClick={dismiss}
                  aria-label="Skip walkthrough"
                  className="-mr-1 -mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                {current.body}
              </p>

              <div className="mt-4 flex items-center justify-between gap-2">
                <div
                  className="flex items-center gap-1"
                  aria-label={`Step ${step + 1} of ${WALKTHROUGH_STEPS.length}`}
                >
                  {WALKTHROUGH_STEPS.map((_, i) => (
                    <span
                      key={i}
                      className={cn(
                        "h-1 rounded-full transition-all",
                        i === step ? "w-4 bg-foreground" : "w-1.5 bg-foreground/25",
                      )}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  {step > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const prev = Math.max(0, step - 1);
                        const prevTab = WALKTHROUGH_STEPS[prev]?.tab;
                        if (prevTab) onJumpTab(prevTab);
                        setStep(prev);
                      }}
                      className="rounded-full px-3 py-1.5 text-[11.5px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
                    >
                      Back
                    </button>
                  )}
                  {!isLast && (
                    <button
                      type="button"
                      onClick={dismiss}
                      className="rounded-full px-3 py-1.5 text-[11.5px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
                    >
                      Skip
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (isLast) {
                        dismiss();
                        return;
                      }
                      const next = step + 1;
                      const nextTab = WALKTHROUGH_STEPS[next]?.tab;
                      if (nextTab) onJumpTab(nextTab);
                      setStep(next);
                    }}
                    className="inline-flex items-center gap-1 rounded-full bg-foreground px-3.5 py-1.5 text-[11.5px] font-semibold text-background hover:opacity-90"
                  >
                    {isLast ? "Get started" : "Next"}
                    {!isLast && <ArrowUpRight className="h-3 w-3" aria-hidden="true" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );

  return createPortal(node, document.body);
}

function ExportMenu({ briefing, disabled }: { briefing: CoachBriefing; disabled?: boolean }) {
  const [busy, setBusy] = useState<null | "pdf" | "doc">(null);
  const run = async (kind: "pdf" | "doc") => {
    if (busy) return;
    setBusy(kind);
    try {
      if (kind === "pdf") await exportBriefingPDF(briefing);
      else await exportBriefingDoc(briefing);
    } finally {
      setBusy(null);
    }
  };
  const isBusy = busy !== null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled || isBusy}
          aria-label={isBusy ? "Preparing export" : "Export briefing"}
          aria-busy={isBusy}
          title={isBusy ? "Preparing export…" : "Export briefing"}
          className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:cursor-wait disabled:opacity-60 disabled:hover:bg-transparent"
        >
          {isBusy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem
          disabled={isBusy}
          onSelect={(e) => {
            e.preventDefault();
            void run("pdf");
          }}
          className="gap-2 text-xs"
        >
          {busy === "pdf" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileText className="h-3.5 w-3.5" />
          )}
          {busy === "pdf" ? "Preparing PDF…" : "Download PDF"}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={isBusy}
          onSelect={(e) => {
            e.preventDefault();
            void run("doc");
          }}
          className="gap-2 text-xs"
        >
          {busy === "doc" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileType2 className="h-3.5 w-3.5" />
          )}
          {busy === "doc" ? "Preparing Word…" : "Download Word (.doc)"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
  hint,
  action,
  tone = "default",
}: {
  icon: typeof Target;
  title: string;
  body: string;
  hint?: string;
  action?: { label: string; prompt: string; icon?: typeof Target };
  tone?: "default" | "soft";
}) {
  const ActionIcon = action?.icon ?? Sparkles;
  return (
    <div
      className={cn(
        "rounded-xl border border-dashed p-4 text-center",
        tone === "soft" ? "border-border/60 bg-secondary/20" : "border-border/70 bg-card",
      )}
    >
      <div className="mx-auto mb-2 grid h-8 w-8 place-items-center rounded-full bg-foreground/5 text-foreground/70">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="text-[12.5px] font-semibold text-foreground">{title}</div>
      <p className="mx-auto mt-1 max-w-[42ch] text-[11.5px] leading-snug text-muted-foreground">
        {body}
      </p>
      {action && (
        <button
          type="button"
          onClick={() => fireChat(action.prompt)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-[11px] font-semibold text-background transition hover:opacity-90"
        >
          <ActionIcon className="h-3 w-3" aria-hidden="true" /> {action.label}
        </button>
      )}
      {hint && (
        <div className="mt-2 text-[10.5px] leading-snug text-muted-foreground/80">{hint}</div>
      )}
    </div>
  );
}

function InsightRow({ insight, sources }: { insight: CoachInsight; sources?: SourceEntry[] }) {
  return (
    <li className="flex gap-2">
      <span
        className={cn(
          "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
          insight.tone === "positive" && "bg-emerald-500",
          insight.tone === "warning" && "bg-amber-500",
          insight.tone === "opportunity" && "bg-violet-500",
          (!insight.tone || insight.tone === "neutral") && "bg-muted-foreground/60",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-semibold leading-snug text-foreground">
          {insight.title}
          <CitationChip sources={sources} source={insight.source} />
        </div>
        <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
          {insight.detail}
        </div>
        {insight.action && (
          <button
            type="button"
            onClick={() => fireChat(insight.action!.prompt)}
            className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-foreground/80 hover:text-foreground"
          >
            {insight.action.label} <ArrowUpRight className="h-3 w-3" />
          </button>
        )}
      </div>
    </li>
  );
}

/* ---------------------- Misc ------------------------------ */

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border/70 bg-secondary/20 p-3 text-center text-[11.5px] text-muted-foreground">
      {text}
    </div>
  );
}

function SkeletonBrief() {
  return (
    <div className="space-y-2">
      <div className="h-3 w-40 animate-pulse rounded bg-secondary" />
      <div className="h-4 w-full animate-pulse rounded bg-secondary" />
      <div className="mt-3 space-y-2">
        <div className="h-16 w-full animate-pulse rounded-xl bg-secondary" />
        <div className="h-12 w-full animate-pulse rounded-xl bg-secondary" />
        <div className="h-12 w-full animate-pulse rounded-xl bg-secondary" />
      </div>
    </div>
  );
}

/* ---------------------- Checklist ------------------------- */

function ChecklistPanel({
  tasks,
  done,
  onToggle,
  onReset,
}: {
  tasks: ChecklistTask[];
  done: Record<string, boolean>;
  onToggle: (id: string) => void;
  onReset: () => void;
}) {
  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={CheckSquare}
        title="No actions queued up"
        body="Once your first briefing lands I'll prioritize the highest-impact moves for today and this week — check them off as you ship."
        hint="Tasks re-prioritize automatically as new signals come in."
        action={{
          label: "Generate my checklist",
          prompt:
            "Generate a prioritized marketing checklist for me based on my brand, competitors and market.",
          icon: Sparkles,
        }}
        tone="soft"
      />
    );
  }
  const today = tasks.filter((t) => t.priority === "today");
  const week = tasks.filter((t) => t.priority === "week");
  const completed = tasks.filter((t) => done[t.id]).length;
  const pct = Math.round((completed / tasks.length) * 100);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border/70 bg-secondary/30 p-2.5">
        <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
          <span>
            {completed} of {tasks.length} done
          </span>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] text-muted-foreground hover:bg-secondary hover:text-foreground"
            title="Reset progress"
          >
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-sky-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {today.length > 0 && (
        <ChecklistGroup
          label="Today"
          tint="emerald"
          tasks={today}
          done={done}
          onToggle={onToggle}
        />
      )}
      {week.length > 0 && (
        <ChecklistGroup label="This week" tint="sky" tasks={week} done={done} onToggle={onToggle} />
      )}
    </div>
  );
}

function ChecklistGroup({
  label,
  tint,
  tasks,
  done,
  onToggle,
}: {
  label: string;
  tint: "emerald" | "sky";
  tasks: ChecklistTask[];
  done: Record<string, boolean>;
  onToggle: (id: string) => void;
}) {
  const tintClass = tint === "emerald" ? "text-emerald-500" : "text-sky-500";
  return (
    <div className="rounded-xl border border-border/70 bg-card/60 p-2.5">
      <div
        className={cn(
          "mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em]",
          tintClass,
        )}
      >
        <CheckSquare className="h-3 w-3" /> {label}
        <span className="ml-auto text-[10px] font-medium text-muted-foreground">
          {tasks.filter((t) => done[t.id]).length}/{tasks.length}
        </span>
      </div>
      <ul className="space-y-1">
        {tasks.map((t) => {
          const isDone = !!done[t.id];
          return (
            <li
              key={t.id}
              className="group flex items-start gap-2 rounded-lg px-1.5 py-1.5 hover:bg-secondary/40"
            >
              <button
                type="button"
                onClick={() => onToggle(t.id)}
                aria-label={isDone ? "Mark as not done" : "Mark as done"}
                className={cn(
                  "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border transition",
                  isDone
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-border/80 bg-background hover:border-foreground/40",
                )}
              >
                {isDone && <CheckSquare className="h-2.5 w-2.5" />}
              </button>
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    "text-[12px] leading-snug",
                    isDone ? "text-muted-foreground line-through" : "text-foreground",
                  )}
                >
                  {t.title}
                </div>
                {t.detail && !isDone && (
                  <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground line-clamp-2">
                    {t.detail}
                  </div>
                )}
              </div>
              {t.action && !isDone && (
                <button
                  type="button"
                  onClick={() => fireChat(t.action!.prompt)}
                  className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border/70 px-1.5 py-0.5 text-[10.5px] font-medium text-foreground/80 opacity-0 transition group-hover:opacity-100 hover:border-foreground/30 hover:text-foreground"
                  title={t.action.label}
                >
                  {t.action.label} <ArrowUpRight className="h-2.5 w-2.5" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
