"use client";

import { motion } from "framer-motion";
import { ArrowUpRight, Lightbulb } from "@/components/ui/gemini-icons";
import { BrandLogo, type BrandKey } from "@/components/brand/BrandLogo";
import { useEffect, useState } from "react";
import { useServerFn } from "@/lib/use-server-fn";
import { suggestNextSteps } from "@/lib/content.functions";

export interface NextStep {
  label: string;
  prompt: string;
  brand?: BrandKey;
  agent?: string; // e.g. "ads", "seo"
}

interface Props {
  lastUserMessage?: string;
  onPick: (prompt: string) => void;
  workspaceId?: string | null;
  brandContext?: string;
}

/**
 * Lovable-style "what to do next" chips that appear after each AI reply.
 * Suggestions are derived from the user's most recent prompt so they feel
 * contextual rather than canned.
 */
export function NextStepSuggestions({
  lastUserMessage = "",
  onPick,
  workspaceId,
  brandContext,
}: Props) {
  const suggest = useServerFn(suggestNextSteps);
  const [live, setLive] = useState<NextStep[] | null>(null);

  useEffect(() => {
    if (!workspaceId) {
      setLive(null);
      return;
    }
    let cancelled = false;
    setLive(null);
    suggest({ data: { workspaceId, context: brandContext, lastUserMessage } })
      .then((res) => {
        if (!cancelled && res?.steps?.length) setLive(res.steps);
      })
      .catch(() => {
        if (!cancelled) setLive(null);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, brandContext, lastUserMessage, suggest]);

  const text = lastUserMessage.toLowerCase();
  const steps = live && live.length > 0 ? live : pickSteps(text);
  if (steps.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.15 }}
      className="ml-10 mt-1"
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <Lightbulb className="h-3 w-3 text-aura" />
        What's next
      </div>
      <div className="flex flex-wrap gap-1.5">
        {steps.map((s, i) => (
          <motion.button
            key={s.label}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.05 * i, duration: 0.2 }}
            onClick={() => onPick(s.prompt)}
            className="group inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-left text-[11.5px] font-medium text-foreground transition hover:-translate-y-0.5 hover:border-foreground/25 hover:bg-secondary/60"
          >
            {s.brand ? (
              <BrandLogo name={s.brand} brand size={12} />
            ) : (
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: "hsl(var(--aura-indigo))" }}
              />
            )}
            <span className="truncate">{s.label}</span>
            <ArrowUpRight className="h-3 w-3 -translate-x-0.5 text-muted-foreground transition group-hover:translate-x-0 group-hover:text-foreground" />
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}

function pickSteps(t: string): NextStep[] {
  // Intent-aware fallbacks. Order matters: most specific first.
  if (/(seo|aeo|geo|rank|keyword|serp|audit|visibility)/.test(t)) {
    return [
      { label: "Audit my homepage", prompt: "Run a full SEO + AEO audit of my homepage" },
      {
        label: "Find ranking opportunities",
        prompt: "Find top 10 keyword opportunities I'm almost ranking for",
      },
      { label: "Fix on-page issues", prompt: "List the on-page SEO issues I should fix this week" },
    ];
  }
  if (/(reddit|quora|community|thread|comment)/.test(t)) {
    return [
      {
        label: "Find hot Reddit threads",
        prompt: "Find 5 hot Reddit threads in my niche to reply to",
        brand: "reddit",
      },
      {
        label: "Draft Quora answers",
        prompt: "Draft 3 Quora answers linking to my site",
        brand: "quora",
      },
      { label: "Schedule replies", prompt: "Schedule these replies across this week" },
    ];
  }
  if (/(post|social|linkedin|instagram|twitter|x\b)/.test(t)) {
    return [
      {
        label: "Plan this week's posts",
        prompt: "Plan 5 LinkedIn posts for this week",
        brand: "linkedin",
      },
      {
        label: "Repurpose for Instagram",
        prompt: "Repurpose my top post for Instagram carousel",
        brand: "instagram",
      },
      { label: "Schedule across channels", prompt: "Schedule these posts across all my channels" },
    ];
  }
  if (/(content|blog|article|write)/.test(t)) {
    return [
      {
        label: "Outline a blog post",
        prompt: "Outline a blog post on this topic targeting our ICP",
      },
      {
        label: "Generate FAQ for AEO",
        prompt: "Generate an FAQ section optimized for answer engines",
      },
      { label: "Refresh an old article", prompt: "Refresh my lowest-performing article" },
    ];
  }
  // Default broad suggestions
  return [
    { label: "Audit my site", prompt: "Run a full visibility audit of my site (SEO + AEO + GEO)" },
    {
      label: "Draft this week's posts",
      prompt: "Plan and draft this week's LinkedIn and Instagram posts",
      brand: "linkedin",
      agent: "social",
    },
    { label: "Plan this week's content", prompt: "Plan this week's content and social posts" },
  ];
}
