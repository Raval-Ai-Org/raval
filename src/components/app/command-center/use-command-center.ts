"use client";

// Data and actions for the Command Center. Reads every workspace the caller
// belongs to through the shared overview service, then the recent content and
// legacy approvals across those workspaces (RLS scopes both). Every write goes
// through the same paths a workspace uses on its own: the content lifecycle
// server functions, the distribution API, and audited logs.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useInvalidateWorkspaces, useWorkspaces } from "@/hooks/use-workspaces";
import { useServerFn } from "@/lib/use-server-fn";
import { generateContentBatch, updateContentItem } from "@/lib/content.functions";
import {
  cancelScheduled,
  publishContentItems,
  retryPublication,
  scheduleContentItems,
} from "@/lib/sdr.functions";
import { addAppEventListener, emitAppEvent, removeAppEventListener } from "@/lib/app-events";
import { logAudit, logAuditMany } from "@/lib/audit";
import {
  activityStats,
  buildAttention,
  buildFailedQueue,
  buildReadyQueue,
  buildReviewQueue,
  groupSchedule,
  transitionPath,
  undoTarget,
  type CcApprovalRow,
  type CcClient,
  type CcContentRow,
  type ClientStatus,
  type ReviewItem,
} from "@/lib/agency/command-center";

type Decision = "approved" | "rejected";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Please try again.");

