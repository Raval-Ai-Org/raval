"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { LayoutTemplate, SlidersHorizontal, Sparkles, Wand2, X, Zap } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { duration, ease } from "@/lib/motion";
import { recommendedRatio } from "@/lib/studio/aspect";
import { detectStudioType } from "@/lib/studio/detect";
import { STUDIO_FORMATS, STUDIO_TYPE_ORDER, type StudioType } from "@/lib/studio/formats";
import type { StudioIdea } from "@/lib/studio/ideas";
import type { StudioControls } from "@/lib/studio/jobs";
import { QUICK_STARTS, type QuickStart } from "@/lib/studio/quick-starts";
import { studioDefaultControls } from "@/lib/studio/session-store";
import {
  POPULAR_TEMPLATE_IDS,
  firstBlank,
  getTemplate,
  type StudioTemplate,
} from "@/lib/studio/templates";
import { IdeasPanel } from "./IdeasPanel";
import { TemplateCard } from "./TemplateGallery";
import {
  FieldLabel,
  PlatformPicker,
  PlatformStack,
  RatioPicker,
  Segmented,
  TypeGlyph,
} from "./studio-ui";

/** Chip labels short enough that all seven formats fit on one row. */
const CHIP: Record<StudioType, string> = {
  social: "Post",
  carousel: "Carousel",
  image: "Image",
  ad: "Ad",
  video: "Video",
  script: "Script",
  article: "Article",
};

type Tab = "ideas" | "templates";

export type QuickGenerateOptions = {
  controls: StudioControls;
  template?: string;
};

/**
 * The first — and usually only — screen before generation. One prompt box:
 * describe it, press Enter. Mellox picks the format from the words, uses your
 * last platforms and size (adjustable in Settings without leaving the box),
 * and starts. Quick starts, ideas and templates only ever fill the box.
 */
