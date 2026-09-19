"use client";

import { readBrandDnaFor } from "@/hooks/use-brand-dna";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { addAppEventListener, emitAppEvent, removeAppEventListener } from "@/lib/app-events";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  Calendar,
  CalendarClock,
  Check,
  Eye,
  FileText,
  Inbox,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Share2,
  Sparkles,
  Spinner,
  Wand2,
  X,
  Mail,
  type LucideIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { duration, ease } from "@/lib/motion";
import { updateContentItem } from "@/lib/content.functions";
import { STUDIO_FORMATS, type StudioType } from "@/lib/studio/formats";
import { isActiveJob, type StudioJob } from "@/lib/studio/jobs";
import { cancelSession, getStudioState, openJob, useStudioStore } from "@/lib/studio/session-store";
import { openItemOrJob } from "@/hooks/use-studio";
import { useVisibleInterval } from "@/hooks/use-visible-interval";
import {
  useStudioSuggestions,
  type StudioSuggestion,
  type StudioSuggestionAccent,
} from "@/hooks/use-studio-suggestions";
import { Burst, DrawCheck, PlatformStack, TypeGlyph } from "@/components/studio/studio-ui";
import { studioApi } from "@/lib/studio/client";
import { createPostFromDraft } from "@/lib/studio/convert";
import {
  CONTENT_COLUMNS,
  PIPELINE_STATUSES,
  SOURCE_LABEL,
  ago,
  groupRows,
  stageCounts,
  type ContentRow,
  type Group,
  type Stage,
} from "@/lib/studio/content-groups";

export type { Group } from "@/lib/studio/content-groups";

function when(iso: string | null): string {
  if (!iso) return "Scheduled";
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `Today · ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow · ${time}`;
  return `${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · ${time}`;
}

/** The workspace this rail belongs to (from the route; null in previews). */
function useWorkspaceId(): string | null {
  return useOptionalWorkspaceId();
}

export function StudioRail(_props: { embedded?: boolean } = {}) {
  const workspaceId = useWorkspaceId();
  const [rows, setRows] = useState<ContentRow[] | null>(null);
  const [agentActions, setAgentActions] = useState(0);
  const [publishedThisWeek, setPublishedThisWeek] = useState(0);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const ws = workspaceId;
    if (!ws) {
      setRows([]);
      return;
    }
    setRefreshing(true);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const [queue, approvals, published] = await Promise.all([
      // Everything still on its way out: not published, not discarded.
      supabase
        .from("content_items")
        .select(CONTENT_COLUMNS)
        .eq("workspace_id", ws)
        .in("status", [...PIPELINE_STATUSES])
        .order("created_at", { ascending: false })
        .limit(80),
      supabase
        .from("approvals")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", ws)
        .eq("status", "pending"),
      supabase
        .from("content_items")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", ws)
        .eq("status", "published")
        .gte("updated_at", weekAgo),
    ]);
    setRefreshing(false);
    if (queue.error) {
      setLoadError("Couldn't load your content.");
      setRows((r) => r ?? []);
      return;
    }
    setLoadError(null);
    const queueRows = (queue.data ?? []) as ContentRow[];
    setRows(queueRows);
    setAgentActions(approvals.count ?? 0);
    setPublishedThisWeek(published.count ?? 0);

    const paths = [
      ...new Set(
        queueRows
          .map((r) => r.meta?.asset_storage_path)
          .filter((p): p is string => typeof p === "string"),
      ),
    ];
    if (paths.length) {
      const { data } = await supabase.storage
        .from("generated-assets")
        .createSignedUrls(paths, 3600);
      const next: Record<string, string> = {};
      for (const s of data ?? []) if (s.path && s.signedUrl) next[s.path] = s.signedUrl;
      setThumbs(next);
    }
  }, [workspaceId]);

  useEffect(() => {
    setRows(null);
    void load();
    const on = () => void load();
    addAppEventListener("content:changed", on);
    addAppEventListener("approvals:changed", on);
    return () => {
      removeAppEventListener("content:changed", on);
      removeAppEventListener("approvals:changed", on);
    };
  }, [load]);
  useVisibleInterval(() => void load(), 60_000);

  const allJobs = useStudioStore((s) => s.jobs);
  const jobs = useMemo(
    () => (workspaceId ? allJobs.filter((j) => j.workspace_id === workspaceId) : allJobs),
    [allJobs, workspaceId],
  );
  const groups = useMemo(() => groupRows(rows ?? []), [rows]);

  return (
    <aside aria-label="Studio" className="flex h-full w-full min-w-0 flex-col">
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-3.5 pb-6 pt-4">
        <CreateButton />
        <BrandDnaCta />
        <LayoutGroup id="studio-rail">
          <PipelineSection
            groups={groups}
            loading={rows === null}
            refreshing={refreshing}
            error={loadError}
            thumbs={thumbs}
            jobs={jobs}
            agentActions={agentActions}
            publishedThisWeek={publishedThisWeek}
            onRefresh={() => void load()}
          />
        </LayoutGroup>
        <SuggestionsSection />
      </div>
    </aside>
  );
}

/* ───────────────────────── Create ───────────────────────── */

