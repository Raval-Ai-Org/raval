"use client";

// TodayBrief — the Coach briefing and its to-do list, in Brain → Home → Today.
// A briefing is paid and only ever started by a person; the last one is kept
// in this browser and shown straight away.
import { Spinner } from "@/components/icons";
import { emitAppEvent } from "@/lib/app-events";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@/lib/use-server-fn";
import {
  Sparkles,
  Target,
  AlertTriangle,
  RefreshCw,
  ArrowUpRight,
  Loader2,
  Trophy,
  CheckSquare,
  RotateCcw,
  Download,
  FileText,
  FileType2,
} from "@/components/ui/gemini-icons";
import { cn } from "@/lib/utils";
import {
  getCoachBriefing,
  type CoachBriefing,
  type CoachInsight,
  type CoachAction,
} from "@/lib/coach.functions";
import { CostChip } from "@/components/app/CostChip";
import { FeatureGate } from "@/components/app/FeatureGate";
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
}

const CACHE_PREFIX = "coach:briefing:v1:";
const CACHE_TTL_MS = 1000 * 60 * 60 * 12; // 12h — refreshes ~twice/day

function cacheKey(wsId: string) {
  return `${CACHE_PREFIX}${wsId}`;
}

/**
 * The last briefing saved in this browser. With `allowStale` an old one is
 * returned too, so the panel can show it instantly while a fresh one loads.
 */
