"use client";
// Wires Home's Inbox card: the same free read as the Inbox (getEngageHome,
// shared query key, so opening the Inbox is instant). Reads only; the card
// opens the Inbox. Hidden when the Inbox is off for this workspace.
import { useQuery } from "@tanstack/react-query";
import { emitAppEvent } from "@/lib/app-events";
import { getEngageHome } from "@/lib/engage.functions";
import { inboxHealth } from "@/lib/engage/health";
import type { EngageHome } from "@/lib/engage/contracts";
import { engageKeys } from "../engage-shared";
import { InboxHomeCard, type InboxHomeExchange, type InboxHomeState } from "./InboxHomeCard";

const clip = (s: string, max: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** Home's view of the Inbox (pure). */
export function inboxHomeState(data: EngageHome | undefined): InboxHomeState {
  if (!data) return { kind: "loading" };
  if (!data.connection) return { kind: "connect" };
  const health = inboxHealth(data);
  const ok = (id: string) => health.find((h) => h.id === id)?.state === "ok";
  const latest: InboxHomeExchange[] = data.comments
    .filter((c) => c.status === "replied" && (c.replyText || c.dmText))
    .sort(
      (a, b) => Date.parse(b.repliedAt ?? b.commentedAt) - Date.parse(a.repliedAt ?? a.commentedAt),
    )
    .slice(0, 4)
    .map((c) => ({
      id: c.id,
      platform: c.platform,
      kind: c.kind,
      said: clip(c.body, 90),
      reply: clip(c.replyText ?? c.dmText ?? "", 110),
      byMox: c.moxState === "replied" || c.autoSent,
    }));
  return {
    kind: "live",
    autoReply: data.autoReply,
    waiting: data.counts.waiting,
    answered: data.counts.replied,
    byMox: data.counts.autoReplied,
    channels: { facebook: ok("facebook"), instagram: ok("instagram"), dms: ok("messages") },
    latest,
    asked: (data.voice?.asked ?? []).map((q) => ({ question: q.question, count: q.count })),
    broken:
      health.some((h) => h.id === "reading" && h.state === "warn") ||
      data.connection.status !== "active",
  };
}

export function HomeInbox({ workspaceId }: { workspaceId: string }) {
  const home = useQuery({
    queryKey: engageKeys.home(workspaceId),
    queryFn: () => getEngageHome({ data: { workspaceId } }),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
  // Off for this workspace, or the read failed: Home shows nothing.
  if (home.error) return null;
  return (
    <InboxHomeCard state={inboxHomeState(home.data)} onOpen={() => emitAppEvent("open:inbox")} />
  );
}
