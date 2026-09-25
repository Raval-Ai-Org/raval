"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  CheckCircle,
  Tag,
  MessageCircle,
  Pause,
  Play,
  Plus,
  Send,
  Target,
  Trash2,
  Wand2,
  Zap,
  type LucideIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { checkScriptClaims } from "@/lib/ugc/grounding";
import { dialogueWordBudget, fitScenes, scriptWordCount } from "@/lib/ugc/prompt";
import type { Brief, Product, Scene, Script } from "@/lib/ugc/schemas";
import { cn } from "@/lib/utils";
import {
  CreatorSilhouette,
  Disclosure,
  Field,
  motionPreset,
  Panel,
  PhoneFrame,
  SectionLabel,
  StepActions,
} from "./ugc-ui";

const QUICK_REWRITES: { label: string; icon: LucideIcon; instruction: string }[] = [
  { label: "Punchier start", icon: Zap, instruction: "Make the opening more eye-catching" },
  {
    label: "More natural",
    icon: MessageCircle,
    instruction: "Shorter and more natural, like a real person talking",
  },
  { label: "More energy", icon: Zap, instruction: "More energetic" },
  { label: "Clearer demo", icon: Play, instruction: "Make the product demo clearer" },
  { label: "Stronger ending", icon: Target, instruction: "Make the call to action clearer" },
];

function sceneLabel(i: number, count: number) {
  return i === 0 ? "Hook" : i === count - 1 ? "Ending" : `Scene ${i + 1}`;
}

