"use client";

// Development-only visual check for Memory and for what a chat reply carries
// (the "Memory updated" note, prepared changes, place buttons), with sample
// data. Nothing here talks to a server.
import { useEffect, useState } from "react";
import { ReplyExtras, ToolActivity } from "@/components/app/chat/ReplyExtras";
import type { ChatActionView, ChatReplyExtras } from "@/lib/chat/events";
import { MEMORY_LIMIT, type Memory, type MemoryView } from "@/lib/memory/contracts";
import { cn } from "@/lib/utils";
import { MemoryScreen, type MemoryHandlers } from "./MemoryScreen";

const SCENES = ["ready", "empty", "viewer", "off", "chat"] as const;
type Scene = (typeof SCENES)[number];

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

function sample(now: number): Memory[] {
  const at = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  const lasting = (
    n: number,
    body: string,
    kind: Memory["kind"],
    topic: Memory["topic"],
  ): Memory => ({
    id: id(n),
    body,
    kind,
    topic,
    source: "chat",
    expiresAt: null,
    createdAt: at(n * 90),
    updatedAt: at(n * 90),
  });
  return [
    {
      ...lasting(1, "Promoting the spring sale this week", "context", "content"),
      expiresAt: new Date(now + 5 * 3_600_000).toISOString(),
    },
    {
      ...lasting(2, "Keep the tone playful for today's posts", "preference", "voice"),
      expiresAt: new Date(now + 20 * 3_600_000).toISOString(),
    },
    lasting(3, "Never use red in our images", "rule", "visual"),
    lasting(4, "Write in British English", "rule", "voice"),
    lasting(5, 'Never say "cheap"; say "good value"', "rule", "voice"),
    lasting(6, "Our busiest season is September to November", "fact", "business"),
    lasting(7, "Prefers carousels over single image posts on Instagram", "preference", "content"),
    lasting(8, "The founder is called Sam and signs the newsletter", "fact", "business"),
  ];
}

const ACTIONS: ChatActionView[] = [
  {
    id: id(21),
    title: "Schedule approved posts",
    detail: "2 items · when: Tuesday 9:00",
    destructive: false,
    state: "offered",
  },
  {
    id: id(22),
    title: "Delete a post",
    detail: "1 content item",
    destructive: true,
    state: "offered",
  },
  {
    id: id(23),
    title: "Start an AI visibility scan",
    detail: "",
    destructive: false,
    state: "done",
    note: "Scan started. Results show in AI Visibility.",
  },
  {
    id: id(24),
    title: "Post now",
    detail: "1 content item",
    destructive: true,
    state: "failed",
    note: "This post isn't approved yet.",
  },
];

export function MemoryLab() {
  const [scene, setScene] = useState<Scene>("ready");
  // Sample times are relative to now, so the screens render in the browser only.
  const [now, setNow] = useState<number | null>(null);
  const [last, setLast] = useState("");
  const [actions, setActions] = useState(ACTIONS);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("scene") as Scene | null;
    if (fromUrl && SCENES.includes(fromUrl)) setScene(fromUrl);
    setNow(Date.now());
  }, []);

  const memories = now === null ? [] : sample(now);
  const view: MemoryView = {
    enabled: scene !== "off",
    canEdit: scene !== "viewer",
    canManage: scene !== "viewer",
    memories: scene === "empty" ? [] : memories,
    limit: MEMORY_LIMIT,
  };

  const handlers: MemoryHandlers = {
    setEnabled: (enabled) => setLast(`enabled:${enabled}`),
    add: (body, hours) => setLast(`add:${body}:${hours ?? "always"}`),
    edit: (memoryId, body) => setLast(`edit:${memoryId.slice(0, 8)}:${body}`),
    keep: (memoryId) => setLast(`keep:${memoryId.slice(0, 8)}`),
    remove: (memoryId) => setLast(`remove:${memoryId.slice(0, 8)}`),
    clear: () => setLast("clear"),
  };

  const extras: ChatReplyExtras = {
    memory: [
      { op: "added", id: id(3), text: "Never use red in our images" },
      {
        op: "added",
        id: id(1),
        text: "Promoting the spring sale this week",
        temporary: true,
      },
    ],
    actions,
    offers: [
      { place: "calendar", label: "Calendar" },
      { place: "backlinks", label: "Backlinks" },
    ],
  };

  return (
    <div data-mellox-app className="min-h-dvh bg-background text-foreground">
      <nav className="sticky top-0 z-10 flex flex-wrap items-center gap-1.5 border-b border-border/60 bg-background px-4 py-2">
        <span className="mr-2 text-[12px] font-medium text-muted-foreground">Memory lab</span>
        {SCENES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScene(s)}
            className={cn(
              "h-7 rounded-full px-3 text-[12px] font-medium",
              s === scene
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-foreground/80",
            )}
          >
            {s}
          </button>
        ))}
        <span data-testid="lab-last" className="ml-auto text-[12px] text-muted-foreground">
          {last}
        </span>
      </nav>

      <div
        data-testid="memory-lab-frame"
        data-ready={now !== null}
        className="mx-auto w-full max-w-2xl px-4 py-6"
      >
        {now === null ? null : scene === "chat" ? (
          <div className="flex flex-col gap-4">
            <p className="text-[15px] leading-relaxed text-foreground">
              Got it, no red from now on. Two of your approved posts can go out on Tuesday.
            </p>
            <ToolActivity activity={{ label: "Looking at your posts", state: "start" }} />
            <ReplyExtras
              extras={extras}
              handlers={{
                undoMemory: async (change) => {
                  setLast(`undo:${change.id.slice(0, 8)}`);
                  return true;
                },
                manageMemory: () => setLast("manage"),
                runAction: (action) => {
                  setLast(`run:${action.id.slice(0, 8)}`);
                  setActions((list) =>
                    list.map((a) =>
                      a.id === action.id ? { ...a, state: "done", note: undefined } : a,
                    ),
                  );
                },
                openPlace: (offer) => setLast(`open:${offer.place}`),
              }}
            />
          </div>
        ) : (
          <MemoryScreen view={view} handlers={handlers} now={new Date(now)} />
        )}
      </div>
    </div>
  );
}
