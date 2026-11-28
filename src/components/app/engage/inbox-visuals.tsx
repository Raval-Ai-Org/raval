"use client";
// The pictures the Inbox is read by (Holo / Autopilot style: more picture,
// fewer words). Presentational; nothing here starts work.
//   InboxFlow     comment arrives → Mox → reply sent, with the live counts
//   ChannelChips  Facebook, Instagram and DMs, a dot each; a tap says the fix
//   ConnectFlow   the first screen: three steps and one Connect pill
import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Check, MessageCircle, Send, Sparkles, X } from "@/components/icons";
import { PlatformAppIcon } from "@/components/brand/PlatformAppIcon";
import { MoxFace, type MoxMood } from "@/components/brand/mox/MoxFace";
import { Mox } from "@/components/brand/mox/Mox";
import { Switch } from "@/components/ui/switch";
import { dsFocus } from "@/components/app/surface/buttons";
import type { HealthItem } from "@/lib/engage/health";
import type { CustomerVoice } from "@/lib/engage/customer-voice";

const EASE = [0.22, 1, 0.36, 1] as const;

/** The soft Mox wash behind a hero card (lime bottom-left, teal top-right). */
const WASH = {
  backgroundImage:
    "radial-gradient(60% 80% at 0% 100%, rgb(217 245 58 / 0.22), transparent 60%), radial-gradient(55% 70% at 100% 0%, rgb(31 214 196 / 0.18), transparent 62%)",
} as const;

/* ───────────────────────── the flow ───────────────────────── */

const SAMPLE_IN = ["Open today?", "Price? 💬", "Do you ship?", "Love this!"];
const SAMPLE_OUT = ["Yes, 9 to 9 ✨", "Sent you the link", "Across Pakistan 🚚", "Thank you! 💛"];

/** A bubble that travels in, then the answer travels out. Loops; still when motion is reduced. */
const bubble = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 24 ? `${t.slice(0, 23)}…` : t;
};

function Travelling({
  reduce,
  pairs,
}: {
  reduce: boolean;
  /** Real recent exchanges; samples until there are some. */
  pairs?: { said: string; reply: string }[];
}) {
  const real = pairs?.filter((p) => p.said.trim() && p.reply.trim()) ?? [];
  const IN = real.length ? real.map((p) => bubble(p.said)) : SAMPLE_IN;
  const OUT = real.length ? real.map((p) => bubble(p.reply)) : SAMPLE_OUT;
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setI((n) => (n + 1) % IN.length), 3200);
    return () => clearInterval(t);
  }, [reduce, IN.length]);
  if (reduce) return null;
  const k = i % IN.length;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-[26px] h-0">
      <AnimatePresence>
        <motion.span
          key={`in-${i}`}
          initial={{ left: "12%", opacity: 0, scale: 0.8 }}
          animate={{ left: ["12%", "40%"], opacity: [0, 1, 1, 0], scale: [0.8, 1, 1, 0.7] }}
          transition={{ duration: 1.4, ease: EASE }}
          className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full rounded-bl-sm bg-[var(--ds-card-bg)] px-2.5 py-1 text-[11px] font-semibold shadow-[var(--ds-card-shadow-hover)]"
        >
          {IN[k]}
        </motion.span>
        <motion.span
          key={`out-${i}`}
          initial={{ left: "60%", opacity: 0, scale: 0.8 }}
          animate={{ left: ["60%", "88%"], opacity: [0, 1, 1, 0], scale: [0.8, 1, 1, 0.8] }}
          transition={{ duration: 1.4, delay: 1.5, ease: EASE }}
          className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full rounded-br-sm px-2.5 py-1 text-[11px] font-bold shadow-[var(--ds-card-shadow-hover)]"
          style={{ backgroundImage: "var(--mox-gradient)", color: "var(--mox-ink)" }}
        >
          {OUT[k]}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

function Node({
  children,
  count,
  label,
  glow,
  onClick,
}: {
  children: ReactNode;
  count?: number;
  label: string;
  glow?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span
        className={cn(
          "relative grid size-[52px] place-items-center rounded-[18px] bg-[var(--ds-card-bg)] shadow-[var(--ds-card-shadow)]",
          glow && "ring-2 ring-[var(--mox-yellow,#f5d547)] ring-offset-2 ring-offset-transparent",
        )}
      >
        {children}
        {count !== undefined && count > 0 && (
          <motion.span
            key={count}
            initial={{ scale: 0.4 }}
            animate={{ scale: 1 }}
            className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-foreground px-1 text-[10.5px] font-bold tabular-nums text-background"
          >
            {count > 99 ? "99+" : count}
          </motion.span>
        )}
      </span>
      <span className="mt-1.5 text-[11.5px] font-semibold text-muted-foreground">{label}</span>
    </>
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={cn("z-10 flex flex-col items-center rounded-2xl p-1", dsFocus)}
    >
      {body}
    </button>
  ) : (
    <div className="z-10 flex flex-col items-center p-1">{body}</div>
  );
}

