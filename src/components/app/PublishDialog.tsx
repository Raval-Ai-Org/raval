"use client";

/**
 * Publish (Share → Publish): everything that is approved and on its way out —
 * posts ready for a time, posts on the calendar, articles and website changes
 * waiting on a pull request, and anything that didn't go out.
 *
 * It is a list of rows that already exist (src/lib/publish/queue.ts). Nothing
 * is approved, scheduled, merged or sent from here: each row opens the place
 * that owns it, so the rules of that place still apply.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Slot } from "@radix-ui/react-slot";
import {
  addAppEventListener,
  emitAppEvent,
  onAppEvent,
  removeAppEventListener,
} from "@/lib/app-events";
import { AppModalShell } from "@/components/app/AppModalShell";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { dsGhostBtn } from "@/components/app/surface/buttons";
import { getPublishQueue } from "@/lib/publish.functions";
import {
  publishQueueCount,
  type PublishEntry,
  type PublishGroup,
  type PublishQueue,
} from "@/lib/publish/queue";
import { workspacePath } from "@/lib/workspace/paths";
import { cn } from "@/lib/utils";
import { CheckCircle, ExternalLink, Rocket } from "@/components/icons";

interface Props {
  workspaceId: string | null;
  children: React.ReactNode;
}

const GROUPS: Array<{ id: PublishGroup; label: string; dot: string }> = [
  { id: "problems", label: "Needs a look", dot: "bg-destructive" },
  { id: "ready", label: "Ready to publish", dot: "bg-primary" },
  { id: "scheduled", label: "Scheduled", dot: "bg-info" },
  { id: "website", label: "Website", dot: "bg-warning" },
];

function when(group: PublishGroup, at: string | null): string | null {
  if (!at) return null;
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  if (group !== "scheduled") {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  const today = new Date();
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === today.toDateString()) return `Today ${time}`;
  return `${date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} ${time}`;
}

export function PublishDialog({ workspaceId, children }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [queue, setQueue] = useState<PublishQueue | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const h = () => setOpen(true);
    addAppEventListener("open:publish", h);
    return () => removeAppEventListener("open:publish", h);
  }, []);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    try {
      setQueue(await getPublishQueue({ data: { workspaceId } }));
      setError(false);
    } catch {
      setError(true);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!open) return;
    setQueue(null);
    setError(false);
    void load();
    // A post approved or scheduled elsewhere shows up without reopening.
    return onAppEvent("content:changed", () => void load());
  }, [open, load]);

  const openEntry = (entry: PublishEntry) => {
    setOpen(false);
    if (entry.contentItemId) emitAppEvent("open:content-item", { id: entry.contentItemId });
    else if (entry.place === "visibility") emitAppEvent("open:ai-visibility");
    else if (entry.place === "experiments" && workspaceId) {
      router.push(workspacePath(workspaceId, "experiments"));
    }
  };

  const total = queue ? publishQueueCount(queue) : 0;

  return (
    <>
      <Slot onClick={() => setOpen(true)}>{children as React.ReactElement}</Slot>
      <AppModalShell
        open={open}
        onOpenChange={setOpen}
        size="md"
        Icon={Rocket}
        title="Publish"
        description="Approved work on its way out"
        srDescription="Approved posts, scheduled posts and website changes waiting to go live"
        bodyClassName="px-5 py-5 sm:px-6"
      >
        {error ? (
          <ErrorState
            size="sm"
            title="Couldn't load this list"
            detail="Check your connection and try again."
            onRetry={() => void load()}
          />
        ) : !queue ? (
          <div className="space-y-2" aria-label="Loading">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[58px] w-full rounded-[var(--ds-radius-well)]" />
            ))}
          </div>
        ) : total === 0 ? (
          <EmptyState
            icon={CheckCircle}
            title="Nothing waiting to go out"
            description="Approve a post and it shows up here, ready for a time."
            action={
              <Button
                onClick={() => {
                  setOpen(false);
                  emitAppEvent("open:library", { tab: "posts", status: "review" });
                }}
              >
                Review drafts
              </Button>
            }
          />
        ) : (
          <div className="space-y-6">
            {GROUPS.map((group) => {
              const entries = queue[group.id];
              if (!entries.length) return null;
              return (
                <div key={group.id}>
                  <div className="ds-label mb-2 flex items-center gap-2">
                    <span aria-hidden className={cn("size-1.5 rounded-full", group.dot)} />
                    {group.label}
                    <span className="font-normal tabular-nums text-muted-foreground">
                      {entries.length}
                    </span>
                  </div>
                  <ul className="ds-tile divide-y divide-border/50 overflow-hidden">
                    {entries.map((entry) => (
                      <Row
                        key={entry.key}
                        entry={entry}
                        time={when(group.id, entry.at)}
                        actionLabel={
                          group.id === "ready"
                            ? "Set a time"
                            : entry.contentItemId || entry.place
                              ? "Open"
                              : null
                        }
                        primary={group.id === "ready"}
                        onOpen={() => openEntry(entry)}
                      />
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </AppModalShell>
    </>
  );
}

function Row({
  entry,
  time,
  actionLabel,
  primary,
  onOpen,
}: {
  entry: PublishEntry;
  time: string | null;
  actionLabel: string | null;
  primary: boolean;
  onOpen: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3">
      <div className="min-w-0 flex-1 basis-[220px]">
        <p className="truncate text-[13.5px] font-medium text-foreground">{entry.title}</p>
        <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
          {entry.detail}
          {time ? ` · ${time}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {entry.href ? (
          <a
            href={entry.href}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(dsGhostBtn, "h-8 px-3 text-[12px]")}
          >
            {entry.hrefLabel ?? "Open"}
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        ) : null}
        {actionLabel ? (
          <Button size="sm" variant={primary ? "default" : "outline"} onClick={onOpen}>
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </li>
  );
}
