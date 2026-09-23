"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle,
  Layers,
  Lightbulb,
  RefreshCw,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FORMATS, labelOf } from "@/lib/ugc/options";
import type { Concept, Script } from "@/lib/ugc/schemas";
import { cn } from "@/lib/utils";
import {
  CreatorSilhouette,
  itemVariants,
  listVariants,
  motionPreset,
  StepActions,
  StepHeader,
  ThinkingLoader,
} from "./ugc-ui";

const WRITING_STAGES = [
  "Studying your product…",
  "Finding angles…",
  "Writing hooks…",
  "Planning scenes…",
  "Checking every claim…",
];

export function ConceptsWriting() {
  return (
    <div className="space-y-2">
      <ThinkingLoader stages={WRITING_STAGES} icon={Lightbulb} intervalMs={7000} />
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.12, duration: 0.4 }}
            className="ds-tile space-y-3 p-3"
          >
            <Skeleton className="h-44 w-full rounded-2xl" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-8 w-full rounded-full" />
            <Skeleton className="h-8 w-full rounded-full" />
          </motion.div>
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
  productImage,
  busy,
  onBack,
  onRegenerate,
  onChoose,
}: {
  concepts: Concept[];
  selectedConceptId: string | null;
  productImage?: string | null;
  busy: boolean;
  onBack: () => void;
  onRegenerate: () => void;
  onChoose: (concept: Concept, hook: string) => void;
}) {
  const reduce = useReducedMotion();
  const [hooks, setHooks] = useState<Record<string, string>>({});

  if (busy) return <ConceptsWriting />;

  return (
    <div className="space-y-5">
      <StepHeader
        icon={Lightbulb}
        title="Pick an idea"
        action={
          <Button variant="outline" size="sm" onClick={onRegenerate}>
            <RefreshCw aria-hidden /> New ideas
          </Button>
        }
      />

      <motion.ul
        initial={reduce ? false : "hidden"}
        animate="show"
        variants={listVariants}
        className="grid gap-4 md:grid-cols-3"
      >
        {concepts.map((concept) => (
          <motion.li key={concept.id} variants={reduce ? undefined : itemVariants}>
            <ConceptCard
              concept={concept}
              selected={concept.id === selectedConceptId}
              hook={hooks[concept.id] ?? concept.script.hook}
              productImage={productImage ?? null}
              onHook={(h) => setHooks((s) => ({ ...s, [concept.id]: h }))}
              onChoose={(h) => onChoose(concept, h)}
            />
          </motion.li>
        ))}
      </motion.ul>

      <StepActions>
        <Button variant="ghost" onClick={onBack} className="mr-auto">
          Back
        </Button>
      </StepActions>
    </div>
  );
}

