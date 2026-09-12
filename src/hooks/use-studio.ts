"use client";

// Entry points into Studio: the `open:canvas` app event (chat tool calls,
// command bar, rail, suggestions), ⌘J, and `?studio=<type>&job=<id>` deep
// links. Everything funnels into the session store.
import { useEffect } from "react";
import { addAppEventListener, removeAppEventListener } from "@/lib/app-events";
import { isStudioType, normalizeStudioType, type StudioType } from "@/lib/studio/formats";
import { openComposer, openJob, refreshWorkspaceJobs } from "@/lib/studio/session-store";
import type { GoalId } from "@/lib/studio/jobs";
import type { PlatformId } from "@/lib/social-platforms";

const STORAGE_LAST = "studio:last-type";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GOALS: GoalId[] = ["awareness", "engagement", "leads", "launch", "education", "offer"];
const PLATFORM_IDS: PlatformId[] = [
  "linkedin",
  "twitter",
  "instagram",
  "facebook",
  "threads",
  "tiktok",
  "youtube",
];

function lastType(): StudioType {
  try {
    const v = localStorage.getItem(STORAGE_LAST);
    return isStudioType(v) ? v : "social";
  } catch {
    return "social";
  }
}

export function rememberStudioType(type: StudioType) {
  try {
    localStorage.setItem(STORAGE_LAST, type);
  } catch {
    /* ignore */
  }
}

/** Mount once (AppShell). */
export function useStudioEntry(workspaceId: string | null) {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const onOpen: Parameters<typeof addAppEventListener<"open:canvas">>[1] = (event) => {
      const raw = event.detail;
      const detail = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
      const id = typeof detail.id === "string" && UUID_RE.test(detail.id) ? detail.id : null;
      if (id && (detail.mode === "review" || detail.mode === "view")) {
        // Legacy callers pass a content item id; jobs are opened by job id.
        void openItemOrJob(id);
        return;
      }
      // A known format opens its brief; anything else opens the start screen.
      const type = normalizeStudioType(detail.type) ?? undefined;
      if (type) rememberStudioType(type);
      openComposer({
        type: type ?? (typeof detail.brief === "string" && detail.brief ? lastType() : undefined),
        brief: typeof detail.brief === "string" ? detail.brief.slice(0, 4000) : undefined,
        goal: GOALS.includes(detail.goal as GoalId) ? (detail.goal as GoalId) : undefined,
        ideaId: typeof detail.ideaId === "string" ? detail.ideaId : undefined,
        ideaSource: typeof detail.ideaSource === "string" ? detail.ideaSource : undefined,
        platforms: Array.isArray(detail.platforms)
          ? (detail.platforms.filter((p) => PLATFORM_IDS.includes(p as PlatformId)) as PlatformId[])
          : undefined,
      });
    };

    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "j" || e.key === "J")) {
        e.preventDefault();
        openComposer();
      }
    };

    addAppEventListener("open:canvas", onOpen);
    window.addEventListener("keydown", onKey);

    // Deep links: ?studio=<type> opens a composer; &job=<id> opens review.
    try {
      const url = new URL(window.location.href);
      const job = url.searchParams.get("job");
      const type = normalizeStudioType(
        url.searchParams.get("studio") ?? url.searchParams.get("canvas"),
      );
      const artifact = url.searchParams.get("artifact");
      if (job && UUID_RE.test(job)) void openJob(job);
      else if (artifact && UUID_RE.test(artifact)) void openItemOrJob(artifact);
      else if (type) openComposer({ type });
      if (job || type || artifact) {
        ["studio", "canvas", "job", "artifact"].forEach((k) => url.searchParams.delete(k));
        const q = url.searchParams.toString();
        window.history.replaceState({}, "", url.pathname + (q ? `?${q}` : ""));
      }
    } catch {
      /* noop */
    }

    return () => {
      removeAppEventListener("open:canvas", onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (workspaceId) void refreshWorkspaceJobs(workspaceId);
  }, [workspaceId]);
}

/**
 * Open whatever an id refers to: a Studio job, or a content item (whose
 * Studio job, if any, is found through meta.job_id). Non-Studio and legacy
 * items open in the item review dialog.
 */
export async function openItemOrJob(id: string) {
  const { supabase } = await import("@/integrations/supabase/client");
  const { emitAppEvent } = await import("@/lib/app-events");
  const { data: item } = await supabase
    .from("content_items")
    .select("id, meta")
    .eq("id", id)
    .maybeSingle();
  const meta = (item?.meta ?? null) as Record<string, unknown> | null;
  const jobId = typeof meta?.job_id === "string" ? meta.job_id : null;
  if (item && jobId) {
    const opened = await openJob(jobId);
    if (opened) return;
  }
  if (item) {
    emitAppEvent("open:content-item", { id });
    return;
  }
  // Not a content item — maybe a job id.
  await openJob(id);
}