/** One entry point: the composer's start screen holds formats and ideas together. */
function CreateButton() {
  return (
    <button
      type="button"
      onClick={() => emitAppEvent("open:create-launcher")}
      aria-label="Create something new"
      className="group flex min-h-14 w-full items-center gap-3 rounded-xl border border-border bg-surface-3 px-3 text-left shadow-1 relative overflow-hidden transition-[border-color,box-shadow,translate] duration-[--motion-duration-base] hover:-translate-y-px hover:border-primary-border hover:shadow-[0_14px_34px_-18px_hsl(var(--primary)/0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55"
    >
      <span className="studio-cta relative grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground transition-transform duration-[--motion-duration-slow] ease-[--motion-ease-spring] group-hover:rotate-90 group-hover:scale-110">
        <Plus className="size-4" strokeWidth={2.5} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">Create</span>
        <span className="block truncate text-xs text-muted-foreground">
          Video, pictures, text, ads
        </span>
      </span>
      <kbd className="hidden rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground ring-1 ring-border sm:inline">
        ⌘J
      </kbd>
    </button>
  );
}

function BrandDnaCta() {
  const wsId = useWorkspaceId();
  const [filled, setFilled] = useState<number | null>(null);
  useEffect(() => {
    const read = () => {
      if (!wsId) return setFilled(0);
      const b = readBrandDnaFor(wsId) as unknown as Record<string, string | undefined>;
      setFilled(
        ["audience", "voice", "values", "doRules", "dontRules"].filter((f) =>
          String(b[f] ?? "").trim(),
        ).length,
      );
    };
    read();
    addAppEventListener("brand-dna:saved", read);
    window.addEventListener("storage", read);
    return () => {
      removeAppEventListener("brand-dna:saved", read);
      window.removeEventListener("storage", read);
    };
  }, [wsId]);
  if (filled === null || filled >= 5) return null;
  return (
    <button
      type="button"
      onClick={() => emitAppEvent("open:brand-dna", { tab: "essentials" })}
      className="flex min-h-10 w-full items-center gap-2.5 rounded-lg border border-dashed border-primary-border bg-primary-surface px-3 py-2 text-left text-xs text-foreground transition-colors hover:border-primary"
    >
      <Sparkles className="size-3.5 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        <span className="block font-medium">Complete your Brand DNA</span>
        <span className="block text-muted-foreground">Sharper ideas and on-voice drafts</span>
      </span>
      <span className="tabular-nums text-muted-foreground">{filled}/5</span>
    </button>
  );
}

/* ───────────────────────── Generating jobs ───────────────────────── */

export function JobRow({
  job,
  tracked: _tracked,
  onDismiss,
}: {
  job: StudioJob;
  tracked: boolean;
  onDismiss: () => void;
}) {
  const format = STUDIO_FORMATS[job.type];
  const active = isActiveJob(job);
  const stage = format.stages.find((s) => s.id === job.stage);
  const index = Math.max(
    0,
    format.stages.findIndex((s) => s.id === job.stage),
  );
  const [cancelling, setCancelling] = useState(false);

  const cancel = async () => {
    setCancelling(true);
    const session = getStudioState().sessions.find((s) => s.job?.id === job.id);
    try {
      if (session) await cancelSession(session.id);
      else await studioApi.cancelJob(job.workspace_id, job.id);
      emitAppEvent("content:changed");
    } catch (e) {
      toast.error("Couldn't cancel", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setCancelling(false);
    }
  };

  return (
    <motion.li
      layoutId={job.parent_job_id ? undefined : `group-${job.group_id}`}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: duration.fast } }}
      transition={{ duration: duration.medium, ease: ease.emphasized }}
      className={cn(
        `studio-tone-${job.type} relative overflow-hidden rounded-2xl bg-surface-3 shadow-1 ring-1`,
        active ? "studio-ring ring-primary-border/50" : "ring-danger-border",
      )}
    >
      {active ? <span className="studio-weave absolute inset-0 opacity-70" aria-hidden /> : null}
      <div className={cn("relative flex items-center gap-3 p-3", active && "pb-2.5")}>
        <TypeGlyph type={job.type} />
        <button
          type="button"
          onClick={() => void openJob(job.id, job.workspace_id)}
          className="min-w-0 flex-1 text-left"
        >
          <span className="block truncate text-sm font-medium text-foreground">
            {job.title || format.label}
          </span>
          <>
            <motion.span
              key={active ? job.stage : "failed"}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: duration.base }}
              className={cn(
                "flex items-center gap-1.5 truncate text-xs",
                active ? "text-muted-foreground" : "text-danger",
              )}
            >
              {active ? (
                (stage?.label ?? "Starting")
              ) : (
                <>
                  <AlertTriangle className="size-3 shrink-0" />
                  <span className="truncate">{job.error?.message ?? "Couldn't finish"}</span>
                </>
              )}
            </motion.span>
          </>
        </button>
        {active ? (
          <Button
            size="icon-sm"
            variant="ghost"
            className="size-7 rounded-full"
            onClick={() => void cancel()}
            disabled={cancelling}
            aria-label={`Cancel ${job.title ?? format.noun}`}
            title="Cancel"
          >
            <X />
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-7 rounded-full px-2.5"
              onClick={() => void openJob(job.id, job.workspace_id)}
            >
              Retry
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              className="size-7 rounded-full"
              onClick={onDismiss}
              aria-label="Dismiss"
              title="Dismiss"
            >
              <X />
            </Button>
          </>
        )}
      </div>
      {active ? (
        <div className="relative flex gap-1 px-3 pb-3" aria-hidden>
          {format.stages.map((s, i) => (
            <span
              key={s.id}
              className="relative h-1 flex-1 overflow-hidden rounded-full bg-foreground/[0.08]"
            >
              {i < index ? (
                <span className="absolute inset-0 rounded-full bg-primary" />
              ) : i === index ? (
                <motion.span
                  key={s.id}
                  className="studio-progress-fill absolute inset-y-0 left-0 rounded-full"
                  initial={{ width: "8%" }}
                  animate={{ width: "82%" }}
                  transition={{ duration: 14, ease: [0.1, 0.6, 0.3, 1] }}
                />
              ) : null}
            </span>
          ))}
        </div>
      ) : null}
    </motion.li>
  );
}

