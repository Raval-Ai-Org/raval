"use client";

import { useState } from "react";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { toast } from "sonner";
import { Check, X } from "@/components/icons";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";
import type { StudioType } from "@/lib/studio/formats";
import {
  firstBlank,
  isTemplateStarter,
  templatesFor,
  type StudioTemplate,
  type ThumbLayout,
} from "@/lib/studio/templates";
import {
  applyTemplate,
  restoreTemplateState,
  type StudioSession,
} from "@/lib/studio/session-store";
import { DrawCheck } from "./studio-ui";

const v = (rest: Variants[string], play: Variants[string]): Variants => ({ rest, play });

/**
 * A tiny animated illustration of a template's structure. It sits still at
 * rest and acts itself out on hover, focus, or selection.
 */
export function TemplateThumb({
  layout,
  play,
  className,
}: {
  layout: ThumbLayout;
  play: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const line = "h-1.5 rounded-full bg-foreground/15";
  let body: React.ReactNode;

  switch (layout) {
    case "list":
      body = (
        <div className="absolute inset-0 flex flex-col justify-center gap-[9%] px-[13%]">
          {[90, 68, 80, 52].map((w, i) => (
            <div key={i} className="flex items-center gap-[6%]">
              <motion.span
                className="size-1.5 shrink-0 rounded-full bg-[hsl(var(--tone))]"
                variants={v(
                  { scale: 1 },
                  { scale: [0, 1.35, 1], transition: { delay: i * 0.12, duration: 0.4 } },
                )}
              />
              <motion.span
                className={line}
                variants={v(
                  { width: `${w}%` },
                  {
                    width: ["0%", `${w}%`],
                    transition: { delay: i * 0.12 + 0.05, duration: 0.5, ease: ease.emphasized },
                  },
                )}
              />
            </div>
          ))}
        </div>
      );
      break;
    case "steps":
      body = (
        <div className="absolute inset-x-[12%] top-1/2 flex -translate-y-1/2 items-center justify-between">
          <span className="absolute inset-x-2 top-1/2 h-px -translate-y-1/2 bg-foreground/15" />
          <motion.span
            className="absolute inset-x-2 top-1/2 h-px origin-left -translate-y-1/2 bg-[hsl(var(--tone))]"
            variants={v(
              { scaleX: 0.34 },
              { scaleX: [0, 1], transition: { duration: 1.2, ease: "easeInOut" } },
            )}
          />
          {[0, 1, 2, 3].map((i) => (
            <motion.span
              key={i}
              className="relative grid size-5 place-items-center overflow-hidden rounded-full bg-surface-3 text-[8px] font-bold text-[hsl(var(--tone))] ring-[1.5px] ring-[hsl(var(--tone)/0.55)]"
              variants={v(
                { scale: 1 },
                { scale: [1, 1.3, 1], transition: { delay: i * 0.3, duration: 0.45 } },
              )}
            >
              <motion.span
                className="absolute inset-0 bg-[hsl(var(--tone)/0.3)]"
                variants={v(
                  { opacity: i < 2 ? 1 : 0 },
                  { opacity: [0, 1], transition: { delay: i * 0.3, duration: 0.3 } },
                )}
              />
              <span className="relative">{i + 1}</span>
            </motion.span>
          ))}
        </div>
      );
      break;
    case "split":
      body = (
        <div className="absolute inset-[11%] flex gap-[5%]">
          <motion.div
            className="relative flex-1 rounded-lg bg-foreground/[0.09]"
            variants={v({ opacity: 1 }, { opacity: [1, 0.45, 1], transition: { duration: 1.1 } })}
          >
            <span className="absolute left-1.5 top-1.5 text-[7px] font-bold uppercase tracking-wide text-muted-foreground">
              Before
            </span>
          </motion.div>
          <motion.div
            className="relative flex-1 overflow-hidden rounded-lg bg-[hsl(var(--tone)/0.3)]"
            variants={v(
              { scale: 1 },
              { scale: [1, 1.07, 1], transition: { delay: 0.3, duration: 0.8 } },
            )}
          >
            <span className="absolute left-1.5 top-1.5 text-[7px] font-bold uppercase tracking-wide text-[hsl(var(--tone))]">
              After
            </span>
            <motion.span
              className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/50 to-transparent"
              variants={v(
                { x: "-130%" },
                { x: ["-130%", "260%"], transition: { delay: 0.45, duration: 0.9 } },
              )}
            />
          </motion.div>
        </div>
      );
      break;
    case "quote":
      body = (
        <div className="absolute inset-0 flex flex-col justify-center gap-[7%] px-[15%]">
          <motion.span
            className="origin-bottom-left font-serif text-[34px] leading-[0.55] text-[hsl(var(--tone))]"
            variants={v(
              { scale: 1, rotate: 0 },
              {
                scale: [0.5, 1.2, 1],
                rotate: [-14, 5, 0],
                transition: { duration: 0.6, ease: ease.emphasized },
              },
            )}
          >
            “
          </motion.span>
          {[88, 62].map((w, i) => (
            <motion.span
              key={w}
              className={line}
              variants={v(
                { width: `${w}%` },
                { width: ["0%", `${w}%`], transition: { delay: 0.25 + i * 0.15, duration: 0.5 } },
              )}
            />
          ))}
          <span className="h-1 w-[28%] rounded-full bg-[hsl(var(--tone)/0.45)]" />
        </div>
      );
      break;
    case "hero":
      body = (
        <div className="absolute inset-0 grid place-items-center">
          <motion.span
            className="aspect-square h-[46%] rounded-2xl bg-gradient-to-br from-[hsl(var(--tone)/0.75)] to-[hsl(var(--tone)/0.25)] shadow-2"
            variants={v(
              { scale: 1, rotate: 0, y: 0 },
              {
                scale: [0.75, 1.1, 1],
                rotate: [-10, 4, 0],
                y: [8, -3, 0],
                transition: { duration: 0.8, ease: ease.emphasized },
              },
            )}
          />
          <motion.span
            className="absolute bottom-[13%] h-1.5 rounded-full bg-foreground/15"
            variants={v(
              { width: "38%" },
              { width: ["0%", "38%"], transition: { delay: 0.4, duration: 0.5 } },
            )}
          />
        </div>
      );
      break;
    case "story":
      body = (
        <div className="absolute inset-[13%] flex items-center gap-[5%]">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="relative h-[86%] flex-1 overflow-hidden rounded-md bg-foreground/[0.1]"
              variants={v(
                { x: 0, opacity: 1 },
                {
                  x: [16, 0],
                  opacity: [0, 1],
                  transition: { delay: i * 0.18, duration: 0.45, ease: ease.emphasized },
                },
              )}
            >
              <span
                className={cn(
                  "absolute bottom-[20%] left-1/2 size-2 -translate-x-1/2 rounded-full",
                  i === 1 ? "bg-[hsl(var(--tone))]" : "bg-[hsl(var(--tone)/0.45)]",
                )}
              />
            </motion.span>
          ))}
        </div>
      );
      break;
    case "question":
      body = (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-[9%]">
          <motion.span
            className="rounded-xl rounded-bl-sm bg-[hsl(var(--tone)/0.3)] px-3 py-0.5 text-[12px] font-bold text-[hsl(var(--tone))]"
            variants={v(
              { scale: 1 },
              { scale: [0.6, 1.15, 1], transition: { duration: 0.5, ease: ease.emphasized } },
            )}
          >
            ?
          </motion.span>
          <div className="flex gap-1.5">
            {[0, 1].map((i) => (
              <motion.span
                key={i}
                className={cn(
                  "h-3 w-9 rounded-full ring-1",
                  i === 0
                    ? "bg-[hsl(var(--tone)/0.35)] ring-[hsl(var(--tone)/0.4)]"
                    : "ring-foreground/15",
                )}
                variants={v(
                  { opacity: 1, y: 0 },
                  { opacity: [0, 1], y: [6, 0], transition: { delay: 0.25 + i * 0.15 } },
                )}
              />
            ))}
          </div>
        </div>
      );
      break;
    case "compare":
      body = (
        <div
          className="absolute inset-[12%] flex flex-col justify-center gap-[12%]"
          style={{ perspective: 320 }}
        >
          {[0, 1].map((i) => (
            <motion.div
              key={i}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2 py-1.5",
                i === 0 ? "bg-foreground/[0.09]" : "bg-[hsl(var(--tone)/0.3)]",
              )}
              variants={v(
                { rotateX: 0 },
                {
                  rotateX: [90, 0],
                  transition: { delay: i * 0.28, duration: 0.5, ease: ease.emphasized },
                },
              )}
            >
              {i === 0 ? (
                <X className="size-2.5 text-muted-foreground" strokeWidth={3} />
              ) : (
                <Check className="size-2.5 text-[hsl(var(--tone))]" strokeWidth={3} />
              )}
              <span className="h-1.5 flex-1 rounded-full bg-foreground/15" />
            </motion.div>
          ))}
        </div>
      );
      break;
  }

  return (
    <motion.div
      aria-hidden
      initial="rest"
      animate={play && !reduce ? "play" : "rest"}
      className={cn(
        "relative aspect-[16/10] w-full overflow-hidden rounded-xl bg-gradient-to-br from-[hsl(var(--tone)/0.18)] via-[hsl(var(--tone)/0.06)] to-transparent ring-1 ring-[hsl(var(--tone)/0.16)]",
        className,
      )}
    >
      {body}
    </motion.div>
  );
}

