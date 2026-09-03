"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  Loader2,
  Sparkles,
  Workflow,
  Brain,
  Database,
  Rocket,
  type LucideIcon,
} from "@/components/ui/gemini-icons";

type Step = { id: string; label: string; icon: LucideIcon };

const DEFAULT_STEPS: Step[] = [
  { id: "route", label: "Routing prompt to the right agent", icon: Workflow },
  { id: "scan", label: "Scanning your site & signals", icon: Database },
  { id: "reason", label: "Reasoning across models", icon: Brain },
  { id: "draft", label: "Drafting the response", icon: Sparkles },
  { id: "ready", label: "Preparing actions for approval", icon: Rocket },
];

/**
 * Live "what's happening right now" trail.
 * Walks through the platform's pipeline steps while the assistant is working,
 * so the user sees concrete progress instead of a blank pause.
 */
export function ThinkingTrail({
  steps = DEFAULT_STEPS,
  site,
}: {
  steps?: Step[];
  site?: string | null;
}) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setIdx((i) => Math.min(i + 1, steps.length - 1));
    }, 1100);
    return () => clearInterval(t);
  }, [steps.length]);

  return (
    <div className="flex gap-3 animate-slide-up">
      <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-border bg-card">
        <span className="relative flex h-3.5 w-3.5">
          <span
            className="absolute inset-0 animate-ping rounded-full opacity-60"
            style={{ background: "hsl(var(--aura-purple))" }}
          />
          <span
            className="relative h-3.5 w-3.5 rounded-full"
            style={{
              background:
                "linear-gradient(135deg, hsl(var(--aura-purple)), hsl(var(--aura-indigo)))",
            }}
          />
        </span>
      </div>

      <div className="max-w-[85%] flex-1 rounded-2xl rounded-bl-sm border border-border bg-card/80 px-3.5 py-2.5 backdrop-blur">
        <div className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin text-aura" />
          Working
          {site ? (
            <span className="normal-case tracking-normal text-foreground/80">
              · {site.replace(/^https?:\/\//, "")}
            </span>
          ) : null}
        </div>

        <ul className="space-y-1">
          {steps.map((s, i) => {
            const state = i < idx ? "done" : i === idx ? "active" : "pending";
            const Icon = s.icon;
            return (
              <motion.li
                key={s.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: state === "pending" ? 0.4 : 1, x: 0 }}
                transition={{ duration: 0.25, delay: i * 0.04 }}
                className="flex items-center gap-2 text-[12px]"
              >
                <span className="grid h-4 w-4 shrink-0 place-items-center">
                  <AnimatePresence mode="wait" initial={false}>
                    {state === "done" ? (
                      <motion.span
                        key="d"
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="grid h-4 w-4 place-items-center rounded-full"
                        style={{
                          background:
                            "linear-gradient(135deg, hsl(var(--aura-purple)), hsl(var(--aura-indigo)))",
                        }}
                      >
                        <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
                      </motion.span>
                    ) : state === "active" ? (
                      <motion.span
                        key="a"
                        initial={{ scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ opacity: 0 }}
                      >
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-aura" />
                      </motion.span>
                    ) : (
                      <motion.span
                        key="p"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                      >
                        <Icon className="h-3 w-3 text-muted-foreground" strokeWidth={1.75} />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </span>
                <span
                  className={
                    state === "done"
                      ? "text-muted-foreground line-through decoration-border"
                      : state === "active"
                        ? "text-foreground"
                        : "text-muted-foreground"
                  }
                >
                  {s.label}
                </span>
              </motion.li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