export function StartStep({
  workspaceId,
  initialType,
  onQuickGenerate,
  onGenerateIdea,
  fixtureIdeas,
}: {
  workspaceId: string;
  initialType?: StudioType | null;
  onQuickGenerate: (type: StudioType, brief: string, options: QuickGenerateOptions) => void;
  onGenerateIdea?: (idea: StudioIdea) => void;
  fixtureIdeas?: StudioIdea[];
}) {
  const reduce = useReducedMotion();
  const [tab, setTab] = useState<Tab>("ideas");
  const [text, setText] = useState("");
  const [type, setType] = useState<StudioType>(initialType ?? "social");
  const [overrides, setOverrides] = useState<Partial<StudioControls>>({});
  const [ratioPinned, setRatioPinned] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [detected, setDetected] = useState(false);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [quickId, setQuickId] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const chips = useRef<HTMLDivElement>(null);

  const format = STUDIO_FORMATS[type];
  const base = useMemo(() => studioDefaultControls(type), [type]);
  const controls: StudioControls = { ...base, ...overrides };
  const template = getTemplate(templateId);
  const ready = text.trim().length >= 3;
  const popular = POPULAR_TEMPLATE_IDS.map(getTemplate).filter((t): t is StudioTemplate => !!t);
  const showRatio =
    format.ratios.length > 0 &&
    (format.media !== "optional-image" || !!controls.includeImage || type === "carousel");

  // Whatever format is selected, by tap or by detection, stays visible.
  useEffect(() => {
    chips.current?.querySelector<HTMLElement>(`[data-type="${type}"]`)?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: reduce ? "auto" : "smooth",
    });
  }, [type, reduce]);

  useEffect(() => {
    // Keyboard-and-mouse users can start typing immediately; don't pop a phone keyboard.
    if (window.matchMedia("(pointer: fine)").matches) input.current?.focus();
  }, []);

  const selectType = (next: StudioType, settings: Partial<StudioControls> = {}) => {
    setType(next);
    setOverrides(settings);
    setRatioPinned(!!settings.ratio);
  };

  /** Put text in the box and place the caret (or select a range) for the user. */
  const fill = (value: string, select?: [number, number] | null) => {
    setText(value);
    box.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    window.requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      const [a, b] = select ?? [value.length, value.length];
      el.setSelectionRange(a, b);
    });
  };

  const onText = (value: string) => {
    setText(value);
    if (!value.trim()) {
      setPinned(false);
      setDetected(false);
      return;
    }
    if (pinned) return;
    const guess = detectStudioType(value);
    if (guess && guess !== type) selectType(guess);
    setDetected(!!guess);
  };

  const pickQuickStart = (q: QuickStart) => {
    selectType(q.type, {
      ...(q.platforms.length ? { platforms: q.platforms } : {}),
      ...q.controls,
    });
    setPinned(true);
    setDetected(false);
    setQuickId(q.id);
    setTemplateId(null);
    const current = text.trim();
    const isLeadIn =
      !current ||
      QUICK_STARTS.some((x) => x.prompt.trim() === current) ||
      (template && template.starter === current);
    fill(isLeadIn ? q.prompt : text);
  };

  const pickTemplate = (t: StudioTemplate) => {
    selectType(t.types[0], t.controls ?? {});
    setPinned(true);
    setDetected(false);
    setQuickId(null);
    setTemplateId(t.id);
    fill(t.starter, firstBlank(t.starter));
  };

  const pickIdea = (idea: StudioIdea) => {
    selectType(idea.type, idea.platforms.length ? { platforms: idea.platforms } : {});
    setPinned(true);
    setDetected(false);
    setQuickId(null);
    setTemplateId(null);
    fill(idea.brief);
  };

  const submit = () => {
    if (!ready) return;
    onQuickGenerate(type, text.trim(), {
      controls,
      template: template?.types.includes(type) ? template.id : undefined,
    });
  };

  const setControl = (patch: Partial<StudioControls>) => {
    setQuickId(null);
    setOverrides((o) => ({ ...o, ...patch }));
  };

  return (
    <div className="relative h-full overflow-y-auto">
      <div aria-hidden className="studio-aurora studio-aurora-soft !bottom-auto h-[420px]" />
      <div className="relative mx-auto w-full max-w-3xl px-5 pb-10 pt-8 @3xl/composer:px-8 @3xl/composer:pt-14 @min-[1400px]/composer:max-w-4xl">
        <motion.h2
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: duration.xslow, ease: ease.emphasized }}
          className="text-center text-2xl font-semibold tracking-tight text-foreground @3xl/composer:text-[1.9rem]"
        >
          What do you want to <span className="studio-gradient-text studio-tone-video">create</span>
          ?
        </motion.h2>

        {/* ── The one prompt ── */}
        <motion.div
          ref={box}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: duration.slow, ease: ease.emphasized }}
          className={cn(
            `studio-tone-${type} mt-6 scroll-mt-6 rounded-2xl border border-input bg-surface-3 shadow-2 transition-[border-color,box-shadow] duration-[--motion-duration-base]`,
            "focus-within:border-primary-border focus-within:shadow-[0_0_0_4px_hsl(var(--primary)/0.12),0_22px_50px_-22px_hsl(var(--primary)/0.5)]",
          )}
        >
          {template ? (
            <div className="flex items-center gap-2 border-b border-border/70 px-4 py-2 text-xs text-muted-foreground">
              <LayoutTemplate className="size-3.5 text-[hsl(var(--tone))]" />
              <span className="font-medium text-foreground">{template.label}</span>
              <span className="hidden min-w-0 truncate @lg/composer:inline">
                · {template.beats.join(" → ")}
              </span>
              <button
                type="button"
                onClick={() => setTemplateId(null)}
                aria-label="Remove template"
                className="ml-auto grid size-6 place-items-center rounded-full hover:bg-surface-2 hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ) : null}
          <label htmlFor="studio-quick" className="sr-only">
            Describe what you want to create
          </label>
          <textarea
            id="studio-quick"
            ref={input}
            value={text}
            onChange={(e) => onText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            maxLength={4000}
            placeholder="e.g. An Instagram post about our new cold brew, with a caption"
            className="block w-full resize-none !border-0 !bg-transparent px-4 pt-4 text-base leading-relaxed text-foreground !shadow-none outline-none placeholder:text-muted-foreground focus-visible:!ring-0 @3xl/composer:text-[15px]"
          />
          <div className="flex flex-wrap items-center gap-2 px-3 pb-3 pt-1">
            <div
              ref={chips}
              role="radiogroup"
              aria-label="Format"
              className="-mx-1 flex min-w-0 flex-1 gap-0.5 overflow-x-auto px-1 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {STUDIO_TYPE_ORDER.map((t) => {
                const on = t === type;
                return (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    data-type={t}
                    title={STUDIO_FORMATS[t].label}
                    onClick={() => {
                      if (t !== type) selectType(t);
                      setPinned(true);
                      setDetected(false);
                      setQuickId(null);
                      input.current?.focus();
                    }}
                    className={cn(
                      `studio-tone-${t} relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full pl-1 pr-2 text-xs font-medium transition-colors duration-[--motion-duration-fast]`,
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--tone))]",
                      on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {on ? (
                      <motion.span
                        layoutId="quick-format"
                        className="absolute inset-0 rounded-full bg-[hsl(var(--tone)/0.14)] ring-1 ring-[hsl(var(--tone)/0.4)]"
                        transition={{ duration: duration.medium, ease: ease.emphasized }}
                      />
                    ) : null}
                    <TypeGlyph type={t} size="sm" className="relative" />
                    <span className="relative">{CHIP[t]}</span>
                    {on && detected && text.trim() ? (
                      <Sparkles
                        className="relative size-3 text-[hsl(var(--tone))]"
                        aria-label="Picked from your description"
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-muted-foreground ring-1 ring-border/70 transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55"
                    aria-label={`Settings for ${format.label}`}
                    title="Platforms and size"
                  >
                    {controls.platforms.length ? (
                      <PlatformStack platforms={controls.platforms} size={18} max={3} />
                    ) : (
                      <SlidersHorizontal className="size-3.5" />
                    )}
                    {showRatio && controls.ratio ? (
                      <span className="tabular-nums">{controls.ratio}</span>
                    ) : null}
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-[min(92vw,380px)] space-y-4 p-4 [&_[role=radiogroup][aria-label=Size]]:!grid-cols-2"
                >
                  <p className="ui-eyebrow">{format.label} settings</p>
                  {format.platforms.length ? (
                    <div>
                      <FieldLabel hint={format.multiPlatform ? "A version for each" : "Pick one"}>
                        {format.multiPlatform ? "Platforms" : "Platform"}
                      </FieldLabel>
                      <PlatformPicker
                        platforms={format.platforms}
                        value={controls.platforms}
                        multi={format.multiPlatform}
                        onChange={(platforms) =>
                          setControl({
                            platforms,
                            ...(!ratioPinned && format.ratios.length && type !== "carousel"
                              ? {
                                  ratio: recommendedRatio(
                                    platforms,
                                    type === "video" ? "video" : "image",
                                    format.ratios,
                                  ),
                                }
                              : {}),
                          })
                        }
                      />
                    </div>
                  ) : null}
                  {format.media === "optional-image" ? (
                    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-surface-2/70 px-3 py-2.5">
                      <span className="text-sm font-medium text-foreground">Add a visual</span>
                      <Switch
                        checked={!!controls.includeImage}
                        onCheckedChange={(v) => setControl({ includeImage: v })}
                        aria-label="Add a visual"
                      />
                    </label>
                  ) : null}
                  {showRatio ? (
                    <div>
                      <FieldLabel>Size</FieldLabel>
                      <RatioPicker
                        ratios={format.ratios}
                        value={controls.ratio}
                        onChange={(ratio) => {
                          setRatioPinned(true);
                          setControl({ ratio });
                        }}
                      />
                    </div>
                  ) : null}
                  {type === "article" ? (
                    <div>
                      <FieldLabel>Length</FieldLabel>
                      <Segmented
                        label="Length"
                        value={controls.length ?? "standard"}
                        onChange={(length) => setControl({ length })}
                        options={[
                          { value: "short", label: "Short" },
                          { value: "standard", label: "Standard" },
                          { value: "long", label: "In-depth" },
                        ]}
                      />
                    </div>
                  ) : null}
                  {type === "script" || type === "video" ? (
                    <div>
                      <FieldLabel>Length</FieldLabel>
                      <Segmented
                        label="Length"
                        value={controls.durationSec ?? (type === "video" ? 6 : 30)}
                        onChange={(durationSec) => setControl({ durationSec })}
                        options={(type === "video" ? [4, 6, 8] : [15, 30, 60]).map((v) => ({
                          value: v,
                          label: `${v}s`,
                        }))}
                      />
                    </div>
                  ) : null}
                  {type === "carousel" ? (
                    <div>
                      <FieldLabel>Slides</FieldLabel>
                      <Segmented
                        label="Slides"
                        value={controls.slideCount ?? 6}
                        onChange={(slideCount) => setControl({ slideCount })}
                        options={[5, 6, 8, 10].map((v) => ({ value: v, label: String(v) }))}
                      />
                    </div>
                  ) : null}
                </PopoverContent>
              </Popover>
              <Button onClick={submit} disabled={!ready} className="studio-cta">
                <Wand2 />
                Generate
              </Button>
            </div>
          </div>
        </motion.div>

        {/* ── Quick starts: one tap sets format and platforms, you add the topic ── */}
        <motion.section
          data-no-rhythm
          aria-labelledby="quick-starts"
          className="mt-6"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.16, duration: duration.slow, ease: ease.emphasized }}
        >
          <div className="mb-2.5 flex items-center gap-2 px-0.5">
            <h3 id="quick-starts" className="ui-eyebrow">
              <Zap className="size-3 text-primary" />
              Quick start
            </h3>
            <span className="text-[11px] text-muted-foreground">Captions included</span>
          </div>
          <div className="grid grid-cols-2 gap-2 @3xl/composer:grid-cols-4">
            {QUICK_STARTS.map((q) => {
              const on = quickId === q.id;
              return (
                <button
                  key={q.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => pickQuickStart(q)}
                  className={cn(
                    `studio-tone-${q.type} group flex min-h-11 items-center gap-2 rounded-xl bg-surface-3 px-2.5 text-left text-xs font-medium shadow-1 ring-1 transition-[box-shadow,translate] duration-[--motion-duration-base]`,
                    "hover:-translate-y-px hover:shadow-[0_12px_28px_-16px_hsl(var(--tone)/0.55)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--tone))]",
                    on
                      ? "text-foreground ring-[hsl(var(--tone)/0.6)]"
                      : "text-foreground/85 ring-border/70 hover:ring-[hsl(var(--tone)/0.4)]",
                  )}
                >
                  <TypeGlyph type={q.type} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{q.label}</span>
                  {q.platforms.length ? (
                    <PlatformStack platforms={q.platforms} size={16} max={2} />
                  ) : null}
                </button>
              );
            })}
          </div>
        </motion.section>

        {/* ── Not sure? Ideas and templates fill the box too ── */}
        <motion.section
          data-no-rhythm
          aria-label="Ideas and templates"
          className="mt-9"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.24, duration: duration.slow, ease: ease.emphasized }}
        >
          <div className="flex items-center gap-3">
            <span aria-hidden className="h-px flex-1 bg-border/70" />
            <div
              role="tablist"
              aria-label="Need a starting point?"
              className="inline-flex rounded-full bg-surface-2/80 p-1 ring-1 ring-border/60"
            >
              {(
                [
                  { id: "ideas", label: "Ideas for you", icon: Sparkles },
                  { id: "templates", label: "Templates", icon: LayoutTemplate },
                ] as const
              ).map((t) => {
                const selected = tab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setTab(t.id)}
                    className={cn(
                      "relative inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium transition-colors duration-[--motion-duration-fast] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55",
                      selected ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {selected ? (
                      <motion.span
                        layoutId="start-tab"
                        className="absolute inset-0 rounded-full bg-surface-3 shadow-1 ring-1 ring-border/70"
                        transition={{ duration: duration.medium, ease: ease.emphasized }}
                      />
                    ) : null}
                    <t.icon className="relative size-3.5" />
                    <span className="relative">{t.label}</span>
                  </button>
                );
              })}
            </div>
            <span aria-hidden className="h-px flex-1 bg-border/70" />
          </div>

          <div key={tab} className="studio-enter-blur mt-5" role="tabpanel">
            {tab === "ideas" ? (
              <IdeasPanel
                workspaceId={workspaceId}
                onPick={pickIdea}
                onGenerate={onGenerateIdea}
                variant="grid"
                limit={4}
                fixtureIdeas={fixtureIdeas}
                title="Picked for your brand"
              />
            ) : (
              <div
                role="radiogroup"
                aria-label="Popular templates"
                className="grid grid-cols-2 gap-3 @3xl/composer:grid-cols-3"
              >
                {popular.map((t, i) => {
                  const tType = t.types[0];
                  return (
                    <TemplateCard
                      key={t.id}
                      template={t}
                      type={tType}
                      index={i}
                      selected={t.id === templateId}
                      onPick={() => pickTemplate(t)}
                      className="w-full"
                      footer={
                        <span className="mt-auto flex items-center gap-1.5 px-1 pb-0.5 pt-1 text-[11px] text-muted-foreground">
                          <TypeGlyph type={tType} size="sm" className="size-5 [&_svg]:size-3" />
                          <span className="truncate">{STUDIO_FORMATS[tType].label}</span>
                        </span>
                      }
                    />
                  );
                })}
              </div>
            )}
          </div>
        </motion.section>
      </div>
    </div>
  );
}