export function ScriptStep({
  initialScript,
  product,
  brief,
  durationSec,
  aspectRatio,
  productImage,
  rewriting,
  saving,
  onBack,
  onRewrite,
  onContinue,
}: {
  initialScript: Script;
  product: Product;
  brief: Brief;
  durationSec: number;
  aspectRatio: string;
  productImage?: string | null;
  rewriting: boolean;
  saving: boolean;
  onBack: (script: Script) => void;
  onRewrite: (script: Script, instruction: string) => void;
  onContinue: (script: Script) => void;
}) {
  const reduce = useReducedMotion();
  const [script, setScript] = useState<Script>(initialScript);
  const [instruction, setInstruction] = useState("");
  const [focus, setFocus] = useState(0);
  const [playing, setPlaying] = useState(false);

  const words = scriptWordCount(script, brief.language);
  const budget = dialogueWordBudget(durationSec);
  const warnings = useMemo(() => checkScriptClaims(script, product.facts), [script, product.facts]);
  const timed = useMemo(() => fitScenes(script.scenes, durationSec), [script.scenes, durationSec]);
  const overBudget = words > budget + 3;
  const current = timed[Math.min(focus, timed.length - 1)];

  // Play the beat sheet in real time on the phone preview.
  useEffect(() => {
    if (!playing || !current) return;
    const ms = Math.max(500, (current.end - current.start) * 1000);
    const t = window.setTimeout(() => {
      if (focus >= timed.length - 1) {
        setPlaying(false);
        setFocus(0);
      } else setFocus((f) => f + 1);
    }, ms);
    return () => window.clearTimeout(t);
  }, [playing, focus, current, timed.length]);

  const setScene = (id: string, patch: Partial<Scene>) =>
    setScript((s) => ({
      ...s,
      scenes: s.scenes.map((sc) => (sc.id === id ? { ...sc, ...patch } : sc)),
    }));

  const addScene = () =>
    setScript((s) => {
      if (s.scenes.length >= 6) return s;
      const last = s.scenes[s.scenes.length - 1];
      const used = new Set(s.scenes.map((sc) => sc.id));
      let n = s.scenes.length + 1;
      while (used.has(`s${n}`)) n++;
      const start = last ? last.end : 0;
      return {
        ...s,
        scenes: [
          ...s.scenes,
          {
            id: `s${n}`,
            start,
            end: start + 2,
            shot: "",
            action: "",
            dialogue: "",
            productPlacement: "",
            caption: "",
          },
        ],
      };
    });

  const globalWarnings = warnings.filter((w) => !w.sceneId);
  const pct = Math.min(1, words / Math.max(budget, 1));

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[250px_minmax(0,1fr)]">
        {/* Live preview */}
        <aside className="space-y-4 lg:sticky lg:top-0 lg:self-start">
          <div className="mx-auto w-44 lg:w-full lg:max-w-[210px]">
            <PhoneFrame ratio={aspectRatio}>
              {productImage ? (
                <img
                  src={productImage}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="absolute inset-0 size-full! scale-110 object-cover opacity-35 blur-[2px]"
                />
              ) : null}
              <div className="absolute inset-0 bg-[radial-gradient(110%_60%_at_50%_0%,hsl(var(--primary)/0.35),transparent_60%)]" />
              <div className="absolute inset-x-[18%] bottom-0 top-[26%]">
                <CreatorSilhouette />
              </div>
              <div className="absolute inset-x-2.5 top-4 flex gap-1" aria-hidden>
                {timed.map((s, i) => (
                  <span
                    key={s.id}
                    className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/25"
                  >
                    <motion.span
                      className="block h-full bg-white"
                      initial={false}
                      animate={{
                        width: i < focus ? "100%" : i === focus && playing ? "100%" : "0%",
                      }}
                      transition={
                        i === focus && playing
                          ? { duration: Math.max(0.5, s.end - s.start), ease: "linear" }
                          : { duration: 0.2 }
                      }
                    />
                  </span>
                ))}
              </div>
              <span className="absolute left-2.5 top-7 rounded-full bg-black/55 px-2 py-0.5 text-[9.5px] font-medium backdrop-blur">
                {current
                  ? `${sceneLabel(focus, timed.length)} · ${current.start}–${current.end}s`
                  : ""}
              </span>
              <div className="absolute inset-x-2.5 bottom-3">
                <AnimatePresence mode="wait">
                  <motion.p
                    key={focus}
                    initial={{ opacity: 0, y: 8, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={motionPreset.medium}
                    className="rounded-lg bg-black/70 px-2 py-1.5 text-center text-[11.5px] font-semibold leading-snug backdrop-blur"
                  >
                    {current?.dialogue.trim() || current?.action || "…"}
                  </motion.p>
                </AnimatePresence>
              </div>
            </PhoneFrame>
          </div>
          <div className="flex items-center justify-center gap-3">
            <Button
              variant={playing ? "secondary" : "default"}
              size="sm"
              onClick={() => {
                if (!playing && focus >= timed.length - 1) setFocus(0);
                setPlaying((p) => !p);
              }}
            >
              {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
              {playing ? "Pause" : "Preview"}
            </Button>
            <SpeakingRing pct={pct} over={overBudget} words={words} budget={budget} />
          </div>
          {overBudget ? (
            <p className="text-center text-[11px] text-danger">Too long for {durationSec}s</p>
          ) : null}
        </aside>

        <div className="min-w-0 space-y-4">
          {/* Timeline */}
          <div className="flex h-9 gap-1 rounded-full bg-[var(--ds-well-bg)] p-1" role="tablist">
            {timed.map((s, i) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={i === focus}
                onClick={() => {
                  setPlaying(false);
                  setFocus(i);
                  document.getElementById(`scene-${s.id}`)?.scrollIntoView({
                    behavior: reduce ? "auto" : "smooth",
                    block: "nearest",
                  });
                }}
                style={{ flexGrow: Math.max(0.5, s.end - s.start) }}
                className={cn(
                  "relative min-w-0 basis-0 overflow-hidden rounded-full text-[11px] font-medium transition-colors",
                  i === focus
                    ? "text-primary-foreground"
                    : "text-muted-foreground hover:bg-[var(--ds-well-bg-hover)] hover:text-foreground",
                )}
              >
                {i === focus ? (
                  <motion.span
                    layoutId={reduce ? undefined : "ugc-timeline"}
                    className="absolute inset-0 rounded-full bg-primary"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                ) : null}
                <span className="relative truncate px-1">
                  {i + 1}
                  <span className="max-sm:hidden">
                    {" "}
                    · {s.end - s.start > 0 ? `${Math.round((s.end - s.start) * 10) / 10}s` : ""}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <ol className="space-y-3">
            <AnimatePresence initial={false}>
              {script.scenes.map((scene, i) => {
                const t = timed.find((x) => x.id === scene.id);
                const sceneWarnings = warnings.filter((w) => w.sceneId === scene.id);
                const active = timed[focus]?.id === scene.id;
                return (
                  <motion.li
                    key={scene.id}
                    id={`scene-${scene.id}`}
                    layout={!reduce}
                    initial={reduce ? false : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={motionPreset.medium}
                  >
                    <SceneCard
                      scene={scene}
                      index={i}
                      count={script.scenes.length}
                      time={t ? `${t.start}–${t.end}s` : null}
                      active={active}
                      warnings={sceneWarnings.map((w) => w.message)}
                      onFocus={() => {
                        const idx = timed.findIndex((x) => x.id === scene.id);
                        if (idx >= 0 && !playing) setFocus(idx);
                      }}
                      onChange={(patch) => {
                        setScene(scene.id, patch);
                        // The hook scene's line is the hook: keep them in step while they match.
                        const next = patch.dialogue;
                        if (i === 0 && next !== undefined) {
                          const linked =
                            !script.hook.trim() || script.hook.trim() === scene.dialogue.trim();
                          if (linked && next.trim()) setScript((s) => ({ ...s, hook: next }));
                        }
                      }}
                      onRemove={
                        script.scenes.length > 1
                          ? () => {
                              setFocus(0);
                              setScript((s) => ({
                                ...s,
                                scenes: s.scenes.filter((x) => x.id !== scene.id),
                              }));
                            }
                          : undefined
                      }
                    />
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ol>
          {script.scenes.length < 6 ? (
            <button
              type="button"
              onClick={addScene}
              className="flex w-full items-center justify-center gap-2 rounded-[20px] border-2 border-dashed border-[var(--ds-tile-border)] py-3 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
            >
              <Plus className="size-4" aria-hidden /> Add scene
            </button>
          ) : null}

          {/* AI edits */}
          <Panel className="space-y-3">
            <SectionLabel icon={Wand2}>Quick edits</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_REWRITES.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  disabled={rewriting}
                  title={q.instruction}
                  onClick={() => onRewrite(script, q.instruction)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--ds-well-bg)] px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-primary/15 hover:text-foreground disabled:opacity-50"
                >
                  <q.icon className="size-3.5 text-primary" aria-hidden />
                  {q.label}
                </button>
              ))}
            </div>
            <form
              data-no-rhythm
              className="flex items-center gap-1.5 rounded-full bg-[var(--ds-well-bg)] p-1 pl-3 ring-primary/50 focus-within:ring-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (instruction.trim()) onRewrite(script, instruction.trim());
              }}
            >
              <Wand2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <input
                aria-label="What to change"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="Or say what to change…"
                className="h-8 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/70"
                disabled={rewriting}
              />
              <Button
                type="submit"
                size="icon-sm"
                loading={rewriting}
                disabled={!instruction.trim()}
                aria-label="Rewrite"
              >
                <Send aria-hidden />
              </Button>
            </form>
            {rewriting ? (
              <div className="h-1 overflow-hidden rounded-full bg-[var(--ds-well-bg)]" aria-hidden>
                <motion.div
                  className="h-full w-1/3 rounded-full bg-primary"
                  animate={{ x: ["-100%", "300%"] }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                />
              </div>
            ) : null}
          </Panel>

          <Disclosure
            label="Post text"
            icon={Tag}
            badge={
              script.hashtags.length ? (
                <span className="rounded-full bg-[var(--ds-well-bg)] px-2 py-0.5 text-[11px] text-muted-foreground">
                  #{script.hashtags.length}
                </span>
              ) : null
            }
          >
            <Field label="Hook" htmlFor="ugc-hook">
              <Input
                id="ugc-hook"
                value={script.hook}
                onChange={(e) => setScript((s) => ({ ...s, hook: e.target.value }))}
              />
            </Field>
            <Field label="Ending line" htmlFor="ugc-script-cta">
              <Input
                id="ugc-script-cta"
                value={script.cta}
                onChange={(e) => setScript((s) => ({ ...s, cta: e.target.value }))}
              />
            </Field>
            <Field label="Caption" htmlFor="ugc-post-caption">
              <Textarea
                id="ugc-post-caption"
                rows={3}
                value={script.postCaption}
                onChange={(e) => setScript((s) => ({ ...s, postCaption: e.target.value }))}
              />
            </Field>
            <Field label="Hashtags" htmlFor="ugc-hashtags">
              <Input
                id="ugc-hashtags"
                value={script.hashtags.map((h) => `#${h}`).join(" ")}
                onChange={(e) =>
                  setScript((s) => ({
                    ...s,
                    hashtags: e.target.value
                      .split(/[\s,]+/)
                      .map((h) => h.replace(/^#/, ""))
                      .filter(Boolean)
                      .slice(0, 10),
                  }))
                }
              />
            </Field>
            {globalWarnings.map((w) => (
              <p key={w.claim + w.field} className="flex gap-1.5 text-[11.5px] text-danger">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {w.message}
              </p>
            ))}
          </Disclosure>

          <Disclosure
            label="Facts"
            icon={CheckCircle}
            badge={
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary tabular-nums">
                {product.facts.length}
              </span>
            }
          >
            {product.facts.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {product.facts.map((f) => (
                  <li
                    key={f.id}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[11.5px]",
                      script.factIds.includes(f.id)
                        ? "bg-primary/15 text-foreground"
                        : "bg-[var(--ds-well-bg)] text-muted-foreground",
                    )}
                  >
                    {f.text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11.5px] text-muted-foreground">
                No facts — the script stays general.
              </p>
            )}
          </Disclosure>
        </div>
      </div>

      {globalWarnings.length ? (
        <p className="flex items-center gap-1.5 text-[11.5px] text-danger">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          {globalWarnings.length} line{globalWarnings.length === 1 ? "" : "s"} in Post text need a
          fact
        </p>
      ) : null}

      <StepActions>
        <Button variant="ghost" onClick={() => onBack(script)} className="mr-auto">
          Back
        </Button>
        <Button
          size="lg"
          onClick={() => onContinue(script)}
          loading={saving}
          disabled={!script.hook.trim() || !script.scenes.length}
        >
          Next <ArrowRight aria-hidden />
        </Button>
      </StepActions>
    </div>
  );
}

function SpeakingRing({
  pct,
  over,
  words,
  budget,
}: {
  pct: number;
  over: boolean;
  words: number;
  budget: number;
}) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <div
      className="flex items-center gap-2"
      title={`${words} of about ${budget} words`}
      aria-label={`${words} of about ${budget} words`}
    >
      <svg viewBox="0 0 36 36" className="size-9 -rotate-90">
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          strokeWidth="3.5"
          className="stroke-[var(--ds-well-bg-hover)]"
        />
        <motion.circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          strokeWidth="3.5"
          strokeLinecap="round"
          className={over ? "stroke-danger" : "stroke-primary"}
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={motionPreset.slow}
        />
      </svg>
      <span className={cn("text-xs tabular-nums", over ? "text-danger" : "text-muted-foreground")}>
        {words}/{budget}
      </span>
    </div>
  );
}

function SceneCard({
  scene,
  index,
  count,
  time,
  active,
  warnings,
  onFocus,
  onChange,
  onRemove,
}: {
  scene: Scene;
  index: number;
  count: number;
  time: string | null;
  active: boolean;
  warnings: string[];
  onFocus: () => void;
  onChange: (patch: Partial<Scene>) => void;
  onRemove?: () => void;
}) {
  const [details, setDetails] = useState(false);
  const wordCount = scene.dialogue.trim().split(/\s+/).filter(Boolean).length;
  return (
    <div
      onFocusCapture={onFocus}
      className={cn(
        "ds-tile space-y-2 p-3 transition-[border-color,box-shadow] sm:p-4",
        active && "border-primary/60 shadow-[0_12px_32px_-22px_hsl(var(--primary)/0.9)]",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "grid size-6 place-items-center rounded-full text-[11px] font-semibold transition-colors",
            active ? "bg-primary text-primary-foreground" : "bg-primary/15 text-primary",
          )}
        >
          {index + 1}
        </span>
        <span className="text-sm font-medium">{sceneLabel(index, count)}</span>
        {time ? (
          <span className="rounded-full bg-[var(--ds-well-bg)] px-2 py-0.5 text-[10.5px] tabular-nums text-muted-foreground">
            {time}
          </span>
        ) : null}
        <span className="ml-auto text-[10.5px] tabular-nums text-muted-foreground">
          {wordCount}w
        </span>
        <button
          type="button"
          aria-expanded={details}
          aria-label="Shot details"
          title="Shot details"
          onClick={() => setDetails((v) => !v)}
          className={cn(
            "grid size-7 place-items-center rounded-full transition-colors",
            details
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-[var(--ds-well-bg)] hover:text-foreground",
          )}
        >
          <Camera className="size-3.5" aria-hidden />
        </button>
        {onRemove ? (
          <button
            type="button"
            aria-label={`Remove scene ${index + 1}`}
            onClick={onRemove}
            className="grid size-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--ds-well-bg)] hover:text-foreground"
          >
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
      <Textarea
        aria-label={`Spoken line, ${sceneLabel(index, count)}`}
        rows={2}
        value={scene.dialogue}
        onChange={(e) => onChange({ dialogue: e.target.value })}
        placeholder="What the creator says"
        className={cn(
          "min-h-0 resize-none border-0 bg-[var(--ds-well-bg)] text-[14px] leading-relaxed shadow-none",
          warnings.length && "ring-1 ring-danger/60",
        )}
      />
      {warnings.map((w) => (
        <p key={w} className="flex gap-1.5 text-[11.5px] text-danger">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {w}
        </p>
      ))}
      <AnimatePresence initial={false}>
        {details ? (
          <motion.div
            key="details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={motionPreset.medium}
            className="overflow-hidden"
          >
            <div className="grid gap-3 pt-1 sm:grid-cols-2">
              <Field label="Camera" htmlFor={`shot-${scene.id}`}>
                <Input
                  id={`shot-${scene.id}`}
                  value={scene.shot}
                  onChange={(e) => onChange({ shot: e.target.value })}
                  placeholder="Close selfie"
                />
              </Field>
              <Field label="Product" htmlFor={`pp-${scene.id}`}>
                <Input
                  id={`pp-${scene.id}`}
                  value={scene.productPlacement}
                  onChange={(e) => onChange({ productPlacement: e.target.value })}
                  placeholder="Label to camera"
                />
              </Field>
              <Field label="Action" htmlFor={`act-${scene.id}`}>
                <Input
                  id={`act-${scene.id}`}
                  value={scene.action}
                  onChange={(e) => onChange({ action: e.target.value })}
                  placeholder="What they do"
                />
              </Field>
              <Field label="Caption" htmlFor={`cap-${scene.id}`}>
                <Input
                  id={`cap-${scene.id}`}
                  value={scene.caption}
                  onChange={(e) => onChange({ caption: e.target.value })}
                  placeholder="Added in editing"
                />
              </Field>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
