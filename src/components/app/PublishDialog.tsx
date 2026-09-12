"use client";

/**
 * Pending approvals.
 *
 * This dialog was written for a website builder, not a marketing platform: it
 * was titled "Publish your app", described itself as pushing changes "to your
 * live deployment" over an "edge network", labelled the approvals queue
 * "Pending changes" behind a git-commit icon, and derived a production URL by
 * running `window.location.hostname.replace("id-preview--", "")` — string
 * surgery on a preview-host convention from another product, which produced a
 * made-up domain in every real deployment. None of that described the actual
 * job: signing off on actions Mellox's agents want to take.
 *
 * It also carried a gutted state machine (a one-member `Phase` union with no
 * setter, a permanently-true conditional, a no-op `reset` still called on
 * close) and — the real defect — approved optimistically without ever checking
 * the Supabase response, so a failed approval rendered as approved and showed
 * a success toast.
 */

import { addAppEventListener, emitAppEvent, removeAppEventListener } from "@/lib/app-events";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Slot } from "@radix-ui/react-slot";
import { AppModalShell } from "@/components/app/AppModalShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Check, CheckCircle, Clock, ListChecks, ShieldCheck } from "@/components/icons";

interface Approval {
  id: string;
  action: string;
  status: string;
  payload: unknown;
  created_at: string;
}

interface Props {
  workspaceId: string | null;
  children: React.ReactNode;
}

/** Turns `generate_post_image` into "Generate post image". */
function readableAction(action: string) {
  const words = action.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Agent action";
}

export function PublishDialog({ workspaceId, children }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<string[]>([]);

  useEffect(() => {
    const h = () => setOpen(true);
    addAppEventListener("open:publish", h);
    return () => removeAppEventListener("open:publish", h);
  }, []);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    const { data, error: cause } = await supabase
      .from("approvals")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (cause) setError(cause.message);
    else setItems((data as Approval[] | null) ?? []);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const pendingIds = useMemo(
    () => items.filter((item) => item.status === "pending").map((item) => item.id),
    [items],
  );

  /**
   * Approve, then reconcile against what the server actually did. The previous
   * version flipped the row to "approved" in local state and fired the request
   * without awaiting its error, so a rejected write left the UI claiming
   * success.
   */
  const approve = async (ids: string[]) => {
    if (!ids.length || !workspaceId) return;
    setBusyIds((prev) => [...prev, ...ids]);
    const { error: cause } = await supabase
      .from("approvals")
      .update({ status: "approved", decided_at: new Date().toISOString() })
      .in("id", ids)
      .eq("workspace_id", workspaceId);
    setBusyIds((prev) => prev.filter((id) => !ids.includes(id)));

    if (cause) {
      toast.error(
        ids.length > 1 ? "Couldn't approve those actions" : "Couldn't approve that action",
        {
          description: cause.message,
        },
      );
      // Re-read rather than guess: some of a batch may have gone through.
      await load();
      return;
    }

    setItems((prev) =>
      prev.map((item) =>
        ids.includes(item.id)
          ? { ...item, status: "approved", decided_at: new Date().toISOString() }
          : item,
      ),
    );
    toast.success(ids.length > 1 ? `${ids.length} actions approved` : "Action approved");
    emitAppEvent("approvals:changed");
  };

  const approvingAll = pendingIds.length > 0 && pendingIds.every((id) => busyIds.includes(id));

  return (
    <>
      <Slot onClick={() => setOpen(true)}>{children as React.ReactElement}</Slot>
      <AppModalShell
        open={open}
        onOpenChange={setOpen}
        size="sm"
        Icon={ListChecks}
        eyebrow="Approvals"
        title="Waiting on you"
        description="Actions Mellox wants to take on your behalf."
        srDescription="Review and approve pending agent actions"
        bodyClassName="px-5 py-4 sm:px-6"
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-border">
            <div className="flex items-center justify-between gap-3 border-b border-border px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Pending</span>
                {pendingIds.length > 0 ? (
                  <Badge variant="secondary">{pendingIds.length}</Badge>
                ) : null}
              </div>
              {pendingIds.length > 1 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void approve(pendingIds)}
                  loading={approvingAll}
                >
                  Approve all
                </Button>
              ) : null}
            </div>

            <div className="max-h-[260px] overflow-y-auto scrollbar-thin">
              {loading ? (
                <ul className="divide-y divide-border" aria-label="Loading approvals">
                  {[0, 1, 2].map((i) => (
                    <li key={i} className="flex items-center gap-3 px-3.5 py-3">
                      <div className="size-4 shrink-0 animate-pulse rounded-full bg-surface-2" />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="h-3.5 w-2/5 animate-pulse rounded bg-surface-2" />
                        <div className="h-3 w-1/4 animate-pulse rounded bg-surface-2" />
                      </div>
                      <div className="h-8 w-20 shrink-0 animate-pulse rounded-md bg-surface-2" />
                    </li>
                  ))}
                </ul>
              ) : error ? (
                <ErrorState
                  size="sm"
                  title="Couldn't load approvals"
                  detail={error}
                  onRetry={() => void load()}
                />
              ) : items.length === 0 ? (
                <EmptyState
                  size="sm"
                  icon={CheckCircle}
                  title="Nothing waiting"
                  description="When an agent wants to publish, schedule or spend, it will ask here first."
                />
              ) : (
                <ul className="divide-y divide-border">
                  {items.map((item) => {
                    const isPending = item.status === "pending";
                    const busy = busyIds.includes(item.id);
                    return (
                      <li key={item.id} className="flex items-start gap-3 px-3.5 py-3">
                        <span
                          aria-hidden
                          className={
                            isPending
                              ? "mt-1.5 size-2 shrink-0 rounded-full bg-warning"
                              : "mt-1.5 size-2 shrink-0 rounded-full bg-success"
                          }
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">
                            {readableAction(item.action)}
                          </p>
                          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Clock className="size-3" aria-hidden />
                            {new Date(item.created_at).toLocaleString()}
                          </p>
                        </div>
                        {isPending ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="shrink-0"
                            loading={busy}
                            onClick={() => void approve([item.id])}
                          >
                            Approve
                          </Button>
                        ) : (
                          <span className="inline-flex shrink-0 items-center gap-1 px-1 text-xs font-medium text-success">
                            <Check className="size-3.5" aria-hidden />
                            {item.status === "approved" ? "Approved" : item.status}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <p className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
            <span>
              Nothing here runs until you approve it. Agents can draft and analyse freely;
              publishing, scheduling and anything that spends credits waits for a decision.
            </span>
          </p>
        </div>
      </AppModalShell>
    </>
  );
}
