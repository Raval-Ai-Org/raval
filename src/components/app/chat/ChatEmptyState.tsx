"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowUpRight,
  CalendarDays,
  Globe,
  Radio,
  Users,
  Wand2,
  X,
  type LucideIcon,
} from "@/components/icons";
import { Logo } from "@/components/brand/Logo";
import {
  buildStarters,
  starterFacts,
  type StarterGroupId,
  type StarterSource,
} from "@/lib/chat/starters";

export type Starter = {
  /** Sent as-is. */
  prompt?: string;
  /** Put in the message box for the user to finish. */
  prefill?: string;
};

const GROUP_ICON: Record<StarterGroupId, LucideIcon> = {
  create: Wand2,
  plan: CalendarDays,
  found: Globe,
  competitors: Radio,
  audience: Users,
};

function greetingFor(hour: number) {
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function ChatGreeting({
  name,
  brand,
  reducedMotion,
}: {
  name?: string | null;
  brand?: string | null;
  reducedMotion: boolean;
}) {
  // Time of day is read after mount so server and client render the same markup.
  const [greeting, setGreeting] = useState<string | null>(null);
  useEffect(() => setGreeting(greetingFor(new Date().getHours())), []);
  const first = name?.trim().split(/\s+/)[0];

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col items-center px-4 text-center"
    >
      <motion.span
        initial={reducedMotion ? false : { scale: 0.6, rotate: -30, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 220, damping: 16, delay: 0.05 }}
        className="mb-4 grid size-12 place-items-center"
      >
        <Logo height={40} markOnly />
      </motion.span>
      <h2 className="mx-greeting">
        <span className={greeting ? "opacity-100" : "opacity-0"}>
          {greeting ?? "Hello"}
          {first ? `, ${first}` : ""}
        </span>
      </h2>
      <p className="mt-2 text-[15px] text-muted-foreground">
        {brand ? `What should we do for ${brand} today?` : "What should we work on today?"}
      </p>
    </motion.div>
  );
}

// Topics under the message box. A topic opens a short list of things to ask,
// written from the brand's own details (no request is made to show them).
export function ChatStarters({
  source,
  onPick,
}: {
  source: StarterSource;
  onPick: (s: Starter) => void;
}) {
  const [open, setOpen] = useState<StarterGroupId | null>(null);
  // Read on click, so server and client render the same markup.
  const [day, setDay] = useState(0);
  const groups = useMemo(() => buildStarters(starterFacts(source), day), [source, day]);
  const listRef = useRef<HTMLUListElement>(null);
  const group = groups.find((g) => g.id === open);

  useEffect(() => {
    if (open) listRef.current?.querySelector("button")?.focus({ preventScroll: true });
  }, [open]);

  if (group) {
    const Icon = GROUP_ICON[group.id];
    return (
      <div
        className="mx-ideas"
        role="group"
        aria-label={`${group.label} ideas`}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(null);
        }}
      >
        <div className="mx-ideas__head">
          <Icon className="size-4 text-primary" />
          <span>{group.label}</span>
          <button
            type="button"
            className="mx-ideas__close"
            aria-label="Back to all topics"
            onClick={() => setOpen(null)}
          >
            <X className="size-4" />
          </button>
        </div>
        <ul ref={listRef}>
          {group.ideas.map((idea) => (
            <li key={idea.text}>
              <button
                type="button"
                className="mx-idea group"
                onClick={() => {
                  setOpen(null);
                  onPick(idea.run === "send" ? { prompt: idea.text } : { prefill: idea.text });
                }}
              >
                <span className="min-w-0 flex-1">
                  {idea.run === "send" ? idea.text : `${idea.text.trimEnd()}…`}
                </span>
                <ArrowUpRight className="size-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-60" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div
      className="mx-starters grid w-full max-w-[420px] grid-cols-2 gap-2 px-2 sm:flex sm:max-w-none sm:flex-wrap sm:justify-center"
      role="group"
      aria-label="Ideas to start with"
    >
      {groups.map((g) => {
        const Icon = GROUP_ICON[g.id];
        return (
          <button
            key={g.id}
            type="button"
            onClick={() => {
              setDay(Math.floor(Date.now() / 86_400_000));
              setOpen(g.id);
            }}
            className="mx-starter group min-w-0 justify-center last:col-span-2 sm:last:col-auto"
          >
            <Icon className="size-4 text-muted-foreground transition-colors group-hover:text-primary" />
            {g.label}
          </button>
        );
      })}
    </div>
  );
}