/**
 * The whole Inbox in one picture: what came in, Mox in the middle, what went
 * out. The counts are the stored ones; the moving bubbles are decoration.
 */
export function InboxFlow({
  waiting,
  answered,
  auto,
  autoReply,
  asking,
  canEdit,
  switching,
  onAutoReply,
  onWaiting,
  onAnswered,
  pairs,
}: {
  /** The latest real comment → reply pairs, for the moving bubbles. */
  pairs?: { said: string; reply: string }[];
  waiting: number;
  answered: number;
  auto: number;
  autoReply: boolean;
  asking: number;
  canEdit: boolean;
  switching: boolean;
  onAutoReply: (on: boolean) => void;
  onWaiting: () => void;
  onAnswered: () => void;
}) {
  const reduce = useReducedMotion() ?? false;
  const mood: MoxMood = !autoReply ? "sleep" : asking ? "thinking" : "happy";
  return (
    <div
      className="relative overflow-hidden rounded-[28px] border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] p-5 shadow-[var(--ds-card-shadow)]"
      data-testid="inbox-flow"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-60" style={WASH} />
      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[22px] font-bold leading-tight tracking-[-0.025em]">
          {autoReply ? (
            <>
              Mox is <span className="ds-grad-text">answering</span>
            </>
          ) : (
            <>
              Mox is <span className="text-muted-foreground">resting</span>
            </>
          )}
        </h2>
        {canEdit && (
          <label
            className={cn(
              "inline-flex h-10 cursor-pointer items-center gap-2.5 rounded-full px-4 text-[13px] font-bold shadow-[var(--ds-card-shadow)] transition-colors",
              autoReply ? "studio-cta" : "bg-[var(--ds-well-bg)] text-foreground",
              switching && "opacity-60",
            )}
            data-testid="inbox-auto-reply"
          >
            <Switch
              checked={autoReply}
              disabled={switching}
              onCheckedChange={onAutoReply}
              aria-label="Auto-reply"
            />
            Auto-reply
          </label>
        )}
      </div>

      <div className="relative mt-6 grid grid-cols-3 items-start">
        {/* the track behind the three nodes */}
        <div
          aria-hidden
          className="absolute left-[16.6%] right-[16.6%] top-[30px] h-[3px] rounded-full bg-foreground/[0.07]"
        >
          <motion.div
            className="ds-grad-bar h-full rounded-full"
            initial={reduce ? false : { width: 0 }}
            animate={{ width: autoReply ? "100%" : "50%" }}
            transition={{ duration: 0.9, ease: EASE }}
          />
        </div>
        {autoReply && !reduce && (
          // a soft light that keeps running along the track while Mox works
          <motion.span
            aria-hidden
            className="pointer-events-none absolute top-[24px] h-[15px] w-16 rounded-full blur-md"
            style={{ backgroundImage: "var(--mox-gradient)" }}
            initial={{ left: "14%", opacity: 0 }}
            animate={{ left: ["14%", "80%"], opacity: [0, 0.7, 0] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        {autoReply && <Travelling reduce={reduce} pairs={pairs} />}

        <div className="flex justify-center">
          <Node count={waiting} label="Needs you" glow={waiting > 0} onClick={onWaiting}>
            <span className="flex -space-x-2">
              <PlatformAppIcon platform="facebook" size={22} />
              <PlatformAppIcon platform="instagram" size={22} />
            </span>
          </Node>
        </div>
        <div className="flex justify-center">
          <Node label={asking ? `${asking} to teach` : "Mox"} glow={asking > 0}>
            <span className={cn(autoReply && !reduce && "mox-float")}>
              <MoxFace mood={mood} size={40} track />
            </span>
          </Node>
        </div>
        <div className="flex justify-center">
          <Node count={answered} label="Answered" onClick={onAnswered}>
            <Send className="size-5 text-foreground/80" />
          </Node>
        </div>
      </div>

      {auto > 0 && (
        <p className="relative mt-4 text-center text-[12px] font-semibold text-muted-foreground">
          <Sparkles className="mr-1 inline size-3.5 align-[-2px]" />
          {auto} answered by Mox
        </p>
      )}
    </div>
  );
}

/* ───────────────────────── channels ───────────────────────── */

const DOT: Record<HealthItem["state"], string> = {
  ok: "bg-success",
  warn: "bg-warning",
  off: "bg-muted-foreground/40",
};

const CHIP_LABEL: Partial<Record<HealthItem["id"], string>> = {
  facebook: "Facebook",
  instagram: "Instagram",
  messages: "DMs",
};

/** Facebook, Instagram and DMs as three chips; a tap opens the one fix. */
export function ChannelChips({
  items,
  canEdit,
  waitingForMeta,
  onConnect,
  onDisconnect,
  checked,
}: {
  items: HealthItem[];
  canEdit: boolean;
  waitingForMeta: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  checked: string | null;
}) {
  const chips = items.filter((i) => CHIP_LABEL[i.id]);
  const [open, setOpen] = useState<HealthItem["id"] | null>(
    chips.find((c) => c.state !== "ok")?.id ?? null,
  );
  const shown = chips.find((c) => c.id === open) ?? null;
  return (
    <div className="space-y-2" data-testid="inbox-setup-check">
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-expanded={open === c.id}
            onClick={() => setOpen(open === c.id ? null : c.id)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold transition-colors",
              dsFocus,
              open === c.id
                ? "border-transparent bg-[var(--ds-card-bg)] shadow-[var(--ds-card-shadow)]"
                : "border-[var(--ds-card-border)] text-foreground/80 hover:bg-[var(--ds-well-bg)]",
            )}
          >
            {c.id === "messages" ? (
              <MessageCircle className="size-3.5" />
            ) : (
              <PlatformAppIcon platform={c.id as "facebook" | "instagram"} size={16} />
            )}
            {CHIP_LABEL[c.id]}
            <span className={cn("size-2 rounded-full", DOT[c.state])} aria-hidden />
          </button>
        ))}
        {checked && (
          <span className="ml-1 text-[11.5px] text-muted-foreground">Checked {checked}</span>
        )}
      </div>
      <AnimatePresence initial={false}>
        {shown && (
          <motion.div
            key={shown.id}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: EASE }}
            className={cn(
              "flex flex-wrap items-center gap-3 rounded-[18px] px-4 py-3",
              shown.state === "ok" ? "bg-[var(--ds-well-bg)]" : "bg-[var(--mox-yellow)]/25",
            )}
          >
            <span
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-full",
                shown.state === "ok" ? "bg-success/15 text-success" : "bg-foreground/10",
              )}
            >
              {shown.state === "ok" ? <Check className="size-3.5" /> : <X className="size-3.5" />}
            </span>
            <p className="min-w-0 flex-1 text-[12.5px] leading-snug">
              <b className="font-semibold">{shown.title}.</b>{" "}
              <span className="text-muted-foreground">{shown.detail}</span>
            </p>
            {canEdit &&
              (shown.reconnect && shown.state !== "ok" ? (
                <button
                  type="button"
                  onClick={onConnect}
                  disabled={waitingForMeta}
                  className="studio-cta inline-flex h-8 items-center rounded-full px-4 text-[12.5px] font-bold disabled:opacity-60"
                >
                  {waitingForMeta ? "Waiting…" : "Fix"}
                </button>
              ) : shown.id === "facebook" ? (
                <button
                  type="button"
                  onClick={onDisconnect}
                  className="text-[12px] font-semibold text-muted-foreground hover:text-destructive"
                >
                  Disconnect
                </button>
              ) : null)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ───────────────────────── first screen ───────────────────────── */

const CONNECT_STEPS = [
  { id: "connect", label: "Connect", line: "Facebook + Instagram" },
  { id: "teach", label: "Teach", line: "Mox asks once" },
  { id: "relax", label: "Relax", line: "Replies in minutes" },
] as const;

/** Nothing connected yet: Mox, three steps as pictures and one pill. */
export function ConnectFlow({
  configured,
  canEdit,
  waiting,
  onConnect,
}: {
  configured: boolean;
  canEdit: boolean;
  waiting: boolean;
  onConnect: () => void;
}) {
  const reduce = useReducedMotion() ?? false;
  return (
    <div
      className="relative mx-auto flex max-w-[760px] flex-col items-center overflow-hidden rounded-[32px] border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] px-6 pb-8 pt-8 text-center shadow-[var(--ds-card-shadow)]"
      data-testid="inbox-connect"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-70" style={WASH} />
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 10, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: EASE }}
        className={cn("relative", !reduce && "mox-float")}
      >
        <Mox pose="wave" size={132} alt="" shadow />
      </motion.div>
      <h2 className="relative mt-3 text-[28px] font-bold leading-tight tracking-[-0.03em] sm:text-[32px]">
        Every comment and DM, <span className="ds-grad-text">answered</span>
      </h2>

      <ol className="relative mt-7 grid w-full grid-cols-3 gap-2.5">
        {CONNECT_STEPS.map((s, i) => (
          <motion.li
            key={s.id}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.1, duration: 0.4, ease: EASE }}
            className="flex flex-col items-center rounded-[22px] bg-[var(--ds-well-bg)] px-2 py-4"
          >
            <span className="grid size-12 place-items-center rounded-2xl bg-[var(--ds-card-bg)] shadow-[var(--ds-card-shadow)]">
              {s.id === "connect" ? (
                <span className="flex -space-x-2">
                  <PlatformAppIcon platform="facebook" size={22} />
                  <PlatformAppIcon platform="instagram" size={22} />
                </span>
              ) : s.id === "teach" ? (
                <MoxFace mood="thinking" size={34} />
              ) : (
                <Send className="size-5 text-foreground/80" />
              )}
            </span>
            <span className="mt-2.5 text-[13.5px] font-bold">
              <span className="tabular-nums text-muted-foreground">{i + 1}.</span> {s.label}
            </span>
            <span className="mt-0.5 text-[11.5px] text-muted-foreground">{s.line}</span>
          </motion.li>
        ))}
      </ol>

      {configured ? (
        canEdit && (
          <button
            type="button"
            onClick={onConnect}
            disabled={waiting}
            className="studio-cta relative mt-7 inline-flex h-12 items-center gap-2 rounded-full px-7 text-[15px] font-bold shadow-[var(--ds-card-shadow-hover)] disabled:opacity-60"
            data-testid="inbox-connect-button"
          >
            {waiting ? "Waiting for Meta…" : "Connect"}
          </button>
        )
      ) : (
        <p className="relative mt-6 text-[13px] text-muted-foreground">
          Not set up on this server yet.
        </p>
      )}
      <p className="relative mt-3 text-[11.5px] text-muted-foreground">
        Instagram must be a Professional account linked to your Facebook Page.
      </p>
    </div>
  );
}

