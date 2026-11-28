"use client";
// Home's Inbox card (Holo): what Mox is doing in the brand's comments and DMs
// right now, without opening the Inbox. Real rows only: the latest answers
// cycle like a live feed, the counts are stored ones, and "Customers ask" is
// the customer brain (customer-voice.ts). The whole card opens the Inbox.
// Presentational: the data comes from HomeInbox (the same free read as the
// Inbox, shared cache).
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { PlatformAppIcon } from "@/components/brand/PlatformAppIcon";
import { MoxFace } from "@/components/brand/mox/MoxFace";
import { CardArrow } from "@/components/app/surface/MoxParts";
import { dsFocus } from "@/components/app/surface/buttons";
import { cn } from "@/lib/utils";
import type { EngagePlatform } from "@/lib/engage/contracts";

const EASE = [0.22, 1, 0.36, 1] as const;

export type InboxHomeExchange = {
  id: string;
  platform: EngagePlatform;
  kind: "comment" | "dm";
  said: string;
  reply: string;
  byMox: boolean;
};

export type InboxHomeState =
  | { kind: "loading" }
  | { kind: "connect" }
  | {
      kind: "live";
      autoReply: boolean;
      waiting: number;
      answered: number;
      byMox: number;
      channels: { facebook: boolean; instagram: boolean; dms: boolean };
      latest: InboxHomeExchange[];
      asked: { question: string; count: number }[];
      /** Something needs fixing (a red chip in the Inbox). */
      broken: boolean;
    };

const WASH = {
  backgroundImage:
    "radial-gradient(70% 90% at 0% 100%, rgb(217 245 58 / 0.20), transparent 62%), radial-gradient(60% 80% at 100% 0%, rgb(31 214 196 / 0.16), transparent 64%)",
} as const;

function Count({ value, label, hot }: { value: number; label: string; hot?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold",
        hot
          ? "bg-[var(--mox-yellow,#f5d547)]/25 text-foreground"
          : "bg-[var(--ds-well-bg)] text-muted-foreground",
      )}
    >
      <motion.span
        key={value}
        initial={{ y: -6, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.3, ease: EASE }}
        className="font-bold tabular-nums text-foreground"
      >
        {value > 999 ? "999+" : value}
      </motion.span>
      {label}
    </span>
  );
}

