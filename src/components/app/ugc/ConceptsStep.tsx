"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, Check, Loader2, RefreshCw } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FORMATS, labelOf } from "@/lib/ugc/options";
import type { Concept, Script } from "@/lib/ugc/schemas";
import { cn } from "@/lib/utils";
import { itemVariants, listVariants, Panel, StepActions } from "./ugc-ui";

const WRITING_STAGES = [
  "Studying the product facts…",
  "Finding angles for your audience…",
  "Writing scroll-stopping hooks…",
  "Blocking out scenes and dialogue…",
  "Checking every claim against your facts…",
];

export function ConceptsWriting() {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const id = window.setInterval(
      () => setStage((s) => Math.min(s + 1, WRITING_STAGES.length - 1)),
      7000,
    );
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm" aria-live="polite">
        <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
        {WRITING_STAGES[stage]}
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Panel key={i} className="space-y-3">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </Panel>
        ))}
      </div>
    </div>
  );
}

/** Apply a chosen hook: it becomes the script hook and, if scene 1 opened with the old hook, its opening line. */
export function applyHook(script: Script, hook: string): Script {
  const [first, ...rest] = script.scenes;
  if (!first) return { ...script, hook };
  const opensWithHook =
    !first.dialogue.trim() ||
    first.dialogue.trim().toLowerCase().startsWith(script.hook.trim().toLowerCase().slice(0, 24));
  return {
    ...script,
    hook,
    scenes: opensWithHook ? [{ ...first, dialogue: hook }, ...rest] : script.scenes,
  };
}

export function ConceptsStep({
  concepts,
  selectedConceptId,
  busy,
  onBack,
  onRegenerate,
  onChoose,
}: {
  concepts: Concept[];
  selectedConceptId: string | null;
  busy: boolean;
  onBack: () => void;
  onRegenerate: () => void;
  onChoose: (concept: Concept, hook: string) => void;
}) {
  const reduce = useReducedMotion();
  const [hooks, setHooks] = useState<Record<string, string>>({});

  if (busy) return <ConceptsWriting />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold tracking-tight">Pick a concept</h3>
          <p className="text-sm text-muted-foreground">
            Choose the angle and opening line. You'll fine-tune the script next.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onRegenerate}>
          <RefreshCw aria-hidden /> New concepts
        </Button>
      </div>

      <motion.ul
        initial={reduce ? false : "hidden"}
        animate="show"
        variants={listVariants}
        className="grid gap-3 md:grid-cols-3"
      >
        {concepts.map((concept) => {
          const selected = concept.id === selectedConceptId;
          const hook = hooks[concept.id] ?? concept.script.hook;
          return (
            <motion.li key={concept.id} variants={reduce ? undefined : itemVariants}>
              <Panel
                className={cn(
                  "flex h-full flex-col gap-3 transition-shadow",
                  selected && "ring-2 ring-primary/70",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-primary">
                      {labelOf(FORMATS, concept.format)}
                    </span>
                    <h4 className="mt-0.5 text-sm font-semibold leading-snug">{concept.title}</h4>
                  </div>
                  {selected ? (
                    <Check className="size-4 shrink-0 text-primary" aria-label="Selected" />
                  ) : null}
                </div>
                {concept.angle ? (
                  <p className="text-xs leading-relaxed text-muted-foreground">{concept.angle}</p>
                ) : null}

                <fieldset className="space-y-1.5">
                  <legend className="mb-1 text-[11px] font-medium text-foreground/80">
                    Opening hook
                  </legend>
                  {concept.hooks.map((h) => (
                    <label
                      key={h}
                      className={cn(
                        "flex cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2 text-[12.5px] leading-snug ring-1 transition-colors",
                        h === hook
                          ? "bg-primary/10 ring-primary/50"
                          : "bg-surface-3/40 ring-border/50 hover:bg-surface-3",
                      )}
                    >
                      <input
                        type="radio"
                        name={`hook-${concept.id}`}
                        checked={h === hook}
                        onChange={() => setHooks((s) => ({ ...s, [concept.id]: h }))}
                        className="mt-0.5 size-4 shrink-0 accent-[hsl(var(--primary))]"
                      />
                      <span>“{h}”</span>
                    </label>
                  ))}
                </fieldset>

                <div className="text-[11.5px] text-muted-foreground">
                  {concept.script.scenes.length} scenes · {concept.script.factIds.length} facts used
                </div>
                {concept.whyItWorks ? (
                  <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground/80">Why it works: </span>
                    {concept.whyItWorks}
                  </p>
                ) : null}
                {concept.warnings.length ? (
                  <ul className="space-y-1 rounded-lg bg-surface-3/60 p-2 text-[11px] text-muted-foreground">
                    {concept.warnings.slice(0, 3).map((w) => (
                      <li key={w} className="flex gap-1.5">
                        <AlertTriangle
                          className="mt-0.5 size-3 shrink-0 text-foreground/70"
                          aria-hidden
                        />
                        {w}
                      </li>
                    ))}
                  </ul>
                ) : null}

                <Button
                  className="mt-auto min-h-10 whitespace-normal text-center"
                  variant={selected ? "default" : "outline"}
                  onClick={() => onChoose(concept, hook)}
                >
                  {selected ? "Continue with this" : "Use this concept"}
                </Button>
              </Panel>
            </motion.li>
          );
        })}
      </motion.ul>

      <StepActions>
        <Button variant="ghost" onClick={onBack} className="mr-auto">
          Back to brief
        </Button>
      </StepActions>
    </div>
  );
}