export function useCommandCenter() {
  const [sessionReady, setSessionReady] = useState(false);
  const [userName, setUserName] = useState("");
  const workspacesQuery = useWorkspaces({ enabled: sessionReady });
  const invalidateWorkspaces = useInvalidateWorkspaces();
  const updateItem = useServerFn(updateContentItem);
  const generateBatch = useServerFn(generateContentBatch);

  const [rows, setRows] = useState<CcContentRow[]>([]);
  const [approvals, setApprovals] = useState<CcApprovalRow[]>([]);
  const [contentLoaded, setContentLoaded] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  // Ids decided in this session — hidden at once, before realtime catches up.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());

  const clients = useMemo<CcClient[]>(
    () =>
      (workspacesQuery.data ?? []).map((w) => ({
        id: w.id,
        name: w.name,
        websiteUrl: w.websiteUrl,
        domain: w.domain,
        logoUrl: w.logoUrl,
        industry: w.industry,
        clientStatus: w.clientStatus,
        role: w.role,
        onboarded: w.onboarded,
        pendingApprovals: w.pendingApprovals,
        draftCount: w.draftCount,
        scheduledCount: w.scheduledCount,
        publishedCount: w.publishedCount,
        failedCount: w.failedCount,
        connectedSocialAccounts: w.connectedSocialAccounts,
        geoScore: w.geoScore,
        geoScannedAt: w.geoScannedAt,
        lastActivityAt: w.lastActivityAt,
      })),
    [workspacesQuery.data],
  );
  const clientMap = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const ids = useMemo(() => clients.map((c) => c.id), [clients]);
  const idsKey = ids.join(",");

  // Session gate.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!data.session) {
        window.location.assign("/login");
        return;
      }
      const u = data.session.user;
      const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
      const full = (meta.full_name || meta.name) as string | undefined;
      setUserName((full || u.email?.split("@")[0] || "").split(" ")[0]);
      setSessionReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Minute tick so "today", countdowns and windows stay honest on an open tab.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const loadSeq = useRef(0);
  const reload = useCallback(async () => {
    const list = idsKey ? idsKey.split(",") : [];
    const seq = ++loadSeq.current;
    if (list.length === 0) {
      setRows([]);
      setApprovals([]);
      setContentLoaded(true);
      return;
    }
    const since = new Date(Date.now() - 45 * 86_400_000).toISOString();
    const [ci, apr] = await Promise.all([
      supabase
        .from("content_items")
        .select(
          "id, workspace_id, agent, kind, channel, title, body, hashtags, media_url, status, scheduled_at, created_at",
        )
        .in("workspace_id", list)
        .or(
          `created_at.gte.${since},status.in.(pending,draft,approved,scheduled,failed,partial_failed)`,
        )
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("approvals")
        .select("id, workspace_id, action, status, created_at, payload")
        .in("workspace_id", list)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    if (seq !== loadSeq.current) return;
    if (ci.error) setContentError(ci.error.message);
    else {
      setContentError(null);
      setRows((ci.data ?? []) as CcContentRow[]);
    }
    setApprovals((apr.data ?? []) as CcApprovalRow[]);
    setContentLoaded(true);
    setHidden(new Set());
  }, [idsKey]);

  useEffect(() => {
    if (!sessionReady || workspacesQuery.isLoading) return;
    void reload();
  }, [sessionReady, workspacesQuery.isLoading, reload]);

  // Realtime + in-app events: refresh on any change in these workspaces.
  useEffect(() => {
    if (!idsKey) return;
    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void reload();
        void invalidateWorkspaces();
      }, 400);
    };
    const channel = supabase
      .channel(`command-center-${idsKey.length}-${idsKey.slice(0, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "content_items" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "approvals" }, refresh)
      .subscribe();
    addAppEventListener("content:changed", refresh);
    addAppEventListener("approvals:changed", refresh);
    return () => {
      window.clearTimeout(timer);
      void supabase.removeChannel(channel);
      removeAppEventListener("content:changed", refresh);
      removeAppEventListener("approvals:changed", refresh);
    };
  }, [idsKey, reload, invalidateWorkspaces]);

  const visibleRows = useMemo(() => rows.filter((r) => !hidden.has(r.id)), [rows, hidden]);
  const review = useMemo(
    () =>
      buildReviewQueue(
        visibleRows,
        approvals.filter((a) => !hidden.has(a.id)),
        clientMap,
      ),
    [visibleRows, approvals, hidden, clientMap],
  );
  const ready = useMemo(() => buildReadyQueue(visibleRows, clientMap), [visibleRows, clientMap]);
  const failed = useMemo(() => buildFailedQueue(visibleRows, clientMap), [visibleRows, clientMap]);
  const schedule = useMemo(
    () => groupSchedule(visibleRows, clientMap, now),
    [visibleRows, clientMap, now],
  );
  const stats = useMemo(() => activityStats(rows, clientMap, now), [rows, clientMap, now]);
  const attention = useMemo(
    () => buildAttention(clients, { review, ready, failed }),
    [clients, review, ready, failed],
  );

  const setBusyIds = (list: string[], on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      list.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  const hide = (list: string[], on: boolean) =>
    setHidden((prev) => {
      const next = new Set(prev);
      list.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });

  const broadcast = () => {
    emitAppEvent("content:changed");
    emitAppEvent("approvals:changed");
  };

  /** Set a content row's status along a legal path. */
  const moveContent = async (item: Pick<ReviewItem, "id" | "status">, target: Decision) => {
    for (const status of transitionPath(item.status, target)) {
      await updateItem({ data: { id: item.id, patch: { status: status as never } } });
    }
  };

  const undo = async (items: ReviewItem[], decision: Decision) => {
    try {
      await Promise.all(
        items.map(async (it) => {
          if (it.source === "content") {
            await updateItem({
              data: { id: it.id, patch: { status: undoTarget(it.status, decision) as never } },
            });
          } else {
            const { error } = await supabase
              .from("approvals")
              .update({ status: "pending", decided_at: null })
              .eq("id", it.id);
            if (error) throw error;
          }
        }),
      );
      hide(
        items.map((i) => i.id),
        false,
      );
      broadcast();
      void logAuditMany(
        items.map((i) => i.workspaceId),
        "undo_bulk",
        null,
        { count: items.length },
      );
      toast.success(`Back in review`, { description: `${items.length} restored.` });
    } catch (e) {
      toast.error("Couldn't undo", { description: errMsg(e) });
    }
  };

  /** Approve or reject one or many. Only items the caller may decide are touched. */
  const decide = async (items: ReviewItem[], decision: Decision) => {
    const allowed = items.filter((i) => i.canDecide);
    if (allowed.length === 0) {
      toast.error("View only", { description: "You can't approve for these clients." });
      return false;
    }
    const list = allowed.map((i) => i.id);
    setBusyIds(list, true);
    hide(list, true);
    const results = await Promise.allSettled(
      allowed.map(async (it) => {
        if (it.source === "content") await moveContent(it, decision);
        else {
          const { error } = await supabase
            .from("approvals")
            .update({ status: decision, decided_at: new Date().toISOString() })
            .eq("id", it.id);
          if (error) throw error;
        }
        return it;
      }),
    );
    setBusyIds(list, false);
    const done = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const failedIds = allowed.filter((it) => !done.includes(it)).map((i) => i.id);
    if (failedIds.length) hide(failedIds, false);
    if (done.length) {
      broadcast();
      if (done.length === 1) {
        void logAudit(
          done[0].workspaceId,
          decision === "approved" ? "approve" : "reject",
          done[0].id,
        );
      } else {
        void logAuditMany(
          done.map((d) => d.workspaceId),
          decision === "approved" ? "approve_bulk" : "reject_bulk",
          null,
          { count: done.length },
        );
      }
      toast.success(
        decision === "approved"
          ? `Approved ${done.length === 1 ? "" : done.length}`.trim()
          : `Sent back ${done.length === 1 ? "" : done.length}`.trim(),
        {
          description:
            decision === "approved" ? "Now under Ready to post." : "Removed from review.",
          duration: 8000,
          action: { label: "Undo", onClick: () => void undo(done, decision) },
        },
      );
    }
    if (failedIds.length) {
      const first = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      toast.error(`${failedIds.length} couldn't be saved`, { description: errMsg(first.reason) });
    }
    return done.length > 0;
  };

  /** Post now. Publishing an unapproved item is the user's explicit consent (distribution handles the lifecycle). */
  const publishNow = async (item: ReviewItem) => {
    if (!item.canDecide) return;
    setBusyIds([item.id], true);
    try {
      const res = await publishContentItems(item.workspaceId, [item.id], { type: "all" });
      const outcome = res.results[0];
      if (!outcome || (outcome.status !== "publishing" && outcome.status !== "already")) {
        throw new Error(outcome?.reason ?? "No connected account for this channel.");
      }
      hide([item.id], true);
      void logAudit(item.workspaceId, "publish", item.id);
      broadcast();
      toast.success("Posting now", { description: `${item.clientName} · ${item.title}` });
    } catch (e) {
      toast.error("Couldn't post", { description: errMsg(e) });
    } finally {
      setBusyIds([item.id], false);
    }
  };

  const scheduleAt = async (item: ReviewItem, when: Date) => {
    if (!item.canDecide) return false;
    setBusyIds([item.id], true);
    try {
      const res = await scheduleContentItems(
        item.workspaceId,
        [{ contentItemId: item.id, scheduledAt: when.toISOString() }],
        { type: "all" },
      );
      const outcome = res.results[0];
      if (!outcome || (outcome.status !== "publishing" && outcome.status !== "already")) {
        throw new Error(outcome?.reason ?? "No connected account for this channel.");
      }
      hide([item.id], true);
      void logAudit(item.workspaceId, "schedule", item.id);
      broadcast();
      toast.success("Scheduled", {
        description: when.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }),
      });
      return true;
    } catch (e) {
      toast.error("Couldn't schedule", { description: errMsg(e) });
      return false;
    } finally {
      setBusyIds([item.id], false);
    }
  };

  const unschedule = async (item: ReviewItem) => {
    if (!item.canDecide) return;
    setBusyIds([item.id], true);
    try {
      await cancelScheduled(item.workspaceId, item.id);
      broadcast();
      toast.success("Schedule cancelled", { description: "It's back under Ready to post." });
    } catch (e) {
      toast.error("Couldn't cancel", { description: errMsg(e) });
    } finally {
      setBusyIds([item.id], false);
    }
  };

  const retry = async (item: ReviewItem) => {
    if (!item.canDecide) return;
    setBusyIds([item.id], true);
    try {
      await retryPublication(item.workspaceId, item.id);
      hide([item.id], true);
      broadcast();
      toast.success("Retrying", { description: item.title });
    } catch (e) {
      toast.error("Couldn't retry", { description: errMsg(e) });
    } finally {
      setBusyIds([item.id], false);
    }
  };

  const [drafting, setDrafting] = useState<Set<string>>(new Set());
  /** Draft a week of posts for the chosen clients. Paid: only on an explicit click. */
  const draftWeek = async (clientIds: string[]) => {
    const targets = clients.filter((c) => clientIds.includes(c.id) && c.role !== "viewer");
    if (targets.length === 0) return;
    setDrafting(new Set(targets.map((t) => t.id)));
    let created = 0;
    const failures: string[] = [];
    await Promise.all(
      targets.map(async (c) => {
        try {
          const items = await generateBatch({
            data: {
              workspaceId: c.id,
              agent: "spark",
              prompt: `Draft this week's posts for ${c.name}: 1 Instagram post, 1 LinkedIn post, 1 image post with a one-line visual idea (kind:"image", channel:"instagram"), and 1 short blog article (kind:"blog", channel:"blog"). Specific to this brand, no placeholder copy.`,
              channels: ["instagram", "linkedin", "instagram", "blog"],
              count: 4,
              websiteUrl: c.websiteUrl ?? undefined,
            },
          });
          const n = Array.isArray(items) ? items.length : 0;
          created += n;
          void logAudit(c.id, "draft_week", null, { count: n });
        } catch (e) {
          failures.push(`${c.name}: ${errMsg(e)}`);
        } finally {
          setDrafting((prev) => {
            const next = new Set(prev);
            next.delete(c.id);
            return next;
          });
        }
      }),
    );
    broadcast();
    if (created) toast.success(`${created} new drafts`, { description: "They're in Review." });
    if (failures.length)
      toast.error(`${failures.length} couldn't draft`, { description: failures[0] });
  };

  const setClientStatus = async (id: string, status: ClientStatus) => {
    const { data, error } = await supabase
      .from("workspaces")
      .update({ client_status: status })
      .eq("id", id)
      .select("id");
    if (error || !data?.length) {
      toast.error("Couldn't change status", { description: error?.message });
      return;
    }
    void invalidateWorkspaces();
    toast.success(status === "paused" ? "Paused" : status === "active" ? "Active" : "Onboarding");
  };

  return {
    userName,
    loading: !sessionReady || workspacesQuery.isLoading || !contentLoaded,
    workspacesError: workspacesQuery.error ? errMsg(workspacesQuery.error) : null,
    contentError,
    retryLoad: () => {
      void workspacesQuery.refetch();
      void reload();
    },
    now,
    clients,
    clientMap,
    review,
    ready,
    failed,
    schedule,
    stats,
    attention,
    busy,
    drafting,
    decide,
    publishNow,
    scheduleAt,
    unschedule,
    retry,
    draftWeek,
    setClientStatus,
  };
}

export type CommandCenter = ReturnType<typeof useCommandCenter>;