function ConceptCard({
  concept,
  selected,
  hook,
  productImage,
  onHook,
  onChoose,
}: {
  concept: Concept;
  selected: boolean;
  hook: string;
  productImage: string | null;
  onHook: (hook: string) => void;
  onChoose: (hook: string) => void;
}) {
  const reduce = useReducedMotion();
  const [why, setWhy] = useState(false);
  const scenes = concept.script.scenes.length;
  // Offer the script's own hook alongside the alternatives, without repeats.
  const hookOptions = Array.from(new Set([concept.script.hook, ...concept.hooks])).slice(0, 4);

  return (
    <motion.div
      whileHover={reduce ? undefined : { y: -3 }}
      transition={motionPreset.base}
      className={cn(
        "ds-tile flex h-full flex-col gap-3 p-3 transition-[border-color,box-shadow]",
        selected
          ? "border-primary/70 shadow-[0_16px_40px_-22px_hsl(var(--primary)/0.9)]"
          : "hover:border-[var(--ds-tile-border-hover)]",
      )}
    >
      {/* Story preview */}
      <div className="relative h-44 overflow-hidden rounded-2xl bg-neutral-900 text-white">
        {productImage ? (
          <img
            src={productImage}
            alt=""
            referrerPolicy="no-referrer"
            className="absolute inset-0 size-full! scale-110 object-cover opacity-40 blur-[2px]"
          />
        ) : null}
        <div className="absolute inset-0 bg-[radial-gradient(90%_70%_at_50%_0%,hsl(var(--primary)/0.35),transparent_65%)]" />
        <div className="absolute inset-x-[30%] bottom-0 top-6">
          <CreatorSilhouette />
        </div>
        <div className="absolute inset-x-2.5 top-2 flex gap-1" aria-hidden>
          {Array.from({ length: scenes }).map((_, i) => (
            <span key={i} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/25">
              {i === 0 ? (
                <motion.span
                  className="block h-full bg-white"
                  initial={{ width: "0%" }}
                  animate={{ width: "100%" }}
                  transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                />
              ) : null}
            </span>
          ))}
        </div>
        <span className="absolute left-2.5 top-4 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
          {labelOf(FORMATS, concept.format)}
        </span>
        {selected ? (
          <span className="absolute right-2.5 top-4 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
            <Check className="size-3" aria-label="Selected" />
          </span>
        ) : null}
        <div className="absolute inset-x-3 bottom-3">
          <AnimatePresence mode="wait">
            <motion.p
              key={hook}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={motionPreset.medium}
              className="rounded-lg bg-black/70 px-2 py-1.5 text-center text-[12.5px] font-semibold leading-snug backdrop-blur"
            >
              {hook}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>

      <div className="space-y-1 px-1">
        <h4 className="text-sm font-semibold leading-snug">{concept.title}</h4>
        {concept.angle ? (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {concept.angle}
          </p>
        ) : null}
      </div>

      <div role="radiogroup" aria-label="Opening line" className="space-y-1.5">
        {hookOptions.map((h) => {
          const on = h === hook;
          return (
            <button
              key={h}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onHook(h)}
              className={cn(
                "flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left text-[12px] leading-snug transition-colors",
                on
                  ? "bg-primary/12 text-foreground ring-1 ring-primary/60"
                  : "bg-[var(--ds-well-bg)] text-muted-foreground hover:bg-[var(--ds-well-bg-hover)] hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 grid size-3.5 shrink-0 place-items-center rounded-full border",
                  on ? "border-primary bg-primary" : "border-muted-foreground/50",
                )}
                aria-hidden
              >
                {on ? <span className="size-1.5 rounded-full bg-primary-foreground" /> : null}
              </span>
              <span className="line-clamp-2">{h}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1" title="Scenes">
          <Layers className="size-3.5" aria-hidden /> {scenes}
        </span>
        <span className="inline-flex items-center gap-1" title="Facts used">
          <CheckCircle className="size-3.5 text-primary" aria-hidden />{" "}
          {concept.script.factIds.length}
        </span>
        {concept.warnings.length ? (
          <span
            className="inline-flex items-center gap-1 text-warning"
            title={concept.warnings.slice(0, 3).join("\n")}
          >
            <AlertTriangle className="size-3.5" aria-hidden /> {concept.warnings.length}
          </span>
        ) : null}
        {concept.whyItWorks ? (
          <button
            type="button"
            aria-expanded={why}
            onClick={() => setWhy((v) => !v)}
            className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 transition-colors hover:bg-[var(--ds-well-bg)] hover:text-foreground"
          >
            <Lightbulb className="size-3.5" aria-hidden /> Why
          </button>
        ) : null}
      </div>
      <AnimatePresence initial={false}>
        {why ? (
          <motion.p
            key="why"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={motionPreset.medium}
            className="overflow-hidden px-1 text-[11.5px] leading-relaxed text-muted-foreground"
          >
            {concept.whyItWorks}
          </motion.p>
        ) : null}
      </AnimatePresence>

      <Button
        className="mt-auto w-full"
        variant={selected ? "default" : "outline"}
        onClick={() => onChoose(hook)}
      >
        {selected ? "Continue" : "Use this"} <ArrowRight aria-hidden />
      </Button>
    </motion.div>
  );
}
