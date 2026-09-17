"use client";

// Buttons under a reply for the things Mellox offered to open or start.
// Nothing here runs until it is clicked — the chat never opens a window over
// the conversation by itself.
import { useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  Brain,
  CalendarDays,
  Check,
  Globe,
  Radio,
  Sparkles,
  Spinner,
  Users,
  Wand2,
  type LucideIcon,
} from "@/components/icons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { describeOffer, type ChatToolCall, type ChatToolResult } from "@/lib/chat-tools";
import { runChatAction, type ChatAction } from "@/lib/chat-actions";

const OFFER_ICON: Partial<Record<ChatToolCall["kind"], LucideIcon>> = {
  "open-studio": Wand2,
  "open-memory": Brain,
  "open-calendar": CalendarDays,
  "open-clients": Users,
  "open-visibility": Globe,
  "open-competitor": Radio,
  "open-coach": Sparkles,
  "open-operations": Activity,
};

const ACTION_ICON: Record<ChatAction["kind"], LucideIcon> = {
  audit: Globe,
  studio: Wand2,
  memory: BookOpen,
  calendar: CalendarDays,
};

type OfferState = "idle" | "running" | "done";

export function ChatOffers({
  offers = [],
  actions = [],
  execute,
  onStudioStarted,
}: {
  offers?: ChatToolCall[];
  actions?: ChatAction[];
  execute: (call: ChatToolCall) => Promise<ChatToolResult>;
  onStudioStarted?: (result: ChatToolResult, call: ChatToolCall) => void;
}) {
  const [states, setStates] = useState<Record<string, OfferState>>({});
  if (!offers.length && !actions.length) return null;

  // Client-detected shortcuts that duplicate an offer are dropped.
  const offerKinds = new Set(offers.map((o) => o.kind));
  const extra = actions.filter(
    (a) =>
      !(a.kind === "memory" && offerKinds.has("open-memory")) &&
      !(a.kind === "calendar" && offerKinds.has("open-calendar")) &&
      !(a.kind === "studio" && offerKinds.has("open-studio")),
  );

  const run = async (key: string, call: ChatToolCall) => {
    setStates((s) => ({ ...s, [key]: "running" }));
    try {
      const r = await execute(call);
      if (!r.ok) toast.error(r.label, r.detail ? { description: r.detail } : undefined);
      if (r.ok && r.sessionId) onStudioStarted?.(r, call);
      setStates((s) => ({ ...s, [key]: r.ok && call.kind === "open-studio" ? "done" : "idle" }));
    } catch {
      setStates((s) => ({ ...s, [key]: "idle" }));
    }
  };

  let index = 0;
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Suggested next actions">
      {offers.map((call, i) => {
        const key = `offer-${i}`;
        const { label, hint } = describeOffer(call);
        const Icon = OFFER_ICON[call.kind] ?? ArrowUpRight;
        const state = states[key] ?? "idle";
        return (
          <OfferButton
            key={key}
            index={index++}
            icon={Icon}
            label={state === "done" ? "Started in Studio" : label}
            title={hint}
            state={state}
            primary={call.kind === "open-studio" && !!hint}
            onClick={() => void run(key, call)}
          />
        );
      })}
      {extra.map((a) => (
        <OfferButton
          key={a.label}
          index={index++}
          icon={ACTION_ICON[a.kind]}
          label={a.label}
          title={a.hint}
          state="idle"
          onClick={() => {
            const r = runChatAction(a);
            if (r.toast) toast.success(r.toast);
          }}
        />
      ))}
    </div>
  );
}

function OfferButton({
  icon: Icon,
  label,
  title,
  state,
  primary,
  index,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  title?: string;
  state: OfferState;
  primary?: boolean;
  index: number;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 + index * 0.05, duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      disabled={state !== "idle"}
      title={title}
      className={cn(
        "mx-offer group",
        primary && "mx-offer--primary",
        state === "done" && "is-done",
      )}
    >
      <span className="mx-offer__icon">
        {state === "running" ? (
          <Spinner className="size-3.5 animate-spin" />
        ) : state === "done" ? (
          <Check className="size-3.5" />
        ) : (
          <Icon className="size-3.5" />
        )}
      </span>
      <span className="truncate">{label}</span>
      {state === "idle" ? (
        <ArrowUpRight className="size-3.5 shrink-0 opacity-50 transition-[opacity,transform] group-hover:translate-x-px group-hover:-translate-y-px group-hover:opacity-100" />
      ) : null}
    </motion.button>
  );
}
