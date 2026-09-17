"use client";

import { motion } from "framer-motion";
import { ArrowRight, ArrowUpRight } from "@/components/icons";
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
 * Contextual "what to do next" chips that appear after each AI reply.
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
      transition={{ duration: 0.3, delay: 0.2 }}
      className="-mt-2 flex flex-col"
      aria-label="Follow-up ideas"
    >
      {steps.slice(0, 3).map((s, i) => (
        <motion.button
          key={s.label}
          type="button"
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.25 + 0.06 * i, duration: 0.22 }}
          onClick={() => onPick(s.prompt)}
          className="group flex w-full items-center gap-3 border-t border-border/60 py-2.5 text-left text-[14px] text-muted-foreground transition-colors first:border-t-0 hover:text-foreground"
        >
          {s.brand ? (
            <BrandLogo name={s.brand} brand size={14} />
          ) : (
            <ArrowRight className="size-4 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-primary" />
          )}
          <span className="min-w-0 flex-1 truncate">{s.label}</span>
          <ArrowUpRight className="size-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
        </motion.button>
      ))}
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