/* ───────────────────────── Content pipeline ─────────────────────────
 * The whole life of a post in one place: Creating → Review → Ready →
 * Scheduled. Approving a finished Studio post moves it to Ready; approving a
 * text-only draft creates the finished post (visual + captions), which shows
 * under Creating and lands in Ready by itself. */

type PipelineStage = "generating" | Exclude<Stage, "published">;

const PIPELINE_STEPS: { id: PipelineStage; label: string; icon: LucideIcon }[] = [
  { id: "generating", label: "Creating", icon: Sparkles },
  { id: "review", label: "Review", icon: Eye },
  { id: "ready", label: "Ready", icon: Check },
  { id: "scheduled", label: "Scheduled", icon: CalendarClock },
];

const PIPELINE_TAB_KEY = "studio:pipeline-tab";
const PIPELINE_VISIBLE = 5;
const DISMISSED_JOBS = "studio:rail-dismissed-jobs";

function rememberTab(id: PipelineStage) {
  try {
    sessionStorage.setItem(PIPELINE_TAB_KEY, id);
  } catch {
    /* ignore */
  }
}

function readDismissedJobs(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_JOBS) ?? "[]") as string[];
  } catch {
    return [];
  }
}

type Creating = { key: string; title: string; type: StudioType | "legacy" };