function readCache(wsId: string, opts?: { allowStale?: boolean }): CoachBriefing | null {
  try {
    const raw = localStorage.getItem(cacheKey(wsId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CoachBriefing;
    if (!parsed.generatedAt) return null;
    if (!opts?.allowStale && isStale(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isStale(b: CoachBriefing): boolean {
  return Date.now() - new Date(b.generatedAt).getTime() > CACHE_TTL_MS;
}

function writeCache(wsId: string, b: CoachBriefing) {
  try {
    localStorage.setItem(cacheKey(wsId), JSON.stringify(b));
  } catch {}
}

function fireChat(prompt: string) {
  emitAppEvent("chat:prefill", prompt);
  emitAppEvent("chat:focus");
}

/**
 * Today's plan: the Coach briefing and its to-do list, shown in Brain → Home.
 * Opening it never starts a paid briefing; the saved one is shown and a person
 * starts a priced refresh.
 */
export function TodayBrief({ workspaceId, brandContext }: Props) {
  const [briefing, setBriefing] = useState<CoachBriefing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const [clock, setClock] = useState(() => Date.now());
  const [tab, setTab] = useState<CoachTabId>("today");
  const fetchBriefing = useServerFn(getCoachBriefing);
  const hasBriefingRef = useRef(false);
  hasBriefingRef.current = briefing !== null;

  const load = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!workspaceId) return;
      const requestId = ++requestRef.current;
      setLoading(true);
      setError(null);
      try {
        const b = await fetchBriefing({
          data: {
            workspaceId,
            brandContext,
            force: opts?.force,
            idempotencyKey: crypto.randomUUID(),
          },
        });
        if (requestId !== requestRef.current) return;
        setBriefing(b);
        if (!b.limited) writeCache(workspaceId, b);
      } catch (e) {
        if (requestId !== requestRef.current) return;
        setError(e instanceof Error ? e.message : "Couldn't load your plan");
      } finally {
        if (requestId === requestRef.current) setLoading(false);
      }
    },
    [workspaceId, brandContext, fetchBriefing],
  );

  useEffect(() => {
    if (!workspaceId) return;
    setBriefing(readCache(workspaceId, { allowStale: true }));
  }, [workspaceId]);

  useEffect(() => {
    if (!briefing?.generatedAt) return;
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [briefing?.generatedAt]);

  const generatedLabel = useMemo(() => {
    if (!briefing?.generatedAt) return null;
    const diff = clock - new Date(briefing.generatedAt).getTime();
    const mins = Math.round(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  }, [briefing?.generatedAt, clock]);

  return (
    <div className="space-y-3">
      {!briefing && !loading && !error && (
        <div className="ds-tile flex flex-col items-center gap-3 p-8 text-center">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-primary/12 text-primary">
            <Target className="h-5 w-5" aria-hidden="true" />
          </span>
          <p className="text-[14px] font-medium text-foreground">What to do today</p>
          <FeatureGate feature="market_brain">
            <button
              type="button"
              onClick={() => void load({ force: true })}
              className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground"
            >
              Get today's plan
            </button>
          </FeatureGate>
          <CostChip action="coach_briefing" />
        </div>
      )}
      {loading && !briefing && <SkeletonBrief />}
      {error && !loading && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-semibold text-destructive">
                Couldn't update your plan
              </div>
              <div className="mt-0.5 text-[11.5px] leading-snug text-destructive/85">{error}</div>
              <div className="mt-2 flex items-center gap-2">
                <FeatureGate feature="market_brain">
                  <button
                    type="button"
                    onClick={() => void load({ force: true })}
                    className="inline-flex items-center gap-1 rounded-full bg-destructive px-3 py-1 text-[11px] font-semibold text-destructive-foreground hover:opacity-90"
                  >
                    <RefreshCw className="h-3 w-3" aria-hidden="true" /> Try again
                  </button>
                </FeatureGate>
                <CostChip action="coach_briefing" />
              </div>
            </div>
          </div>
        </div>
      )}
      {briefing?.limited && !loading && (
        <div className="rounded-2xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          Mellox couldn't write a full plan this time. This short version is free and isn't saved.
        </div>
      )}
      {briefing && (
        <CoachBody
          workspaceId={workspaceId ?? null}
          briefing={briefing}
          tab={tab}
          onTab={setTab}
          loading={loading}
          onRefresh={() => void load({ force: true })}
          generatedLabel={generatedLabel}
        />
      )}
    </div>
  );
}

/* -------------------- Tabs (a11y) ------------------------- */

type CoachTabId = "today" | "checklist";

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
      aria-label="Today"
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
  tab: CoachTabId;
  onTab: (t: CoachTabId) => void;
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
    { id: "checklist", label: "To-do", icon: CheckSquare, count: openCount },
  ];

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div
            className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground"
            aria-live="polite"
            title={
              briefing.generatedAt ? new Date(briefing.generatedAt).toLocaleString() : undefined
            }
          >
            <span>{briefing.greeting}</span>
            {(generatedLabel || loading) && (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1">
                  {loading ? <Spinner className="h-3 w-3 animate-spin" aria-hidden /> : null}
                  {loading ? "Updating…" : `Updated ${generatedLabel}`}
                </span>
              </>
            )}
          </div>
          <div className="mt-1 text-[15px] font-semibold leading-snug tracking-[-0.01em] text-foreground">
            {briefing.headline}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <CostChip action="coach_briefing" />
          <FeatureGate feature="market_brain">
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              aria-label={loading ? "Updating briefing" : "Update briefing"}
              aria-busy={loading}
              title="Update briefing · 100 credits"
              className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:cursor-wait disabled:opacity-60 disabled:hover:bg-transparent"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </button>
          </FeatureGate>
          <ExportMenu briefing={briefing} disabled={loading} />
        </div>
      </div>

      <button
        type="button"
        onClick={() =>
          fireChat(
            `Based on today's plan, what should I do first and why? Headline: ${briefing.headline}`,
          )
        }
        className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground transition hover:brightness-105"
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        What should I do first?
      </button>

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
              body="Nothing new since your last update."
              action={{
                label: "Check again",
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

      {briefing.sources && briefing.sources.length > 0 && (
        <SourcesPanel sources={briefing.sources} />
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
    <div className="rounded-2xl border border-primary/20 bg-primary/[0.06] p-3 sm:p-3.5">
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

function ExportMenu({ briefing, disabled }: { briefing: CoachBriefing; disabled?: boolean }) {
  const [busy, setBusy] = useState<null | "pdf" | "doc">(null);
  const run = async (kind: "pdf" | "doc") => {
    if (busy) return;
    setBusy(kind);
    try {
      const { exportBriefingPDF, exportBriefingDoc } = await import("@/lib/coach-export");
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
            className="h-full rounded-full bg-primary transition-all"
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
                  className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border/70 px-1.5 py-0.5 text-[10.5px] font-medium text-foreground/80 transition hover:border-foreground/30 hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
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
