"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  CalendarDays,
  Globe,
  Image as ImageIcon,
  Radio,
  Wand2,
  type LucideIcon,
} from "@/components/icons";
import { Logo } from "@/components/brand/Logo";

export type Starter = {
  label: string;
  icon: LucideIcon;
  /** Sent as-is. */
  prompt?: string;
  /** Put in the message box for the user to finish. */
  prefill?: string;
};

export const STARTERS: Starter[] = [
  { label: "Write a post", icon: Wand2, prefill: "Create a LinkedIn post about " },
  { label: "Make an image", icon: ImageIcon, prefill: "Create an Instagram image of " },
  {
    label: "Plan my month",
    icon: CalendarDays,
    prompt: "Build a 30-day marketing plan for my business with the highest-impact actions.",
  },
  {
    label: "Check AI search",
    icon: Globe,
    prompt:
      "How visible is my brand in AI search like ChatGPT, Gemini and Perplexity, and what should I fix first?",
  },
  {
    label: "Study competitors",
    icon: Radio,
    prompt: "Analyze my competitors and tell me where we can win.",
  },
];

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

export function ChatStarters({
  onPick,
  reducedMotion,
}: {
  onPick: (s: Starter) => void;
  reducedMotion: boolean;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-2 px-2" aria-label="Ideas to start with">
      {STARTERS.map((s, i) => {
        const Icon = s.icon;
        return (
          <motion.button
            key={s.label}
            type="button"
            initial={reducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18 + i * 0.05, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            whileTap={{ scale: 0.96 }}
            onClick={() => onPick(s)}
            className="mx-starter group"
          >
            <Icon className="size-4 text-muted-foreground transition-colors group-hover:text-primary" />
            {s.label}
          </motion.button>
        );
      })}
    </div>
  );
}