export function PipelineSection({
  groups,
  loading,
  refreshing = false,
  error,
  thumbs,
  jobs,
  agentActions = 0,
  publishedThisWeek = 0,
  onRefresh,
  fixture,
}: {
  groups: Group[];
  loading: boolean;
  refreshing?: boolean;
  error: string | null;
  thumbs: Record<string, string>;
  jobs: StudioJob[];
  /** Pending Operations approvals (agent actions), shown as one row. */
  agentActions?: number;
  publishedThisWeek?: number;
  onRefresh: () => void;
  /** Preview/testing: decisions and creation don't write. */
  fixture?: boolean;
}) {
  const reduce = useReducedMotion();
  // The rows shown here were loaded for this workspace; work started from them
  // is created in it, whatever page is current when the click resolves.
  const rowWorkspaceId = useWorkspaceId();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [creating, setCreating] = useState<Creating[]>([]);
  const [followJob, setFollowJob] = useState<string | null>(null);
  /** Draft key → the job making its post; keeps the draft out of Review until the list refreshes. */
  const [handedOff, setHandedOff] = useState<Record<string, string>>({});
  /** Lab only: drafts whose simulated post has finished. */
  const [simulatedReady, setSimulatedReady] = useState<string[]>([]);
  const [picked, setPicked] = useState<PipelineStage | null>(null);

  useEffect(() => {
    setDismissed(readDismissedJobs());
    try {
      const v = sessionStorage.getItem(PIPELINE_TAB_KEY);
      if (v === "generating" || v === "review" || v === "ready" || v === "scheduled") setPicked(v);
    } catch {
      /* ignore */
    }
  }, []);

  const activeJobs = jobs.filter(isActiveJob);
  const failedJobs = jobs.filter(
    (j) =>
      j.status === "failed" &&
      !j.parent_job_id &&
      !dismissed.includes(j.id) &&
      Date.now() - Date.parse(j.updated_at) < 6 * 3_600_000,
  );
  const makingCount = activeJobs.length + creating.length;
  const generatingCount = makingCount + failedJobs.length;

  // A draft being turned into a post lives under Creating until the post exists.
  const visibleGroups = useMemo(() => {
    const hidden = new Set(creating.map((c) => c.key));
    const stillMaking = (jobId: string | null | undefined) => {
      if (!jobId) return false;
      const job = jobs.find((j) => j.id === jobId);
      return !!job && job.status !== "failed" && job.status !== "cancelled";
    };
    return groups
      .filter(
        (g) =>
          !hidden.has(g.key) && !stillMaking(g.convertingJobId) && !stillMaking(handedOff[g.key]),
      )
      .map((g) =>
        simulatedReady.includes(g.key)
          ? { ...g, status: "approved", stage: "ready" as const, source: "studio" as const }
          : g,
      );
  }, [groups, creating, jobs, handedOff, simulatedReady]);

  const justFinished = useMemo(
    () =>
      new Set(
        jobs
          .filter(
            (j) =>
              j.status === "succeeded" &&
              j.completed_at &&
              Date.now() - Date.parse(j.completed_at) < 8000,
          )
          .map((j) => j.group_id),
      ),
    [jobs],
  );
  const counts = useMemo(() => stageCounts(visibleGroups), [visibleGroups]);
  const countOf = (id: PipelineStage) => (id === "generating" ? generatingCount : counts[id]);

  // Until someone picks a stage, open where there's something to do.
  const active: PipelineStage =
    picked ??
    (makingCount
      ? "generating"
      : (PIPELINE_STEPS.find((st) => st.id !== "generating" && counts[st.id] > 0)?.id ?? "review"));

  const choose = (id: PipelineStage) => {
    setPicked(id);
    rememberTab(id);
  };

  // When a post someone just approved finishes, follow it into Ready.
  useEffect(() => {
    if (!followJob) return;
    const job = jobs.find((j) => j.id === followJob);
    if (!job || isActiveJob(job)) return;
    setFollowJob(null);
    if (job.status === "succeeded") {
      setPicked("ready");
      rememberTab("ready");
      emitAppEvent("content:changed");
      toast.success("Your post is ready", { description: "It's waiting under Ready." });
    }
  }, [jobs, followJob]);

  const list = useMemo(() => {
    if (active === "generating") return [];
    const inStage = visibleGroups.filter((g) => g.stage === active);
    return active === "scheduled"
      ? inStage.sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""))
      : inStage.sort(
          (a, b) => Number(b.problem) - Number(a.problem) || b.createdAt.localeCompare(a.createdAt),
        );
  }, [visibleGroups, active]);
  const visible = list.slice(0, PIPELINE_VISIBLE);
  const openLibrary = (status?: Stage) => emitAppEvent("open:library", { tab: "posts", status });

  const dismissJob = (id: string) => {
    const next = [...dismissed, id].slice(-50);
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED_JOBS, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const approveAndCreate = async (group: Group) => {
    const entry: Creating = { key: group.key, title: group.title, type: group.type };
    setCreating((c) => [...c.filter((x) => x.key !== entry.key), entry]);
    choose("generating");
    if (fixture) {
      window.setTimeout(() => {
        setCreating((c) => c.filter((x) => x.key !== entry.key));
        setSimulatedReady((r) => [...r, entry.key]);
        choose("ready");
        toast.success("Your post is ready", { description: "It's waiting under Ready." });
      }, 4000);
      return;
    }
    const ws = rowWorkspaceId;
    try {
      if (!ws) throw new Error("Choose a workspace first.");
      const job = await createPostFromDraft(ws, group.ids[0]);
      setHandedOff((h) => ({ ...h, [entry.key]: job.id }));
      if (isActiveJob(job)) {
        setFollowJob(job.id);
        toast.success("Creating your post", {
          description: "Mellox is making the visual. It lands in Ready when it's done.",
        });
      } else if (job.status === "succeeded") {
        choose("ready");
        toast.success("Your post is ready", { description: "It's waiting under Ready." });
      }
    } catch (e) {
      toast.error("Couldn't create the post", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setCreating((c) => c.filter((x) => x.key !== entry.key));
      emitAppEvent("content:changed");
      onRefresh();
    }
  };

  const nextScheduled = counts.scheduled
    ? visibleGroups
        .filter((g) => g.stage === "scheduled" && g.scheduledAt)
        .map((g) => g.scheduledAt as string)
        .sort()[0]
    : null;
  const summary =
    active === "generating"
      ? makingCount
        ? `Creating ${makingCount} post${makingCount === 1 ? "" : "s"}. They move on by themselves.`
        : failedJobs.length
          ? `${failedJobs.length} couldn't finish. Retry or dismiss.`
          : "Nothing is being created right now."
      : active === "review"
        ? counts.review
          ? `${counts.review} waiting for your approval`
          : "Nothing waiting for you."
        : active === "ready"
          ? counts.ready
            ? `${counts.ready} approved, not posted yet`
            : "Approve a draft and it's ready to post here."
          : nextScheduled
            ? `Next one goes out ${when(nextScheduled)}`
            : "Nothing scheduled yet.";

  return (
    <section data-no-rhythm aria-labelledby="rail-pipeline" aria-busy={loading}>
      <div className="mb-3 flex items-center gap-2 px-1">
        <h3 id="rail-pipeline" className="ui-eyebrow">
          Content pipeline
        </h3>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing || loading}
          aria-label="Refresh content pipeline"
          title="Refresh"
          className="ml-auto grid size-6 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
        </button>
      </div>

      {agentActions > 0 ? (
        <button
          type="button"
          onClick={() => emitAppEvent("open:operations", { tab: "approvals" })}
          className="mb-3 flex w-full items-center gap-2 rounded-xl bg-warning-surface px-3 py-2 text-left text-xs text-foreground ring-1 ring-warning-border transition-[filter] hover:brightness-[0.97]"
        >
          <Inbox className="size-3.5 shrink-0 text-warning" />
          <span className="min-w-0 flex-1 truncate">
            {agentActions} agent action{agentActions === 1 ? " needs" : "s need"} a decision
          </span>
          <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      ) : null}

      {/* ── The pipeline: four connected stages ── */}
      <div role="tablist" aria-label="Pipeline stage" className="relative grid grid-cols-4">
        <span
          aria-hidden
          className="absolute left-[12.5%] right-[12.5%] top-[18px] h-0.5 rounded-full bg-border"
        />
        <span
          aria-hidden
          className={cn(
            "absolute left-[12.5%] right-[12.5%] top-[18px] h-0.5 rounded-full transition-opacity duration-[--motion-duration-slow]",
            makingCount ? "studio-flow opacity-100" : "opacity-0",
          )}
        />
        {PIPELINE_STEPS.map((step) => {
          const on = active === step.id;
          const count = countOf(step.id);
          const Icon = step.icon;
          const busy = step.id === "generating" && makingCount > 0;
          const attention =
            (step.id === "review" && count > 0) ||
            (step.id === "generating" && failedJobs.length > 0 && !makingCount);
          return (
            <button
              key={step.id}
              type="button"
              role="tab"
              aria-selected={on}
              aria-label={`${step.label}: ${loading ? "loading" : count}`}
              onClick={() => choose(step.id)}
              className="group relative flex flex-col items-center gap-1 rounded-xl pb-2 pt-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55"
            >
              <motion.span
                whileHover={reduce ? undefined : { y: -2 }}
                whileTap={reduce ? undefined : { scale: 0.92 }}
                className={cn(
                  "relative grid size-9 place-items-center rounded-full ring-1 transition-[background-color,box-shadow,color] duration-[--motion-duration-base]",
                  on
                    ? "bg-primary text-primary-foreground shadow-[0_8px_20px_-8px_hsl(var(--primary)/0.75)] ring-primary"
                    : count
                      ? "bg-surface-3 text-foreground ring-border-strong group-hover:ring-primary-border"
                      : "bg-surface-2 text-muted-foreground ring-border/70 group-hover:text-foreground",
                )}
              >
                {busy ? (
                  <span aria-hidden className="studio-ring absolute inset-0 rounded-full" />
                ) : null}
                {busy && !on ? (
                  <Spinner className="size-4 animate-spin text-primary" />
                ) : (
                  <Icon className="size-4" />
                )}
                {!loading && count ? (
                  <motion.span
                    key={count}
                    initial={reduce ? false : { scale: 0.3, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 520, damping: 20 }}
                    className={cn(
                      "absolute -right-1.5 -top-1 min-w-[18px] rounded-full px-1 text-center text-[10px] font-bold leading-[18px] tabular-nums ring-2 ring-surface-1",
                      attention
                        ? "bg-warning text-white"
                        : on
                          ? "bg-foreground text-background"
                          : "bg-surface-4 text-foreground",
                    )}
                  >
                    {count}
                  </motion.span>
                ) : null}
              </motion.span>
              <span
                className={cn(
                  "text-[11px] font-medium transition-colors",
                  on ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
                )}
              >
                {step.label}
              </span>
              {on ? (
                <motion.span
                  layoutId="pipeline-marker"
                  className="absolute bottom-0 h-0.5 w-7 rounded-full bg-primary"
                  transition={{ duration: duration.medium, ease: ease.emphasized }}
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <p
        key={`${active}-${summary}`}
        aria-live="polite"
        className="studio-enter-blur mb-2.5 mt-1.5 px-1 text-[11.5px] leading-snug text-muted-foreground"
      >
        {loading ? "Loading your content…" : summary}
      </p>

      {loading ? (
        <div className="space-y-2.5">
          {[0, 1].map((k) => (
            <div
              key={k}
              className="relative overflow-hidden rounded-2xl bg-surface-3 p-3 ring-1 ring-border/70"
            >
              <span className="studio-weave absolute inset-0" aria-hidden />
              <div className="flex gap-3">
                <div className="size-8 rounded-lg bg-surface-2" />
                <div className="flex-1 space-y-2 py-0.5">
                  <div className="h-2 w-2/5 rounded-full bg-surface-2" />
                  <div className="h-2.5 w-4/5 rounded-full bg-surface-2" />
                  <div className="h-2 w-3/5 rounded-full bg-surface-2" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="flex items-center justify-between gap-2 rounded-2xl bg-danger-surface px-3 py-2.5 text-xs text-foreground ring-1 ring-danger-border">
          {error}
          <Button size="sm" variant="ghost" onClick={onRefresh}>
            Retry
          </Button>
        </div>
      ) : active === "generating" ? (
        generatingCount === 0 ? (
          <EmptyStage
            icon={Sparkles}
            text="Approve a draft or create something new, and it shows here while Mellox makes it."
            action={
              <Button size="sm" onClick={() => emitAppEvent("open:create-launcher")}>
                <Wand2 />
                Create
              </Button>
            }
          />
        ) : (
          <ul key="generating" className="space-y-2.5">
            <AnimatePresence initial={false}>
              {creating.map((c) => (
                <CreatingRow key={`creating-${c.key}`} title={c.title} type={c.type} />
              ))}
              {activeJobs.map((job) => (
                <JobRow key={job.id} job={job} tracked onDismiss={() => {}} />
              ))}
              {failedJobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  tracked={false}
                  onDismiss={() => dismissJob(job.id)}
                />
              ))}
            </AnimatePresence>
          </ul>
        )
      ) : list.length === 0 ? (
        <EmptyStage
          icon={PIPELINE_STEPS.find((st) => st.id === active)?.icon ?? Check}
          text={
            active === "review"
              ? "Nothing waiting for you. New drafts land here."
              : active === "ready"
                ? "Approved posts wait here until you schedule or publish them."
                : "Schedule a ready post and it shows here with its time."
          }
          action={
            active === "review" ? (
              <Button size="sm" onClick={() => emitAppEvent("open:create-launcher")}>
                <Wand2 />
                Create something
              </Button>
            ) : active === "scheduled" && counts.ready ? (
              <Button size="sm" variant="outline" onClick={() => choose("ready")}>
                See {counts.ready} ready
              </Button>
            ) : null
          }
        />
      ) : (
        <ul key={active} className="space-y-2.5">
          <AnimatePresence initial={false}>
            {visible.map((g, i) => (
              <ApprovalCard
                key={g.key}
                group={g}
                index={i}
                thumb={g.storagePath ? thumbs[g.storagePath] : undefined}
                highlight={justFinished.has(g.key)}
                onChanged={onRefresh}
                onCreate={(group) => void approveAndCreate(group)}
                fixture={fixture}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}

      {!loading && active !== "generating" && list.length > PIPELINE_VISIBLE ? (
        <button
          type="button"
          onClick={() => openLibrary(active)}
          className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          View all {list.length} in Library
          <ArrowRight className="size-3.5" />
        </button>
      ) : null}

      {!loading ? (
        <button
          type="button"
          onClick={() => openLibrary(publishedThisWeek ? "published" : undefined)}
          className="group mt-3 flex w-full items-center gap-2 rounded-xl bg-surface-2/60 px-3 py-2 text-left text-[11px] text-muted-foreground ring-1 ring-border/50 transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary-surface text-primary ring-1 ring-primary-border">
            <Check className="size-3" strokeWidth={3} />
          </span>
          <span className="min-w-0 flex-1 truncate">
            {publishedThisWeek
              ? `${publishedThisWeek} published this week`
              : "Everything you make is saved in Library"}
          </span>
          <span className="inline-flex shrink-0 items-center gap-0.5 font-medium">
            Library
            <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
          </span>
        </button>
      ) : null}
    </section>
  );
}

function EmptyStage({
  icon: Icon,
  text,
  action,
}: {
  icon: LucideIcon;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="studio-enter-blur flex flex-col items-center rounded-2xl border border-dashed border-border bg-surface-3/50 px-4 py-6 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-surface-2 text-muted-foreground ring-1 ring-border">
        <Icon className="size-4" />
      </span>
      <p className="mt-2.5 max-w-[230px] text-xs leading-relaxed text-muted-foreground">{text}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/** A draft that was just approved, while its post is being written (before the job exists). */
function CreatingRow({ title, type }: { title: string; type: StudioType | "legacy" }) {
  const t = (type === "legacy" ? "article" : type) as StudioType;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, x: -18 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, transition: { duration: duration.fast } }}
      transition={{ duration: duration.slow, ease: ease.emphasized }}
      className={`studio-tone-${t} studio-ring relative overflow-hidden rounded-2xl bg-surface-3 shadow-1 ring-1 ring-primary-border/50`}
    >
      <span className="studio-weave absolute inset-0 opacity-70" aria-hidden />
      <div className="relative flex items-center gap-3 p-3 pb-2.5">
        <TypeGlyph type={t} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{title}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Spinner className="size-3 animate-spin" />
            Writing captions and planning the visual
          </span>
        </span>
      </div>
      <div className="relative px-3 pb-3">
        <span className="block h-1 overflow-hidden rounded-full bg-foreground/[0.08]">
          <motion.span
            className="studio-progress-fill relative block h-full rounded-full"
            initial={{ width: "6%" }}
            animate={{ width: "72%" }}
            transition={{ duration: 20, ease: [0.1, 0.6, 0.3, 1] }}
          />
        </span>
      </div>
    </motion.li>
  );
}

export function ApprovalCard({
  group,
  thumb,
  highlight,
  onChanged,
  onCreate,
  index = 0,
  fixture,
}: {
  group: Group;
  thumb?: string;
  highlight: boolean;
  onChanged: () => void;
  /** Approve a text-only draft by creating the finished post from it. */
  onCreate?: (group: Group) => void;
  /** Position in the list, for a gentle stagger on arrival. */
  index?: number;
  /** Preview/testing: decide locally without writing. */
  fixture?: boolean;
}) {
  const reduce = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const [decided, setDecided] = useState<null | "approved" | "rejected" | "draft">(null);
  const legacy = group.type === "legacy";
  const stage = group.stage;
  const label = legacy
    ? (group.legacyLabel ?? "Legacy")
    : STUDIO_FORMATS[group.type as StudioType].label;
  const media = thumb && group.mediaType ? group.mediaType : null;
  // Drafts from chat, agents or the calendar are text only: approving creates the real post.
  const needsPost = !!onCreate && !legacy && group.source !== "studio" && !media;

  const open = () => {
    if (group.jobId) return void openJob(group.jobId);
    return void openItemOrJob(group.ids[0]);
  };

  const decide = async (status: "approved" | "rejected" | "draft") => {
    setBusy(true);
    try {
      if (!fixture) {
        // A draft can't be discarded directly: the lifecycle is draft → pending → rejected.
        if (status === "rejected" && group.status === "draft") {
          await Promise.all(
            group.ids.map((id) =>
              updateContentItem({ data: { id, patch: { status: "pending" } } }),
            ),
          );
        }
        await Promise.all(
          group.ids.map((id) => updateContentItem({ data: { id, patch: { status } } })),
        );
      }
      // Let the decision register before the card moves on.
      setDecided(status);
      await new Promise((r) => window.setTimeout(r, 750));
      if (fixture) {
        window.setTimeout(() => setDecided(null), 900);
        return;
      }
      emitAppEvent("content:changed");
      toast.success(
        status === "approved" ? "Approved" : status === "draft" ? "Back in review" : "Discarded",
        {
          description: status === "approved" ? "It's under Ready. Schedule or post it." : undefined,
          action: status === "approved" ? { label: "Open", onClick: open } : undefined,
        },
      );
    } catch (e) {
      setDecided(null);
      toast.error("Couldn't update", { description: e instanceof Error ? e.message : undefined });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const iconButton =
    "grid size-7 place-items-center rounded-full text-muted-foreground transition-colors disabled:opacity-50";

  return (
    <motion.li
      layout
      layoutId={`group-${group.key}`}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={
        reduce
          ? { opacity: 0 }
          : {
              opacity: 0,
              x: 36,
              scale: 0.96,
              transition: { duration: duration.base, ease: ease.accelerate },
            }
      }
      transition={{
        delay: Math.min(index, 5) * 0.04,
        duration: duration.medium,
        ease: ease.emphasized,
      }}
      className={cn(
        `studio-tone-${legacy ? "article" : group.type} group relative overflow-hidden rounded-2xl bg-surface-3 shadow-1 ring-1 transition-[box-shadow,translate] duration-[--motion-duration-slow] ease-[--motion-ease-emphasized] hover:-translate-y-0.5 hover:shadow-[0_16px_36px_-18px_hsl(var(--tone)/0.5)]`,
        highlight
          ? "shadow-[0_0_0_4px_hsl(var(--primary)/0.14)] ring-primary"
          : group.problem
            ? "ring-danger-border"
            : "ring-border/70 hover:ring-border-strong",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-x-0 top-0 z-10 h-[3px]",
          group.problem
            ? "bg-danger"
            : "bg-gradient-to-r from-[hsl(var(--tone))] via-[hsl(var(--tone)/0.45)] to-transparent",
        )}
      />
      {media ? (
        <button
          type="button"
          onClick={open}
          tabIndex={-1}
          aria-hidden
          className="relative block aspect-[16/9] w-full overflow-hidden bg-surface-2"
        >
          {media === "image" ? (
            <img
              src={thumb}
              alt=""
              className="size-full object-cover transition-transform duration-[--motion-duration-xslow] ease-[--motion-ease-emphasized] group-hover:scale-[1.04]"
            />
          ) : (
            <video
              src={thumb}
              muted
              playsInline
              preload="metadata"
              className="size-full object-cover"
            />
          )}
          <span className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/50 to-transparent" />
          {group.platforms.length ? (
            <PlatformStack
              platforms={group.platforms}
              size={20}
              className="absolute bottom-2 left-2"
            />
          ) : null}
          {media === "video" ? (
            <span className="absolute right-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
              Video
            </span>
          ) : null}
        </button>
      ) : null}
      <button
        type="button"
        onClick={open}
        className="flex w-full items-start gap-3 px-3 pb-2 pt-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/55"
      >
        {!media ? (
          legacy ? (
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 ring-1 ring-border">
              <FileText className="size-4 text-muted-foreground" />
            </span>
          ) : (
            <TypeGlyph type={group.type as StudioType} />
          )
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="truncate">{label}</span>
            {group.source !== "studio" && group.source !== "other" ? (
              <span className="shrink-0 rounded-full bg-surface-2 px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                {SOURCE_LABEL[group.source]}
              </span>
            ) : null}
            {!media && group.platforms.length ? (
              <PlatformStack platforms={group.platforms} size={16} />
            ) : null}
            <span className="ml-auto shrink-0 tabular-nums">{ago(group.createdAt)}</span>
          </span>
          <span className="mt-1 line-clamp-2 block text-sm font-medium leading-snug text-foreground">
            {group.title}
          </span>
          {group.excerpt && group.excerpt !== group.title ? (
            <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
              {group.excerpt}
            </span>
          ) : null}
        </span>
      </button>

      {stage === "scheduled" ? (
        <div className="flex items-center gap-1 px-3 pb-3 pt-1">
          <span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-success-surface px-2 py-0.5 text-[10px] font-semibold text-success ring-1 ring-success-border">
            <CalendarClock className="size-3 shrink-0" />
            <span className="truncate">{when(group.scheduledAt)}</span>
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7 rounded-full px-2.5"
            onClick={open}
          >
            Open
          </Button>
        </div>
      ) : stage === "ready" ? (
        <div className="flex items-center gap-1 px-3 pb-3 pt-1">
          <span className="inline-flex items-center gap-0.5 rounded-full bg-success-surface px-1 py-px text-[8px] font-semibold leading-tight text-success ring-1 ring-success-border">
            <Check className="size-2.5" strokeWidth={3} />
            Not posted
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => void decide("draft")}
              disabled={busy}
              aria-label={`Move ${group.title} back to review`}
              title="Back to review"
              className={cn(iconButton, "hover:bg-surface-2 hover:text-foreground")}
            >
              <RotateCcw className="size-3.5" />
            </button>
            <Button size="sm" className="studio-cta h-7 rounded-full px-3" onClick={open}>
              <CalendarClock />
              Schedule or post
            </Button>
          </div>
        </div>
      ) : group.problem ? (
        <div className="flex items-center gap-1 px-3 pb-3 pt-1">
          <span className="inline-flex items-center gap-1 rounded-full bg-danger-surface px-2 py-0.5 text-[10px] font-semibold text-danger ring-1 ring-danger-border">
            <AlertTriangle className="size-3" />
            {group.status === "partial_failed" ? "Didn't fully publish" : "Didn't publish"}
          </span>
          <Button size="sm" className="ml-auto h-7 rounded-full px-3" onClick={open}>
            Fix and retry
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-1 px-3 pb-3 pt-1">
          {needsPost ? (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
              title="Approving creates the visual and captions for you"
            >
              <FileText className="size-3" />
              Text draft
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => void decide("rejected")}
              disabled={busy}
              aria-label={`Discard ${group.title}`}
              title="Discard"
              className={cn(iconButton, "hover:bg-danger-surface hover:text-danger")}
            >
              <X className="size-3.5" />
            </button>
            {needsPost ? null : (
              <Button size="sm" variant="ghost" className="h-7 rounded-full px-2.5" onClick={open}>
                Review
              </Button>
            )}
            <Button
              size="sm"
              className="studio-cta h-7 rounded-full px-3"
              onClick={() => (needsPost && onCreate ? onCreate(group) : void decide("approved"))}
              disabled={busy}
              aria-label={
                needsPost ? `Approve and create ${group.title}` : `Approve ${group.title}`
              }
              title={needsPost ? "Approve and create the finished post" : undefined}
            >
              {needsPost ? <Wand2 /> : <Check />}
              {needsPost ? "Approve & create" : "Approve"}
            </Button>
          </div>
        </div>
      )}

      <AnimatePresence>
        {decided ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: duration.base }}
            className="absolute inset-0 z-10 grid place-items-center bg-surface-3/90 backdrop-blur-[2px]"
            role="status"
          >
            <span className="flex flex-col items-center gap-2">
              <motion.span
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: duration.medium, ease: ease.emphasized }}
                className={cn(
                  "relative grid size-10 place-items-center rounded-full",
                  decided === "approved"
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface-2 text-muted-foreground ring-1 ring-border",
                )}
              >
                {decided === "approved" ? (
                  <>
                    <DrawCheck className="size-5" delay={0.1} />
                    <Burst />
                  </>
                ) : decided === "draft" ? (
                  <RotateCcw className="size-4" />
                ) : (
                  <X className="size-4" />
                )}
              </motion.span>
              <span className="text-sm font-medium text-foreground">
                {decided === "approved"
                  ? "Approved · moving to Ready"
                  : decided === "draft"
                    ? "Back in review"
                    : "Discarded"}
              </span>
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.li>
  );
}

/* ───────────────────────── Suggestions ─────────────────────────
 * Operational nudges (Brand DNA, audit, planning). Creative ideas live in the
 * composer, where they're specific to the chosen format. The card DOM and ARIA
 * contract is covered by tests/integration/studio-suggestions-*.spec.ts. */

const SUGGESTION_ICON = {
  Sparkles,
  Brain,
  Calendar,
  Search,
  Wand2,
  Mail,
  Share2,
  FileText,
} as const;

const SUGGESTION_TEXT_BASE =
  "block w-full min-w-0 max-w-full overflow-hidden break-words [hyphens:auto] [overflow-wrap:anywhere]";

const clampStyle = (lines: number): React.CSSProperties => ({
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: lines,
});

const _accentUnused: StudioSuggestionAccent | null = null;

function SuggestionsSection() {
  const { items, loading } = useStudioSuggestions();
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      const raw =
        typeof window !== "undefined" ? localStorage.getItem("studio:suggest-dismissed") : null;
      return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set<string>();
    }
  });
  const visible = items.filter((s: StudioSuggestion) => !dismissed.has(s.id));
  void _accentUnused;

  const dismiss = (id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem("studio:suggest-dismissed", JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  if ((loading && items.length === 0) || visible.length === 0) return null;

  return (
    <section data-no-rhythm>
      <div className="mb-1.5 flex items-center justify-between px-0.5">
        <h3 className="ui-eyebrow">
          <Sparkles className="h-2.5 w-2.5 text-primary" strokeWidth={2.5} />
          Suggestions for you
        </h3>
        <span className="ui-count-pill">{visible.length}</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        <AnimatePresence initial={false}>
          {visible.map((s, idx) => {
            const Icon = SUGGESTION_ICON[s.icon];
            return (
              <motion.li
                key={s.id}
                layout
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -8, transition: { duration: 0.18 } }}
                transition={{ delay: idx * 0.04, duration: 0.25, ease: ease.emphasized }}
              >
                <div className="group relative grid min-h-[64px] grid-cols-[1.75rem_minmax(0,1fr)_auto] items-start gap-2 overflow-hidden rounded-xl border border-border bg-surface-3 px-2.5 py-2 transition-colors hover:border-border-strong">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface-2 ring-1 ring-border">
                    <Icon className="h-3.5 w-3.5 text-foreground/75" strokeWidth={2.25} />
                  </span>
                  <button
                    onClick={s.run}
                    title={s.hint ? `${s.label} — ${s.hint}` : s.label}
                    className="flex min-w-0 max-w-full flex-col items-stretch justify-center self-stretch overflow-hidden text-left"
                  >
                    <span
                      title={s.label}
                      style={clampStyle(2)}
                      className={cn(
                        SUGGESTION_TEXT_BASE,
                        "text-[12.5px] font-medium leading-snug text-foreground",
                      )}
                    >
                      {s.label}
                    </span>
                    <span
                      title={s.hint}
                      style={clampStyle(1)}
                      className={cn(
                        SUGGESTION_TEXT_BASE,
                        "mt-0.5 text-[10.5px] leading-snug text-muted-foreground",
                      )}
                    >
                      {s.hint}
                    </span>
                  </button>
                  <div className="flex min-w-0 shrink-0 items-center gap-1 self-center">
                    <button
                      onClick={s.run}
                      aria-label={`Run suggestion: ${s.label}`}
                      className="rounded-full bg-primary-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground ring-1 ring-primary-border transition hover:border-primary"
                    >
                      Try
                    </button>
                    <button
                      onClick={() => dismiss(s.id)}
                      title="Dismiss"
                      aria-label="Dismiss suggestion"
                      className="grid h-5 w-5 place-items-center rounded-full text-muted-foreground opacity-0 transition hover:bg-surface-2 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </section>
  );
}