/** The latest answers, one at a time: what they said, then Mox's reply. */
function LiveFeed({ items }: { items: InboxHomeExchange[] }) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduce || items.length < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % items.length), 4200);
    return () => clearInterval(t);
  }, [reduce, items.length]);
  const n = Math.max(1, items.length);
  // The newest exchange at the bottom, the one before it fading above (a live chat).
  const shown = items.length > 1 ? [items[(i + n - 1) % n], items[i % n]] : items.slice(0, 1);
  if (!shown.length) return null;
  const kindLabel = (it: InboxHomeExchange) =>
    `${it.platform === "instagram" ? "Instagram" : "Facebook"} ${it.kind === "dm" ? "DM" : "comment"}`;
  return (
    <div
      className="relative flex h-full min-h-[150px] flex-col justify-end gap-3 overflow-hidden"
      aria-live="off"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-gradient-to-b from-[var(--ds-well-bg)] to-transparent"
      />
      <AnimatePresence initial={false} mode="popLayout">
        {shown.map((item, idx) => (
          <motion.div
            key={item.id}
            layout={!reduce}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24 }}
            animate={{
              opacity: idx === shown.length - 1 ? 1 : 0.45,
              y: 0,
              scale: idx === shown.length - 1 ? 1 : 0.97,
            }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -20 }}
            transition={{ duration: 0.45, ease: EASE }}
            className="origin-top space-y-1.5"
          >
            <p className="pl-7 text-[10.5px] font-semibold text-muted-foreground">
              {kindLabel(item)}
            </p>
            <div className="flex items-start gap-2">
              <PlatformAppIcon platform={item.platform} size={20} className="mt-0.5 shrink-0" />
              <span className="max-w-[85%] truncate rounded-2xl rounded-tl-sm bg-[var(--ds-card-bg)] px-3 py-1.5 text-[12.5px] shadow-[var(--ds-card-shadow)]">
                {item.said}
              </span>
            </div>
            <motion.div
              initial={reduce ? false : { opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: reduce ? 0 : 0.45, duration: 0.35, ease: EASE }}
              className="flex items-start justify-end gap-2"
            >
              <span
                className="max-w-[85%] truncate rounded-2xl rounded-tr-sm px-3 py-1.5 text-[12.5px] font-semibold"
                style={{ backgroundImage: "var(--mox-gradient)", color: "var(--mox-ink)" }}
              >
                {item.reply}
              </span>
              {item.byMox ? (
                <MoxFace mood="happy" size={20} className="mt-0.5 shrink-0" />
              ) : (
                <span className="mt-0.5 grid h-5 shrink-0 place-items-center rounded-full bg-foreground px-1.5 text-[9.5px] font-bold text-background">
                  You
                </span>
              )}
            </motion.div>
          </motion.div>
        ))}
      </AnimatePresence>
      {items.length > 1 && (
        <div className="absolute right-1 top-1 z-20 flex gap-1" aria-hidden>
          {items.map((it, n) => (
            <span
              key={it.id}
              className={cn(
                "h-1 rounded-full transition-all duration-300",
                n === i % items.length
                  ? "w-4 [background:var(--mox-gradient)]"
                  : "w-1 bg-foreground/15",
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function InboxHomeCard({ state, onOpen }: { state: InboxHomeState; onOpen: () => void }) {
  const reduce = useReducedMotion();
  if (state.kind === "loading")
    return <div className="h-[168px] animate-pulse rounded-[24px] bg-[var(--ds-well-bg)]" />;

  if (state.kind === "connect")
    return (
      <button
        type="button"
        onClick={onOpen}
        data-testid="home-inbox"
        className={cn(
          "group relative flex w-full items-center gap-4 overflow-hidden rounded-[24px] border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] p-5 text-left shadow-[var(--ds-card-shadow)] transition-shadow hover:shadow-[var(--ds-card-shadow-hover)]",
          dsFocus,
        )}
        style={WASH}
      >
        <div className="relative flex shrink-0 -space-x-2">
          <motion.span
            animate={reduce ? undefined : { y: [0, -4, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          >
            <PlatformAppIcon platform="facebook" size={36} />
          </motion.span>
          <motion.span
            animate={reduce ? undefined : { y: [0, -4, 0] }}
            transition={{ duration: 3, delay: 0.5, repeat: Infinity, ease: "easeInOut" }}
          >
            <PlatformAppIcon platform="instagram" size={36} />
          </motion.span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[16px] font-bold tracking-[-0.015em]">Mox answers your comments</h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Instagram and Facebook, day and night.
          </p>
        </div>
        <span className="studio-cta inline-flex h-9 shrink-0 items-center rounded-full px-4 text-[13px] font-bold">
          Connect
        </span>
      </button>
    );

  const { latest, asked } = state;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="home-inbox"
      aria-label="Open Inbox"
      className={cn(
        "group relative grid w-full gap-4 overflow-hidden rounded-[24px] border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] p-5 text-left shadow-[var(--ds-card-shadow)] transition-[box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:shadow-[var(--ds-card-shadow-hover)] @xl:grid-cols-[1fr_1.15fr]",
        dsFocus,
      )}
      style={WASH}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <span className="relative">
            <MoxFace
              mood={state.autoReply ? (state.waiting ? "thinking" : "happy") : "sleep"}
              size={34}
            />
            {state.autoReply && (
              <span className="absolute -right-0.5 -top-0.5 flex size-2.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400/70" />
                <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
              </span>
            )}
          </span>
          <div className="min-w-0">
            <h3 className="text-[16px] font-bold tracking-[-0.015em]">
              Inbox <span className="ds-grad-text">{state.autoReply ? "live" : "paused"}</span>
            </h3>
            <div className="mt-0.5 flex items-center gap-1">
              {(
                [
                  ["facebook", state.channels.facebook],
                  ["instagram", state.channels.instagram],
                ] as const
              ).map(([p, on]) => (
                <PlatformAppIcon
                  key={p}
                  platform={p}
                  size={16}
                  className={cn(!on && "opacity-30 grayscale")}
                />
              ))}
              {state.broken && (
                <span className="ml-1 inline-flex items-center gap-1 text-[11px] font-semibold text-destructive">
                  <span className="size-1.5 rounded-full bg-destructive" />
                  Fix
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Count value={state.waiting} label="need you" hot={state.waiting > 0} />
          <Count value={state.answered} label="answered" />
          {state.byMox > 0 && <Count value={state.byMox} label="by Mox" />}
        </div>
        {asked.length > 0 && (
          <div className="mt-3 space-y-1">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
              Customers ask
            </p>
            {asked.slice(0, 2).map((q, n) => (
              <motion.p
                key={q.question}
                initial={reduce ? false : { opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + n * 0.08, duration: 0.3, ease: EASE }}
                className="flex items-center gap-1.5 text-[12.5px]"
              >
                <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-foreground px-1 text-[10px] font-bold tabular-nums text-background">
                  {q.count}
                </span>
                <span className="truncate">{q.question}</span>
              </motion.p>
            ))}
          </div>
        )}
      </div>

      <div className="relative min-w-0 rounded-[18px] bg-[var(--ds-well-bg)] p-3">
        {latest.length ? (
          <LiveFeed items={latest} />
        ) : (
          <div className="flex min-h-[92px] flex-col items-center justify-center text-center">
            <MoxFace mood={state.autoReply ? "happy" : "sleep"} size={32} />
            <p className="mt-1.5 text-[12px] text-muted-foreground">
              {state.autoReply ? "Waiting for the first comment" : "Turn on Auto-reply"}
            </p>
          </div>
        )}
      </div>
      <CardArrow className="absolute bottom-5 left-5 hidden @xl:inline-flex" />
    </button>
  );
}