/** The template's structure as a row of beats: Hook → Myth → Fact → CTA. */
export function BeatPills({ beats, className }: { beats: string[]; className?: string }) {
  return (
    <ol
      key={beats.join("|")}
      className={cn("flex flex-wrap items-center gap-1", className)}
      aria-label="Template structure"
    >
      {beats.map((b, i) => (
        <motion.li
          key={i}
          initial={{ opacity: 0, y: 6, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: i * 0.07, type: "spring", stiffness: 420, damping: 28 }}
          className="flex items-center gap-1 text-[11px] leading-none"
        >
          {i ? (
            <span aria-hidden className="text-[10px] text-muted-foreground/60">
              →
            </span>
          ) : null}
          <span className="rounded-full bg-[hsl(var(--tone)/0.12)] px-2 py-1 text-[11px] font-medium leading-none text-[hsl(var(--tone))] ring-1 ring-[hsl(var(--tone)/0.25)]">
            {b}
          </span>
        </motion.li>
      ))}
    </ol>
  );
}

export function TemplateCard({
  template: t,
  type,
  selected,
  index,
  onPick,
  footer,
  className,
}: {
  template: StudioTemplate;
  type: StudioType;
  selected?: boolean;
  index: number;
  onPick: () => void;
  footer?: React.ReactNode;
  className?: string;
}) {
  const [active, setActive] = useState(false);
  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={!!selected}
      onClick={onPick}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.045, type: "spring", stiffness: 320, damping: 28 }}
      whileTap={{ scale: 0.97 }}
      className={cn(
        `studio-tone-${type} group relative flex w-[168px] shrink-0 snap-start flex-col rounded-2xl bg-surface-3 p-2 text-left ring-1`,
        "transition-[box-shadow,translate] duration-[--motion-duration-base] ease-[--motion-ease-emphasized]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--tone))]",
        selected
          ? "shadow-[0_14px_30px_-16px_hsl(var(--tone)/0.6)] ring-2 ring-[hsl(var(--tone))]"
          : "ring-border/70 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-18px_hsl(var(--tone)/0.5)] hover:ring-[hsl(var(--tone)/0.45)]",
        className,
      )}
    >
      <TemplateThumb layout={t.thumb} play={active || !!selected} />
      <span className="mt-2 px-1 text-[13px] font-semibold leading-tight text-foreground">
        {t.label}
      </span>
      <span className="mt-0.5 line-clamp-2 px-1 pb-1 text-[11px] leading-snug text-muted-foreground">
        {t.tagline}
      </span>
      {footer}
      {selected ? (
        <span className="absolute right-3.5 top-3.5 grid size-5 place-items-center rounded-full bg-[hsl(var(--tone))] text-surface-3 shadow-2">
          <DrawCheck className="size-3" strokeWidth={3.5} />
        </span>
      ) : null}
    </motion.button>
  );
}