/* ───────────────────────── what customers ask ───────────────────────── */

/**
 * The customer brain, from the brand's own comments and DMs: the questions
 * people ask most and where they get stuck. "Post about it" opens Studio with
 * a brief (nothing is made until Generate). Studio and Autopilot read the
 * same list on the server (customer-voice.ts).
 */
export function CustomerVoiceTile({
  voice,
  onPost,
}: {
  voice: CustomerVoice | null | undefined;
  onPost?: (brief: string) => void;
}) {
  const reduce = useReducedMotion();
  if (!voice || (!voice.asked.length && !voice.confused.length)) return null;
  const top = Math.max(1, ...voice.asked.map((q) => q.count));
  const brief = (q: string, answer: string | null) =>
    answer
      ? `A post that answers what our customers keep asking: "${q}" Our answer: ${answer}`
      : `A post about what our customers keep asking: "${q}" Don't state an answer we haven't given; invite them to message us.`;
  return (
    <div
      className="relative overflow-hidden rounded-[24px] border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] p-4 shadow-[var(--ds-card-shadow)]"
      data-testid="inbox-customer-voice"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-50" style={WASH} />
      <div className="relative flex items-center gap-2">
        <span className="ds-grad-pill grid size-8 place-items-center rounded-full text-[var(--mox-ink)]">
          <MessageCircle className="size-4" />
        </span>
        <p className="text-[14px] font-bold">What customers ask</p>
        <span className="ml-auto text-[11px] text-muted-foreground">
          from {voice.read} comment{voice.read === 1 ? "" : "s"} and DMs
        </span>
      </div>
      <ul className="relative mt-3 space-y-2">
        {voice.asked.map((q, n) => (
          <motion.li
            key={q.question}
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: n * 0.05, duration: 0.3, ease: EASE }}
            className="group flex items-center gap-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-[13px] font-semibold">{q.question}</span>
                {q.answer && (
                  <Check className="size-3.5 shrink-0 text-emerald-600" aria-label="Answered" />
                )}
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-foreground/[0.06]">
                <motion.div
                  className="ds-grad-bar h-full rounded-full"
                  initial={reduce ? false : { width: 0 }}
                  animate={{ width: `${Math.max(8, (q.count / top) * 100)}%` }}
                  transition={{ delay: 0.1 + n * 0.05, duration: 0.7, ease: EASE }}
                />
              </div>
            </div>
            <span className="w-7 shrink-0 text-right text-[12px] font-bold tabular-nums">
              {q.count}
            </span>
            {onPost && (
              <button
                type="button"
                onClick={() => onPost(brief(q.question, q.answer))}
                className={cn(
                  "h-7 shrink-0 rounded-full bg-[var(--ds-well-bg)] px-2.5 text-[11.5px] font-semibold transition-colors hover:bg-foreground hover:text-background",
                  dsFocus,
                )}
              >
                Post about it
              </button>
            )}
          </motion.li>
        ))}
      </ul>
      {voice.confused.length > 0 && (
        <div className="relative mt-3 flex flex-wrap gap-1.5">
          {voice.confused.map((c) => (
            <span
              key={c}
              className="max-w-full truncate rounded-full bg-[var(--mox-yellow,#f5d547)]/20 px-2.5 py-1 text-[11.5px]"
              title="People seem unsure about this"
            >
              <span className="mr-1 font-bold">?</span>
              {c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
