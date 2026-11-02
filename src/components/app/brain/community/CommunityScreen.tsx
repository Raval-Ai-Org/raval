"use client";
// CommunityScreen — Brain → Market → Communities. Presentational: everything
// comes in through props, every change goes out through `handlers`, so
// /brain-lab can render it with sample data.
//
// Real threads where people ask about what the brand does, with their links.
// A reply is drafted on a person's click; the person copies it and posts it
// themselves. Blocks are <div>s (the global section rhythm breaks grids).
import { useMemo, useState, type FormEvent } from "react";
import {
  Bookmark,
  Check,
  Copy,
  ExternalLink,
  EyeOff,
  MessageSquare,
  Pause,
  Plus,
  RefreshCw,
  Search,
  Spinner,
  X,
} from "@/components/icons";
import { PlatformAppIcon } from "@/components/brand/PlatformAppIcon";
import { CostChip } from "@/components/app/CostChip";
import { dsFocus, dsGhostBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { EmptyState } from "@/components/ui/empty-state";
import {
  COMMUNITY_SOURCES,
  MATCH_CHIPS,
  MATCH_LABELS,
  SOURCE_LABELS,
  type CommunityHome,
  type CommunitySource,
  type CommunityThreadView,
  type CommunityWatchKind,
  type MatchKind,
  type ThreadStatus,
} from "@/lib/community/contracts";
import { cn } from "@/lib/utils";

export type CommunityHandlers = {
  refresh: () => void;
  pause: () => void;
  setStatus: (threadId: string, status: ThreadStatus) => void;
  addWatch: (kind: CommunityWatchKind, value: string) => void;
  removeWatch: (watchId: string) => void;
  draftReply: (threadId: string) => void;
  copy: (text: string) => void;
};

export type CommunityScreenProps = {
  home: CommunityHome;
  handlers: CommunityHandlers;
  refreshing?: boolean;
  /** The thread whose reply is being written. */
  draftingId?: string | null;
  /** Viewers see everything but change nothing. */
  canEdit?: boolean;
  now?: number;
};

type Filter = "all" | MatchKind | "saved";

const HOUR = 3_600_000;

export function ago(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  if (ms < HOUR) return "just now";
  if (ms < 24 * HOUR) return `${Math.floor(ms / HOUR)} h ago`;
  const days = Math.floor(ms / (24 * HOUR));
  if (days < 31) return `${days} ${days === 1 ? "day" : "days"} ago`;
  const months = Math.floor(days / 30);
  return `${months} ${months === 1 ? "month" : "months"} ago`;
}

function SourceMark({ source, size = 20 }: { source: CommunitySource; size?: number }) {
  return <PlatformAppIcon platform={source} size={size} />;
}

export function CommunityScreen({
  home,
  handlers,
  refreshing = false,
  draftingId = null,
  canEdit = true,
  now = Date.now(),
}: CommunityScreenProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const busy = refreshing || home.job.state === "queued" || home.job.state === "running";
  const never = home.job.state === "never";

  const counts = useMemo(() => {
    const out: Record<Filter, number> = {
      all: home.threads.length,
      saved: 0,
      problem: 0,
      competitor: 0,
      alternative: 0,
      category: 0,
    };
    for (const t of home.threads) {
      out[t.matchedOn] += 1;
      if (t.status === "saved") out.saved += 1;
    }
    return out;
  }, [home.threads]);

  const shown = home.threads.filter((t) =>
    filter === "all" ? true : filter === "saved" ? t.status === "saved" : t.matchedOn === filter,
  );

  return (
    <div className="mx-auto w-full max-w-[1040px] space-y-5" data-testid="community-screen">
      {/* ── header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <div className="flex -space-x-1.5" aria-hidden>
              {COMMUNITY_SOURCES.map((s) => (
                <SourceMark key={s} source={s} size={22} />
              ))}
            </div>
            <h2 className="text-[17px] font-semibold tracking-tight">Communities</h2>
          </div>
          <p className="max-w-[560px] text-[13px] text-muted-foreground">
            Real threads where people ask about what you do. Mellox can draft a reply; you post it
            yourself.
          </p>
          <JobLine home={home} busy={busy} now={now} />
        </div>
        {canEdit && !never && (
          <div className="flex shrink-0 items-center gap-2">
            {home.job.state !== "paused" && (
              <button
                type="button"
                className={cn(dsGhostBtn, "h-9 px-3.5 text-[13px]")}
                onClick={handlers.pause}
                disabled={busy}
              >
                <Pause className="h-4 w-4" /> Pause
              </button>
            )}
            <button
              type="button"
              className={cn(dsPrimaryBtn, "h-9 px-4 text-[13px]")}
              onClick={handlers.refresh}
              disabled={busy}
            >
              {busy ? <Spinner className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
              {busy ? "Looking…" : home.job.state === "paused" ? "Start again" : "Look now"}
              {!busy && <CostChip free />}
            </button>
          </div>
        )}
      </div>

      {never ? (
        <div className="ds-tile">
          <EmptyState
            icon={Search}
            title="Find people asking about what you do"
            description="Mellox looks on Reddit, Quora, Hacker News and Stack Exchange once a day, using your Brand DNA, products, audience and competitors."
            action={
              canEdit ? (
                <button
                  type="button"
                  className={cn(dsPrimaryBtn, "h-10 px-5 text-[14px]")}
                  onClick={handlers.refresh}
                  disabled={busy}
                >
                  {busy ? <Spinner className="h-4 w-4" /> : <Search className="h-4 w-4" />}
                  {busy ? "Looking…" : "Start looking"}
                  {!busy && <CostChip free />}
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <Signals home={home} onPick={setFilter} />

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="min-w-0 space-y-3">
              <div
                role="tablist"
                aria-label="Show"
                className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {(["all", "alternative", "problem", "competitor", "category", "saved"] as const)
                  .filter((f) => f === "all" || counts[f] > 0)
                  .map((f) => (
                    <button
                      key={f}
                      type="button"
                      role="tab"
                      aria-selected={filter === f}
                      onClick={() => setFilter(f)}
                      className={cn(
                        "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors",
                        filter === f
                          ? "bg-[var(--ds-tile-bg)] text-foreground ring-1 ring-primary/30"
                          : "text-muted-foreground hover:text-foreground",
                        dsFocus,
                      )}
                    >
                      {f === "all" ? "All" : f === "saved" ? "Saved" : MATCH_CHIPS[f]}
                      <span className="tabular-nums text-muted-foreground">{counts[f]}</span>
                    </button>
                  ))}
              </div>

              {shown.length === 0 ? (
                <div className="ds-tile">
                  <EmptyState
                    size="sm"
                    icon={MessageSquare}
                    title={
                      home.threads.length === 0
                        ? busy
                          ? "Looking for threads…"
                          : "No threads yet"
                        : "Nothing here"
                    }
                    description={
                      home.threads.length === 0 && !busy
                        ? "Add a few words or a community on the right, then look again."
                        : undefined
                    }
                  />
                </div>
              ) : (
                <div className="space-y-2.5">
                  {shown.map((t) => (
                    <ThreadCard
                      key={t.id}
                      thread={t}
                      now={now}
                      canEdit={canEdit}
                      drafting={draftingId === t.id}
                      handlers={handlers}
                    />
                  ))}
                </div>
              )}
            </div>

            <Watches home={home} canEdit={canEdit} handlers={handlers} />
          </div>
        </>
      )}
    </div>
  );
}

function JobLine({ home, busy, now }: { home: CommunityHome; busy: boolean; now: number }) {
  const parts: string[] = [];
  if (busy) parts.push("Looking now. New threads show up here in a minute or two.");
  else if (home.job.state === "paused")
    parts.push("Paused. Nothing is looked up until you start again.");
  else if (home.job.lastRunAt) {
    parts.push(`Last looked ${ago(home.job.lastRunAt, now)}`);
    if (home.job.lastFound > 0) parts.push(`${home.job.lastFound} new`);
    parts.push("looks again every day");
  }
  return (
    <div className="space-y-0.5 text-[12px] text-muted-foreground">
      {parts.length > 0 && <p className="text-[12px]">{parts.join(" · ")}</p>}
      {home.job.error && !busy && (
        <p className="text-[12px] text-amber-600 dark:text-amber-400">{home.job.error}</p>
      )}
      {!home.webSearch && (
        <p className="text-[12px]">
          Reddit and Quora need web search, which isn't set up here yet. Hacker News and Stack
          Exchange still work.
        </p>
      )}
      {!home.redditApi && home.webSearch && (
        <p className="text-[12px]">
          Reddit threads are found through web search. Replies are always posted by you.
        </p>
      )}
    </div>
  );
}

function Signals({ home, onPick }: { home: CommunityHome; onPick: (f: Filter) => void }) {
  const { competitorMentions, recurringQuestions, activeCommunities } = home.signals;
  if (!competitorMentions.length && !recurringQuestions.length && !activeCommunities.length) {
    return null;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-3" data-testid="community-signals">
      {competitorMentions.length > 0 && (
        <button
          type="button"
          onClick={() => onPick("competitor")}
          className={cn("ds-tile ds-tile-hover space-y-2 p-4 text-left", dsFocus)}
        >
          <p className="ds-label">Competitors talked about</p>
          <ul className="space-y-1">
            {competitorMentions.slice(0, 4).map((c) => (
              <li key={c.name} className="flex items-center justify-between gap-2 text-[13px]">
                <span className="truncate">{c.name}</span>
                <span className="tabular-nums text-muted-foreground">
                  {c.count} {c.count === 1 ? "thread" : "threads"}
                </span>
              </li>
            ))}
          </ul>
        </button>
      )}
      {recurringQuestions.length > 0 && (
        <div className="ds-tile space-y-2 p-4">
          <p className="ds-label">Asked again and again</p>
          <ul className="space-y-1.5">
            {recurringQuestions.slice(0, 3).map((q) => (
              <li key={q.question} className="text-[13px] leading-snug">
                <span className="line-clamp-2">{q.question}</span>
                <span className="text-[12px] text-muted-foreground">{q.count} threads</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {activeCommunities.length > 0 && (
        <div className="ds-tile space-y-2 p-4">
          <p className="ds-label">Busiest places</p>
          <ul className="space-y-1.5">
            {activeCommunities.slice(0, 4).map((c) => (
              <li
                key={`${c.source}-${c.community}`}
                className="flex items-center gap-2 text-[13px]"
              >
                <SourceMark source={c.source} size={18} />
                <span className="min-w-0 flex-1 truncate">{c.community}</span>
                <span className="tabular-nums text-muted-foreground">{c.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ThreadCard({
  thread: t,
  now,
  canEdit,
  drafting,
  handlers,
}: {
  thread: CommunityThreadView;
  now: number;
  canEdit: boolean;
  drafting: boolean;
  handlers: CommunityHandlers;
}) {
  const when = ago(t.postedAt ?? t.foundAt, now);
  const saved = t.status === "saved";
  return (
    <div className="ds-tile space-y-3 p-4" data-testid="community-thread">
      <div className="flex items-start gap-3">
        <SourceMark source={t.source} size={28} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted-foreground">
            <span className="font-medium text-foreground/80">
              {t.community || SOURCE_LABELS[t.source]}
            </span>
            {when && <span>· {when}</span>}
            {t.status === "replied" && (
              <span className="inline-flex items-center gap-0.5 text-primary">
                · <Check className="h-3 w-3" /> Replied
              </span>
            )}
          </p>
          <a
            href={t.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={cn("block text-[14.5px] font-medium leading-snug hover:underline", dsFocus)}
          >
            {t.title}
          </a>
          {(t.summary || t.snippet) && (
            <p className="line-clamp-2 text-[13px] text-muted-foreground">
              {t.summary || t.snippet}
            </p>
          )}
          <p className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[12px]">
            <span
              title={MATCH_LABELS[t.matchedOn]}
              className="rounded-full bg-[var(--ds-well-bg)] px-2 py-0.5 font-medium text-foreground/80"
            >
              {t.matchedOn === "competitor" || t.matchedOn === "alternative"
                ? `${MATCH_CHIPS[t.matchedOn]}: ${t.competitorName ?? t.matchedTerm}`
                : MATCH_CHIPS[t.matchedOn]}
            </span>
            {t.matchedTerm && t.matchedOn !== "competitor" && t.matchedOn !== "alternative" && (
              <span className="truncate text-muted-foreground">found for “{t.matchedTerm}”</span>
            )}
          </p>
        </div>
      </div>

      {t.reply && (
        <div
          className="space-y-2 rounded-[14px] bg-[var(--ds-well-bg)] p-3"
          data-testid="community-reply"
        >
          <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">{t.reply.text}</p>
          {t.reply.removed > 0 && (
            <p className="text-[11.5px] text-muted-foreground">
              Left out {t.reply.removed} {t.reply.removed === 1 ? "sentence" : "sentences"} with a
              number you haven't given Mellox.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {t.reply ? (
          <>
            <button
              type="button"
              className={cn(dsPrimaryBtn, "h-8 px-3.5 text-[12.5px]")}
              onClick={() => handlers.copy(t.reply!.text)}
            >
              <Copy className="h-3.5 w-3.5" /> Copy
            </button>
            <a
              href={t.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className={cn(dsGhostBtn, "h-8 px-3.5 text-[12.5px]")}
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open thread
            </a>
            {canEdit && t.status !== "replied" && (
              <button
                type="button"
                className={cn(dsGhostBtn, "h-8 px-3.5 text-[12.5px]")}
                onClick={() => handlers.setStatus(t.id, "replied")}
              >
                <Check className="h-3.5 w-3.5" /> I posted it
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                className={cn(dsGhostBtn, "h-8 px-3 text-[12.5px]")}
                onClick={() => handlers.draftReply(t.id)}
                disabled={drafting}
              >
                {drafting ? (
                  <Spinner className="h-3.5 w-3.5" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Write another
                {!drafting && <CostChip action="community_reply" />}
              </button>
            )}
          </>
        ) : (
          <>
            {canEdit && (
              <button
                type="button"
                className={cn(dsPrimaryBtn, "h-8 px-3.5 text-[12.5px]")}
                onClick={() => handlers.draftReply(t.id)}
                disabled={drafting}
              >
                {drafting ? (
                  <Spinner className="h-3.5 w-3.5" />
                ) : (
                  <MessageSquare className="h-3.5 w-3.5" />
                )}
                {drafting ? "Writing…" : "Draft a reply"}
                {!drafting && <CostChip action="community_reply" />}
              </button>
            )}
            <a
              href={t.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className={cn(dsGhostBtn, "h-8 px-3.5 text-[12.5px]")}
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open thread
            </a>
          </>
        )}
        {canEdit && (
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              aria-label={saved ? "Remove from saved" : "Save"}
              title={saved ? "Remove from saved" : "Save"}
              className={cn(
                "grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-[var(--ds-well-bg)]",
                saved ? "text-primary" : "text-muted-foreground",
                dsFocus,
              )}
              onClick={() => handlers.setStatus(t.id, saved ? "new" : "saved")}
            >
              <Bookmark className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Hide"
              title="Hide"
              className={cn(
                "grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--ds-well-bg)]",
                dsFocus,
              )}
              onClick={() => handlers.setStatus(t.id, "hidden")}
            >
              <EyeOff className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Watches({
  home,
  canEdit,
  handlers,
}: {
  home: CommunityHome;
  canEdit: boolean;
  handlers: CommunityHandlers;
}) {
  const [kind, setKind] = useState<CommunityWatchKind>("keyword");
  const [value, setValue] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (v.length < 2) return;
    handlers.addWatch(kind, v);
    setValue("");
  };
  const words = home.watches.filter((w) => w.kind === "keyword");
  const places = home.watches.filter((w) => w.kind === "community");
  return (
    <div className="ds-tile h-fit space-y-3 p-4" data-testid="community-watches">
      <div className="space-y-0.5">
        <p className="text-[13.5px] font-semibold">What to look for</p>
        <p className="text-[12px] text-muted-foreground">
          Mellox already uses your Brand DNA, products, audience and competitors. Add more here.
        </p>
      </div>
      {[
        { label: "Words", list: words },
        { label: "Communities", list: places },
      ].map(
        (group) =>
          group.list.length > 0 && (
            <div key={group.label} className="space-y-1.5">
              <p className="ds-label">{group.label}</p>
              <div className="flex flex-wrap gap-1.5">
                {group.list.map((w) => (
                  <span
                    key={w.id}
                    className="inline-flex items-center gap-1 rounded-full bg-[var(--ds-well-bg)] py-1 pl-2.5 pr-1 text-[12.5px]"
                  >
                    {w.value}
                    {canEdit && (
                      <button
                        type="button"
                        aria-label={`Remove ${w.value}`}
                        className={cn(
                          "grid h-5 w-5 place-items-center rounded-full text-muted-foreground hover:text-foreground",
                          dsFocus,
                        )}
                        onClick={() => handlers.removeWatch(w.id)}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>
          ),
      )}
      {canEdit && (
        <form onSubmit={submit} className="space-y-2">
          <div className="ds-well inline-flex w-full gap-0.5 rounded-full p-1" role="radiogroup">
            {(["keyword", "community"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={cn(
                  "h-7 flex-1 rounded-full text-[12px] font-medium transition-all",
                  kind === k
                    ? "bg-[var(--ds-tile-bg)] text-foreground shadow-sm ring-1 ring-primary/30"
                    : "text-muted-foreground hover:text-foreground",
                  dsFocus,
                )}
              >
                {k === "keyword" ? "Words" : "Community"}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={80}
              aria-label={kind === "keyword" ? "Words to look for" : "Community to look in"}
              placeholder={kind === "keyword" ? "e.g. dial in espresso" : "e.g. r/espresso"}
              className="h-9 min-w-0 flex-1 rounded-full border border-border/70 bg-background px-3.5 text-[13px] outline-none focus:border-primary/50"
            />
            <button
              type="submit"
              aria-label="Add"
              className={cn(dsGhostBtn, "h-9 w-9 shrink-0 p-0")}
              disabled={value.trim().length < 2}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
