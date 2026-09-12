"use client";

import { addAppEventListener, emitAppEvent, removeAppEventListener } from "@/lib/app-events";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { toast } from "sonner";
import {
  AlertTriangle,
  Brain,
  Calendar,
  Check,
  FileText,
  Plus,
  Search,
  Share2,
  Sparkles,
  Wand2,
  X,
  Mail,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { supabase } from "@/integrations/supabase/client";
import { getActiveWorkspaceId } from "@/lib/authed-fetch";
import { cn } from "@/lib/utils";
import { duration, ease } from "@/lib/motion";
import { updateContentItem } from "@/lib/content.functions";
import { PLATFORMS, type PlatformId } from "@/lib/social-platforms";
import {
  STUDIO_FORMATS,
  LEGACY_KINDS,
  studioTypeFromContent,
  type StudioType,
} from "@/lib/studio/formats";
import { isActiveJob, type StudioJob } from "@/lib/studio/jobs";
import {
  cancelSession,
  getStudioState,
  openComposer,
  openJob,
  useStudioStore,
} from "@/lib/studio/session-store";
import { openItemOrJob } from "@/hooks/use-studio";
import { useVisibleInterval } from "@/hooks/use-visible-interval";
import {
  useStudioSuggestions,
  type StudioSuggestion,
  type StudioSuggestionAccent,
} from "@/hooks/use-studio-suggestions";
import { TypeGlyph } from "@/components/studio/studio-ui";
import { studioApi } from "@/lib/studio/client";

type ContentRow = {
  id: string;
  title: string | null;
  body: string | null;
  kind: string;
  channel: string | null;
  status: string;
  meta: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  scheduled_at: string | null;
};

type Group = {
  key: string;
  ids: string[];
  type: StudioType | "legacy";
  legacyLabel?: string;
  title: string;
  excerpt: string;
  platforms: PlatformId[];
  storagePath: string | null;
  mediaType: "image" | "video" | null;
  createdAt: string;
  jobId: string | null;
};

function cleanText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function ago(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

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

function groupRows(rows: ContentRow[]): Group[] {
  const map = new Map<string, Group>();
  for (const r of rows) {
    const meta = r.meta ?? {};
    const state = meta.studio_state;
    if (state === "generating" || state === "failed") continue;
    const key = typeof meta.group_id === "string" ? meta.group_id : r.id;
    const platform =
      typeof meta.platform === "string" && meta.platform in PLATFORMS
        ? (meta.platform as PlatformId)
        : null;
    const existing = map.get(key);
    if (existing) {
      existing.ids.push(r.id);
      if (platform && !existing.platforms.includes(platform)) existing.platforms.push(platform);
      continue;
    }
    const type = studioTypeFromContent(r.kind, meta);
    map.set(key, {
      key,
      ids: [r.id],
      type,
      legacyLabel: type === "legacy" ? LEGACY_KINDS[r.kind] : undefined,
      title: cleanText(r.title) || cleanText(r.body).slice(0, 80) || "Untitled",
      excerpt: cleanText(r.body).slice(0, 140),
      platforms: platform ? [platform] : [],
      storagePath: typeof meta.asset_storage_path === "string" ? meta.asset_storage_path : null,
      mediaType: meta.media_type === "video" ? "video" : meta.asset_storage_path ? "image" : null,
      createdAt: r.created_at,
      jobId: typeof meta.job_id === "string" ? meta.job_id : null,
    });
  }
  return [...map.values()];
}

/** Workspace id that follows the switcher. */
function useWorkspaceId(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setId(getActiveWorkspaceId());
    sync();
    addAppEventListener("workspace:changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      removeAppEventListener("workspace:changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return id;
}

export function StudioRail(_props: { embedded?: boolean } = {}) {
  const workspaceId = useWorkspaceId();
  const [pending, setPending] = useState<ContentRow[] | null>(null);
  const [legacyApprovals, setLegacyApprovals] = useState<Group[]>([]);
  const [scheduled, setScheduled] = useState<ContentRow[]>([]);
  const [recent, setRecent] = useState<ContentRow[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const ws = workspaceId;
    if (!ws) {
      setPending([]);
      return;
    }
    const cols =
      "id, title, body, kind, channel, status, meta, created_at, updated_at, scheduled_at";
    const [queue, legacy, sched, rec] = await Promise.all([
      supabase
        .from("content_items")
        .select(cols)
        .eq("workspace_id", ws)
        .in("status", ["pending", "draft"])
        .order("created_at", { ascending: false })
        .limit(40),
      supabase
        .from("approvals")
        .select("id, action, payload, created_at")
        .eq("workspace_id", ws)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("content_items")
        .select(cols)
        .eq("workspace_id", ws)
        .eq("status", "scheduled")
        .order("scheduled_at", { ascending: true, nullsFirst: false })
        .limit(6),
      supabase
        .from("content_items")
        .select(cols)
        .eq("workspace_id", ws)
        .in("status", ["approved", "published", "publishing"])
        .order("updated_at", { ascending: false })
        .limit(6),
    ]);
    if (queue.error) {
      setLoadError("Couldn't load your queue.");
      setPending((p) => p ?? []);
      return;
    }
    setLoadError(null);
    const queueRows = (queue.data ?? []) as ContentRow[];
    setPending(queueRows);
    setLegacyApprovals(
      (
        (legacy.data ?? []) as Array<{
          id: string;
          action: string | null;
          payload: Record<string, unknown> | null;
          created_at: string;
        }>
      ).map((a) => ({
        key: `approval-${a.id}`,
        ids: [a.id],
        type: "legacy" as const,
        legacyLabel: "Approval",
        title: cleanText(a.action) || "Pending approval",
        excerpt: typeof a.payload?.body === "string" ? cleanText(a.payload.body).slice(0, 140) : "",
        platforms: [],
        storagePath: null,
        mediaType: null,
        createdAt: a.created_at,
        jobId: null,
      })),
    );
    setScheduled((sched.data ?? []) as ContentRow[]);
    setRecent((rec.data ?? []) as ContentRow[]);

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
    setPending(null);
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

  const jobs = useStudioStore((s) => s.jobs);
  const sessions = useStudioStore((s) => s.sessions);
  const groups = useMemo(
    () => [...groupRows(pending ?? []), ...legacyApprovals],
    [pending, legacyApprovals],
  );

  return (
    <aside aria-label="Studio" className="flex h-full w-full min-w-0 flex-col">
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-3.5 pb-6 pt-4">
        <CreateButton />
        <BrandDnaCta />
        <LayoutGroup id="studio-rail">
          <InProgressSection
            jobs={jobs}
            sessionsJobIds={
              new Set(sessions.flatMap((s) => [s.job?.id]).filter(Boolean) as string[])
            }
          />
          <ApprovalSection
            groups={groups}
            loading={pending === null}
            error={loadError}
            thumbs={thumbs}
            jobs={jobs}
            onChanged={() => void load()}
          />
        </LayoutGroup>
        <SuggestionsSection />
        <CompactList
          title="Scheduled"
          rows={scheduled}
          empty="Nothing scheduled yet."
          meta={(r) => when(r.scheduled_at)}
        />
        <CompactList
          title="Recent"
          rows={recent}
          empty="Approved and published work shows here."
          meta={(r) => ago(r.updated_at)}
        />
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
      onClick={() => openComposer()}
      aria-label="Create something new"
      className="group flex min-h-14 w-full items-center gap-3 rounded-xl border border-border bg-surface-3 px-3 text-left shadow-1 transition-colors duration-[--motion-duration-fast] hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground transition-transform duration-[--motion-duration-fast] group-hover:scale-105">
        <Plus className="size-4" strokeWidth={2.5} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">Create</span>
        <span className="block truncate text-xs text-muted-foreground">
          Posts, visuals, video, articles
        </span>
      </span>
      <kbd className="hidden rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground ring-1 ring-border sm:inline">
        ⌘J
      </kbd>
    </button>
  );
}

function BrandDnaCta() {
  const [filled, setFilled] = useState<number | null>(null);
  useEffect(() => {
    const read = () => {
      try {
        const wsId = getActiveWorkspaceId() ?? "";
        for (const k of wsId
          ? [`brand-dna:v3:${wsId}`, `brand-dna:v2:${wsId}`, `brand-dna:${wsId}`]
          : []) {
          const raw = localStorage.getItem(k);
          if (!raw) continue;
          const b = JSON.parse(raw) as Record<string, string | undefined>;
          setFilled(
            ["audience", "voice", "values", "doRules", "dontRules"].filter((f) =>
              (b[f] ?? "").trim(),
            ).length,
          );
          return;
        }
        setFilled(0);
      } catch {
        setFilled(0);
      }
    };
    read();
    addAppEventListener("brand-dna:saved", read);
    window.addEventListener("storage", read);
    return () => {
      removeAppEventListener("brand-dna:saved", read);
      window.removeEventListener("storage", read);
    };
  }, []);
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

/* ───────────────────────── In progress ───────────────────────── */

const DISMISSED_JOBS = "studio:rail-dismissed-jobs";

function readDismissedJobs(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_JOBS) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function InProgressSection({
  jobs,
  sessionsJobIds,
}: {
  jobs: StudioJob[];
  sessionsJobIds: Set<string>;
}) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => setDismissed(readDismissedJobs()), []);
  const visible = jobs.filter(
    (j) =>
      isActiveJob(j) ||
      (j.status === "failed" &&
        !j.parent_job_id &&
        !dismissed.includes(j.id) &&
        Date.now() - Date.parse(j.updated_at) < 6 * 3_600_000),
  );
  if (!visible.length) return null;

  const dismiss = (id: string) => {
    const next = [...dismissed, id].slice(-50);
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED_JOBS, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  return (
    <section data-no-rhythm aria-labelledby="rail-progress">
      <div className="mb-2 flex items-center gap-2 px-1">
        <h3 id="rail-progress" className="ui-eyebrow">
          In progress
        </h3>
        <span className="ui-count-pill">
          {visible.filter(isActiveJob).length || visible.length}
        </span>
      </div>
      <ul className="space-y-1.5">
        <AnimatePresence initial={false}>
          {visible.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              tracked={sessionsJobIds.has(job.id)}
              onDismiss={() => dismiss(job.id)}
            />
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );
}

function JobRow({
  job,
  tracked,
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
        "relative overflow-hidden rounded-xl border bg-surface-3",
        active ? "border-primary-border" : "border-danger-border",
      )}
    >
      {active ? <span className="studio-weave absolute inset-0" aria-hidden /> : null}
      <div className="relative flex items-center gap-2.5 p-2.5">
        <TypeGlyph type={job.type} size="sm" />
        <button
          type="button"
          onClick={() => void openJob(job.id, job.workspace_id)}
          className="min-w-0 flex-1 text-left"
        >
          <span className="block truncate text-sm font-medium text-foreground">
            {job.title || format.label}
          </span>
          <span
            className={cn(
              "flex items-center gap-1.5 truncate text-xs",
              active ? "text-muted-foreground" : "text-danger",
            )}
          >
            {active ? (
              <>
                <span className="tabular-nums">
                  {index + 1}/{format.stages.length}
                </span>
                · {stage?.label ?? "Starting"}
              </>
            ) : (
              <>
                <AlertTriangle className="size-3" /> {job.error?.message ?? "Couldn't finish"}
              </>
            )}
          </span>
        </button>
        {active ? (
          <Button
            size="icon-sm"
            variant="ghost"
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
              variant="ghost"
              onClick={() => void openJob(job.id, job.workspace_id)}
            >
              Retry
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={onDismiss}
              aria-label="Dismiss"
              title="Dismiss"
            >
              <X />
            </Button>
          </>
        )}
      </div>
      {active && !tracked ? null : null}
    </motion.li>
  );
}

/* ───────────────────────── Needs approval ───────────────────────── */

function ApprovalSection({
  groups,
  loading,
  error,
  thumbs,
  jobs,
  onChanged,
}: {
  groups: Group[];
  loading: boolean;
  error: string | null;
  thumbs: Record<string, string>;
  jobs: StudioJob[];
  onChanged: () => void;
}) {
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

  return (
    <section data-no-rhythm aria-labelledby="rail-approval" aria-busy={loading}>
      <div className="mb-2 flex items-center gap-2 px-1">
        <h3 id="rail-approval" className="ui-eyebrow">
          Needs approval
        </h3>
        {groups.length ? (
          <span className="ui-count-pill !bg-warning-surface !text-warning ring-1 ring-warning-border">
            {groups.length}
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="space-y-1.5">
          {[0, 1].map((k) => (
            <div
              key={k}
              className="flex gap-2.5 rounded-xl border border-border bg-surface-3 p-2.5"
            >
              <div className="size-14 animate-pulse rounded-lg bg-surface-2" />
              <div className="flex-1 space-y-2 py-1">
                <div className="h-2.5 w-2/5 animate-pulse rounded bg-surface-2" />
                <div className="h-3 w-4/5 animate-pulse rounded bg-surface-2" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-danger-border bg-danger-surface px-3 py-2.5 text-xs text-foreground">
          {error}
          <Button size="sm" variant="ghost" onClick={onChanged}>
            Retry
          </Button>
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border">
          <EmptyState
            size="sm"
            icon={Check}
            title="You're all caught up"
            description="Anything you create in Studio waits here for your approval before it goes anywhere."
            action={
              <Button size="sm" onClick={() => openComposer({ type: "social" })}>
                <Wand2 />
                Create a post
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="space-y-1.5">
          <AnimatePresence initial={false}>
            {groups.map((g) => (
              <ApprovalCard
                key={g.key}
                group={g}
                thumb={g.storagePath ? thumbs[g.storagePath] : undefined}
                highlight={justFinished.has(g.key)}
                onChanged={onChanged}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}

function ApprovalCard({
  group,
  thumb,
  highlight,
  onChanged,
}: {
  group: Group;
  thumb?: string;
  highlight: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const legacy = group.type === "legacy";
  const isApprovalRow = group.key.startsWith("approval-");
  const label = legacy
    ? (group.legacyLabel ?? "Legacy")
    : STUDIO_FORMATS[group.type as StudioType].label;

  const open = () => {
    if (isApprovalRow) return emitAppEvent("open:operations", { tab: "approvals" });
    if (group.jobId) return void openJob(group.jobId);
    return void openItemOrJob(group.ids[0]);
  };

  const decide = async (status: "approved" | "rejected") => {
    setBusy(true);
    try {
      await Promise.all(
        group.ids.map((id) => updateContentItem({ data: { id, patch: { status } } })),
      );
      emitAppEvent("content:changed");
      toast.success(status === "approved" ? "Approved" : "Discarded", {
        description: status === "approved" ? "Open it to schedule or publish." : undefined,
        action: status === "approved" ? { label: "Open", onClick: open } : undefined,
      });
    } catch (e) {
      toast.error("Couldn't update", { description: e instanceof Error ? e.message : undefined });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.li
      layout
      layoutId={`group-${group.key}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -8, transition: { duration: duration.fast } }}
      transition={{ duration: duration.medium, ease: ease.emphasized }}
      className={cn(
        "group overflow-hidden rounded-xl border bg-surface-3 transition-[border-color,box-shadow] duration-[--motion-duration-slow]",
        highlight
          ? "border-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.18)]"
          : "border-border hover:border-border-strong",
      )}
    >
      <button
        type="button"
        onClick={open}
        className="flex w-full items-start gap-2.5 p-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/55"
      >
        <span className="relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-2 ring-1 ring-border">
          {thumb && group.mediaType === "image" ? (
            <img src={thumb} alt="" className="size-full object-cover" />
          ) : thumb && group.mediaType === "video" ? (
            <video
              src={thumb}
              muted
              playsInline
              preload="metadata"
              className="size-full object-cover"
            />
          ) : legacy ? (
            <FileText className="size-5 text-muted-foreground" />
          ) : (
            <TypeGlyph type={group.type as StudioType} className="bg-transparent ring-0" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">{label}</span>
            {group.platforms.slice(0, 4).map((p) => {
              const Icon = PLATFORMS[p].icon;
              return <Icon key={p} className="size-3 shrink-0" aria-label={PLATFORMS[p].label} />;
            })}
            <span className="ml-auto shrink-0">{ago(group.createdAt)}</span>
          </span>
          <span className="mt-0.5 line-clamp-2 block text-sm font-medium leading-snug text-foreground">
            {group.title}
          </span>
          {group.excerpt && group.excerpt !== group.title ? (
            <span className="mt-0.5 line-clamp-1 block text-xs text-muted-foreground">
              {group.excerpt}
            </span>
          ) : null}
        </span>
      </button>
      {!isApprovalRow ? (
        <div className="flex items-center gap-1 border-t border-border px-2 py-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-muted-foreground"
            onClick={() => void decide("rejected")}
            disabled={busy}
            aria-label={`Discard ${group.title}`}
          >
            Discard
          </Button>
          <div className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={open}>
              Review
            </Button>
            <Button
              size="sm"
              className="h-7 px-2.5"
              onClick={() => void decide("approved")}
              disabled={busy}
              aria-label={`Approve ${group.title}`}
            >
              <Check />
              Approve
            </Button>
          </div>
        </div>
      ) : null}
    </motion.li>
  );
}

/* ───────────────────────── Scheduled / recent ───────────────────────── */

function CompactList({
  title,
  rows,
  empty,
  meta,
}: {
  title: string;
  rows: ContentRow[];
  empty: string;
  meta: (r: ContentRow) => string;
}) {
  return (
    <section data-no-rhythm>
      <div className="mb-1.5 flex items-center gap-2 px-1">
        <h3 className="ui-eyebrow">{title}</h3>
        {rows.length ? <span className="ui-count-pill">{rows.length}</span> : null}
      </div>
      {rows.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((r) => {
            const type = studioTypeFromContent(r.kind, r.meta);
            const platform =
              typeof r.meta?.platform === "string" && r.meta.platform in PLATFORMS
                ? PLATFORMS[r.meta.platform as PlatformId]
                : null;
            const Icon = platform?.icon;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => void openItemOrJob(r.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-sm text-foreground/85 transition-colors hover:bg-surface-2 hover:text-foreground"
                >
                  {type === "legacy" ? (
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : Icon ? (
                    <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <TypeGlyph type={type} size="sm" className="size-5 bg-transparent ring-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {cleanText(r.title) || cleanText(r.body).slice(0, 60) || "Untitled"}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{meta(r)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
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