/**
 * "Start from a template" on the brief step. Picking one fills the brief with
 * blanks to complete, applies its settings, and selects the first blank.
 */
export function TemplateGallery({
  session,
  textareaRef,
  className,
}: {
  session: StudioSession;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  className?: string;
}) {
  const templates = templatesFor(session.type);
  if (!templates.length) return null;

  const pick = (t: StudioTemplate) => {
    if (t.id === session.template) return;
    const previous = session.brief.trim();
    const prev = applyTemplate(session.id, t.id);
    if (!prev) return;
    window.requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const blank = firstBlank(t.starter);
      if (blank) el.setSelectionRange(blank[0], blank[1]);
    });
    if (previous && !isTemplateStarter(previous)) {
      toast(`Using “${t.label}”`, {
        description: "Your brief was replaced with the template.",
        action: { label: "Undo", onClick: () => restoreTemplateState(session.id, prev) },
      });
    }
  };

  return (
    <section data-no-rhythm aria-labelledby="studio-templates" className={className}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 id="studio-templates" className="text-xs font-medium text-foreground">
          Start from a template{" "}
          <span className="font-normal text-muted-foreground">· optional</span>
        </h3>
        <span className="text-[11px] text-muted-foreground">Proven structures Mellox follows</span>
      </div>
      <div
        role="radiogroup"
        aria-label="Templates"
        className="-mx-1 flex snap-x gap-2.5 overflow-x-auto px-1 pb-2 pt-1 [scrollbar-width:thin]"
      >
        {templates.map((t, i) => (
          <TemplateCard
            key={t.id}
            template={t}
            type={session.type}
            selected={t.id === session.template}
            index={i}
            onPick={() => pick(t)}
          />
        ))}
      </div>
    </section>
  );
}
