"use client";

// AnnouncementsOutlet — the messages staff publish from the admin console
// (Admin → Announcements), shown as a thin strip at the top of the app.
//
// The table's row-level security only returns announcements that are live right
// now, so there is nothing to filter here. A failed read shows nothing: a
// missing banner must never get in the way of the app. Closing one is a
// per-browser convenience (localStorage), never state anyone else sees.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { XIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

export type LiveAnnouncement = {
  id: string;
  title: string;
  body: string;
  tone: "info" | "success" | "warning";
  link_url: string | null;
  dismissible: boolean;
};

const STORAGE_KEY = "announcements:closed";

function readClosed(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeClosed(ids: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.slice(-50)));
  } catch {
    /* storage unavailable: it simply comes back next visit */
  }
}

const TONE = {
  info: "bg-primary/12 text-foreground",
  success: "bg-success/12 text-foreground",
  warning: "bg-warning/15 text-foreground",
} as const;

/** Presentational: also what the admin lab renders. */
export function AnnouncementStrip({
  items,
  onClose,
}: {
  items: LiveAnnouncement[];
  onClose?: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div role="region" aria-label="Announcements" className="flex flex-col">
      {items.map((item) => (
        <div
          key={item.id}
          className={cn("flex items-center gap-3 px-4 py-2 text-[13px]", TONE[item.tone])}
        >
          <p className="min-w-0 flex-1">
            <span className="font-semibold">{item.title}</span>
            {item.body && <span className="text-foreground/75"> {item.body}</span>}
            {item.link_url && (
              <>
                {" "}
                <a
                  href={item.link_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium underline underline-offset-2"
                >
                  Learn more
                </a>
              </>
            )}
          </p>
          {item.dismissible && onClose && (
            <button
              type="button"
              onClick={() => onClose(item.id)}
              aria-label={`Close announcement: ${item.title}`}
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full hover:bg-foreground/10"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function AnnouncementsOutlet() {
  const [items, setItems] = useState<LiveAnnouncement[]>([]);
  const [closed, setClosed] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    setClosed(readClosed());
    void (async () => {
      try {
        // The table is newer than the generated database types.
        const table = (
          supabase as unknown as {
            from: (name: string) => {
              select: (columns: string) => {
                order: (
                  column: string,
                  options: { ascending: boolean },
                ) => {
                  limit: (n: number) => PromiseLike<{ data: LiveAnnouncement[] | null }>;
                };
              };
            };
          }
        ).from("platform_announcements");
        const { data } = await table
          .select("id,title,body,tone,link_url,dismissible")
          .order("starts_at", { ascending: false })
          .limit(3);
        if (!cancelled && data) setItems(data);
      } catch {
        /* no banner is better than a broken app */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AnnouncementStrip
      items={items.filter((item) => !closed.includes(item.id))}
      onClose={(id) => {
        const next = [...closed, id];
        setClosed(next);
        writeClosed(next);
      }}
    />
  );
}
